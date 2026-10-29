export type TokenActionLink = { id: string; label: string; url: string };

type TokenActionEntry = { label: string; urlTemplate: string };

const DEFAULT_CONFIG: Record<string, TokenActionEntry> = {
  bonkbot: {
    label: 'BONKbot',
    urlTemplate: 'https://t.me/bonkbot_bot?start=ref_ceqh3_ca_{mint}',
  },
  gmgn: {
    label: 'GMGN',
    urlTemplate: 'https://t.me/GMGN_sol_bot?start=i_gSWRgmGL_c_{mint}',
  },
  fomo: {
    label: 'FOMO',
    urlTemplate: 'https://fomo.family/coin?address={mint}&chainId=1399811149&r=heymike777&source=share_link',
  },
  dexscreener: {
    label: 'DexScreener',
    urlTemplate: 'https://dexscreener.com/solana/{mint}',
  },
};

let cachedRaw: string | undefined;
let cachedConfig = DEFAULT_CONFIG;

function isEntry(value: unknown): value is TokenActionEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.label === 'string' && typeof entry.urlTemplate === 'string';
}

function configuredActions() {
  const raw = process.env.TOKEN_ACTION_CONFIG_BASE64
    ? Buffer.from(process.env.TOKEN_ACTION_CONFIG_BASE64, 'base64').toString('utf8')
    : process.env.TOKEN_ACTION_CONFIG_JSON ?? '';
  if (raw === cachedRaw) return cachedConfig;
  cachedRaw = raw;
  if (!raw) return (cachedConfig = DEFAULT_CONFIG);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const valid = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, TokenActionEntry] => isEntry(entry[1])));
    cachedConfig = Object.keys(valid).length ? valid : DEFAULT_CONFIG;
  } catch (error) {
    console.warn('Token action configuration is invalid; using safe defaults', error);
    cachedConfig = DEFAULT_CONFIG;
  }
  return cachedConfig;
}

export function buildTokenActionLinks(mint: string): TokenActionLink[] {
  return Object.entries(configuredActions()).flatMap(([id, entry]) => {
    const rendered = entry.urlTemplate.replaceAll('{mint}', encodeURIComponent(mint));
    if (/\{[^}]+\}/.test(rendered)) return [];
    try {
      const url = new URL(rendered);
      return url.protocol === 'https:' ? [{ id, label: entry.label, url: url.toString() }] : [];
    } catch {
      return [];
    }
  });
}
