import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  enabled: false,
  find: vi.fn(),
  bulkWrite: vi.fn(),
}));

vi.mock('../db.js', () => ({
  hasDatabase: () => dbMocks.enabled,
  collections: async () => ({
    tokenMetadata: { find: dbMocks.find, bulkWrite: dbMocks.bulkWrite },
  }),
}));

import type { NormalizedActivity } from '../chains/types.js';
import { enrichActivityMetadata, enrichSwapActivity } from '../services/token-metadata.js';

describe('swap token metadata enrichment', () => {
  beforeEach(() => {
    dbMocks.enabled = false;
    dbMocks.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    dbMocks.bulkWrite.mockResolvedValue({ ok: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HELIUS_API_KEY;
    delete process.env.JUPITER_API_KEY;
    vi.clearAllMocks();
  });

  it('resolves a marketplace NFT name and image through DAS while retaining the listing price', async () => {
    process.env.HELIUS_API_KEY = 'helius-test';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url.includes('api.jup.ag') ? [] : { result: [{ id: 'nft-listing-mint',
        content: { metadata: { name: 'SMB Gen3 #11517' }, links: { image: 'https://example.com/nft.png' } },
      }] },
    })));
    const activity: NormalizedActivity = { chain: 'solana', txHash: 'listing', eventIndex: 0, kind: 'nft',
      title: 'Listed NFT for 2.617 SOL', detail: 'Magic Eden', source: 'Magic Eden', occurredAt: new Date(),
      metadata: { nft: { marketplace: 'magic-eden', action: 'list', mint: 'nft-listing-mint', priceSol: 2.617 } },
    };
    const result = await enrichActivityMetadata(activity);
    expect(result.title).toBe('Listed SMB Gen3 #11517 for 2.617 SOL');
    expect(result.metadata.nft).toMatchObject({ name: 'SMB Gen3 #11517', imageUrl: 'https://example.com/nft.png' });
    expect(result.metadata.tokenActions).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('resolves a Metaplex Core asset image for an NFT mint', async () => {
    process.env.HELIUS_API_KEY = 'helius-test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: [{
      id: 'core-asset-test', content: { metadata: { name: 'Core Cat #1' }, links: { image: 'https://example.com/cat.png' } },
    }] }) }));
    const activity: NormalizedActivity = { chain: 'solana', txHash: 'core-mint', eventIndex: 0, kind: 'nft',
      title: 'Minted Core NFT', detail: 'Metaplex Core', source: 'Metaplex Core', occurredAt: new Date(),
      metadata: { nft: { mint: 'core-asset-test', action: 'mint' } },
    };
    const result = await enrichActivityMetadata(activity);
    expect(result.title).toBe('Minted Core Cat #1');
    expect(result.metadata.nft).toMatchObject({ name: 'Core Cat #1', imageUrl: 'https://example.com/cat.png' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('prefers verified Jupiter metadata, including SVG token icons', async () => {
    process.env.JUPITER_API_KEY = 'jupiter-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          id: 'input-mint-test',
          symbol: 'IN', name: 'Input Token', icon: 'https://cdn.example/input.svg', decimals: 6, isVerified: true,
        },
        {
          id: 'output-mint-test',
          symbol: 'OUT', name: 'Output Token', icon: 'https://cdn.example/output.png', decimals: 9, tags: ['verified'],
        },
      ]),
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
      input: { symbol: 'IN', name: 'Input Token', iconUrl: 'https://cdn.example/input.svg', decimals: 6, isVerified: true },
      output: { symbol: 'OUT', name: 'Output Token', iconUrl: 'https://cdn.example/output.png', decimals: 9, isVerified: true },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.jup.ag/tokens/v2/search?query='),
      expect.objectContaining({ headers: { 'x-api-key': 'jupiter-key' } }),
    );
  });

  it('enriches yield assets and rewrites the notification title', async () => {
    process.env.JUPITER_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{
        id: 'yield-mint-test',
        symbol: 'USDC', name: 'USD Coin', icon: 'https://cdn.example/usdc.png', isVerified: true,
      }]),
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
    process.env.JUPITER_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{
        id: 'launch-mint-test',
        symbol: 'LAUNCH', name: 'Launch Token', icon: 'https://cdn.example/launch.png', isVerified: true,
      }]),
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
    expect(enriched.metadata.tokenActions).toMatchObject([{
      token: { mint: 'launch-mint-test', symbol: 'LAUNCH', name: 'Launch Token' },
      links: [
        { id: 'bonkbot', label: 'BONKbot' },
        { id: 'gmgn', label: 'GMGN' },
        { id: 'fomo', label: 'FOMO' },
        { id: 'dexscreener', label: 'DexScreener' },
      ],
    }]);
  });

  it('falls back to Helius DAS when Jupiter has no verified metadata', async () => {
    process.env.HELIUS_API_KEY = 'helius-key';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{
          id: 'onchain-only-mint',
          token_info: { symbol: 'CHAIN' },
          content: {
            metadata: { name: 'On-chain Token' },
            links: { image: 'https://cdn.example/onchain.png' },
          },
        }] }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const activity: NormalizedActivity = {
      chain: 'solana',
      txHash: 'onchain-fallback',
      eventIndex: 0,
      kind: 'swap',
      title: 'Swap',
      detail: 'Meteora',
      occurredAt: new Date(),
      metadata: { swap: {
        dex: 'meteora',
        dexName: 'Meteora',
        input: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', amount: 1 },
        output: { mint: 'onchain-only-mint', symbol: 'unknown', amount: 2 },
      } },
    };

    const enriched = await enrichSwapActivity(activity);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(enriched.metadata.swap).toMatchObject({
      output: { symbol: 'CHAIN', name: 'On-chain Token', iconUrl: 'https://cdn.example/onchain.png' },
    });
  });

  it('persists resolved metadata in the backend Mongo cache by mint', async () => {
    dbMocks.enabled = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{
        id: 'mongo-cache-mint',
        symbol: 'CACHE',
        name: 'Cached Token',
        icon: 'https://cdn.example/cache.svg',
        decimals: 6,
        isVerified: true,
      }]),
    }));
    const activity: NormalizedActivity = {
      chain: 'solana', txHash: 'cache', eventIndex: 0, kind: 'balance', title: 'Cache', detail: '', occurredAt: new Date(),
      metadata: { tokenCandidates: [{ mint: 'mongo-cache-mint', decimals: 6 }] },
    };

    await enrichActivityMetadata(activity);

    expect(dbMocks.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { _id: 'mongo-cache-mint' },
          update: expect.objectContaining({
            $set: expect.objectContaining({ source: 'jupiter', symbol: 'CACHE', iconUrl: 'https://cdn.example/cache.svg' }),
          }),
          upsert: true,
        }),
      }),
    ], { ordered: false });
  });

  it('does not add trade actions for SOL, stablecoins, or NFTs', async () => {
    const activity: NormalizedActivity = {
      chain: 'solana', txHash: 'filtered', eventIndex: 0, kind: 'balance', title: 'Filtered', detail: '', occurredAt: new Date(),
      metadata: { tokenCandidates: [
        { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
        { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
        { mint: 'nft-mint', decimals: 0 },
      ] },
    };
    const enriched = await enrichActivityMetadata(activity);
    expect(enriched.metadata.tokenActions).toBeUndefined();
  });
});
