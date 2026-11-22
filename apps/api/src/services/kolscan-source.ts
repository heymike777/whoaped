export type DiscoveryProfile = { address: string; name: string; twitter: string | null; telegram: string | null };

export const KOLSCAN_SOURCE_URL = 'https://kolscan.io/leaderboard';
const MIN_PROFILES = 100;
const MAX_HTML_BYTES = 5_000_000;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class KolscanParseError extends Error {
  readonly parsed: number;
  constructor(parsed: number) {
    super('Kolscan returned only ' + parsed + ' profiles');
    this.parsed = parsed;
  }
}

function parseLink(raw: unknown, hosts: string[]) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && hosts.includes(url.hostname) && url.pathname.length > 1 ? url.href : null;
  } catch { return null; }
}

export function parseKolscanProfiles(html: string): DiscoveryProfile[] {
  // Next sends its serialized data in script pushes; a record can span pushes.
  // Decode the strings as JSON only. Never execute scripts from the source.
  const chunks: string[] = [];
  for (const [, literal] of html.matchAll(/<script\b[^>]*>\s*self\.__next_f\.push\((\[[^\r\n]*?\])\)\s*<\/script>/gi)) {
    try {
      const chunk: unknown = JSON.parse(literal);
      if (Array.isArray(chunk) && chunk[0] === 1 && typeof chunk[1] === 'string') chunks.push(chunk[1]);
    } catch { /* Ignore unrelated or malformed pushes. */ }
  }
  const directory = new Map<string, DiscoveryProfile>();
  const leaderboard = new Map<string, DiscoveryProfile>();
  for (const line of chunks.join('').split('\n')) {
    const record = line.match(/^[a-f0-9]+:([\[{].*)$/i);
    if (!record) continue;
    let data: unknown;
    try { data = JSON.parse(record[1]); } catch { continue; }
    const pending: unknown[] = [data];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object') continue;
      for (const [key, child] of Object.entries(value)) {
        const target = key === 'initialData' ? directory : key === 'initLeaderboard' ? leaderboard : null;
        if (!target || !Array.isArray(child)) {
          if (child && typeof child === 'object') pending.push(child);
          continue;
        }
        for (const row of child) {
          if (!row || typeof row !== 'object') continue;
          const { wallet_address: address, name, telegram, twitter } = row;
          if (typeof address !== 'string' || !SOLANA_ADDRESS.test(address) || typeof name !== 'string' || target.has(address)) continue;
          target.set(address, {
            address,
            name: name.trim().slice(0, 80) || address.slice(0, 6) + '…' + address.slice(-4),
            twitter: parseLink(twitter, ['x.com', 'twitter.com']),
            telegram: parseLink(telegram, ['t.me']),
          });
        }
      }
    }
  }
  // A trader may appear in multiple timeframes; prefer their directory entry.
  return [...directory.values(), ...[...leaderboard.values()].filter(profile => !directory.has(profile.address))];
}

export async function fetchKolscanProfiles(fetcher: typeof fetch = fetch) {
  const response = await fetcher(KOLSCAN_SOURCE_URL, {
    headers: { 'User-Agent': 'WhoAped-Discovery/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('Kolscan HTTP ' + response.status);
  const html = await response.text();
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('Kolscan response too large');
  const profiles = parseKolscanProfiles(html);
  if (profiles.length < MIN_PROFILES) throw new KolscanParseError(profiles.length);
  return profiles;
}
