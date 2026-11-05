import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { kolscanSnapshot } from '../data/kolscan-profiles.js';

let mongo: MongoMemoryReplSet;
let database: typeof import('../db.js');
let discovery: typeof import('../services/kolscan-discovery.js');

const extraAddress = 'So11111111111111111111111111111111111111112';
const row = (profile: { address: string; name: string; twitter: string | null; telegram: string | null }) =>
  `\\"wallet_address\\":\\"${profile.address}\\",\\"name\\":\\"${profile.name}\\",\\"telegram\\":${profile.telegram ? `\\"${profile.telegram}\\"` : 'null'},\\"twitter\\":${profile.twitter ? `\\"${profile.twitter}\\"` : 'null'}`;
const page = (profiles: Array<{ address: string; name: string; twitter: string | null; telegram: string | null }>) =>
  profiles.map(row).join(',');
const fetchPage = (html: string) => vi.fn(async () => new Response(html)) as unknown as typeof fetch;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv('MONGODB_URI', mongo.getUri());
  vi.stubEnv('MONGODB_DATABASE', 'discovery-tests');
  database = await import('../db.js');
  discovery = await import('../services/kolscan-discovery.js');
}, 120_000);
afterAll(async () => { await database?.closeDatabase(); await mongo?.stop(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  const db = await database.collections();
  await db.discoveryProfiles.deleteMany({});
  await db.discoverySync.deleteMany({});
  await db.telegramChats.deleteMany({});
  await db.telegramUpdates.deleteMany({});
  await db.telegramJobs.deleteMany({});
  await db.telegramChats.insertMany([
    { _id: '123', username: 'heymike777', createdAt: new Date() },
    { _id: '456', username: 'another_user', createdAt: new Date() },
  ]);
});

describe('daily Kolscan Discovery sync', () => {
  it('adds new profiles once a day without subscribing or deleting old wallets', async () => {
    const first = kolscanSnapshot.profiles.slice(0, 101);
    const now = new Date();
    const firstFetch = fetchPage(page(first));
    const simultaneous = await Promise.all([
      discovery.syncKolscanDiscovery(now, firstFetch),
      discovery.syncKolscanDiscovery(now, firstFetch),
    ]);
    expect(simultaneous.some(result => !result.skipped && result.count === 101)).toBe(true);
    expect(simultaneous).toContainEqual({ skipped: true });
    expect(vi.mocked(firstFetch)).toHaveBeenCalledTimes(1);

    const next = [...first.slice(1), { address: extraAddress, name: 'New caller', twitter: 'https://x.com/newcaller', telegram: null }];
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect(await discovery.syncKolscanDiscovery(tomorrow, fetchPage(page(next)))).toMatchObject({ skipped: false, count: 101 });
    const db = await database.collections();
    expect(await db.discoveryProfiles.countDocuments()).toBe(102);
    expect((await db.discoveryProfiles.findOne({ _id: first[0].address }))?.name).toBe(first[0].name);
    expect((await db.discoveryProfiles.findOne({ _id: extraAddress }))?.twitter).toBe('https://x.com/newcaller');
    expect(await db.wallets.countDocuments()).toBe(0);
    expect((await db.discoverySync.findOne({ _id: 'kolscan:solana' }))?.lastReport).toMatchObject({ status: 'ok', parsed: 101, added: 1, missing: 1 });
    expect(await db.telegramJobs.countDocuments({ kind: 'discovery', chatId: '123' })).toBe(2);
    expect(await db.telegramJobs.countDocuments({ kind: 'discovery', chatId: '456' })).toBe(0);
    expect((await db.telegramJobs.findOne({ kind: 'discovery', chatId: '123', text: /Новых кошельков: 1/ }))?.text).toContain('Спарсено сейчас: 101');
    expect((await discovery.getDiscoveryCatalog()).profiles.some(profile => profile.address === extraAddress)).toBe(true);
  });

  it('keeps the previous catalog and schedules a retry after a bad response', async () => {
    const now = new Date();
    await discovery.syncKolscanDiscovery(now, fetchPage(page(kolscanSnapshot.profiles.slice(0, 101))));
    const retryAt = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await expect(discovery.syncKolscanDiscovery(retryAt, fetchPage('invalid'))).rejects.toThrow('only 0 profiles');
    const db = await database.collections();
    expect(await db.discoveryProfiles.countDocuments()).toBe(101);
    expect((await db.discoverySync.findOne({ _id: 'kolscan:solana' }))?.lastError).toContain('only 0 profiles');
    expect((await db.discoverySync.findOne({ _id: 'kolscan:solana' }))?.lastReport).toMatchObject({ status: 'error', parsed: 0, added: null, missing: null });
    expect((await db.telegramJobs.findOne({ kind: 'discovery', status: 'pending', text: /🔴 Ошибка/ }))?.text).toContain('Спарсено сейчас: 0');
  });

  it('finds the private report chat from a past authenticated bot update', async () => {
    const db = await database.collections();
    await db.telegramChats.updateOne({ _id: '123' }, { $unset: { username: '' } });
    await db.telegramUpdates.insertOne({
      _id: 'report-owner-update',
      payload: { message: { from: { id: 123, username: 'heymike777' }, chat: { id: 123, type: 'private' } } },
      status: 'sent', attempts: 0, createdAt: new Date(), availableAt: new Date(),
    });
    await discovery.syncKolscanDiscovery(new Date(), fetchPage(page(kolscanSnapshot.profiles.slice(0, 101))));
    expect((await db.discoverySync.findOne({ _id: 'kolscan:solana' }))?.reportChatId).toBe('123');
    expect(await db.telegramJobs.countDocuments({ kind: 'discovery', chatId: '123' })).toBe(1);
  });

  it('lets the configured Telegram username claim the report chat', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    const telegramFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));
    vi.stubGlobal('fetch', telegramFetch);
    try {
      const { handleTelegramUpdate } = await import('../services/telegram.js');
      await handleTelegramUpdate({ update_id: 4001, message: {
        chat: { id: 123, type: 'private' }, from: { id: 123, username: 'heymike777' }, text: '/discoveryreports',
      } });
      const db = await database.collections();
      expect((await db.discoverySync.findOne({ _id: 'kolscan:solana' }))?.reportChatId).toBe('123');
      expect(JSON.parse(telegramFetch.mock.calls[0][1]!.body as string).text).toContain('Discovery reports will arrive here');
    } finally { vi.unstubAllGlobals(); }
  });
  it('locks reports to the pinned numeric Telegram ID even if a username changes hands', async () => {
    const db = await database.collections();
    await discovery.claimDiscoveryReportChat('123');
    expect(await discovery.isDiscoveryReportAdmin('123', 'different_name')).toBe(true);
    expect(await discovery.isDiscoveryReportAdmin('456', 'heymike777')).toBe(false);
    vi.stubEnv('DISCOVERY_REPORT_TELEGRAM_USER_ID', '123');
    expect(await discovery.isDiscoveryReportAdmin('456', 'heymike777')).toBe(false);
    expect(await discovery.isDiscoveryReportAdmin('123')).toBe(true);
    expect((await db.discoverySync.findOne({ _id: 'kolscan:solana' }))?.reportChatId).toBe('123');
    vi.stubEnv('DISCOVERY_REPORT_TELEGRAM_USER_ID', '');
  });
});
