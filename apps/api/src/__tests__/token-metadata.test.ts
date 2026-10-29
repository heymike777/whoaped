import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedActivity } from '../chains/types.js';
import { enrichActivityMetadata, enrichSwapActivity } from '../services/token-metadata.js';

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

  it('enriches yield assets and rewrites the notification title', async () => {
    process.env.HELIUS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [{
        id: 'yield-mint-test',
        token_info: { symbol: 'USDC' },
        content: { metadata: { name: 'USD Coin' }, links: { image: 'https://cdn.example/usdc.png' } },
      }] }),
    }));
    const activity: NormalizedActivity = {
      chain: 'solana',
      txHash: 'yield-signature',
      eventIndex: 0,
      kind: 'yield',
      title: 'Deposit',
      detail: 'Kamino',
      occurredAt: new Date(),
      metadata: { yield: {
        action: 'deposit',
        protocol: 'kamino',
        protocolName: 'Kamino',
        assets: [{ mint: 'yield-mint-test', symbol: 'yiel…test', amount: 100.25 }],
      } },
    };

    const enriched = await enrichActivityMetadata(activity);

    expect(enriched.title).toBe('Deposited 100.25 USDC');
    expect(enriched.metadata.yield).toMatchObject({
      assets: [{ symbol: 'USDC', name: 'USD Coin', iconUrl: 'https://cdn.example/usdc.png' }],
    });
  });

  it('enriches a launched token while preserving its buy link', async () => {
    process.env.HELIUS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [{
        id: 'launch-mint-test',
        token_info: { symbol: 'LAUNCH' },
        content: { metadata: { name: 'Launch Token' }, links: { image: 'https://cdn.example/launch.png' } },
      }] }),
    }));
    const activity: NormalizedActivity = {
      chain: 'solana',
      txHash: 'launch-signature',
      eventIndex: 0,
      kind: 'launch',
      title: 'Launched token',
      detail: 'Pump.fun',
      occurredAt: new Date(),
      metadata: { launch: {
        platform: 'pumpfun',
        platformName: 'Pump.fun',
        token: { mint: 'launch-mint-test', symbol: 'unknown' },
        buyUrl: 'https://jup.ag/swap/SOL-launch-mint-test',
      } },
    };

    const enriched = await enrichActivityMetadata(activity);

    expect(enriched.title).toBe('Launched Launch Token (LAUNCH)');
    expect(enriched.metadata.launch).toMatchObject({
      buyUrl: 'https://jup.ag/swap/SOL-launch-mint-test',
      token: {
        symbol: 'LAUNCH',
        name: 'Launch Token',
        iconUrl: 'https://cdn.example/launch.png',
      },
    });
  });
});
