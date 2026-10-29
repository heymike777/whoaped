import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedActivity } from '../chains/types.js';
import { enrichSwapActivity } from '../services/token-metadata.js';

describe('swap token metadata enrichment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HELIUS_API_KEY;
  });

  it('adds token symbols, names, and secure icon URLs from Helius DAS', async () => {
    process.env.HELIUS_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [
        {
          id: 'input-mint-test',
          token_info: { symbol: 'IN' },
          content: { metadata: { name: 'Input Token' }, links: { image: 'https://cdn.example/input.png' } },
        },
        {
          id: 'output-mint-test',
          content: {
            metadata: { name: 'Output Token', symbol: 'OUT' },
            files: [{ mime: 'image/png', cdn_uri: 'https://cdn.example/output.png' }],
          },
        },
      ] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const activity: NormalizedActivity = {
      chain: 'solana',
      txHash: 'signature',
      eventIndex: 0,
      kind: 'swap',
      title: 'Swap',
      detail: 'Jupiter',
      occurredAt: new Date(),
      metadata: { swap: {
        dex: 'jupiter',
        dexName: 'Jupiter',
        input: { mint: 'input-mint-test', symbol: 'input', amount: 1 },
        output: { mint: 'output-mint-test', symbol: 'output', amount: 2 },
      } },
    };

    const enriched = await enrichSwapActivity(activity);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(enriched.metadata.swap).toMatchObject({
      input: { symbol: 'IN', name: 'Input Token', iconUrl: 'https://cdn.example/input.png' },
      output: { symbol: 'OUT', name: 'Output Token', iconUrl: 'https://cdn.example/output.png' },
    });
  });
});
