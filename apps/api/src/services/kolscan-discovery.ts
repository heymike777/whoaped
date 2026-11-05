import { randomUUID } from 'node:crypto';

import { collections, withDatabaseTransaction, type DiscoverySyncDocument, type TelegramChatDocument } from '../db.js';
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

export class KolscanParseError extends Error {
  constructor(public parsed: number) { super(`Kolscan returned only ${parsed} profiles`); }
}

type Report = NonNullable<DiscoverySyncDocument['lastReport']>;

export function formatDiscoveryReport(report: Report) {
  const status = report.status === 'ok' ? '✅ OK' : '🔴 Ошибка';
  const number = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US');
  return [
    `📡 Kolscan Discovery · ${status}`,
    `Спарсено сейчас: ${number(report.parsed)}`,
    `Новых кошельков: ${number(report.added)}`,
    `Пропали из источника: ${number(report.missing)} (из Discovery не удаляем)`,
    `Время: ${report.finishedAt.toISOString()}`,
    ...(report.error ? [`Причина: ${report.error}`] : []),
  ].join('\n');
}

function reportUsername() {
  return (process.env.DISCOVERY_REPORT_TELEGRAM_USERNAME ?? 'heymike777').replace(/^@/, '').toLowerCase();
}

async function findReportChat(db: Awaited<ReturnType<typeof collections>>, state: DiscoverySyncDocument) {
  if (state.reportChatId) {
    const chat = await db.telegramChats.findOne({ _id: state.reportChatId, disabledAt: { $exists: false } });
    if (chat) return chat;
  }
  const name = reportUsername();
  const namePattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const update = await db.telegramUpdates.findOne({ $or: [
    { 'payload.message.from.username': namePattern },
    { 'payload.callback_query.from.username': namePattern },
  ] }, { sort: { createdAt: -1 } });
  const payload = update?.payload as { message?: { from?: { id?: number; username?: string }; chat?: { id?: number } }; callback_query?: { from?: { id?: number; username?: string }; message?: { chat?: { id?: number } } } } | undefined;
  const sender = payload?.callback_query?.from ?? payload?.message?.from;
  const messageChat = payload?.callback_query?.message?.chat ?? payload?.message?.chat;
  let chat: TelegramChatDocument | null = null;
  if (sender?.username?.toLowerCase() === name && sender.id === messageChat?.id) {
    chat = await db.telegramChats.findOne({ _id: String(sender.id), disabledAt: { $exists: false } });
  }
  if (!chat) chat = await db.telegramChats.findOne({ username: namePattern, disabledAt: { $exists: false } }, { sort: { createdAt: -1 } });
  if (chat) await db.discoverySync.updateOne({ _id: SYNC_ID }, { $set: { reportChatId: chat._id } });
  return chat;
}

export async function claimDiscoveryReportChat(chatId: string): Promise<Report | undefined> {
  const db = await collections();
  await db.discoverySync.updateOne({ _id: SYNC_ID }, {
    $set: { reportChatId: chatId },
    $setOnInsert: { nextRunAt: new Date(0), leaseUntil: new Date(0) },
  }, { upsert: true });
  return (await db.discoverySync.findOne({ _id: SYNC_ID }))?.lastReport;
}

async function finishSync(leaseToken: string, report: Report, nextRunAt: Date, chat: TelegramChatDocument | null) {
  await withDatabaseTransaction(async (db, session) => {
    const result = await db.discoverySync.updateOne({ _id: SYNC_ID, leaseToken }, {
      $set: {
        lastReport: report,
        nextRunAt,
        leaseUntil: new Date(0),
        ...(report.status === 'ok' ? { lastSuccessAt: report.finishedAt, lastCount: report.parsed! } : { lastError: report.error ?? 'Unknown error' }),
      },
      $unset: { leaseToken: '', ...(report.status === 'ok' ? { lastError: '' } : {}) },
    }, { session });
    if (!result.matchedCount || !chat) return;
    await db.telegramJobs.updateOne({ _id: `discovery:${leaseToken}:${chat._id}` }, {
      $setOnInsert: {
        chatId: chat._id, userId: chat.userId ?? `telegram:${chat._id}`,
        walletId: `discovery:${chat._id}`, txHash: leaseToken, slot: 0, kind: 'discovery', priority: 10,
        text: formatDiscoveryReport(report), buttons: [], status: 'pending', attempts: 0,
        availableAt: report.finishedAt, createdAt: report.finishedAt,
      },
    }, { upsert: true, session });
  });
}

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
  if (profiles.length < MIN_PROFILES) throw new KolscanParseError(profiles.length);
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

  let parsed: number | null = null;
  try {
    const profiles = await fetchKolscanProfiles(fetcher);
    parsed = profiles.length;
    const known = new Set<string>(kolscanSnapshot.profiles.map(profile => profile.address));
    for (const profile of await db.discoveryProfiles.find({}, { projection: { _id: 1 } }).toArray()) known.add(profile._id);
    const previouslySeen = lease.lastSuccessAt
      ? await db.discoveryProfiles.find({ lastSeenAt: lease.lastSuccessAt }, { projection: { _id: 1 } }).toArray()
      : kolscanSnapshot.profiles.map(profile => ({ _id: profile.address }));
    const current = new Set<string>(profiles.map(profile => profile.address));
    const added = profiles.filter(profile => !known.has(profile.address)).length;
    const missing = previouslySeen.filter(profile => !current.has(profile._id)).length;
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
    const report: Report = { status: 'ok', parsed, added, missing, finishedAt: seenAt };
    await finishSync(leaseToken, report, new Date(seenAt.getTime() + DAY_MS), await findReportChat(db, lease));
    return { skipped: false as const, count: profiles.length, added, missing };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date();
    const report: Report = { status: 'error', parsed: error instanceof KolscanParseError ? error.parsed : parsed, added: null, missing: null, finishedAt, error: message.slice(0, 200) };
    await finishSync(leaseToken, report, new Date(finishedAt.getTime() + RETRY_MS), await findReportChat(db, lease));
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
