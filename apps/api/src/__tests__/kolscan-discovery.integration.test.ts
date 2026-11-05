import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { kolscanSnapshot } from '../data/kolscan-profiles.js';

let mongo: MongoMemoryServer;
let database: typeof import('../db.js');
let discovery: typeof import('../services/kolscan-discovery.js');

const extraAddress = 'So11111111111111111111111111111111111111112';
const row = (profile: { address: string; name: string; twitter: string | null; telegram: string | null }) =>
  `\\"wallet_address\\":\\"${profile.address}\\",\\"name\\":\\"${profile.name}\\",\\"telegram\\":${profile.telegram ? `\\"${profile.telegram}\\"` : 'null'},\\"twitter\\":${profile.twitter ? `\\"${profile.twitter}\\"` : 'null'}`;
const page = (profiles: Array<{ address: string; name: string; twitter: string | null; telegram: string | null }>) =>
  profiles.map(row).join(',');
const fetchPage = (html: string) => vi.fn(async () => new Response(html)) as unknown as typeof fetch;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
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
    expect(simultaneous).toContainEqual({ skipped: false, count: 101 });
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
  });
});
