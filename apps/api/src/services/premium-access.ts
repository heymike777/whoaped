import type { ClientSession } from 'mongodb';
import { collections, type Collections, type PaymentOrderDocument } from '../db.js';
import { BillingError, PREMIUM_PLANS } from '../config/premium.js';
const entitlementId = (userId: string) => `whoaped-premium:${userId}`;

export async function premiumAccess(userId: string, database?: Collections, session?: ClientSession, now = new Date()) {
  const db = database ?? await collections();
  const grant = await db.accountEntitlements.findOne({ _id: entitlementId(userId), userId, provider: 'whoaped-billing', revokedAt: { $exists: false } }, { session });
  return { active: Boolean(grant?.expiresAt && grant.expiresAt > now), expiresAt: grant?.expiresAt ?? null };
}
async function setExpiry(db: Collections, session: ClientSession, userId: string, expiresAt: Date, now: Date) {
  await db.accountEntitlements.updateOne({ _id: entitlementId(userId) }, {
    $set: { userId, expiresAt }, $unset: { revokedAt: '' },
    $setOnInsert: { provider: 'whoaped-billing', externalId: entitlementId(userId), feature: 'premium', createdAt: now },
  }, { session, upsert: true });
}
export async function grantPaidOrder(db: Collections, session: ClientSession, order: PaymentOrderDocument, userId: string, paymentId: string, now: Date) {
  const current = await premiumAccess(userId, db, session, now);
  const start = new Date(Math.max(now.getTime(), current.expiresAt?.getTime() ?? 0));
  const end = new Date(start.getTime() + PREMIUM_PLANS[order.plan].days * 86400_000);
  const saved = await db.paymentOrders.updateOne({ _id: order._id, status: { $in: ['pending', 'expired'] } }, { $set: {
    userId, status: 'paid', paymentId, paidAt: now, accessStartsAt: start, accessEndsAt: end,
  } }, { session });
  if (!saved.matchedCount) throw new BillingError('Payment order was already processed.');
  await setExpiry(db, session, userId, end, now);
  return end;
}
/** Repack only unused paid time. Refunds and account merges never manufacture used days. */
export async function repackPaidAccess(db: Collections, session: ClientSession, userId: string, now: Date) {
  const orders = await db.paymentOrders.find({ userId, status: 'paid', accessEndsAt: { $gt: now } }, { session }).sort({ accessStartsAt: 1, paidAt: 1, _id: 1 }).toArray();
  let end = now.getTime();
  for (const order of orders) {
    if (!order.accessStartsAt || !order.accessEndsAt) continue;
    const remaining = Math.max(0, order.accessEndsAt.getTime() - Math.max(now.getTime(), order.accessStartsAt.getTime()));
    await db.paymentOrders.updateOne({ _id: order._id }, { $set: { accessStartsAt: new Date(end), accessEndsAt: new Date(end + remaining) } }, { session });
    end += remaining;
  }
  await setExpiry(db, session, userId, new Date(end), now);
  return new Date(end);
}
export async function mergePaidAccess(db: Collections, session: ClientSession, sourceId: string, targetId: string, now: Date) {
  await db.paymentOrders.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, { session });
  await db.billingSupport.updateMany({ userId: sourceId }, { $set: { userId: targetId } }, { session });
  const grant = await db.accountEntitlements.findOne({ _id: entitlementId(sourceId) }, { session });
  if (grant) {
    await db.accountEntitlements.deleteOne({ _id: grant._id }, { session });
    await repackPaidAccess(db, session, targetId, now);
  }
}
