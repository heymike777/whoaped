import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { mergePaidAccess, premiumAccess } from './premium-access.js';
import { getTrackingStatus, mergeAccountRateLimits } from './rate-limits.js';
import { collections, withDatabaseTransaction, type Collections } from '../db.js';

export class AccountLinkError extends Error {}
export class AccountUnavailableError extends Error {}
export const linkHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function canonicalAccountId(userId: string, db?: Collections, session?: ClientSession): Promise<string> {
  const database = db ?? await collections();
  for (let depth = 0; depth < 10; depth++) {
    const user = await database.users.findOne({ _id: userId }, { session });
    if (!user?.mergedInto) return userId;
    userId = user.mergedInto;
  }
  throw new AccountLinkError('Account could not be resolved. Please contact support.');
}

// Wallet/device writes take the same account lock as a merge. An in-flight write
// either commits before the merge scans it, or retries against the new owner.
export async function lockAccount(db: Collections, session: ClientSession, accountId: string) {
  const result = await db.users.updateOne({ _id: accountId }, { $inc: { writeVersion: 1 } }, { session });
  if (result.matchedCount) return true;
  // Older bot sessions can have a chat row before their first account write.
  if (!accountId.startsWith('telegram:') || !await db.telegramChats.findOne({
    _id: accountId.slice(9), $or: [{ userId: accountId }, { userId: { $exists: false } }],
  }, { session })) return false;
  await db.users.updateOne({ _id: accountId }, { $inc: { writeVersion: 1 }, $setOnInsert: { createdAt: new Date() } }, { session, upsert: true });
  return true;
}

export async function withAccountMutation<T>(userId: string, work: (db: Collections, session: ClientSession, accountId: string) => Promise<T>, onMissing?: () => T) {
  return withDatabaseTransaction(async (db, session) => {
    const accountId = await canonicalAccountId(userId, db, session);
    if (!await lockAccount(db, session, accountId)) {
      if (onMissing) return onMissing();
      throw new AccountUnavailableError('This account is no longer available.');
    }
    return work(db, session, accountId);
  });
}

export async function getAccount(userId: string) {
  const db = await collections();
  const accountId = await canonicalAccountId(userId, db);
  const user = await db.users.findOne({ _id: accountId });
  const chat = await db.telegramChats.findOne({ userId: accountId });
  const now = new Date();
  const entitlements = await db.accountEntitlements.find({ userId: accountId, revokedAt: { $exists: false }, $or: [
    { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } },
  ] }).toArray();
  const premium = await premiumAccess(accountId, db);
  return {
    id: accountId,
    preferences: { trackFailedTransactions: user?.trackFailedTransactions === true },
    telegram: chat ? { connected: true as const, username: chat.username ?? null, linkedAt: chat.linkedAt } : null,
    tracking: await getTrackingStatus(accountId, premium.active),
    premium,
    entitlements: entitlements.map(e => ({ feature: e.feature, expiresAt: e.expiresAt ?? null })),
  };
}

export async function setTrackFailedTransactions(userId: string, enabled: boolean) {
  return withAccountMutation(userId, async (db, session, accountId) => {
    await db.users.updateOne({ _id: accountId }, { $set: { trackFailedTransactions: enabled } }, { session });
    if (!enabled) {
      await db.notificationJobs.updateMany({ userId: accountId, failedTransaction: true, status: { $in: ['pending', 'processing'] } }, { $set: { status: 'failed', lastError: 'Failed transaction tracking disabled' } }, { session });
      await db.telegramJobs.updateMany({ userId: accountId, kind: 'failed', status: { $in: ['pending', 'processing'] } }, { $set: { status: 'failed', lastError: 'Failed transaction tracking disabled' } }, { session });
    }
    return { trackFailedTransactions: enabled };
  });
}

export async function createTelegramLink(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date(), expiresAt = new Date(now.getTime() + 10 * 60_000);
  const code = String(randomInt(100_000, 1_000_000));
  await withAccountMutation(userId, async (db, session, accountId) => {
    if (await db.telegramChats.findOne({ userId: accountId }, { session })) throw new AccountLinkError('Telegram is already connected to this account.');
    // Reissuing cancels earlier links. Only a hash of the high-entropy token is stored.
    await db.accountLinks.updateMany({ userId: accountId, status: 'pending' }, { $set: { status: 'cancelled' } }, { session });
    await db.accountLinks.insertOne({ _id: linkHash(token), userId: accountId, code, createdAt: now, expiresAt, status: 'pending' }, { session });
  });
  return { url: `https://t.me/whoapedbot?start=link_${token}`, code, expiresAt };
}

export async function previewTelegramLink(token: string, chatId: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccountLinkError('This connection link is invalid. Create a new one in the app.');
  const db = await collections();
  const link = await db.accountLinks.findOneAndUpdate({ _id: linkHash(token), status: 'pending', expiresAt: { $gt: new Date() }, $or: [
    { claimedChatId: { $exists: false } }, { claimedChatId: chatId },
  ] }, { $set: { claimedChatId: chatId } }, { returnDocument: 'after' });
  if (!link) throw new AccountLinkError('This connection link expired or was used. Create a new one in the app.');
  const other = await db.telegramChats.findOne({ userId: await canonicalAccountId(link.userId, db) });
  if (other && other._id !== chatId) throw new AccountLinkError('This app account is connected to another Telegram account.');
  return link;
}

/** All changes commit together, including link consumption and every session/device owner. */
export async function confirmTelegramLink(token: string, chatId: string, username?: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccountLinkError('Invalid connection link.');
  return withDatabaseTransaction(async (db, session) => {
    const options = { session };
    const link = await db.accountLinks.findOne({ _id: linkHash(token) }, options);
    if (!link || link.expiresAt <= new Date() || link.status === 'cancelled') throw new AccountLinkError('This link expired. Create a new one in the app.');
    if (link.status === 'confirmed') {
      if (link.confirmedChatId !== chatId) throw new AccountLinkError('This link was already used.');
      return;
    }
    if (link.claimedChatId !== chatId) throw new AccountLinkError('Open this connection link in this Telegram chat first.');
    const sourceId = await canonicalAccountId(link.userId, db, session);
    if (!await lockAccount(db, session, sourceId)) throw new AccountLinkError('This app account no longer exists.');
    const chat = await db.telegramChats.findOne({ _id: chatId }, options);
    const targetId = await canonicalAccountId(chat?.userId ?? `telegram:${chatId}`, db, session);
    const otherChat = await db.telegramChats.findOne({ userId: sourceId }, options);
    if (otherChat && otherChat._id !== chatId) throw new AccountLinkError('This app account is connected to another Telegram account.');
    const now = new Date();
    await db.users.updateOne({ _id: targetId }, { $inc: { writeVersion: 1 }, $setOnInsert: { createdAt: now } }, { ...options, upsert: true });
    if (sourceId !== targetId) await mergeAccountData(db, session, sourceId, targetId, now);
    await db.telegramChats.updateOne({ _id: chatId }, {
      $set: { userId: targetId, linkedAt: chat?.linkedAt ?? now, ...(username ? { username } : {}) },
      $unset: { pendingAction: '', disabledAt: '' }, $setOnInsert: { createdAt: now },
    }, { ...options, upsert: true });
    await db.accountLinks.updateOne({ _id: link._id, status: 'pending' }, { $set: { status: 'confirmed', confirmedChatId: chatId } }, options);
    await db.accountLinks.updateMany({ userId: link.userId, _id: { $ne: link._id }, status: 'pending' }, { $set: { status: 'cancelled' } }, options);
  });
}

export async function mergeAccountData(db: Collections, session: ClientSession, sourceId: string, targetId: string, now: Date) {
  const options = { session };
  const source = await db.users.findOne({ _id: sourceId }, options);
  const target = await db.users.findOne({ _id: targetId }, options);
  if (source?.trackFailedTransactions === true && target?.trackFailedTransactions == null) {
    await db.users.updateOne({ _id: targetId }, { $set: { trackFailedTransactions: true } }, options);
  }
  // Retain aliases for any session or in-flight event that still carries the old account ID.
  await db.users.updateOne({ _id: sourceId }, { $set: { mergedInto: targetId, mergedAt: now }, $setOnInsert: { createdAt: now } }, { ...options, upsert: true });
  const wallets = await db.wallets.find({ userId: sourceId }, options).toArray();
  for (const wallet of wallets) {
    const existing = !wallet.deletedAt ? await db.wallets.findOne({ userId: targetId, chain: wallet.chain, address: wallet.address, deletedAt: null }, options) : null;
    if (!existing) {
      await db.wallets.updateOne({ _id: wallet._id }, { $set: { userId: targetId, telegramAlertsFrom: now } }, options);
      continue;
    }
    // Preserve both history and original IDs. Duplicate activities become aliases to the retained row.
    await db.wallets.updateOne({ _id: wallet._id }, { $set: { userId: targetId, deletedAt: now, mergedIntoWalletId: existing._id } }, options);
    for (const transaction of await db.transactions.find({ walletId: wallet._id }, options).toArray()) {
      const duplicate = await db.transactions.findOne({ walletId: existing._id, chain: transaction.chain, txHash: transaction.txHash, eventIndex: transaction.eventIndex }, options);
      await db.transactions.updateOne({ _id: transaction._id }, { $set: duplicate
        ? { userId: targetId, suppressed: true, mergedIntoTransactionId: duplicate._id }
        : { userId: targetId, walletId: existing._id } }, options);
    }
    // Telegram already tracks the retained wallet. Never replay the mobile backlog as new alerts.
    await db.telegramJobs.updateMany({ walletId: wallet._id, status: { $in: ['pending', 'processing'] } }, { $set: { status: 'failed', lastError: 'Wallet merged' } }, options);
  }
  // Sequential operations: MongoDB sessions do not support parallel operations in a transaction.
  await db.transactions.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, options);
  await db.sessions.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, options);
  await db.deviceTokens.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, options);
  await db.payboxImports.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, options);
  await db.notificationJobs.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, options);
  await mergePaidAccess(db, session, sourceId, targetId, now);
  await db.accountEntitlements.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, options);
  await db.stakeFastWallets.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, options);
  await db.stakeFastChallenges.deleteOne({ _id: sourceId }, options);
  await mergeAccountRateLimits(db, session, sourceId, targetId, now);
}
