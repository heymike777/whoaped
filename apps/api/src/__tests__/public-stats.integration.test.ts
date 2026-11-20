import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { WalletDocument } from '../db.js';

let mongo: MongoMemoryReplSet;
let database: typeof import('../db.js');
let app: typeof import('../app.js')['app'];

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv('MONGODB_URI', mongo.getUri());
  vi.stubEnv('MONGODB_DATABASE', 'public-stats-tests');
  database = await import('../db.js');
  ({ app } = await import('../app.js'));
}, 120_000);

afterAll(async () => {
  await database?.closeDatabase();
  await mongo?.stop();
  vi.unstubAllEnvs();
});

it('publicly returns only a cached deduplicated count of active Solana watches', async () => {
  const db = await database.collections();
  const now = new Date();
  const wallet = (_id: string, userId: string, address: string, overrides: Partial<WalletDocument> = {}): WalletDocument => ({
    _id, userId, address, name: 'Private label', chain: 'solana', status: 'active', createdAt: now, ...overrides,
  });
  await db.wallets.insertMany([
    wallet('1', 'mobile', 'same-mint-case'),
    wallet('2', 'telegram:123', 'same-mint-case'),
    wallet('3', 'mobile', 'Same-mint-case'),
    wallet('4', 'paused', 'Same-mint-case'),
    wallet('5', 'paused', 'paused-only'),
    wallet('6', 'cooling', 'cooling-only'),
    wallet('7', 'resuming', 'resuming-only'),
    wallet('8', 'mobile', 'deleted', { deletedAt: now }),
    wallet('9', 'mobile', 'syncing', { status: 'syncing' }),
    wallet('10', 'mobile', 'error', { status: 'error' }),
    wallet('11', 'resumed', 'resumed'),
  ]);
  await db.trackingStates.insertMany([
    { _id: 'paused', paused: true, updatedAt: now },
    { _id: 'cooling', cooldownUntil: new Date(now.getTime() + 60_000), updatedAt: now },
    { _id: 'resuming', resumePending: true, updatedAt: now },
    { _id: 'resumed', cooldownUntil: new Date(now.getTime() - 60_000), updatedAt: now },
  ]);

  const response = await app.request('/public/stats');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toMatch(/^public, max-age=\d+$/);
  const snapshot = await response.json() as { asOf: string };
  expect(snapshot).toEqual({ uniqueWalletsTracked: 3, asOf: expect.any(String) });
  expect(Date.parse(snapshot.asOf)).toBeGreaterThanOrEqual(now.getTime());

  await db.wallets.insertOne(wallet('12', 'mobile', 'new-uncached-address'));
  await expect((await app.request('/public/stats')).json()).resolves.toEqual(snapshot);
});
