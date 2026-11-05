import { randomUUID } from 'node:crypto';

import { collections } from '../db.js';
import { kolscanSnapshot } from '../data/kolscan-profiles.js';

export type DiscoveryProfile = { address: string; name: string; twitter: string | null; telegram: string | null };

const SOURCE_URL = 'https://kolscan.io/leaderboard';
const SYNC_ID = 'kolscan:solana';
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const MIN_PROFILES = 100;
const MAX_HTML_BYTES = 5_000_000;
const PROFILE_PATTERN = /\\"wallet_address\\":\\"([1-9A-HJ-NP-Za-km-z]{32,44})\\",\\"name\\":\\"([^\\"]*)\\",(?:\\"pfp\\":(?:null|\\"[^\\"]*\\"),)?\\"telegram\\":(null|\\"[^\\"]*\\"),\\"twitter\\":(null|\\"[^\\"]*\\")/g;

function parseLink(raw: string, hosts: string[]) {
  if (raw === 'null') return null;
  const value = raw.slice(2, -2);
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.includes(url.hostname) && url.pathname.length > 1 ? url.href : null;
  } catch { return null; }
}

export function parseKolscanProfiles(html: string): DiscoveryProfile[] {
  const profiles = new Map<string, DiscoveryProfile>();
  for (const match of html.matchAll(PROFILE_PATTERN)) {
    const [, address, rawName, telegramRaw, twitterRaw] = match;
    if (profiles.has(address)) continue;
    const name = rawName.trim().slice(0, 80) || `${address.slice(0, 6)}…${address.slice(-4)}`;
    profiles.set(address, {
      address,
      name,
      twitter: parseLink(twitterRaw, ['x.com', 'twitter.com']),
      telegram: parseLink(telegramRaw, ['t.me']),
    });
  }
  return [...profiles.values()];
}

export async function fetchKolscanProfiles(fetcher: typeof fetch = fetch) {
  const response = await fetcher(SOURCE_URL, {
    headers: { 'User-Agent': 'WhoAped-Discovery/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Kolscan HTTP ${response.status}`);
  const html = await response.text();
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('Kolscan response too large');
  const profiles = parseKolscanProfiles(html);
  if (profiles.length < MIN_PROFILES) throw new Error(`Kolscan returned only ${profiles.length} profiles`);
  return profiles;
}

export async function syncKolscanDiscovery(now = new Date(), fetcher: typeof fetch = fetch) {
  const db = await collections();
  await db.discoverySync.updateOne({ _id: SYNC_ID }, {
    $setOnInsert: { nextRunAt: new Date(0), leaseUntil: new Date(0) },
  }, { upsert: true });

  const leaseToken = randomUUID();
  const lease = await db.discoverySync.findOneAndUpdate(
    { _id: SYNC_ID, nextRunAt: { $lte: now }, leaseUntil: { $lte: now } },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), leaseToken } },
    { returnDocument: 'after' },
  );
  if (!lease) return { skipped: true as const };

  try {
    const profiles = await fetchKolscanProfiles(fetcher);
    const seenAt = new Date();
    await db.discoveryProfiles.bulkWrite(profiles.map(profile => ({
      updateOne: {
        filter: { _id: profile.address },
        update: {
          $set: { name: profile.name, twitter: profile.twitter, telegram: profile.telegram, chain: 'solana' as const, source: 'kolscan' as const, lastSeenAt: seenAt },
          $setOnInsert: { firstSeenAt: seenAt },
        },
        upsert: true,
      },
    })), { ordered: false });
    await db.discoverySync.updateOne({ _id: SYNC_ID, leaseToken }, {
      $set: { lastSuccessAt: seenAt, lastCount: profiles.length, nextRunAt: new Date(seenAt.getTime() + DAY_MS), leaseUntil: new Date(0) },
      $unset: { leaseToken: '', lastError: '' },
    });
    return { skipped: false as const, count: profiles.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.discoverySync.updateOne({ _id: SYNC_ID, leaseToken }, {
      $set: { lastError: message.slice(0, 300), nextRunAt: new Date(Date.now() + RETRY_MS), leaseUntil: new Date(0) },
      $unset: { leaseToken: '' },
    });
    throw error;
  }
}

export async function getDiscoveryCatalog() {
  const db = await collections();
  const [stored, sync] = await Promise.all([
    db.discoveryProfiles.find({ chain: 'solana', source: 'kolscan' }).toArray(),
    db.discoverySync.findOne({ _id: SYNC_ID }),
  ]);
  const profiles = new Map<string, DiscoveryProfile>(kolscanSnapshot.profiles.map(profile => [profile.address, profile]));
  for (const profile of stored) profiles.set(profile._id, {
    address: profile._id, name: profile.name, twitter: profile.twitter, telegram: profile.telegram,
  });
  return {
    profiles: [...profiles.values()].sort((a, b) => a.name.localeCompare(b.name)),
    importedAt: sync?.lastSuccessAt?.toISOString() ?? kolscanSnapshot.importedAt,
  };
}
