import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { collections, type Collections, type TrackingStateDocument, type WalletDocument } from '../db.js';
import { canonicalAccountId, withAccountMutation } from './accounts.js';

// One policy for every account today. Future paid policies can be selected here.
export const FREE_TRANSACTION_LIMITS = [
  { name: 'minute', limit: 20, durationMs: 60_000 },
  { name: 'hour', limit: 100, durationMs: 60 * 60_000 },
  { name: 'day', limit: 300, durationMs: 24 * 60 * 60_000 },
] as const;

export function trackingBlocked(state: TrackingStateDocument | null | undefined, now = new Date()) {
  return Boolean(state?.paused || state?.resumePending || (state?.cooldownUntil && state.cooldownUntil > now));
}
export function subscriptionBlocked(state: TrackingStateDocument | null | undefined, now = new Date()) {
  // Expired cooldowns subscribe only to establish a fresh live slot, never to replay the pause.
  return Boolean(state?.paused || (state?.cooldownUntil && state.cooldownUntil > now));
}

export async function quotaDeadline(db: Collections, userId: string, now: Date, session?: ClientSession, merging = false) {
  const exceeded: string[] = [];
  let until = 0;
  for (const policy of FREE_TRANSACTION_LIMITS) {
    const query = { userId, observedAt: { $gt: new Date(now.getTime() - policy.durationMs) } };
    const count = await db.rateEvents.countDocuments(query, { session });
    if (merging ? count <= policy.limit : count < policy.limit) continue;
    const [release] = await db.rateEvents.find(query, { session }).sort({ observedAt: 1, _id: 1 }).skip(count - policy.limit).limit(1).toArray();
    if (!release) continue;
    until = Math.max(until, release.observedAt.getTime() + policy.durationMs);
    exceeded.push(`${policy.limit}/${policy.name}`);
  }
  return until ? { until: new Date(until), reason: exceeded.join(', ') } : null;
}

async function queueTrackingNotice(db: Collections, session: ClientSession, userId: string, text: string, until: Date | null, now: Date) {
  const id = `tracking:${randomUUID()}`;
  const chat = await db.telegramChats.findOne(userId.startsWith('telegram:') ? { _id: userId.slice(9) } : { userId }, { session });
  if (chat && !chat.disabledAt) await db.telegramJobs.insertOne({
    _id: randomUUID(), kind: 'account', userId, chatId: chat._id, walletId: `account:${userId}`,
    txHash: id, slot: 0, text, buttons: [], priority: 1,
    status: 'pending', attempts: 0, availableAt: now, createdAt: now,
  }, { session });
  const devices = await db.deviceTokens.find({ userId, disabledAt: { $exists: false } }, { session }).toArray();
  for (const device of devices) await db.notificationJobs.insertOne({
    _id: randomUUID(), userId, deviceTokenId: device._id, transactionId: id,
    title: 'WhoAped · Tracking paused', body: text,
    data: { type: 'tracking_cooldown', cooldownUntil: until?.toISOString() ?? '', reason: text },
    status: 'pending', attempts: 0, availableAt: now, createdAt: now,
  }, { session });
}

export async function startCooldown(db: Collections, session: ClientSession, userId: string, until: Date, reason: string, now: Date) {
  await db.trackingStates.updateOne({ _id: userId }, { $set: {
    cooldownUntil: until, cooldownStartedAt: now, reason, resumePending: true, updatedAt: now,
  } }, { session, upsert: true });
  await queueTrackingNotice(db, session, userId,
    `You're in cooldown: transaction limit ${reason} reached. All your wallets are paused until ${until.toISOString()} (UTC). Tracking will resume automatically. Transactions during this pause will not be collected or backfilled.`, until, now);
}

export async function admitAccountTransaction(userId: string, txHash: string, slot: number, now = new Date()) {
  return withAccountMutation(userId, async (db, session, accountId) => {
    const state = await db.trackingStates.findOne({ _id: accountId }, { session });
    if (trackingBlocked(state, now) || slot <= (state?.ignoreThroughSlot ?? -1)) return { allowed: false, cooldownStarted: false, accountId };
    if (await db.rateEvents.findOne({ userId: accountId, chain: 'solana', txHash }, { session })) return { allowed: true, cooldownStarted: false, accountId };
    const deadline = await quotaDeadline(db, accountId, now, session);
    if (deadline) {
      await startCooldown(db, session, accountId, deadline.until, deadline.reason, now);
      return { allowed: false, cooldownStarted: true, accountId };
    }
    await db.rateEvents.insertOne({ _id: randomUUID(), userId: accountId, chain: 'solana', txHash, slot, observedAt: now }, { session });
    return { allowed: true, cooldownStarted: false, accountId };
  });
}

export async function getTrackingStatus(userId: string) {
  const db = await collections();
  const state = await db.trackingStates.findOne({ _id: userId });
  return {
    paused: Boolean(state?.paused), cooldownUntil: state?.cooldownUntil ?? null,
    resuming: Boolean(state?.resumePending && !subscriptionBlocked(state)), reason: state?.reason ?? null,
    limits: Object.fromEntries(FREE_TRANSACTION_LIMITS.map(p => [p.name, p.limit])),
  };
}

export async function setAccountTrackingPaused(userId: string, paused: boolean, now = new Date()) {
  return withAccountMutation(userId, async (db, session, accountId) => {
    const previous = await db.trackingStates.findOne({ _id: accountId }, { session });
    await db.trackingStates.updateOne({ _id: accountId }, { $set: { paused, resumePending: true, updatedAt: now } }, { session, upsert: true });
    if (paused && !previous?.paused) await queueTrackingNotice(db, session, accountId,
      'Tracking has been paused for your account. Your wallets are no longer monitored. Transactions during this pause will not be collected or backfilled.', null, now);
    return { accountId, paused };
  });
}

export async function eligibleSubscriptionPlan(now = new Date()) {
  const db = await collections();
  const wallets = await db.wallets.find({ chain: 'solana', deletedAt: null, status: { $ne: 'error' } }).toArray();
  const owners = [...new Set(wallets.map(w => w.userId))];
  const states = new Map((await db.trackingStates.find({ _id: { $in: owners } }).toArray()).map(s => [s._id, s]));
  const eligible = wallets.filter(w => !subscriptionBlocked(states.get(w.userId), now));
  const addresses = [...new Set(eligible.map(w => w.address))].sort();
  const resuming = [...new Set(eligible.filter(w => states.get(w.userId)?.resumePending).map(w => w.userId))].sort();
  return { addresses, resuming, fingerprint: JSON.stringify([addresses, resuming]) };
}

/** A fresh ping gives a reliable Solana slot at the end of a pause, without an extra RPC request. */
export async function resumeAccountsAtSlot(addresses: string[], slot: number, now = new Date()) {
  const db = await collections();
  const userIds = await db.wallets.distinct('userId', { address: { $in: addresses }, deletedAt: null, chain: 'solana' });
  const resuming = await db.trackingStates.find({ _id: { $in: userIds }, resumePending: true }).toArray();
  for (const { _id: userId } of resuming) await withAccountMutation(userId, async (database, session, accountId) => {
    const state = await database.trackingStates.findOne({ _id: accountId }, { session });
    if (!state?.resumePending || subscriptionBlocked(state, now)) return;
    // A merge may combine more usage than any one pre-merge account had.
    const deadline = await quotaDeadline(database, accountId, now, session);
    if (deadline) {
      await startCooldown(database, session, accountId, deadline.until, deadline.reason, now);
      return;
    }
    await database.trackingStates.updateOne({ _id: accountId }, {
      $set: { resumePending: false, updatedAt: now }, $max: { ignoreThroughSlot: slot },
    }, { session });
  });
}

/** Re-evaluated before every paid history request, including each pagination page. */
export async function backfillStartSlot(address: string, requestedFrom: number, toSlot: number, now = new Date()) {
  const db = await collections();
  const wallets = await db.wallets.find({ address, chain: 'solana', deletedAt: null, status: { $ne: 'error' } }).toArray();
  let earliest = Infinity;
  for (const wallet of wallets) {
    const state = await db.trackingStates.findOne({ _id: wallet.userId });
    if (trackingBlocked(state, now)) continue;
    earliest = Math.min(earliest, Math.max(requestedFrom, (state?.ignoreThroughSlot ?? -1) + 1));
  }
  return earliest <= toSlot ? earliest : null;
}

export async function walletTrackingEligible(wallet: WalletDocument, slot: number, blockTime?: number | null) {
  // Do not charge a newly added wallet for old history fetched for another subscriber.
  if (blockTime && blockTime * 1000 < wallet.createdAt.getTime() - 1000) return false;
  const db = await collections();
  const userId = await canonicalAccountId(wallet.userId, db);
  const state = await db.trackingStates.findOne({ _id: userId });
  return !trackingBlocked(state) && slot > (state?.ignoreThroughSlot ?? -1);
}

/** Called inside the account merge transaction: linking/reinstallation cannot reset limits. */
export async function mergeAccountRateLimits(db: Collections, session: ClientSession, sourceId: string, targetId: string, now: Date) {
  const options = { session };
  for (const event of await db.rateEvents.find({ userId: sourceId }, options).toArray()) {
    const existing = await db.rateEvents.findOne({ userId: targetId, chain: event.chain, txHash: event.txHash }, options);
    if (existing) {
      await db.rateEvents.updateOne({ _id: existing._id }, { $min: { observedAt: event.observedAt } }, options);
      await db.rateEvents.deleteOne({ _id: event._id }, options);
    } else await db.rateEvents.updateOne({ _id: event._id }, { $set: { userId: targetId } }, options);
  }
  const source = await db.trackingStates.findOne({ _id: sourceId }, options);
  const target = await db.trackingStates.findOne({ _id: targetId }, options);
  if (source) await db.trackingStates.updateOne({ _id: targetId }, { $set: {
    paused: Boolean(source.paused || target?.paused), resumePending: Boolean(source.resumePending || target?.resumePending),
    ignoreThroughSlot: Math.max(source.ignoreThroughSlot ?? -1, target?.ignoreThroughSlot ?? -1), updatedAt: now,
  }, $max: { cooldownUntil: source.cooldownUntil ?? new Date(0) } }, { ...options, upsert: true });
  const existingUntil = Math.max(source?.cooldownUntil?.getTime() ?? 0, target?.cooldownUntil?.getTime() ?? 0);
  const deadline = await quotaDeadline(db, targetId, now, session, true);
  if (deadline && deadline.until.getTime() > existingUntil) await startCooldown(db, session, targetId, deadline.until, deadline.reason, now);
  if (source) await db.trackingStates.deleteOne({ _id: sourceId }, options);
}
