import type { ParsedSolanaTransaction } from '../chains/solana.js';
import { collections } from '../db.js';
import { backfillParsedEvents } from './parsed-events.js';
import {
  ADDRESSES_PER_CONNECTION,
  chunks,
  streamSubscriptions,
} from './parsed-stream-protocol.js';
import { ingestParsedTransaction } from './parsed-transactions.js';
import { drainNotificationJobs } from './push.js';
import { drainUsdcPayments } from './usdc-payments.js';
import { drainTelegramJobs } from './telegram.js';
import { drainTelegramGa4Events } from './telegram-ga4.js';
import { eligibleSubscriptionPlan, resumeAccountsAtSlot } from './rate-limits.js';
import { StreamTimingReporter } from './stream-timing.js';

function positiveInteger(value: string | undefined, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
}

const STREAM_URL = (process.env.HELIUS_PARSED_STREAM_URL ?? 'wss://fs-beta.helius-rpc.com').replace(/\/$/, '');
const REFRESH_MS = positiveInteger(process.env.HELIUS_WALLET_REFRESH_MS, 5_000);
const PING_MS = positiveInteger(process.env.HELIUS_STREAM_PING_MS, 240_000, 540_000);
const RECOVERY_RETRY_MS = 30_000;
const SLOT_PING_GRACE_MS = 1_500;
const SLOT_RPC_TIMEOUT_MS = 5_000;

type StreamValue = {
  transaction: ParsedSolanaTransaction;
  instructions?: ParsedSolanaTransaction['instructions'];
};

type StreamNotification = {
  method: 'parsedTransactionNotification';
  params: {
    result: {
      context: { slot: number };
      value: StreamValue;
    };
  };
};

type RpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function positiveSlot(value: unknown): number | null {
  const slot = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof slot === 'number' && Number.isSafeInteger(slot) && slot > 0 ? slot : null;
}

function pingSlot(result: unknown): number | null {
  // Parsed Streams currently returns { slot }; keep accepting the older scalar reply.
  return result !== null && typeof result === 'object' && 'slot' in result
    ? positiveSlot(result.slot)
    : positiveSlot(result);
}

async function confirmedRpcSlot(apiKey: string, signal: AbortSignal): Promise<number> {
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'confirmed' }] }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(SLOT_RPC_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error(`Slot RPC returned ${response.status}`);
  const payload = await response.json() as RpcResponse;
  const slot = payload.error ? null : positiveSlot(payload.result);
  if (slot === null) throw new Error('Slot RPC did not return a valid slot');
  return slot;
}

async function getCheckpoint(id: string) {
  const db = await collections();
  const row = await db.pipelineCheckpoints.findOne({ _id: id });
  return row?.lastSlot ?? null;
}

async function saveCheckpoint(id: string, slot: number) {
  const db = await collections();
  await db.pipelineCheckpoints.updateOne(
    { _id: id },
    { $max: { lastSlot: slot }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );
}

export const addressCheckpointId = (address: string) => `solana-parsed-address:${address}`;

async function saveAddressCheckpoints(addresses: string[], slot: number) {
  const db = await collections();
  const updatedAt = new Date();
  await db.pipelineCheckpoints.bulkWrite(addresses.map(address => ({
    updateOne: {
      filter: { _id: addressCheckpointId(address) },
      update: { $max: { lastSlot: slot }, $set: { updatedAt } },
      upsert: true,
    },
  })), { ordered: false });
}

export async function backfillTrackedAddresses(addresses: string[], currentSlot: number, onCooldown?: () => Promise<void>, shouldContinue: () => boolean = () => true, signal?: AbortSignal) {
  const queue = [...addresses];
  const concurrency = Math.min(positiveInteger(process.env.HELIUS_BACKFILL_CONCURRENCY, 4, 16), queue.length);
  const results = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
    while (queue.length && shouldContinue()) {
      const address = queue.shift();
      if (!address) return;
      const id = addressCheckpointId(address);
      const previousSlot = await getCheckpoint(id);
      if (shouldContinue() && previousSlot != null && currentSlot > previousSlot) {
        await backfillParsedEvents(address, previousSlot, currentSlot, 20, { onCooldown, shouldContinue, signal });
      }
      if (shouldContinue()) await saveCheckpoint(id, currentSlot);
    }
  }));
  // Wait for all lanes to finish before a retry can start new history requests.
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function streamTransaction(notification: StreamNotification): ParsedSolanaTransaction {
  const value = notification.params.result.value;
  return {
    ...value.transaction,
    slot: value.transaction.slot ?? notification.params.result.context.slot,
    instructions: value.instructions ?? value.transaction.instructions ?? [],
  };
}

async function messageText(data: unknown) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return String(data);
}

export class ParsedStreamSupervisor {
  private generation = 0;
  private fingerprint = '';
  private sockets = new Set<WebSocket>();
  private stopped = false;
  private refreshTimer?: NodeJS.Timeout;
  private pushTimer?: NodeJS.Timeout;
  private readonly activeDrains = new Set<string>();
  private readonly timing = new StreamTimingReporter();
  private lastRefreshAt = 0;
  private refreshing?: Promise<void>;

  async start() {
    if (!process.env.HELIUS_API_KEY) throw new Error('HELIUS_API_KEY is not configured');
    await this.migrateLegacyCheckpoints();
    await this.refreshSubscriptions();
    this.refreshTimer = setInterval(() => {
      this.refreshSubscriptions().catch((error) => console.error('Wallet subscription refresh failed', error));
    }, REFRESH_MS);
    this.pushTimer = setInterval(() => {
      this.drainPush().catch((error) => console.error('Notification drain failed', error));
    }, 1_000);
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.pushTimer) clearInterval(this.pushTimer);
    for (const socket of this.sockets) socket.close(1000, 'worker stopping');
    this.sockets.clear();
  }

  isHealthy() {
    const maximumRefreshAge = Math.max(REFRESH_MS * 3, 30_000);
    return !this.stopped && Date.now() - this.lastRefreshAt <= maximumRefreshAge;
  }

  private async drainPush() {
    // Portfolio commands may inspect many wallets. Do not let a slow Telegram
    // command stop mobile push delivery or the other background drains.
    for (const [name, drain] of [
      ['push', drainNotificationJobs], ['telegram', drainTelegramJobs],
      ['payments', drainUsdcPayments], ['analytics', drainTelegramGa4Events],
    ] as const) {
      if (this.activeDrains.has(name)) continue;
      this.activeDrains.add(name);
      void Promise.resolve().then(async () => { await drain(); })
        .catch(error => console.error(`${name} drain failed`, error))
        .finally(() => this.activeDrains.delete(name));
    }
  }

  private async migrateLegacyCheckpoints() {
    const db = await collections();
    if (await db.pipelineCheckpoints.findOne({ _id: { $regex: '^solana-parsed-address:' } })) return;
    const { addresses } = await eligibleSubscriptionPlan();
    const groups = chunks(addresses, ADDRESSES_PER_CONNECTION);
    for (const [index, group] of groups.entries()) {
      const previous = await getCheckpoint(`solana-parsed-stream:${index}`);
      if (previous == null) continue;
      for (const address of group) await saveCheckpoint(addressCheckpointId(address), previous);
    }
  }

  async refreshSubscriptions() {
    if (this.stopped) return;
    while (this.refreshing) await this.refreshing;
    if (this.stopped) return;
    this.refreshing = this.rebuildSubscriptions().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async rebuildSubscriptions() {
    const plan = await eligibleSubscriptionPlan();
    const { addresses, fingerprint } = plan;
    this.lastRefreshAt = Date.now();
    if (fingerprint === this.fingerprint) return;

    this.fingerprint = fingerprint;
    this.generation += 1;
    const generation = this.generation;
    for (const socket of this.sockets) socket.close(1000, 'wallet set changed');
    this.sockets.clear();

    if (!addresses.length) {
      console.log('Parsed Streams idle: no active Solana wallets');
      return;
    }

    const groups = chunks(addresses, ADDRESSES_PER_CONNECTION);
    console.log(`Opening ${groups.length} Parsed Streams connection(s) for ${addresses.length} wallets`);
    groups.forEach((group, index) => this.connect(group, index, generation, 1_000));
  }

  private connect(addresses: string[], connectionIndex: number, generation: number, backoffMs: number) {
    if (this.stopped || generation !== this.generation) return;
    const apiKey = process.env.HELIUS_API_KEY as string;
    const socket = new WebSocket(`${STREAM_URL}/?api-key=${encodeURIComponent(apiKey)}`);
    const pingIds = new Set<number>();
    const subscriptionIds = new Set(streamSubscriptions(addresses, true).map((request) => request.id));
    let pingSequence = 0;
    let processing = Promise.resolve();
    let processingFailed = false;
    let pingTimer: NodeJS.Timeout | undefined;
    let recoveryStarted = false;
    let recovered = false;
    let closed = false;
    let recoveryTimer: NodeJS.Timeout | undefined;
    let slotFallbackTimer: NodeJS.Timeout | undefined;
    const recoveryController = new AbortController();
    const current = () => !closed && !processingFailed && !this.stopped && generation === this.generation;

    const recover = async (slot: number) => {
      if (!current()) return;
      const startedAt = Date.now();
      try {
        await backfillTrackedAddresses(
          addresses, slot, () => this.refreshSubscriptions(), current, recoveryController.signal,
        );
        if (!current()) return;
        recovered = true;
        console.info('solana_stream_recovery_complete', { connectionIndex, slot, durationMs: Date.now() - startedAt });
      } catch (error) {
        if (!current()) return;
        // A slow or unavailable REST endpoint must not tear down a healthy live socket.
        const reason = error instanceof Error
          ? error.message.match(/^Helius Parsed Events failed \(\d{3}\)/)?.[0] ?? error.name : 'UnknownError';
        console.warn('solana_stream_recovery_retry', { connectionIndex, slot, durationMs: Date.now() - startedAt, reason });
        recoveryTimer = setTimeout(() => { void recover(slot); }, RECOVERY_RETRY_MS);
      }
    };

    const enqueue = (task: () => Promise<void>) => {
      processing = processing.then(async () => {
        if (!current()) return;
        await task();
      }).catch((error) => {
        console.error(`Parsed Streams processing failed for connection ${connectionIndex}`, error);
        if (current()) {
          processingFailed = true;
          socket.close(4001, 'processing failed');
        }
      });
    };

    const beginRecovery = async (slot: number, source: 'stream_ping' | 'confirmed_rpc') => {
      if (recoveryStarted || !current() || subscriptionIds.size !== 0) return;
      recoveryStarted = true;
      clearTimeout(slotFallbackTimer);
      // Apply the live slot floor before history runs. Paused transactions must not replay.
      await resumeAccountsAtSlot(addresses, slot);
      console.info('solana_stream_recovery_anchor', { connectionIndex, slot, source });
      void recover(slot);
    };

    const lookupRecoverySlot = async () => {
      if (recoveryStarted || !current()) return;
      try {
        const slot = await confirmedRpcSlot(apiKey, recoveryController.signal);
        // Order the database resume with live frames and ignore stale sockets or a winning ping.
        enqueue(() => beginRecovery(slot, 'confirmed_rpc'));
      } catch (error) {
        if (recoveryStarted || !current()) return;
        // Keep the socket live and do not log transport errors that can contain the API key.
        console.warn('solana_stream_recovery_anchor_retry', { connectionIndex, reason: error instanceof Error ? error.name : 'UnknownError' });
        slotFallbackTimer = setTimeout(() => { void lookupRecoverySlot(); }, RECOVERY_RETRY_MS);
      }
    };

    const sendPing = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const id = 100_000 + pingSequence++;
      pingIds.add(id);
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }));
    };

    this.sockets.add(socket);
    socket.addEventListener('open', () => {
      for (const subscription of streamSubscriptions(addresses, true)) {
        socket.send(JSON.stringify(subscription));
      }
      sendPing();
      pingTimer = setInterval(sendPing, PING_MS);
      console.log(`Parsed Streams connection ${connectionIndex} subscribed`);
    });

    socket.addEventListener('message', (event) => {
      const streamReceivedAt = Date.now();
      enqueue(async () => {
        const streamProcessingStartedAt = Date.now();
        const message = JSON.parse(await messageText(event.data)) as RpcResponse | StreamNotification;
        if ('error' in message && message.error) {
          if (message.id != null && subscriptionIds.has(message.id)) {
            throw new Error(`subscription ${message.id} rejected (${message.error.code ?? 'unknown'}): ${message.error.message ?? 'unknown'}`);
          }
          console.error(`Parsed Streams RPC error ${message.error.code ?? ''}: ${message.error.message ?? 'unknown'}`);
          return;
        }
        if ('id' in message && message.id != null && subscriptionIds.delete(message.id)) {
          if (subscriptionIds.size === 0) {
            sendPing();
            // Some Parsed Streams gateways return a keepalive acknowledgement, not a slot.
            // The timer also covers a missing response and does not block live processing.
            slotFallbackTimer = setTimeout(() => { void lookupRecoverySlot(); }, SLOT_PING_GRACE_MS);
          }
          return;
        }
        if ('id' in message && message.id != null && pingIds.delete(message.id)) {
          const slot = pingSlot(message.result);
          if (slot !== null && subscriptionIds.size === 0) {
            if (!recoveryStarted) {
              await beginRecovery(slot, 'stream_ping');
            } else if (recovered) {
              // All live frames before this ping are durable, and its historical
              // range has already been covered. Avoid skipping a recovery gap.
              await saveAddressCheckpoints(addresses, slot);
            }
          }
          return;
        }
        if ('method' in message && message.method === 'parsedTransactionNotification') {
          const transaction = streamTransaction(message);
          try {
            await ingestParsedTransaction(transaction, {
              provider: 'helius-parsed-stream',
              streamTiming: { streamReceivedAt, streamProcessingStartedAt },
              onCooldown: () => this.refreshSubscriptions(),
            });
          } finally {
            this.timing.record(connectionIndex, transaction, streamReceivedAt, streamProcessingStartedAt, Date.now());
          }
        }
      });
    });

    socket.addEventListener('error', (event) => {
      console.error(`Parsed Streams connection ${connectionIndex} error`, event);
    });

    socket.addEventListener('close', (event) => {
      closed = true;
      recoveryController.abort();
      if (recoveryTimer) clearTimeout(recoveryTimer);
      clearTimeout(slotFallbackTimer);
      if (pingTimer) clearInterval(pingTimer);
      this.sockets.delete(socket);
      if (this.stopped || generation !== this.generation) return;
      const nextBackoff = Math.min(backoffMs * 2, 30_000);
      console.warn(`Parsed Streams connection ${connectionIndex} closed (${event.code}); retrying in ${backoffMs}ms`);
      setTimeout(() => this.connect(addresses, connectionIndex, generation, nextBackoff), backoffMs);
    });
  }
}
