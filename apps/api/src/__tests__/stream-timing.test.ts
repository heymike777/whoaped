import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamTimingReporter } from '../services/stream-timing.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('stream timing', () => {
  it('separates delay before receipt, queue wait and processing time', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new StreamTimingReporter().record(0, { slot: 99, blockTime: 100 }, 506_000, 508_100, 508_150);
    expect(warn).toHaveBeenCalledWith('solana_stream_timing_slow', expect.objectContaining({
      slot: 99, blockTimeSource: 'frame', blockToStreamMs: 406_000, queueMs: 2_100, processingMs: 50,
    }));
  });

  it('samples a missing block timestamp asynchronously and bounds RPC requests', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('HELIUS_API_KEY', 'test-key');
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn(() => promise);
    vi.stubGlobal('fetch', fetcher);
    const timings = new StreamTimingReporter();
    timings.record(0, { slot: 99, blockTime: null }, 506_000, 506_001, 506_002);
    timings.record(0, { slot: 100, blockTime: null }, 506_002, 506_003, 506_004);
    expect(warn).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(Response.json({ result: 100 }));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('solana_stream_timing_slow', expect.objectContaining({
      slot: 99, blockTimeSource: 'rpc', blockToStreamMs: 406_000, queueMs: 1, processingMs: 1,
    })));
  });
});
