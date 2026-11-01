import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Collections } from '../db.js';

let replica: MongoMemoryReplSet;
let database: typeof import('../db.js');
let accounts: typeof import('../services/accounts.js');
let auth: typeof import('../auth.js');
let app: typeof import('../app.js')['app'];
let db: Collections;
const now = new Date();
const address = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';
const address2 = '11111111111111111111111111111111';
const address3 = 'So11111111111111111111111111111111111111112';
const source = 'mobile-user', target = 'telegram:123';

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv('MONGODB_URI', replica.getUri());
  vi.stubEnv('MONGODB_DATABASE', 'account-link-tests');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  database = await import('../db.js');
  accounts = await import('../services/accounts.js');
  auth = await import('../auth.js');
  app = (await import('../app.js')).app;
  db = await database.collections();
}, 120_000);
afterAll(async () => { await database?.closeDatabase(); await replica?.stop(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  for (const collection of Object.values(db)) await collection.deleteMany({});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) }));
  await db.users.insertOne({ _id: source, createdAt: now });
  await db.telegramChats.insertOne({ _id: '123', createdAt: now });
  await db.sessions.insertOne({ _id: 'session', userId: source, tokenHash: auth.hashToken('mobile-token'), createdAt: now, expiresAt: new Date(Date.now() + 60_000) });
  await db.wallets.insertMany([
    { _id: 'mobile-shared', userId: source, address, name: 'Mobile name', chain: 'solana', status: 'active', createdAt: now, deletedAt: null },
    { _id: 'mobile-only', userId: source, address: address2, name: 'Mobile only', chain: 'solana', status: 'active', createdAt: now, deletedAt: null },
    { _id: 'bot-shared', userId: target, address, name: 'Bot name', chain: 'solana', status: 'active', createdAt: now, deletedAt: null },
    { _id: 'other-wallet', userId: 'someone-else', address, name: 'Other account', chain: 'solana', status: 'active', createdAt: now, deletedAt: null },
  ]);
});
async function pendingLink() {
  const link = await accounts.createTelegramLink(source);
  const token = new URL(link.url).searchParams.get('start')!.slice(5);
  await accounts.previewTelegramLink(token, '123');
  return { ...link, token };
}

describe('atomic Telegram account linking (real MongoDB replica set)', () => {
  it('merges wallets, sessions, push devices, history and entitlements and shares future writes', async () => {
    await db.deviceTokens.insertOne({ _id: 'device', userId: source, token: 'push-token', platform: 'ios', createdAt: now, lastSeenAt: now });
    const activity = { chain: 'solana' as const, txHash: 'same-signature', eventIndex: 0, slot: 1, kind: 'balance' as const, title: 'Transfer', detail: '', occurredAt: now, metadata: {}, createdAt: now };
    await db.transactions.insertMany([
      { ...activity, _id: 'mobile-tx', userId: source, walletId: 'mobile-shared' },
      { ...activity, _id: 'bot-tx', userId: target, walletId: 'bot-shared' },
      { ...activity, _id: 'unique-tx', txHash: 'unique', userId: source, walletId: 'mobile-shared' },
    ]);
    await db.accountEntitlements.insertMany([
      { _id: 'pro', userId: source, provider: 'apple', externalId: 'receipt-1', feature: 'premium', createdAt: now },
      { _id: 'alerts', userId: target, provider: 'telegram', externalId: 'invoice-1', feature: 'unlimited-alerts', createdAt: now },
    ]);
    const link = await pendingLink();
    expect(link.url).toMatch(/^https:\/\/t.me\/whoapedbot\?start=link_[A-Za-z0-9_-]{43}$/);
    const stored = await db.accountLinks.findOne({ _id: accounts.linkHash(link.token) });
    expect(stored?.code).toBe(link.code);
    expect(JSON.stringify(stored)).not.toContain(link.token);
    const telegram = await import('../services/telegram.js');
    await telegram.handleTelegramUpdate({ update_id: 42, message: { chat: { id: 123, type: 'private' }, from: { id: 123 }, text: `/start link_${link.token}` } });
    const prompt = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string);
    expect(prompt.text).toContain(link.code);
    const confirmation = prompt.reply_markup.inline_keyboard[0][0].callback_data;
    expect(Buffer.byteLength(confirmation)).toBeLessThanOrEqual(64);
    await telegram.handleTelegramUpdate({ update_id: 43, callback_query: { id: 'confirm', data: confirmation, from: { id: 123, username: 'mike' }, message: { chat: { id: 123, type: 'private' } } } });
    expect((await auth.authenticateSessionToken('mobile-token'))?.userId).toBe(target);
    expect(await db.wallets.countDocuments({ userId: target, deletedAt: null })).toBe(2);
    expect((await db.wallets.findOne({ _id: 'mobile-shared' }))?.mergedIntoWalletId).toBe('bot-shared');
    expect((await db.transactions.findOne({ _id: 'mobile-tx' }))?.mergedIntoTransactionId).toBe('bot-tx');
    expect((await db.transactions.findOne({ _id: 'unique-tx' }))?.walletId).toBe('bot-shared');
    expect((await db.deviceTokens.findOne({ _id: 'device' }))?.userId).toBe(target);
    expect(await db.wallets.countDocuments({ userId: 'someone-else' })).toBe(1);
    const account = await accounts.getAccount(source);
    expect(account.id).toBe(target);
    expect(account.telegram?.username).toBe('mike');
    expect(account.entitlements.map(e => e.feature).sort()).toEqual(['premium', 'unlimited-alerts']);
    const response = await app.request('/v1/wallets', { headers: { Authorization: 'Bearer mobile-token' } });
    expect((await response.json() as { data: unknown[] }).data).toHaveLength(2);
    const added = await app.request('/v1/wallets', { method: 'POST', headers: { Authorization: 'Bearer mobile-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New app wallet', address: address3, chain: 'solana' }) });
    expect(added.status).toBe(201);
    expect((await db.wallets.findOne({ address: address3 }))?.userId).toBe(target);
    await telegram.handleTelegramUpdate({ update_id: 44, message: { chat: { id: 123, type: 'private' }, from: { id: 123 }, text: '/wallets' } });
    expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).text).toContain('New app wallet');
    // New chain events fan out to both linked delivery channels.
    const { ingestParsedTransaction } = await import('../services/parsed-transactions.js');
    await ingestParsedTransaction({ signature: 'new-chain-event', slot: 200, accountKeys: [address], nativeTransfers: [{ fromUserAccount: address, toUserAccount: 'receiver', amount: 1_000_000_000 }] }, { provider: 'helius-parsed-stream' });
    expect(await db.telegramJobs.countDocuments({ chatId: '123', txHash: 'new-chain-event' })).toBe(1);
    expect(await db.notificationJobs.countDocuments({ userId: target, deviceTokenId: 'device' })).toBe(1);
  });
  it('requires authentication on all mobile account routes', async () => {
    expect((await app.request('/v1/account')).status).toBe(401);
    expect((await app.request('/v1/account/telegram-link', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/v1/account/telegram-link', { method: 'DELETE' })).status).toBe(401);
  });
  it('lets a new installation recover the same Telegram account and keeps both sessions', async () => {
    const first = await pendingLink();
    await accounts.confirmTelegramLink(first.token, '123');
    await db.users.insertOne({ _id: 'new-installation', createdAt: now });
    await db.sessions.insertOne({ _id: 'new-session', userId: 'new-installation', tokenHash: auth.hashToken('second-token'), createdAt: now, expiresAt: new Date(Date.now() + 60_000) });
    const second = await accounts.createTelegramLink('new-installation');
    const token = new URL(second.url).searchParams.get('start')!.slice(5);
    await accounts.previewTelegramLink(token, '123');
    await accounts.confirmTelegramLink(token, '123');
    expect((await auth.authenticateSessionToken('second-token'))?.userId).toBe(target);
    expect((await auth.authenticateSessionToken('mobile-token'))?.userId).toBe(target);
    expect(await db.wallets.countDocuments({ userId: target, deletedAt: null })).toBe(2);
  });
  it('requires a matching chat to open and confirm a link', async () => {
    const link = await pendingLink();
    await expect(accounts.previewTelegramLink(link.token, '456')).rejects.toThrow();
    await expect(accounts.confirmTelegramLink(link.token, '456')).rejects.toThrow();
    expect((await db.users.findOne({ _id: source }))?.mergedInto).toBeUndefined();
  });
  it('rejects expired and cancelled links without merging anything', async () => {
    const link = await pendingLink();
    await db.accountLinks.updateOne({ _id: accounts.linkHash(link.token) }, { $set: { expiresAt: new Date(0) } });
    await expect(accounts.confirmTelegramLink(link.token, '123')).rejects.toThrow();
    const second = await pendingLink();
    await db.accountLinks.updateOne({ _id: accounts.linkHash(second.token) }, { $set: { status: 'cancelled' } });
    await expect(accounts.confirmTelegramLink(second.token, '123')).rejects.toThrow();
    expect(await db.wallets.countDocuments({ userId: source, deletedAt: null })).toBe(2);
  });
  it('makes repeated confirmation harmless and prevents replay in another chat', async () => {
    const link = await pendingLink();
    await accounts.confirmTelegramLink(link.token, '123');
    await accounts.confirmTelegramLink(link.token, '123');
    expect(await db.wallets.countDocuments({ userId: target, deletedAt: null })).toBe(2);
    await expect(accounts.confirmTelegramLink(link.token, '456')).rejects.toThrow();
  });
  it('does not allow a second Telegram identity to take over a linked account', async () => {
    await db.telegramChats.updateOne({ _id: '456' }, { $set: { userId: source, createdAt: now } }, { upsert: true });
    // A previously issued link must still re-check identity at confirmation.
    const token = 'a'.repeat(43);
    await db.accountLinks.insertOne({ _id: accounts.linkHash(token), userId: source, code: '123456', status: 'pending', claimedChatId: '123', createdAt: now, expiresAt: new Date(Date.now() + 60_000) });
    await expect(accounts.confirmTelegramLink(token, '123')).rejects.toThrow('another Telegram');
    expect(await db.wallets.countDocuments({ userId: source, deletedAt: null })).toBe(2);
  });
  it('serializes wallet writes racing with a merge onto the retained account', async () => {
    const link = await pendingLink();
    await Promise.all([
      accounts.confirmTelegramLink(link.token, '123'),
      accounts.withAccountMutation(source, async (database, session, accountId) => {
        await database.wallets.insertOne({ _id: 'racing-wallet', userId: accountId, address: address3, name: 'Concurrent', chain: 'solana', status: 'active', createdAt: now, deletedAt: null }, { session });
      }),
    ]);
    expect((await db.wallets.findOne({ _id: 'racing-wallet' }))?.userId).toBe(target);
    expect(await db.wallets.countDocuments({ userId: source, deletedAt: null })).toBe(0);
  });
  it('rolls back the merge if a dependent write fails', async () => {
    const link = await pendingLink();
    const spy = vi.spyOn(db.accountEntitlements, 'updateMany').mockRejectedValueOnce(new Error('database unavailable'));
    // Use the same collection instances for an explicit transaction to exercise atomic rollback.
    await expect(database.withDatabaseTransaction((_, session) => accounts.mergeAccountData(db, session, source, target, now))).rejects.toThrow('database unavailable');
    spy.mockRestore();
    expect((await db.users.findOne({ _id: source }))?.mergedInto).toBeUndefined();
    expect(await db.wallets.countDocuments({ userId: source, deletedAt: null })).toBe(2);
    expect((await db.accountLinks.findOne({ _id: accounts.linkHash(link.token) }))?.status).toBe('pending');
  });
});
