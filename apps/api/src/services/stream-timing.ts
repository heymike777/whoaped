import type { ParsedSolanaTransaction } from '../chains/solana.js';

const SAMPLE_MS = 60_000;
const BLOCK_LOOKUP_INTERVAL_MS = 10_000;
const WORKER_SLOW_MS = 2_000;
const BLOCK_TO_STREAM_SLOW_MS = 10_000;
const SLOW_LOG_INTERVAL_MS = 5_000;

async function lookupBlockTime(slot: number): Promise<number | null> {
  const key = process.env.HELIUS_API_KEY;
  if (!key || !Number.isSafeInteger(slot) || slot <= 0) return null;
  try {
    const response = await fetch('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockTime', params: [slot] }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const { result } = await response.json() as { result?: number | null };
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export class StreamTimingReporter {
  private lastSampleAt = -Infinity;
  private lastLookupAt = -Infinity;
  private lastSlowLogAt = -Infinity;

  record(connectionIndex: number, tx: Pick<ParsedSolanaTransaction, 'slot' | 'blockTime'>, receivedAt: number, startedAt: number, finishedAt: number) {
    const sample = finishedAt - this.lastSampleAt >= SAMPLE_MS;
    if (sample) this.lastSampleAt = finishedAt;
    const queueMs = Math.max(0, startedAt - receivedAt);
    const processingMs = Math.max(0, finishedAt - startedAt);
    const log = (blockTime: number | null, blockTimeSource: 'frame' | 'rpc' | null) => {
      const blockToStreamMs = blockTime == null ? null : receivedAt - 1000 * blockTime;
      const slow = queueMs >= WORKER_SLOW_MS || processingMs >= WORKER_SLOW_MS
        || (blockToStreamMs ?? 0) >= BLOCK_TO_STREAM_SLOW_MS;
      const timing = {
        connectionIndex, slot: tx.slot, blockTimeSource, blockToStreamMs, queueMs, processingMs,
        streamReceivedAt: new Date(receivedAt).toISOString(),
        streamProcessingStartedAt: new Date(startedAt).toISOString(),
      };
      if (slow && finishedAt - this.lastSlowLogAt >= SLOW_LOG_INTERVAL_MS) {
        this.lastSlowLogAt = finishedAt;
        console.warn('solana_stream_timing_slow', timing);
      } else if (sample) {
        console.info('solana_stream_timing_sample', timing);
      }
    };
    if (typeof tx.blockTime === 'number' && Number.isFinite(tx.blockTime)) {
      log(tx.blockTime, 'frame');
    } else if ((sample || queueMs >= WORKER_SLOW_MS || processingMs >= WORKER_SLOW_MS)
      && finishedAt - this.lastLookupAt >= BLOCK_LOOKUP_INTERVAL_MS) {
      this.lastLookupAt = finishedAt;
      // Metrics only: neither activity nor notification delivery waits on this request.
      void lookupBlockTime(tx.slot).then(time => log(time, time == null ? null : 'rpc'));
    } else {
      log(null, null);
    }
  }
}
