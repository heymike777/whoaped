import { collections } from '../db.js';

export const PUBLIC_STATS_TTL_SECONDS = 300;
export const PUBLIC_STATS_RETRY_SECONDS = 30;

type WalletStats = { uniqueWalletsTracked: number; asOf: string };
let cached: WalletStats | undefined;
let pending: Promise<WalletStats | null> | undefined;
let retryAt = 0;

async function readWalletStats(asOf: Date): Promise<WalletStats> {
  const db = await collections();
  const result = await db.wallets.aggregate<{ uniqueWalletsTracked: number }>([
    { $match: { chain: 'solana', status: 'active', deletedAt: null } },
    // Use the same account-level exclusions as trackingBlocked. Match before
    // deduplication so a paused subscriber does not hide another active watch.
    { $lookup: {
      from: db.trackingStates.collectionName, localField: 'userId', foreignField: '_id', as: 'blocked',
      pipeline: [
        { $match: { $or: [{ paused: true }, { resumePending: true }, { cooldownUntil: { $gt: asOf } }] } },
        { $project: { _id: 1 } },
      ],
    } },
    { $match: { 'blocked.0': { $exists: false } } },
    { $group: { _id: '$address' } },
    { $count: 'uniqueWalletsTracked' },
  ], { maxTimeMS: 5_000 }).next();
  return { uniqueWalletsTracked: result?.uniqueWalletsTracked ?? 0, asOf: asOf.toISOString() };
}

export async function getPublicWalletStats(): Promise<WalletStats | null> {
  const now = Date.now();
  if (cached && now - Date.parse(cached.asOf) < PUBLIC_STATS_TTL_SECONDS * 1_000) return cached;
  if (now < retryAt) return null;
  pending ??= readWalletStats(new Date(now)).then((stats) => cached = stats).catch(() => {
    // Do not retry the aggregation on every request during a database outage.
    retryAt = Date.now() + PUBLIC_STATS_RETRY_SECONDS * 1_000;
    return null;
  }).finally(() => { pending = undefined; });
  return pending;
}
