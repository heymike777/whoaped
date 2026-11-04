import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collections, PortfolioSnapshotDocument, WalletDocument } from '../db.js';
import { addDasBalances, aggregatePortfolio, formatPortfolio, getPortfolioSnapshot } from '../services/telegram-portfolio.js';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCaKGKZ5PjyaWE5BqB';
const UNKNOWN = 'UnknownMint11111111111111111111111111111111';
const address = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';
const wallet = (index: number): WalletDocument => ({ _id: `w${index}`, userId: 'telegram:123', name: `Wallet ${index}`,
  address: `${address.slice(0, -2)}${String(index).padStart(2, '0')}`, chain: 'solana', status: 'active', createdAt: new Date(0) });
const snapshot = (count: number): PortfolioSnapshotDocument => ({
  _id: 'telegram:123', walletIds: Array.from({ length: count }, (_, i) => `w${i}`),
  wallets: Array.from({ length: count }, (_, i) => ({ id: `w${i}`, name: `Wallet ${i}`, address,
    holdings: [{ mint: SOL, symbol: 'SOL', amount: 1, usdValue: 100 }, { mint: USDC, symbol: 'USDC', amount: 25, usdValue: 25 },
      ...Array.from({ length: 40 }, (_, n) => ({ mint: `token-${n}`, symbol: `TOKEN${n}`, amount: 2, usdValue: n + 1 }))],
  })), createdAt: new Date(), expiresAt: new Date(Date.now() + 120_000), incomplete: false,
});

describe('Telegram portfolio', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('converts DAS raw balances and native lamports without including NFTs or zero balances', () => {
    const amounts = new Map<string, number>();
    addDasBalances(amounts, { nativeBalance: { lamports: 1_500_000_000 }, items: [
      { id: USDC, interface: 'FungibleToken', token_info: { balance: '12500000', decimals: 6 } },
      { id: BONK, interface: 'FungibleAsset', token_info: { balance: 200, decimals: 2 } },
      { id: 'nft', interface: 'V1_NFT', token_info: { balance: 1, decimals: 0 } },
      { id: 'empty', interface: 'FungibleToken', token_info: { balance: 0, decimals: 6 } },
    ] }, true);
    expect([...amounts]).toEqual([[SOL, 1.5], [USDC, 12.5], [BONK, 2]]);
  });

  it('paginates 200 wallets and many tokens while keeping every Telegram message under 4000 characters', () => {
    const data = snapshot(200);
    expect(aggregatePortfolio(data).find(item => item.mint === SOL)?.amount).toBe(200);
    const total = formatPortfolio(data, 'total');
    expect(total.text).toContain('200 wallets');
    expect(total.text).toContain('$189,000.00');
    expect(total.buttons.flat()).toContainEqual({ text: 'Next →', callback_data: 'portfolio:tokens:1' });
    for (let page = 0; page < 34; page++) {
      const list = formatPortfolio(data, 'wallets', page);
      expect(list.text.length).toBeLessThan(4000);
      expect(list.buttons.length).toBeLessThan(10);
    }
    for (let page = 0; page < 10; page++) {
      expect(formatPortfolio(data, 'total', page).text.length).toBeLessThan(4000);
      expect(formatPortfolio(data, 'wallet', page, 199).text.length).toBeLessThan(4000);
    }
    expect(formatPortfolio(data, 'wallets', 33).buttons.flat()).toContainEqual({ text: '200. Wallet 199', callback_data: 'portfolio:wallet:199:0' });
  });

  it('loads all tracked wallets, uses Jupiter membership and prices, and reuses a fresh snapshot', async () => {
    vi.stubEnv('HELIUS_API_KEY', 'helius-test'); vi.stubEnv('JUPITER_API_KEY', 'jupiter-test');
    const wallets = [wallet(0), wallet(1)];
    const findOne = vi.fn().mockResolvedValueOnce(null);
    const replaceOne = vi.fn().mockResolvedValue({});
    const db = { wallets: { find: vi.fn(() => ({ sort: () => ({ toArray: async () => wallets }) })) },
      portfolioSnapshots: { findOne, replaceOne } } as unknown as Collections;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('helius-rpc')) {
        const owner = JSON.parse(String(init?.body)).params.ownerAddress;
        return { ok: true, json: async () => ({ result: { nativeBalance: { lamports: owner === wallets[0].address ? 1_000_000_000 : 2_000_000_000 }, items: [
          { id: USDC, interface: 'FungibleToken', token_info: { balance: '10000000', decimals: 6 } },
          { id: BONK, interface: 'FungibleToken', token_info: { balance: '1000000', decimals: 5 } },
          { id: UNKNOWN, interface: 'FungibleToken', token_info: { balance: '1000000', decimals: 5 } },
        ] } }) };
      }
      if (url.includes('/tokens/v2/search')) return { ok: true, json: async () => [
        { id: SOL, symbol: 'SOL' }, { id: USDC, symbol: 'USDC' }, { id: BONK, symbol: 'BONK' },
      ] };
      if (url.includes('/price/v3')) return { ok: true, json: async () => ({
        [SOL]: { usdPrice: 100 }, [USDC]: { usdPrice: 1 }, [BONK]: { usdPrice: 0.01 },
      }) };
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getPortfolioSnapshot(db, 'telegram:123');
    expect(result.wallets).toHaveLength(2);
    expect(result.wallets[0].holdings.find(item => item.mint === BONK)?.usdValue).toBe(0.1);
    expect(result.wallets[0].holdings.some(item => item.mint === UNKNOWN)).toBe(false);
    expect(formatPortfolio(result, 'total').text).toContain('$320.20');
    expect(replaceOne).toHaveBeenCalledOnce();
    findOne.mockResolvedValue(result);
    fetchMock.mockClear();
    expect(await getPortfolioSnapshot(db, 'telegram:123')).toBe(result);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks failed wallet reads as partial instead of treating them as zero-valued', async () => {
    vi.stubEnv('HELIUS_API_KEY', 'helius-test'); vi.stubEnv('JUPITER_API_KEY', 'jupiter-test');
    const wallets = [wallet(0), wallet(1)];
    const db = { wallets: { find: () => ({ sort: () => ({ toArray: async () => wallets }) }) },
      portfolioSnapshots: { findOne: async () => null, replaceOne: async () => ({}) } } as unknown as Collections;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('helius-rpc')) {
        const owner = JSON.parse(String(init?.body)).params.ownerAddress;
        return { ok: true, json: async () => owner === wallets[0].address
          ? { result: { nativeBalance: { lamports: 1_000_000_000 }, items: [] } }
          : { error: { message: 'unavailable' } } };
      }
      if (url.includes('/tokens/v2/search')) return { ok: true, json: async () => [{ id: SOL, symbol: 'SOL' }] };
      return { ok: true, json: async () => ({ [SOL]: { usdPrice: 100 } }) };
    }));
    const result = await getPortfolioSnapshot(db, 'telegram:123');
    expect(result.incomplete).toBe(true);
    expect(result.wallets[1].error).toBe(true);
    expect(formatPortfolio(result, 'wallets').text).toContain('Partial data');
  });
});
