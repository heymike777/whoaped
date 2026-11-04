import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Collections } from '../db.js';
let replica: MongoMemoryReplSet;
let database: typeof import('../db.js');
let quota: typeof import('../services/rate-limits.js');
let accounts: typeof import('../services/accounts.js');
let ingest: typeof import('../services/parsed-transactions.js')['ingestParsedTransaction'];
let history: typeof import('../services/parsed-events.js')['backfillParsedEvents'];
let db: Collections;
let now: Date;
const user = 'telegram:123', other = 'other-user';
const address = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';
const exclusive = '11111111111111111111111111111111';
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv('MONGODB_URI', replica.getUri()); vi.stubEnv('MONGODB_DATABASE', 'quota-tests');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token'); vi.stubEnv('HELIUS_API_KEY', 'test-key');
  database = await import('../db.js'); quota = await import('../services/rate-limits.js');
  accounts = await import('../services/accounts.js');
  ingest = (await import('../services/parsed-transactions.js')).ingestParsedTransaction;
  history = (await import('../services/parsed-events.js')).backfillParsedEvents;
  db = await database.collections();
}, 120_000);
afterAll(async () => { await database?.closeDatabase(); await replica?.stop(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  for (const collection of Object.values(db)) await collection.deleteMany({});
  now = new Date();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) }));
  await db.users.insertMany([{ _id: user, createdAt: now }, { _id: other, createdAt: now }]);
  await db.telegramChats.insertOne({ _id: '123', userId: user, createdAt: now });
  await db.deviceTokens.insertOne({ _id: 'phone', userId: user, token: 'push', platform: 'ios', createdAt: now, lastSeenAt: now });
  await db.wallets.insertMany([
    { _id: 'shared-u', userId: user, address, name: 'Shared', chain: 'solana', status: 'active', createdAt: new Date(0), deletedAt: null },
    { _id: 'exclusive-u', userId: user, address: exclusive, name: 'Exclusive', chain: 'solana', status: 'active', createdAt: new Date(0), deletedAt: null },
  ]);
});
async function seed(count: number, owner = user, age = 0, spacing = 0, prefix = 'tx') {
  await db.rateEvents.insertMany(Array.from({ length: count }, (_, i) => ({
    _id: `${owner}:${prefix}:${i}`, userId: owner, chain: 'solana' as const, txHash: `${prefix}:${i}`, slot: i + 1,
    observedAt: new Date(now.getTime() - age - spacing * i),
  })));
}

describe('per-account transaction limits', () => {
  it('allows exactly 20/min, sends one cooldown notice per channel, then stops all owned addresses', async () => {
    for (let i = 0; i < 20; i++) expect((await quota.admitAccountTransaction(user, `sig:${i}`, i + 1, now)).allowed).toBe(true);
    const decision = await quota.admitAccountTransaction(user, 'sig:21', 21, now);
    expect(decision).toMatchObject({ allowed: false, cooldownStarted: true });
    expect((await db.trackingStates.findOne({ _id: user }))?.cooldownUntil).toEqual(new Date(now.getTime() + 60_000));
    expect((await quota.eligibleSubscriptionPlan(now)).addresses).toEqual([]);
    expect(await db.telegramJobs.countDocuments({ kind: 'account' })).toBe(1);
    expect(await db.notificationJobs.countDocuments({ 'data.type': 'tracking_cooldown' })).toBe(1);
    expect((await quota.admitAccountTransaction(user, 'sig:22', 22, now)).cooldownStarted).toBe(false);
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(20);
    expect(await db.telegramJobs.countDocuments({ kind: 'account' })).toBe(1);
  });
  it('counts duplicate delivery once, even at the boundary', async () => {
    await seed(20);
    expect((await quota.admitAccountTransaction(user, 'tx:0', 1, now)).allowed).toBe(true);
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(20);
    expect(await db.trackingStates.countDocuments({ _id: user })).toBe(0);
  });
  it('enforces 100/hour independently of the minute limit', async () => {
    await seed(100, user, 30 * 60_000, 1000);
    const decision = await quota.admitAccountTransaction(user, 'extra', 999, now);
    expect(decision.allowed).toBe(false);
    const state = await db.trackingStates.findOne({ _id: user });
    expect(state?.reason).toBe('100/hour');
    expect(state?.cooldownUntil).toEqual(new Date(now.getTime() + 30 * 60_000 - 99_000));
  });
  it('enforces 300/day independently of the hour limit', async () => {
    await seed(300, user, 2 * 60 * 60_000, 60_000);
    expect((await quota.admitAccountTransaction(user, 'extra', 999, now)).allowed).toBe(false);
    const state = await db.trackingStates.findOne({ _id: user });
    expect(state?.reason).toBe('300/day');
    expect(state?.cooldownUntil).toEqual(new Date(now.getTime() + 22 * 60 * 60_000 - 299 * 60_000));
  });
  it('uses the latest release time when multiple windows are exhausted', async () => {
    await seed(20); await seed(80, user, 10 * 60_000, 1000, 'hour'); await seed(200, user, 3 * 60 * 60_000, 1000, 'day');
    await quota.admitAccountTransaction(user, 'extra', 999, now);
    const state = await db.trackingStates.findOne({ _id: user });
    expect(state?.reason).toBe('20/minute, 100/hour, 300/day');
    expect(state!.cooldownUntil!.getTime()).toBeGreaterThan(now.getTime() + 20 * 60 * 60_000);
  });
  it('serializes concurrent stream deliveries instead of admitting beyond 20', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => quota.admitAccountTransaction(user, `parallel:${i}`, i + 1, now)));
    expect(results.filter(r => r.allowed)).toHaveLength(20);
    expect(results.filter(r => r.cooldownStarted)).toHaveLength(1);
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(20);
  }, 15_000);
  it('charges one signature across all wallets, including unclassified transactions', async () => {
    await ingest({ signature: 'both-wallets', slot: 500, accountKeys: [address, exclusive] }, { provider: 'helius-parsed-stream' });
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(1);
    expect(await db.telegramJobs.countDocuments({ txHash: 'both-wallets' })).toBe(1);
    const message = await db.telegramJobs.findOne({ txHash: 'both-wallets' });
    expect(message?.text).toContain('2 tracked wallets');
    expect(message?.text).toContain('Shared');
    expect(message?.text).toContain('Exclusive');
    expect(await db.notificationJobs.countDocuments({ dedupeKey: 'solana:both-wallets' })).toBe(0);
  });
  it('sends one push and one Telegram message for a transfer between two watched wallets', async () => {
    await ingest({ signature: 'internal-transfer', slot: 501, accountKeys: [address, exclusive],
      feePayer: address, fee: 5000,
      nativeTransfers: [{ fromUserAccount: address, toUserAccount: exclusive, amount: 100_000_000 }],
    }, { provider: 'helius-parsed-stream' });
    expect(await db.transactions.countDocuments({ userId: user, txHash: 'internal-transfer' })).toBe(2);
    expect(await db.telegramJobs.countDocuments({ txHash: 'internal-transfer' })).toBe(1);
    const message = await db.telegramJobs.findOne({ txHash: 'internal-transfer' });
    expect(message?.text).toContain('Shared');
    expect(message?.text).toContain('Exclusive');
    expect(message?.text).toContain('−0.100005 SOL');
    expect(message?.text).toContain('+0.1 SOL');
    const push = await db.notificationJobs.findOne({ dedupeKey: 'solana:internal-transfer' });
    expect(push?.title).toBe('2 wallets in one transaction');
    expect(push?.body).toContain('Shared:');
    expect(push?.body).toContain('Exclusive:');
    expect(await db.notificationJobs.countDocuments({ dedupeKey: 'solana:internal-transfer' })).toBe(1);
  });
  it('keeps a shared address for another account, but never ingests or backfills the paused account', async () => {
    await db.wallets.insertOne({ _id: 'shared-other', userId: other, address, name: 'Other', chain: 'solana', status: 'active', createdAt: new Date(0), deletedAt: null });
    await seed(20); await quota.admitAccountTransaction(user, 'over-limit', 500, now);
    expect((await quota.eligibleSubscriptionPlan()).addresses).toEqual([address]);
    expect(await quota.backfillStartSlot(exclusive, 1, 1000)).toBeNull();
    expect(await quota.backfillStartSlot(address, 1, 1000)).toBe(1);
    await ingest({ signature: 'shared-new', slot: 501, accountKeys: [address], nativeTransfers: [{ fromUserAccount: address, toUserAccount: 'receiver', amount: 1_000_000_000 }] }, { provider: 'helius-parsed-stream' });
    expect(await db.transactions.countDocuments({ userId: user, txHash: 'shared-new' })).toBe(0);
    expect(await db.transactions.countDocuments({ userId: other, txHash: 'shared-new' })).toBe(1);
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(20);
  });
  it('makes zero paid history calls for paused wallets and stops pagination at cooldown', async () => {
    await quota.setAccountTrackingPaused(user, true);
    await history(exclusive, 1, 1000);
    expect(fetch).not.toHaveBeenCalled();
    await db.trackingStates.deleteMany({});
    const onCooldown = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({
      data: Array.from({ length: 100 }, (_, i) => ({ parserStatus: 'OK', signature: `history:${i}`, parsed: { slot: i + 1, accountKeys: [address] } })), paginationToken: 'more',
    }) } as Response);
    const result = await history(address, 1, 1000, 20, { onCooldown });
    expect(result.pages).toBe(1); expect(fetch).toHaveBeenCalledTimes(1);
    expect(onCooldown).toHaveBeenCalledTimes(1);
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(20);
  });
  it('resumes at a fresh slot, skipping the entire cooldown gap without a history request', async () => {
    await db.trackingStates.insertOne({ _id: user, cooldownUntil: new Date(now.getTime() - 1), resumePending: true, updatedAt: now });
    expect((await quota.admitAccountTransaction(user, 'before-ping', 999, now)).allowed).toBe(false);
    expect((await quota.eligibleSubscriptionPlan()).addresses).toContain(exclusive);
    await quota.resumeAccountsAtSlot([address, exclusive], 1000, now);
    expect((await db.trackingStates.findOne({ _id: user }))?.ignoreThroughSlot).toBe(1000);
    expect(await quota.backfillStartSlot(address, 1, 1000, now)).toBeNull();
    await history(address, 1, 1000);
    expect(fetch).not.toHaveBeenCalled();
    expect((await quota.admitAccountTransaction(user, 'old-slot', 1000, now)).allowed).toBe(false);
    expect((await quota.admitAccountTransaction(user, 'new-slot', 1001, now)).allowed).toBe(true);
  });
  it('keeps usage and cooldown when accounts merge, so linking cannot reset limits', async () => {
    await seed(20, user); await seed(20, other, 0, 0, 'other');
    await database.withDatabaseTransaction((database, session) => accounts.mergeAccountData(database, session, other, user, now));
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(40);
    expect(await db.rateEvents.countDocuments({ userId: other })).toBe(0);
    expect((await quota.admitAccountTransaction(other, 'bypass', 999, now)).allowed).toBe(false);
    expect((await quota.eligibleSubscriptionPlan()).addresses).toEqual([]);
  });
  it('deduplicates shared signatures and preserves manual pauses during merge', async () => {
    await seed(1, user); await seed(1, other);
    await quota.setAccountTrackingPaused(other, true);
    await database.withDatabaseTransaction((database, session) => accounts.mergeAccountData(database, session, other, user, now));
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(1);
    expect((await db.trackingStates.findOne({ _id: user }))?.paused).toBe(true);
  });
  it('persists cooldown and counters across a database reconnection', async () => {
    await seed(20); await quota.admitAccountTransaction(user, 'extra', 999, now);
    await database.closeDatabase(); db = await database.collections();
    expect((await quota.eligibleSubscriptionPlan()).addresses).toEqual([]);
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(20);
    expect((await quota.admitAccountTransaction(user, 'after-restart', 1000)).allowed).toBe(false);
  });
  it('charges opted-in failed transactions but avoids parsing and metadata calls after quota is exhausted', async () => {
    await accounts.setTrackFailedTransactions(user, true);
    await ingest({ signature: 'failed', status: 'error', slot: 700, accountKeys: [address] }, { provider: 'helius-parsed-stream' });
    expect(await db.rateEvents.countDocuments({ userId: user })).toBe(1);
    expect((await db.telegramJobs.findOne({ txHash: 'failed' }))?.text).toContain('FAILED TRANSACTION');
    expect(await db.transactions.countDocuments({ userId: user, txHash: 'failed', kind: 'failed' })).toBe(1);
    await seed(19);
    const adapter = (await import('../chains/solana.js')).solanaAdapter;
    const spy = vi.spyOn(adapter, 'normalize');
    await ingest({ signature: 'over', slot: 701, accountKeys: [address], instructions: [{ instructionName: 'closeAccount' }] }, { provider: 'helius-parsed-stream' });
    expect(spy).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('rolls back cooldown activation if durable notification creation fails', async () => {
    const spy = vi.spyOn(db.telegramJobs, 'insertOne').mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(database.withDatabaseTransaction((_, session) => quota.startCooldown(db, session, user, new Date(now.getTime() + 60_000), '20/minute', now))).rejects.toThrow('outbox unavailable');
    spy.mockRestore();
    expect(await db.trackingStates.findOne({ _id: user })).toBeNull();
  });
  it('does not enable higher limits from a premium entitlement yet', async () => {
    await db.accountEntitlements.insertOne({ _id: 'pro', userId: user, provider: 'test', externalId: 'test', feature: 'premium', createdAt: now });
    await seed(20); expect((await quota.admitAccountTransaction(user, 'extra', 999, now)).allowed).toBe(false);
  });
  it('protects the administrative pause endpoint', async () => {
    const app = (await import('../app.js')).app;
    expect((await app.request(`/internal/accounts/${user}/tracking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true }) })).status).toBe(401);
    vi.stubEnv('INTERNAL_JOB_SECRET', 'test-internal-secret');
    const response = await app.request(`/internal/accounts/${user}/tracking`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-internal-secret' }, body: JSON.stringify({ paused: true }) });
    expect(response.status).toBe(200); expect((await quota.eligibleSubscriptionPlan()).addresses).toEqual([]);
    const resumed = await app.request(`/internal/accounts/${user}/tracking`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-internal-secret' }, body: JSON.stringify({ paused: false }) });
    expect(resumed.status).toBe(200); expect((await db.trackingStates.findOne({ _id: user }))?.resumePending).toBe(true);
  });
});
