import type { Collections, PortfolioHolding, PortfolioSnapshotDocument, PortfolioWallet, WalletDocument } from '../db.js';
import { withAccountMutation } from './accounts.js';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SNAPSHOT_MS = 2 * 60_000;
const DAS_PAGE_SIZE = 1000;
const MAX_DAS_PAGES = 5;
const MAX_JUPITER_MINTS = 5000;
const TOKEN_PAGE_SIZE = 12;
const WALLET_PAGE_SIZE = 6;
type Button = { text: string; callback_data: string };
export type PortfolioMessage = { text: string; buttons: Button[][] };

type DasAsset = { id?: string; interface?: string; token_info?: { balance?: number | string; decimals?: number; price_info?: { price_per_token?: number; currency?: string } } };
type DasResponse = { result?: { items?: DasAsset[]; nativeBalance?: { lamports?: number | string; price_per_sol?: number } }; error?: { message?: string } };
type JupiterToken = { id?: string; symbol?: string; verification?: string; usdPrice?: number };
type JupiterPrice = { usdPrice?: number; confidenceLevel?: string } | null;
type RawWallet = { wallet: WalletDocument; amounts: Map<string, number>; heliusPrices: Map<string, number>; incomplete: boolean; error: boolean };
let nextKeylessJupiterRequestAt = 0;

async function waitForKeylessJupiterSlot() {
  const scheduledAt = Math.max(Date.now(), nextKeylessJupiterRequestAt);
  nextKeylessJupiterRequestAt = scheduledAt + 2_100;
  const delay = scheduledAt - Date.now();
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
}

function finitePositive(value: unknown): number {
  const amount = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function addDasBalances(amounts: Map<string, number>, result: NonNullable<DasResponse['result']>, firstPage: boolean, prices?: Map<string, number>) {
  if (firstPage) {
    const sol = finitePositive(result.nativeBalance?.lamports) / 1e9;
    if (sol) amounts.set(SOL, (amounts.get(SOL) ?? 0) + sol);
    const solPrice = finitePositive(result.nativeBalance?.price_per_sol);
    if (solPrice) prices?.set(SOL, solPrice);
  }
  for (const asset of result.items ?? []) {
    if (!asset.id || !['FungibleToken', 'FungibleAsset'].includes(asset.interface ?? '')) continue;
    const decimals = asset.token_info?.decimals;
    if (!Number.isInteger(decimals) || decimals! < 0 || decimals! > 18) continue;
    const raw = finitePositive(asset.token_info?.balance);
    if (!raw) continue;
    const amount = raw / 10 ** decimals!;
    amounts.set(asset.id, (amounts.get(asset.id) ?? 0) + amount);
    const priceInfo = asset.token_info?.price_info;
    const price = finitePositive(priceInfo?.price_per_token);
    if (price && ['USD', 'USDC'].includes(priceInfo?.currency?.toUpperCase() ?? '')) prices?.set(asset.id, price);
  }
}

async function jsonRequest<T>(url: string, init: RequestInit, label: string, beforeAttempt?: () => Promise<void>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await beforeAttempt?.();
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
      if (response.ok) return await response.json() as T;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(`${label} HTTP ${response.status}`);
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 350 * 2 ** attempt + Math.random() * 250));
  }
  throw new Error(`${label} unavailable`);
}

function jupiterRequest<T>(url: string, key: string | undefined, label: string): Promise<T> {
  return jsonRequest<T>(url, key ? { headers: { 'x-api-key': key } } : {}, label,
    key ? undefined : waitForKeylessJupiterSlot);
}

async function fetchWallet(wallet: WalletDocument, heliusKey: string): Promise<RawWallet> {
  const amounts = new Map<string, number>();
  const heliusPrices = new Map<string, number>();
  try {
    for (let page = 1; page <= MAX_DAS_PAGES; page++) {
      const body = await jsonRequest<DasResponse>(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: `portfolio-${page}`, method: 'getAssetsByOwner', params: {
          ownerAddress: wallet.address, page, limit: DAS_PAGE_SIZE,
          displayOptions: { showFungible: true, showNativeBalance: true },
        } }),
      }, 'Helius DAS');
      if (body.error || !body.result?.items) throw new Error(body.error?.message ?? 'Helius DAS returned no assets');
      addDasBalances(amounts, body.result, page === 1, heliusPrices);
      if (body.result.items.length < DAS_PAGE_SIZE) return { wallet, amounts, heliusPrices, incomplete: false, error: false };
    }
    return { wallet, amounts, heliusPrices, incomplete: true, error: false };
  } catch (error) {
    console.warn('Portfolio wallet fetch failed', { walletId: wallet._id, error: String(error) });
    return { wallet, amounts: new Map(), heliusPrices: new Map(), incomplete: true, error: true };
  }
}

async function limitedMap<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function jupiterMetadata(mints: string[], key?: string) {
  const batches = await limitedMap(chunks(mints, 100), 2, async (batch) => {
    const result = await jupiterRequest<JupiterToken[]>(`https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(batch.join(','))}`, key, 'Jupiter Tokens');
    return Array.isArray(result) ? result : [];
  });
  const requested = new Set(mints);
  return new Map(batches.flat().flatMap(token => token.id && requested.has(token.id) && token.verification !== 'banned'
    ? [[token.id, { symbol: token.symbol?.slice(0, 24) || token.id.slice(0, 6), usdPrice: finitePositive(token.usdPrice) || undefined }] as const] : []));
}

async function jupiterPrices(mints: string[], key?: string) {
  const batches = await limitedMap(chunks(mints, 50), 2, async batch => jupiterRequest<Record<string, JupiterPrice>>(
    `https://api.jup.ag/price/v3?ids=${encodeURIComponent(batch.join(','))}`, key, 'Jupiter Price'));
  return new Map(batches.flatMap(batch => Object.entries(batch).flatMap(([mint, price]) => {
    const usd = price?.usdPrice;
    return typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? [[mint, usd] as const] : [];
  })));
}

export async function getPortfolioSnapshot(db: Collections, userId: string, refresh = false): Promise<PortfolioSnapshotDocument> {
  const wallets = await db.wallets.find({ userId, chain: 'solana', deletedAt: null })
    .sort({ createdAt: 1, _id: 1 }).toArray();
  const walletIds = wallets.map(wallet => wallet._id);
  if (!refresh) {
    const cached = await db.portfolioSnapshots.findOne({ _id: userId, expiresAt: { $gt: new Date() } });
    if (cached && cached.walletIds.length === walletIds.length && cached.walletIds.every((id, index) => id === walletIds[index])) return cached;
  }
  if (!wallets.length) return { _id: userId, walletIds, wallets: [], createdAt: new Date(), expiresAt: new Date(Date.now() + SNAPSHOT_MS), incomplete: false };
  const heliusKey = process.env.HELIUS_API_KEY;
  const jupiterKey = process.env.JUPITER_API_KEY && process.env.JUPITER_API_KEY !== 'SET_IN_DIGITALOCEAN'
    ? process.env.JUPITER_API_KEY : undefined;
  if (!heliusKey) throw new Error('Portfolio requires HELIUS_API_KEY');

  const raw = await limitedMap(wallets, 4, wallet => fetchWallet(wallet, heliusKey));
  if (raw.every(row => row.error)) throw new Error('Helius could not load any tracked wallet');
  const allMints = [...new Set(raw.flatMap(row => [...row.amounts.keys()]))];
  const selected = [SOL, USDC, ...allMints.filter(mint => mint !== SOL && mint !== USDC)].slice(0, MAX_JUPITER_MINTS);
  const [metadata, prices] = await Promise.all([jupiterMetadata(selected, jupiterKey), jupiterKey ? jupiterPrices(selected, jupiterKey) : Promise.resolve(new Map<string, number>())]);
  metadata.set(SOL, { symbol: 'SOL', usdPrice: metadata.get(SOL)?.usdPrice });
  metadata.set(USDC, { symbol: 'USDC', usdPrice: metadata.get(USDC)?.usdPrice });
  const mapped: PortfolioWallet[] = raw.map(({ wallet, amounts, heliusPrices, incomplete, error }) => ({
    id: wallet._id, name: wallet.name, address: wallet.address, error,
    incomplete: incomplete || allMints.length > MAX_JUPITER_MINTS,
    holdings: [...amounts].flatMap(([mint, amount]): PortfolioHolding[] => {
      const token = metadata.get(mint);
      if (!token) return [];
      const price = prices.get(mint) ?? token.usdPrice ?? heliusPrices.get(mint);
      return [{ mint, symbol: token.symbol, amount, usdValue: price == null ? null : amount * price }];
    }),
  }));
  const now = new Date();
  const snapshot: PortfolioSnapshotDocument = {
    _id: userId, walletIds, wallets: mapped, createdAt: now,
    expiresAt: new Date(now.getTime() + SNAPSHOT_MS),
    incomplete: mapped.some(row => row.incomplete || row.error),
  };
  await withAccountMutation(userId, async (database, session, accountId) => {
    if (accountId !== userId) return;
    await database.portfolioSnapshots.replaceOne({ _id: userId }, snapshot, { upsert: true, session });
  });
  return snapshot;
}

const number = (value: number, digits = 6) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
const dollars = (value: number) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const safe = (value: string, max = 40) => value.replace(/[\r\n\t]/g, ' ').slice(0, max);
const totalUsd = (holdings: PortfolioHolding[]) => holdings.reduce((sum, item) => sum + (item.usdValue ?? 0), 0);

export function aggregatePortfolio(snapshot: PortfolioSnapshotDocument): PortfolioHolding[] {
  const grouped = new Map<string, PortfolioHolding>();
  for (const wallet of snapshot.wallets) for (const holding of wallet.holdings) {
    const previous = grouped.get(holding.mint);
    grouped.set(holding.mint, { ...holding,
      amount: (previous?.amount ?? 0) + holding.amount,
      usdValue: holding.usdValue == null && previous?.usdValue == null ? null : (previous?.usdValue ?? 0) + (holding.usdValue ?? 0),
    });
  }
  return [...grouped.values()].sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));
}

function holdingLine(holding: PortfolioHolding) {
  return `${safe(holding.symbol, 20)}  ${number(holding.amount, 9)}  ·  ${holding.usdValue == null ? 'price unavailable' : dollars(holding.usdValue)}`;
}

function nav(prefix: string, page: number, pages: number): Button[] {
  const row: Button[] = [];
  if (page > 0) row.push({ text: '← Previous', callback_data: `${prefix}:${page - 1}` });
  if (page + 1 < pages) row.push({ text: 'Next →', callback_data: `${prefix}:${page + 1}` });
  return row;
}

export function formatPortfolio(snapshot: PortfolioSnapshotDocument, view: 'total' | 'wallets' | 'wallet', page = 0, walletIndex = 0): PortfolioMessage {
  if (!snapshot.wallets.length) return { text: '📊 Portfolio\n\nNo Solana wallets yet. Add one with /add ADDRESS Name.', buttons: [[{ text: '➕ Add wallet', callback_data: 'add' }]] };
  const aggregate = aggregatePortfolio(snapshot);
  const note = snapshot.incomplete ? '\n⚠️ Partial data: one or more wallets or token pages could not be loaded. Totals exclude missing assets.' : '';
  const unpriced = aggregate.filter(item => item.usdValue == null).length;
  if (view === 'total') {
    const others = aggregate.filter(item => item.mint !== SOL && item.mint !== USDC);
    const pages = Math.max(1, Math.ceil(others.length / TOKEN_PAGE_SIZE));
    const current = Math.max(0, Math.min(page, pages - 1));
    const key = (mint: string) => aggregate.find(item => item.mint === mint);
    const text = [
      `📊 Portfolio · ${snapshot.wallets.length} ${snapshot.wallets.length === 1 ? 'wallet' : 'wallets'}`,
      `Estimated total: ${dollars(totalUsd(aggregate))}`,
      key(SOL) ? holdingLine(key(SOL)!) : 'SOL  0',
      key(USDC) ? holdingLine(key(USDC)!) : 'USDC  0',
      '', `Other tokens · page ${current + 1}/${pages}`,
      ...(others.length ? others.slice(current * TOKEN_PAGE_SIZE, (current + 1) * TOKEN_PAGE_SIZE).map(holdingLine) : ['No other Jupiter tokens.']),
      ...(unpriced ? ['', `${unpriced} token${unpriced === 1 ? '' : 's'} without a reliable USD price are excluded from the estimated total.`] : []),
      note,
    ].join('\n');
    return { text, buttons: [nav('portfolio:tokens', current, pages), [{ text: '👛 By wallet', callback_data: 'portfolio:wallets:0' }, { text: '↻ Refresh', callback_data: 'portfolio:refresh' }]].filter(row => row.length) };
  }
  if (view === 'wallets') {
    const pages = Math.max(1, Math.ceil(snapshot.wallets.length / WALLET_PAGE_SIZE));
    const current = Math.max(0, Math.min(page, pages - 1));
    const first = current * WALLET_PAGE_SIZE;
    const rows = snapshot.wallets.slice(first, first + WALLET_PAGE_SIZE);
    return {
      text: [`👛 Portfolio by wallet · ${current + 1}/${pages}`, `Estimated total: ${dollars(totalUsd(aggregate))}`, '',
        ...rows.map((wallet, offset) => `${first + offset + 1}. ${safe(wallet.name)} — ${wallet.error ? 'unavailable' : dollars(totalUsd(wallet.holdings))}`), note].join('\n'),
      buttons: [
        ...rows.map((wallet, offset) => [{ text: `${first + offset + 1}. ${safe(wallet.name, 30)}`, callback_data: `portfolio:wallet:${first + offset}:0` }]),
        nav('portfolio:wallets', current, pages),
        [{ text: '← Total', callback_data: 'portfolio:tokens:0' }, { text: '↻ Refresh', callback_data: 'portfolio:refresh' }],
      ].filter(row => row.length),
    };
  }
  const index = Math.max(0, Math.min(walletIndex, snapshot.wallets.length - 1));
  const wallet = snapshot.wallets[index];
  const holdings = [...wallet.holdings].sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));
  const pages = Math.max(1, Math.ceil(holdings.length / TOKEN_PAGE_SIZE));
  const current = Math.max(0, Math.min(page, pages - 1));
  return {
    text: [`👛 ${safe(wallet.name)} · ${index + 1}/${snapshot.wallets.length}`, `${wallet.address.slice(0, 6)}…${wallet.address.slice(-6)}`,
      wallet.error ? 'Balance unavailable.' : `Estimated value: ${dollars(totalUsd(holdings))}`,
      '', `Tokens · page ${current + 1}/${pages}`,
      ...(holdings.length ? holdings.slice(current * TOKEN_PAGE_SIZE, (current + 1) * TOKEN_PAGE_SIZE).map(holdingLine) : ['No Jupiter tokens found.']),
      ...(wallet.incomplete ? '\n⚠️ Partial data for this wallet.' : ''),
    ].join('\n'),
    buttons: [nav(`portfolio:wallet:${index}`, current, pages),
      [{ text: '← Wallets', callback_data: `portfolio:wallets:${Math.floor(index / WALLET_PAGE_SIZE)}` }, { text: '↻ Refresh', callback_data: 'portfolio:refresh' }]].filter(row => row.length),
  };
}
