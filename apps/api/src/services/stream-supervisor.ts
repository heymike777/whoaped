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

function positiveInteger(value: string | undefined, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
}

const STREAM_URL = (process.env.HELIUS_PARSED_STREAM_URL ?? 'wss://fs-beta.helius-rpc.com').replace(/\/$/, '');
const REFRESH_MS = positiveInteger(process.env.HELIUS_WALLET_REFRESH_MS, 5_000);
const PING_MS = positiveInteger(process.env.HELIUS_STREAM_PING_MS, 240_000, 540_000);

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

export async function backfillTrackedAddresses(addresses: string[], currentSlot: number, onCooldown?: () => Promise<void>, shouldContinue: () => boolean = () => true) {
  const queue = [...addresses];
  const concurrency = Math.min(positiveInteger(process.env.HELIUS_BACKFILL_CONCURRENCY, 4, 16), queue.length);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length && shouldContinue()) {
      const address = queue.shift();
      if (!address) return;
      const id = addressCheckpointId(address);
      const previousSlot = await getCheckpoint(id);
      if (previousSlot != null && currentSlot > previousSlot) await backfillParsedEvents(address, previousSlot, currentSlot, 20, { onCooldown, shouldContinue });
      if (shouldContinue()) await saveCheckpoint(id, currentSlot);
    }
  }));
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
    let synchronized = false;

    const enqueue = (task: () => Promise<void>) => {
      processing = processing.then(async () => {
        if (this.stopped || generation !== this.generation) return;
        await task();
      }).catch((error) => {
        console.error(`Parsed Streams processing failed for connection ${connectionIndex}`, error);
        if (!processingFailed) {
          processingFailed = true;
          socket.close(1011, 'processing failed');
        }
      });
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
      enqueue(async () => {
        const message = JSON.parse(await messageText(event.data)) as RpcResponse | StreamNotification;
        if ('error' in message && message.error) {
          if (message.id != null && subscriptionIds.has(message.id)) {
            throw new Error(`subscription ${message.id} rejected (${message.error.code ?? 'unknown'}): ${message.error.message ?? 'unknown'}`);
          }
          console.error(`Parsed Streams RPC error ${message.error.code ?? ''}: ${message.error.message ?? 'unknown'}`);
          return;
        }
        if ('id' in message && message.id != null && subscriptionIds.delete(message.id)) {
          if (subscriptionIds.size === 0) sendPing();
          return;
        }
        if ('id' in message && message.id != null && pingIds.delete(message.id)) {
          const slot = Number(message.result);
          if (Number.isFinite(slot) && subscriptionIds.size === 0) {
            if (!synchronized) {
              synchronized = true;
              await resumeAccountsAtSlot(addresses, slot);
              await backfillTrackedAddresses(addresses, slot, () => this.refreshSubscriptions(), () => !this.stopped && generation === this.generation);
            } else {
              // The message queue is serial, so all notifications before this ping are durable.
              for (const address of addresses) await saveCheckpoint(addressCheckpointId(address), slot);
            }
          }
          return;
        }
        if ('method' in message && message.method === 'parsedTransactionNotification') {
          const transaction = streamTransaction(message);
          await ingestParsedTransaction(transaction, { provider: 'helius-parsed-stream', onCooldown: () => this.refreshSubscriptions() });
          if (generation === this.generation) {
            const involved = new Set(transaction.accountKeys ?? []);
            for (const address of addresses) if (involved.has(address)) await saveCheckpoint(addressCheckpointId(address), transaction.slot);
          }
        }
      });
    });

    socket.addEventListener('error', (event) => {
      console.error(`Parsed Streams connection ${connectionIndex} error`, event);
    });

    socket.addEventListener('close', (event) => {
      if (pingTimer) clearInterval(pingTimer);
      this.sockets.delete(socket);
      if (this.stopped || generation !== this.generation) return;
      const nextBackoff = Math.min(backoffMs * 2, 30_000);
      console.warn(`Parsed Streams connection ${connectionIndex} closed (${event.code}); retrying in ${backoffMs}ms`);
      setTimeout(() => this.connect(addresses, connectionIndex, generation, nextBackoff), backoffMs);
    });
  }
}
