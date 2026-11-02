import type { NormalizedActivity } from '../chains/types.js';
import { buildTokenActionLinks } from '../config/token-actions.js';
import { collections, hasDatabase, type TokenMetadataDocument } from '../db.js';

type TokenMetadata = {
  symbol?: string;
  name?: string;
  iconUrl?: string;
  decimals?: number;
  isVerified?: boolean;
};

type JupiterToken = {
  id?: string;
  symbol?: string;
  name?: string;
  icon?: string;
  decimals?: number;
  isVerified?: boolean;
  tags?: string[];
};

type DasAsset = {
  id?: string;
  content?: {
    metadata?: { name?: string; symbol?: string };
    links?: { image?: string };
    files?: Array<{ cdn_uri?: string; uri?: string; mime?: string }>;
  };
  token_info?: { symbol?: string };
};

const JUPITER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const ONCHAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const MISSING_CACHE_TTL_MS = 60 * 60 * 1_000;
const cache = new Map<string, { value: TokenMetadata; expiresAt: number }>();

function imageUrl(asset: DasAsset) {
  const candidate = asset.content?.links?.image
    ?? asset.content?.files?.find((file) => file.mime?.startsWith('image/'))?.cdn_uri
    ?? asset.content?.files?.[0]?.cdn_uri
    ?? asset.content?.files?.[0]?.uri;
  return candidate?.startsWith('https://') ? candidate : undefined;
}

function secureUrl(candidate?: string) {
  return candidate?.startsWith('https://') ? candidate : undefined;
}

async function fetchJupiterMetadata(mints: string[]) {
  if (!mints.length) return new Map<string, TokenMetadata>();
  const apiKey = process.env.JUPITER_API_KEY;
  const response = await fetch(`https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mints.join(','))}`, {
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Jupiter Tokens failed (${response.status})`);
  const body = await response.json() as JupiterToken[];
  const requested = new Set(mints);
  return new Map(body.flatMap((token) => {
    const verified = token.isVerified === true || token.tags?.includes('verified');
    if (!token.id || !requested.has(token.id) || !verified) return [];
    return [[token.id, {
      symbol: token.symbol,
      name: token.name,
      iconUrl: secureUrl(token.icon),
      decimals: token.decimals,
      isVerified: true,
    } satisfies TokenMetadata] as const];
  }));
}

async function fetchOnchainMetadata(mints: string[]) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey || !mints.length) return new Map<string, TokenMetadata>();
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'whoaped-token-metadata', method: 'getAssetBatch', params: { ids: mints } }),
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Helius DAS failed (${response.status})`);
  const body = await response.json() as { result?: DasAsset[] };
  return new Map((body.result ?? []).flatMap((asset) => asset.id ? [[asset.id, {
    symbol: asset.token_info?.symbol ?? asset.content?.metadata?.symbol,
    name: asset.content?.metadata?.name,
    iconUrl: imageUrl(asset),
  } satisfies TokenMetadata] as const] : []));
}

async function readPersistentCache(mints: string[], now: Date) {
  if (!hasDatabase() || !mints.length) return new Map<string, TokenMetadataDocument>();
  try {
    const db = await collections();
    const rows = await db.tokenMetadata.find({
      _id: { $in: mints },
      refreshAfter: { $gt: now },
    }).toArray();
    return new Map(rows.map((row) => [row._id, row]));
  } catch (error) {
    console.warn('Could not read token metadata cache', error);
    return new Map<string, TokenMetadataDocument>();
  }
}

async function writePersistentCache(entries: Array<{
  mint: string;
  value: TokenMetadata;
  source: TokenMetadataDocument['source'];
  refreshAfter: Date;
}>) {
  if (!hasDatabase() || !entries.length) return;
  try {
    const db = await collections();
    await db.tokenMetadata.bulkWrite(entries.map(({ mint, value, source, refreshAfter }) => {
      const definedValue = Object.fromEntries(
        Object.entries(value).filter(([, field]) => field != null),
      ) as TokenMetadata;
      return {
        updateOne: {
          filter: { _id: mint },
          update: {
            $set: {
              chain: 'solana' as const,
              ...definedValue,
              source,
              refreshAfter,
              updatedAt: new Date(),
            },
            $unset: {
              ...(value.symbol ? {} : { symbol: '' as const }),
              ...(value.name ? {} : { name: '' as const }),
              ...(value.iconUrl ? {} : { iconUrl: '' as const }),
              ...(value.decimals == null ? { decimals: '' as const } : {}),
              ...(value.isVerified == null ? { isVerified: '' as const } : {}),
            },
          },
          upsert: true,
        },
      };
    }), { ordered: false });
  } catch (error) {
    console.warn('Could not persist token metadata cache', error);
  }
}

async function resolveTokenMetadata(mints: string[]) {
  const now = Date.now();
  const unique = [...new Set(mints)];
  let missing = unique.filter((mint) => (cache.get(mint)?.expiresAt ?? 0) <= now);
  if (missing.length) {
    const persisted = await readPersistentCache(missing, new Date(now));
    persisted.forEach((row, mint) => cache.set(mint, {
      value: {
        symbol: row.symbol,
        name: row.name,
        iconUrl: row.iconUrl,
        decimals: row.decimals,
        isVerified: row.isVerified,
      },
      expiresAt: row.refreshAfter.getTime(),
    }));
    missing = missing.filter((mint) => !persisted.has(mint));
  }
  if (missing.length) {
    let jupiter = new Map<string, TokenMetadata>();
    try {
      jupiter = await fetchJupiterMetadata(missing);
    } catch (error) {
      console.warn('Could not fetch Jupiter token metadata', error);
    }
    const needsOnchain = missing.filter((mint) => {
      const token = jupiter.get(mint);
      return !token || !token.symbol || !token.name || !token.iconUrl;
    });
    let onchain = new Map<string, TokenMetadata>();
    try {
      onchain = await fetchOnchainMetadata(needsOnchain);
    } catch (error) {
      console.warn('Could not fetch on-chain token metadata', error);
    }
    const entries = missing.map((mint) => {
      const verified = jupiter.get(mint);
      const fallback = onchain.get(mint);
      const value = { ...fallback, ...verified } satisfies TokenMetadata;
      const source: TokenMetadataDocument['source'] = verified ? 'jupiter' : fallback ? 'onchain' : 'missing';
      const ttl = verified ? JUPITER_CACHE_TTL_MS : fallback ? ONCHAIN_CACHE_TTL_MS : MISSING_CACHE_TTL_MS;
      const refreshAfter = new Date(now + ttl);
      cache.set(mint, { value, expiresAt: refreshAfter.getTime() });
      return { mint, value, source, refreshAfter };
    });
    await writePersistentCache(entries);
  }
  return new Map(unique.map((mint) => [mint, cache.get(mint)?.value ?? {}]));
}

export async function warmActivityTokenMetadata(activities: NormalizedActivity[]) {
  await resolveTokenMetadata(activities.flatMap((activity) => candidateTokens(activity).map((token) => token.mint)));
}

export async function enrichSwapActivity(activity: NormalizedActivity) {
  if (activity.kind !== 'swap') return activity;
  const swap = activity.metadata.swap;
  if (!swap || typeof swap !== 'object') return activity;
  const typedSwap = swap as {
    input?: { mint?: string; symbol?: string; amount?: number };
    output?: { mint?: string; symbol?: string; amount?: number };
    steps?: Array<{ dex: string; dexName: string; input: { mint: string; symbol: string; amount: number }; output: { mint: string; symbol: string; amount: number } }>;
    arbitrage?: { profit: number | null; mint: string; symbol: string; includesNetworkFee: boolean };
  };
  const inputMint = typedSwap.input?.mint;
  const outputMint = typedSwap.output?.mint;
  if (!inputMint || !outputMint) return activity;

  const metadata = await resolveTokenMetadata([inputMint, outputMint, ...(typedSwap.steps ?? []).flatMap((step) => [step.input.mint, step.output.mint])]);
  const inputMetadata = metadata.get(inputMint) ?? {};
  const outputMetadata = metadata.get(outputMint) ?? {};
  const inputSymbol = inputMetadata.symbol ?? typedSwap.input?.symbol ?? 'token';
  const outputSymbol = outputMetadata.symbol ?? typedSwap.output?.symbol ?? 'token';
  const amount = (value?: number) => new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value ?? 0) >= 1 ? 4 : 9,
  }).format(Math.abs(value ?? 0));
  const enrichToken = <T extends { mint: string; symbol: string; amount: number }>(token: T) => {
    const resolved = metadata.get(token.mint) ?? {};
    return { ...token, symbol: resolved.symbol ?? token.symbol,
      ...(resolved.name ? { name: resolved.name } : {}),
      ...(resolved.iconUrl ? { iconUrl: resolved.iconUrl } : {}),
      ...(resolved.decimals == null ? {} : { decimals: resolved.decimals }),
      ...(resolved.isVerified == null ? {} : { isVerified: resolved.isVerified }),
    };
  };
  const profit = typedSwap.arbitrage?.profit;
  const profitSymbol = metadata.get(typedSwap.arbitrage?.mint ?? '')?.symbol ?? typedSwap.arbitrage?.symbol;
  return {
    ...activity,
    title: typedSwap.arbitrage
      ? `${typedSwap.steps?.length ?? 0}-swap arbitrage${profit == null ? '' : ` · ${profit >= 0 ? '+' : '−'}${amount(profit)} ${profitSymbol ?? inputSymbol}`}`
      : `Swapped ${amount(typedSwap.input?.amount)} ${inputSymbol} → ${amount(typedSwap.output?.amount)} ${outputSymbol}`,
    metadata: {
      ...activity.metadata,
      swap: {
        ...(swap as Record<string, unknown>),
        ...(typedSwap.steps ? { steps: typedSwap.steps.map((step) => ({ ...step, input: enrichToken(step.input), output: enrichToken(step.output) })) } : {}),
        ...(typedSwap.arbitrage ? { arbitrage: { ...typedSwap.arbitrage, symbol: profitSymbol ?? inputSymbol } } : {}),
        input: {
          ...typedSwap.input,
          symbol: inputSymbol,
          ...(inputMetadata.name ? { name: inputMetadata.name } : {}),
          ...(inputMetadata.iconUrl ? { iconUrl: inputMetadata.iconUrl } : {}),
          ...(inputMetadata.decimals == null ? {} : { decimals: inputMetadata.decimals }),
          ...(inputMetadata.isVerified == null ? {} : { isVerified: inputMetadata.isVerified }),
        },
        output: {
          ...typedSwap.output,
          symbol: outputSymbol,
          ...(outputMetadata.name ? { name: outputMetadata.name } : {}),
          ...(outputMetadata.iconUrl ? { iconUrl: outputMetadata.iconUrl } : {}),
          ...(outputMetadata.decimals == null ? {} : { decimals: outputMetadata.decimals }),
          ...(outputMetadata.isVerified == null ? {} : { isVerified: outputMetadata.isVerified }),
        },
      },
    },
  } satisfies NormalizedActivity;
}

async function enrichYieldActivity(activity: NormalizedActivity) {
  if (activity.kind !== 'yield') return activity;
  const yieldEvent = activity.metadata.yield;
  if (!yieldEvent || typeof yieldEvent !== 'object') return activity;
  const typedYield = yieldEvent as {
    action?: 'deposit' | 'withdraw';
    assets?: Array<{ mint?: string; symbol?: string; amount?: number }>;
  };
  const assets = typedYield.assets?.filter((asset): asset is {
    mint: string; symbol?: string; amount?: number;
  } => Boolean(asset.mint)) ?? [];
  if (!assets.length) return activity;
  const metadata = await resolveTokenMetadata(assets.map((asset) => asset.mint));
  const enrichedAssets = assets.map((asset) => {
    const token = metadata.get(asset.mint) ?? {};
    return {
      ...asset,
      symbol: token.symbol ?? asset.symbol ?? 'token',
      ...(token.name ? { name: token.name } : {}),
      ...(token.iconUrl ? { iconUrl: token.iconUrl } : {}),
      ...(token.decimals == null ? {} : { decimals: token.decimals }),
      ...(token.isVerified == null ? {} : { isVerified: token.isVerified }),
    };
  });
  const amount = (value?: number) => new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value ?? 0) >= 1 ? 4 : 9,
  }).format(Math.abs(value ?? 0));
  const verb = typedYield.action === 'withdraw' ? 'Withdrew' : 'Deposited';
  return {
    ...activity,
    title: `${verb} ${enrichedAssets.map((asset) => `${amount(asset.amount)} ${asset.symbol}`).join(' + ')}`,
    metadata: {
      ...activity.metadata,
      yield: { ...(yieldEvent as Record<string, unknown>), assets: enrichedAssets },
    },
  } satisfies NormalizedActivity;
}

async function enrichLaunchActivity(activity: NormalizedActivity) {
  if (activity.kind !== 'launch') return activity;
  const launch = activity.metadata.launch;
  if (!launch || typeof launch !== 'object') return activity;
  const typedLaunch = launch as {
    token?: { mint?: string; symbol?: string; name?: string; iconUrl?: string };
  };
  const mint = typedLaunch.token?.mint;
  if (!mint) return activity;
  const token = (await resolveTokenMetadata([mint])).get(mint) ?? {};
  const symbol = token.symbol ?? typedLaunch.token?.symbol ?? 'token';
  const name = token.name ?? typedLaunch.token?.name;
  return {
    ...activity,
    title: `Launched ${name ? `${name} (${symbol})` : symbol}`,
    metadata: {
      ...activity.metadata,
      launch: {
        ...(launch as Record<string, unknown>),
        token: {
          ...typedLaunch.token,
          symbol,
          ...(name ? { name } : {}),
          ...(token.iconUrl ? { iconUrl: token.iconUrl } : {}),
          ...(token.decimals == null ? {} : { decimals: token.decimals }),
          ...(token.isVerified == null ? {} : { isVerified: token.isVerified }),
        },
      },
    },
  } satisfies NormalizedActivity;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYDshorBZG77ZK1k3m1dAWF', // USDT
  '2b1kV6DkMWQZCFpW6y8c3A5F8gJdYgDB7B4dQ9wqF9uE', // PYUSD
]);
const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'PYUSD', 'USDS', 'USDG', 'USDE', 'USX', 'FDUSD', 'EURC', 'UXD', 'CASH']);

function candidateTokens(activity: NormalizedActivity) {
  const result = new Map<string, { mint: string; symbol?: string; name?: string; iconUrl?: string; decimals?: number }>();
  const add = (token?: { mint?: string; symbol?: string; name?: string; iconUrl?: string; decimals?: number }) => {
    if (token?.mint) result.set(token.mint, { ...result.get(token.mint), ...token, mint: token.mint });
  };
  const raw = activity.metadata.tokenCandidates;
  if (Array.isArray(raw)) raw.forEach((token) => {
    if (token && typeof token === 'object') add(token as { mint?: string; decimals?: number });
  });
  const swap = activity.metadata.swap as { input?: { mint?: string; symbol?: string; name?: string; iconUrl?: string }; output?: { mint?: string; symbol?: string; name?: string; iconUrl?: string }; steps?: Array<{ input: { mint: string }; output: { mint: string } }> } | undefined;
  add(swap?.input); add(swap?.output);
  swap?.steps?.forEach((step) => { add(step.input); add(step.output); });
  const yieldEvent = activity.metadata.yield as { assets?: Array<{ mint?: string; symbol?: string; name?: string; iconUrl?: string }> } | undefined;
  yieldEvent?.assets?.forEach(add);
  const launch = activity.metadata.launch as { token?: { mint?: string; symbol?: string; name?: string; iconUrl?: string } } | undefined;
  add(launch?.token);
  return [...result.values()];
}

async function enrichTokenActions(activity: NormalizedActivity) {
  const candidates = candidateTokens(activity).filter((token) => token.mint !== SOL_MINT && token.decimals !== 0);
  if (!candidates.length) return activity;
  const metadata = await resolveTokenMetadata(candidates.map((token) => token.mint));
  const tokenActions = candidates.flatMap((token) => {
    const resolved = metadata.get(token.mint) ?? {};
    const symbol = resolved.symbol ?? token.symbol;
    if (STABLE_MINTS.has(token.mint) || (symbol && STABLE_SYMBOLS.has(symbol.toUpperCase()))) return [];
    const links = buildTokenActionLinks(token.mint);
    if (!links.length) return [];
    return [{ token: {
      mint: token.mint,
      symbol: symbol ?? `${token.mint.slice(0, 4)}…${token.mint.slice(-4)}`,
      ...(resolved.name ?? token.name ? { name: resolved.name ?? token.name } : {}),
      ...(resolved.iconUrl ?? token.iconUrl ? { iconUrl: resolved.iconUrl ?? token.iconUrl } : {}),
      ...(resolved.decimals == null ? {} : { decimals: resolved.decimals }),
      ...(resolved.isVerified == null ? {} : { isVerified: resolved.isVerified }),
    }, links }];
  }).slice(0, 2);
  if (!tokenActions.length) return activity;
  return { ...activity, metadata: { ...activity.metadata, tokenActions } } satisfies NormalizedActivity;
}

export async function enrichActivityMetadata(activity: NormalizedActivity) {
  return enrichTokenActions(await enrichLaunchActivity(await enrichYieldActivity(await enrichSwapActivity(activity))));
}

