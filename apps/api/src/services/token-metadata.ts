import type { NormalizedActivity } from '../chains/types.js';

type TokenMetadata = { symbol?: string; name?: string; iconUrl?: string };

type DasAsset = {
  id?: string;
  content?: {
    metadata?: { name?: string; symbol?: string };
    links?: { image?: string };
    files?: Array<{ cdn_uri?: string; uri?: string; mime?: string }>;
  };
  token_info?: { symbol?: string };
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const cache = new Map<string, { value: TokenMetadata; expiresAt: number }>();

function imageUrl(asset: DasAsset) {
  const candidate = asset.content?.links?.image
    ?? asset.content?.files?.find((file) => file.mime?.startsWith('image/'))?.cdn_uri
    ?? asset.content?.files?.[0]?.cdn_uri
    ?? asset.content?.files?.[0]?.uri;
  return candidate?.startsWith('https://') ? candidate : undefined;
}

async function fetchTokenMetadata(mints: string[]) {
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

async function resolveTokenMetadata(mints: string[]) {
  const now = Date.now();
  const unique = [...new Set(mints)];
  const missing = unique.filter((mint) => (cache.get(mint)?.expiresAt ?? 0) <= now);
  if (missing.length) {
    try {
      const fetched = await fetchTokenMetadata(missing);
      missing.forEach((mint) => cache.set(mint, {
        value: fetched.get(mint) ?? {},
        expiresAt: now + CACHE_TTL_MS,
      }));
    } catch (error) {
      console.warn('Could not enrich activity token metadata', error);
    }
  }
  return new Map(unique.map((mint) => [mint, cache.get(mint)?.value ?? {}]));
}

export async function enrichSwapActivity(activity: NormalizedActivity) {
  if (activity.kind !== 'swap') return activity;
  const swap = activity.metadata.swap;
  if (!swap || typeof swap !== 'object') return activity;
  const typedSwap = swap as {
    input?: { mint?: string; symbol?: string; amount?: number };
    output?: { mint?: string; symbol?: string; amount?: number };
  };
  const inputMint = typedSwap.input?.mint;
  const outputMint = typedSwap.output?.mint;
  if (!inputMint || !outputMint) return activity;

  const metadata = await resolveTokenMetadata([inputMint, outputMint]);
  const inputMetadata = metadata.get(inputMint) ?? {};
  const outputMetadata = metadata.get(outputMint) ?? {};
  const inputSymbol = inputMetadata.symbol ?? typedSwap.input?.symbol ?? 'token';
  const outputSymbol = outputMetadata.symbol ?? typedSwap.output?.symbol ?? 'token';
  const amount = (value?: number) => new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value ?? 0) >= 1 ? 4 : 9,
  }).format(Math.abs(value ?? 0));
  return {
    ...activity,
    title: `Swapped ${amount(typedSwap.input?.amount)} ${inputSymbol} → ${amount(typedSwap.output?.amount)} ${outputSymbol}`,
    metadata: {
      ...activity.metadata,
      swap: {
        ...(swap as Record<string, unknown>),
        input: {
          ...typedSwap.input,
          symbol: inputSymbol,
          ...(inputMetadata.name ? { name: inputMetadata.name } : {}),
          ...(inputMetadata.iconUrl ? { iconUrl: inputMetadata.iconUrl } : {}),
        },
        output: {
          ...typedSwap.output,
          symbol: outputSymbol,
          ...(outputMetadata.name ? { name: outputMetadata.name } : {}),
          ...(outputMetadata.iconUrl ? { iconUrl: outputMetadata.iconUrl } : {}),
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

export async function enrichActivityMetadata(activity: NormalizedActivity) {
  return enrichYieldActivity(await enrichSwapActivity(activity));
}

