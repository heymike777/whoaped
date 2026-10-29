type DexLinkEntry = {
  providerName?: string;
  urlTemplate: string;
  referralCode?: string;
  referralQueryParam?: string;
};

export type TradeLink = { provider: string; providerName: string; url: string };

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEFAULT_CONFIG: Record<string, DexLinkEntry> = {
  jupiter: {
    providerName: 'Jupiter',
    urlTemplate: 'https://jup.ag/swap/{inputMint}-{outputMint}',
  },
};

let cachedRaw: string | undefined;
let cachedConfig: Record<string, DexLinkEntry> = DEFAULT_CONFIG;

function isEntry(value: unknown): value is DexLinkEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.urlTemplate === 'string'
    && (entry.providerName == null || typeof entry.providerName === 'string')
    && (entry.referralCode == null || typeof entry.referralCode === 'string')
    && (entry.referralQueryParam == null || typeof entry.referralQueryParam === 'string');
}

function configuredLinks() {
  const rawJson = process.env.DEX_LINK_CONFIG_JSON;
  const rawBase64 = process.env.DEX_LINK_CONFIG_BASE64;
  const raw = rawBase64
    ? Buffer.from(rawBase64, 'base64').toString('utf8')
    : rawJson ?? '';
  if (raw === cachedRaw) return cachedConfig;
  cachedRaw = raw;
  if (!raw) {
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const valid: Record<string, DexLinkEntry> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (isEntry(value)) valid[key] = value;
    });
    cachedConfig = { ...DEFAULT_CONFIG, ...valid };
  } catch (error) {
    console.warn('DEX link configuration is invalid; using safe defaults', error);
    cachedConfig = DEFAULT_CONFIG;
  }
  return cachedConfig;
}

function render(entry: DexLinkEntry, values: Record<string, string>) {
  const replacements = { ...values, referralCode: entry.referralCode ?? '' };
  const rendered = Object.entries(replacements).reduce(
    (url, [key, value]) => url.replaceAll(`{${key}}`, encodeURIComponent(value)),
    entry.urlTemplate,
  );
  if (/\{[^}]+\}/.test(rendered)) return null;
  try {
    const url = new URL(rendered);
    if (url.protocol !== 'https:') return null;
    if (entry.referralCode && entry.referralQueryParam) {
      url.searchParams.set(entry.referralQueryParam, entry.referralCode);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function buildDexTradeLink(
  dex: string,
  providerName: string,
  inputMint: string,
  outputMint: string,
): TradeLink {
  const config = configuredLinks();
  const configuredProvider = config[dex] ? dex : 'jupiter';
  const entry = config[configuredProvider] ?? DEFAULT_CONFIG.jupiter;
  const configuredUrl = render(entry, { dex, inputMint, outputMint, tokenMint: outputMint });
  const provider = configuredUrl ? configuredProvider : 'jupiter';
  const url = configuredUrl
    ?? render(DEFAULT_CONFIG.jupiter, { dex, inputMint, outputMint, tokenMint: outputMint })!;
  return {
    provider,
    providerName: configuredUrl
      ? entry.providerName ?? (provider === dex ? providerName : 'Jupiter')
      : 'Jupiter',
    url,
  };
}

export function buildTokenBuyLink(tokenMint: string) {
  return buildDexTradeLink('jupiter', 'Jupiter', SOL_MINT, tokenMint);
}
