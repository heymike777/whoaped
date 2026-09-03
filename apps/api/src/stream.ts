import type { ParsedSolanaTransaction } from './chains/solana.js';
import { query } from './db.js';
import { backfillParsedEvents } from './services/parsed-events.js';
import {
  ADDRESSES_PER_CONNECTION,
  chunks,
  streamSubscriptions,
} from './services/parsed-stream-protocol.js';
import { ingestParsedTransaction } from './services/parsed-transactions.js';
import { drainNotificationJobs } from './services/push.js';

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
  const [row] = await query<{ last_slot: string | number }>(
    'SELECT last_slot FROM pipeline_checkpoints WHERE id = $1',
    [id],
  );
  return row ? Number(row.last_slot) : null;
}

async function saveCheckpoint(id: string, slot: number) {
  await query(
    `INSERT INTO pipeline_checkpoints (id, last_slot, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE
       SET last_slot = GREATEST(pipeline_checkpoints.last_slot, EXCLUDED.last_slot), updated_at = now()`,
    [id, slot],
  );
}

async function backfillConnection(checkpointId: string, addresses: string[], currentSlot: number) {
  const previousSlot = await getCheckpoint(checkpointId);
  if (previousSlot == null) {
    await saveCheckpoint(checkpointId, currentSlot);
    return;
  }
  if (currentSlot <= previousSlot) return;

  console.log(`Backfilling ${addresses.length} wallets from slot ${previousSlot} through ${currentSlot}`);
  const queue = [...addresses];
  const concurrency = Math.min(
    positiveInteger(process.env.HELIUS_BACKFILL_CONCURRENCY, 4, 16),
    queue.length,
  );
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const address = queue.shift();
      if (!address) return;
      await backfillParsedEvents(address, previousSlot, currentSlot);
    }
  }));
  await saveCheckpoint(checkpointId, currentSlot);
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

class ParsedStreamSupervisor {
  private generation = 0;
  private fingerprint = '';
  private sockets = new Set<WebSocket>();
  private stopped = false;
  private refreshTimer?: NodeJS.Timeout;
  private pushTimer?: NodeJS.Timeout;
  private drainingPush = false;

  async start() {
    if (!process.env.HELIUS_API_KEY) throw new Error('HELIUS_API_KEY is not configured');
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((error) => console.error('Wallet subscription refresh failed', error));
    }, REFRESH_MS);
    this.pushTimer = setInterval(() => {
      this.drainPush().catch((error) => console.error('Notification drain failed', error));
    }, 2_000);
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.pushTimer) clearInterval(this.pushTimer);
    for (const socket of this.sockets) socket.close(1000, 'worker stopping');
    this.sockets.clear();
  }

  private async drainPush() {
    if (this.drainingPush) return;
    this.drainingPush = true;
    try {
      await drainNotificationJobs();
    } finally {
      this.drainingPush = false;
    }
  }

  private async refresh() {
    const rows = await query<{ address: string }>(
      `SELECT DISTINCT address FROM wallets
       WHERE chain = 'solana' AND deleted_at IS NULL AND status != 'error'
       ORDER BY address`,
    );
    const addresses = rows.map((row) => row.address);
    const fingerprint = addresses.join(',');
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
    const checkpointId = `solana-parsed-stream:${connectionIndex}`;
    const pingIds = new Set<number>();
    const subscriptionIds = new Set(streamSubscriptions(addresses).map((request) => request.id));
    let pingSequence = 0;
    let processing = Promise.resolve();
    let processingFailed = false;
    let pingTimer: NodeJS.Timeout | undefined;
    let synchronized = false;

    const enqueue = (task: () => Promise<void>) => {
      processing = processing.then(task).catch((error) => {
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
      for (const subscription of streamSubscriptions(addresses)) {
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
              await backfillConnection(checkpointId, addresses, slot);
            } else {
              // The message queue is serial, so all notifications before this ping are durable.
              await saveCheckpoint(checkpointId, slot);
            }
          }
          return;
        }
        if ('method' in message && message.method === 'parsedTransactionNotification') {
          const transaction = streamTransaction(message);
          await ingestParsedTransaction(transaction, { provider: 'helius-parsed-stream' });
          await saveCheckpoint(checkpointId, transaction.slot);
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

const supervisor = new ParsedStreamSupervisor();
await supervisor.start();

const shutdown = () => {
  supervisor.stop();
  process.exitCode = 0;
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
