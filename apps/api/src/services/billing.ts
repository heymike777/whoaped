import { randomUUID } from 'node:crypto';
import { collections } from '../db.js';
import { BillingError, PREMIUM_PLANS, type PremiumPlan } from '../config/premium.js';
import { canonicalAccountId, withAccountMutation } from './accounts.js';
import { grantPaidOrder, premiumAccess, repackPaidAccess } from './premium-access.js';
import { refreshPaidTrackingPolicy } from './rate-limits.js';
import { telegramCall } from './telegram-api.js';

export const PAYMENT_TERMS = 'WhoAped Premium is a one-time purchase of 30 or 365 days. No automatic renewal. Repeat purchases add unused access time to your shared account. Premium limits: 60 transactions/minute, 1,000/hour, 3,000/day across all wallets; usage protection and manual account pauses still apply. Access activates after payment verification. Billing help and refund requests: send /paysupport followed by your message and payment reference in this bot. Never send private keys or seed phrases.';
export const TERMS_VERSION = '2026-11-01';
export async function billingCatalog(userId: string) {
  return {
    // Legacy orders remain queryable and refundable, but new purchases are paused.
    plans: [],
    usdcAvailable: false,
    terms: PAYMENT_TERMS, termsVersion: TERMS_VERSION,
    premium: await premiumAccess(userId),
  };
}
export async function createStarsInvoice(userId: string, telegramUserId: string, plan: PremiumPlan) {
  const product = PREMIUM_PLANS[plan];
  const order = await withAccountMutation(userId, async (db, session, accountId) => {
    const pending = await db.paymentOrders.countDocuments({ userId: accountId, provider: 'stars', status: 'pending', expiresAt: { $gt: new Date() } }, { session });
    if (pending >= 5) throw new BillingError('You already have pending invoices. Pay an existing invoice or try again in 15 minutes.');
    const now = new Date();
    const document = { _id: randomUUID(), userId: accountId, plan, provider: 'stars' as const, telegramUserId,
      currency: 'XTR' as const, amount: product.stars, status: 'pending' as const, createdAt: now, expiresAt: new Date(now.getTime() + 15 * 60_000) };
    await db.paymentOrders.insertOne(document, { session });
    return document;
  });
  await telegramCall('sendInvoice', {
    chat_id: telegramUserId, title: `WhoAped Premium · ${product.label}`,
    description: `${product.label} of Premium on your shared WhoAped account. One-time payment. No auto-renewal. Limits: 60/min, 1,000/hour, 3,000/day. Billing support: /paysupport.`,
    payload: `whoaped:${order._id}`, provider_token: '', currency: 'XTR', start_parameter: `premium_${order._id}`,
    prices: [{ label: `Premium · ${product.label}`, amount: product.stars }],
  });
  return order._id;
}
export type StarsPayment = { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string };
export type StarsPreCheckout = { id: string; from: { id: number }; currency: string; total_amount: number; invoice_payload: string };
const orderId = (payload: string) => /^whoaped:[0-9a-f-]{36}$/.test(payload) ? payload.slice(8) : '';
export async function answerStarsPreCheckout(query: StarsPreCheckout) {
  const db = await collections();
  const order = await db.paymentOrders.findOne({ _id: orderId(query.invoice_payload) });
  const valid = order?.provider === 'stars' && order.status === 'pending' && order.expiresAt > new Date()
    && order.telegramUserId === String(query.from.id) && query.currency === 'XTR' && query.total_amount === order.amount;
  await telegramCall('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: Boolean(valid),
    ...(valid ? {} : { error_message: 'This invoice expired, was paid, or belongs to another account. Open /premium to create a new invoice.' }),
  }, 6000);
}
export async function settleStarsPayment(chatId: string, payment: StarsPayment, refund = false) {
  const db = await collections();
  const initial = await db.paymentOrders.findOne({ _id: orderId(payment.invoice_payload) });
  if (!initial || initial.provider !== 'stars' || initial.telegramUserId !== chatId
    || payment.currency !== 'XTR' || initial.amount !== payment.total_amount) throw new BillingError('Payment could not be matched. Send /paysupport with your Telegram receipt.');
  return withAccountMutation(initial.userId, async (database, session, accountId) => {
    const order = await database.paymentOrders.findOne({ _id: initial._id }, { session });
    if (!order) throw new BillingError('Payment order is unavailable. Contact /paysupport.');
    const paymentId = payment.telegram_payment_charge_id;
    if (order.paymentId && order.paymentId !== paymentId) throw new BillingError('This invoice has another payment receipt. Contact /paysupport.');
    const now = new Date();
    if (refund) {
      if (order.status === 'refunded') return premiumAccess(accountId, database, session, now);
      await database.paymentOrders.updateOne({ _id: order._id }, { $set: { status: 'refunded', paymentId } }, { session });
      await repackPaidAccess(database, session, accountId, now);
      await refreshPaidTrackingPolicy(database, session, accountId, now);
      return premiumAccess(accountId, database, session, now);
    }
    if (order.status === 'refunded') throw new BillingError('This payment was refunded. Premium was not activated.');
    if (order.status === 'paid') return premiumAccess(accountId, database, session, now);
    await grantPaidOrder(database, session, order, accountId, paymentId, now);
    await refreshPaidTrackingPolicy(database, session, accountId, now);
    return premiumAccess(accountId, database, session, now);
  });
}
export async function createBillingSupport(userId: string, message: string) {
  const db = await collections();
  const accountId = await canonicalAccountId(userId, db);
  const recent = await db.billingSupport.countDocuments({ userId: accountId, createdAt: { $gt: new Date(Date.now() - 60 * 60_000) } });
  if (recent >= 5) throw new BillingError('Your support requests are already recorded. Please wait for a response.');
  const id = randomUUID();
  await db.billingSupport.insertOne({ _id: id, userId: accountId, message: message.slice(0, 4000), createdAt: new Date(), status: 'open' });
  return id;
}
