import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import { MongoServerError } from 'mongodb';

import { createAnonymousSession, requireSession, type Variables } from './auth.js';
import { collections, getDatabase, hasDatabase } from './db.js';
import { activityBeforeCursor, decodeActivityCursor, encodeActivityCursor } from './services/activity-pagination.js';
import { activityView } from './services/activity-view.js';
import { withActivityBalances } from './services/activity-balances.js';
import { reclassifyStoredActivities } from './services/activity-reclassification.js';
import { drainNotificationJobs } from './services/push.js';
import { enrichActivityMetadata, warmActivityTokenMetadata } from './services/token-metadata.js';
import { AccountLinkError, AccountUnavailableError, createTelegramLink, getAccount, setTrackFailedTransactions, withAccountMutation } from './services/accounts.js';
import { deleteAccountForSession } from './services/account-deletion.js';
import { BillingError } from './config/premium.js';
import { answerStarsPreCheckout, billingCatalog } from './services/billing.js';
import { getPaymentOrder, reportUsdcSignature } from './services/usdc-payments.js';
import { getTrackingStatus, setAccountTrackingPaused } from './services/rate-limits.js';
import { authorizedTelegramWebhook, telegramUpdateSchema } from './services/telegram.js';
import { completePayboxImport, createPayboxImport, deletePayboxImport, getPayboxImport, payboxAvailable } from './services/paybox.js';
import { seekerStakingOffer, stakeFastConfig } from './config/stakefast.js';
import {
  createStakeFastChallenge, linkStakeFastWallet, prepareStakeFastAction, stakeFastConfirmation, stakeFastStatus,
  StakeFastLinkError, StakeFastPreflightUnavailableError, stakeFastWalletBalances, unlinkStakeFastWallet, whoApedVaultTotal,
} from './services/stakefast.js';
import { getDiscoveryCatalog } from './services/kolscan-discovery.js';

const walletSchema = z.object({
  name: z.string().trim().min(2).max(40),
  address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana address'),
  chain: z.literal('solana'),
});

const deviceSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['ios', 'android']),
});

function safeSecretEqual(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const app = new Hono<{ Variables: Variables }>();
app.use('*', async (context, next) => {
  if (context.req.path === '/integrations/paybox/callback') return next();
  return logger()(context, next);
});
app.use('*', cors({ origin: process.env.CORS_ORIGIN ?? '*', allowHeaders: ['Authorization', 'Content-Type'] }));

app.post('/telegram/webhook', async (context) => {
  if (!authorizedTelegramWebhook(context.req.header('x-telegram-bot-api-secret-token') ?? '')) {
    return context.json({ error: 'Unauthorized.' }, 401);
  }
  const parsed = telegramUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: 'Invalid update.' }, 400);
  const db = await collections();
  const now = new Date();
  await db.telegramUpdates.updateOne({ _id: String(parsed.data.update_id) }, { $setOnInsert: {
    payload: parsed.data, status: parsed.data.pre_checkout_query ? 'processing' : 'pending', attempts: 0, availableAt: parsed.data.pre_checkout_query ? new Date(now.getTime() + 60_000) : now, createdAt: now,
  } }, { upsert: true });
  if (parsed.data.pre_checkout_query) {
    await answerStarsPreCheckout(parsed.data.pre_checkout_query);
    await db.telegramUpdates.updateOne({ _id: String(parsed.data.update_id) }, { $set: { status: 'sent' } });
  }
  return context.json({ ok: true });
});

app.get('/health', async (context) => {
  if (!hasDatabase()) return context.json({ ok: false, database: 'missing' }, 503);
  try {
    const database = await getDatabase();
    await database.command({ ping: 1 });
    return context.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('MongoDB health check failed', error);
    return context.json({ ok: false, database: 'unavailable' }, 503);
  }
});

// OAuth codes and state must never enter the request logger.
app.get('/integrations/paybox/callback', async (context) => {
  context.header('Cache-Control', 'no-store');
  context.header('Referrer-Policy', 'no-referrer');
  const ok = await completePayboxImport(context.req.query('state') ?? '', context.req.query('code'));
  return context.html(`<!doctype html><meta name="viewport" content="width=device-width"><title>WhoAped</title><main><h1>${ok ? 'Wallets ready' : 'Connection not completed'}</h1><p>Return to WhoAped to ${ok ? 'choose the wallets to track' : 'try again'}.</p></main>`);
});

app.post('/v1/sessions', async (context) => {
  if (!hasDatabase()) return context.json({ error: 'Database is not configured.' }, 503);
  return context.json(await createAnonymousSession(), 201);
});

app.get('/v1/staking/stats', async (context) => {
  context.header('Cache-Control', 'no-store');
  try {
    return context.json(await whoApedVaultTotal(stakeFastConfig()));
  } catch {
    return context.json({ error: 'The WHOAPED staking total is temporarily unavailable.' }, 503);
  }
});

// This endpoint also accepts a completed deletion receipt after the session is revoked.
app.delete('/v1/account', async (context) => {
  context.header('Cache-Control', 'no-store');
  const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(context.req.header('authorization') ?? '')?.[1];
  if (!token || !await deleteAccountForSession(token)) return context.json({ error: 'Session expired.' }, 401);
  return context.body(null, 204);
});

app.use('/v1/*', requireSession);

app.onError((error, context) => {
  if (error instanceof AccountUnavailableError) return context.json({ error: error.message }, 401);
  console.error(error);
  return context.text('Internal Server Error', 500);
});

app.get('/v1/discovery', async context => {
  const query = (context.req.query('q') ?? '').trim().toLocaleLowerCase().slice(0, 80);
  const offset = Math.max(0, Math.min(10_000, Number(context.req.query('offset')) || 0));
  const limit = Math.max(1, Math.min(50, Number(context.req.query('limit')) || 30));
  const catalog = await getDiscoveryCatalog();
  const matched = query
    ? catalog.profiles.filter(profile =>
        profile.name.toLocaleLowerCase().includes(query)
        || profile.address.toLocaleLowerCase().includes(query)
        || profile.twitter?.toLocaleLowerCase().includes(query)
        || profile.telegram?.toLocaleLowerCase().includes(query))
    : catalog.profiles;
  return context.json({
    data: matched.slice(offset, offset + limit),
    total: matched.length,
    nextOffset: offset + limit < matched.length ? offset + limit : null,
    source: 'Kolscan',
    importedAt: catalog.importedAt,
  });
});

app.get('/v1/integrations/paybox', context => context.json({ available: payboxAvailable() }));
app.post('/v1/integrations/paybox/imports', async context => {
  try { return context.json(await createPayboxImport(context.get('userId')), 201); }
  catch { return context.json({ error: 'Paybox connection could not start. Please try again shortly.' }, 503); }
});
app.get('/v1/integrations/paybox/imports/:id', async context => {
  const result = await getPayboxImport(context.get('userId'), context.req.param('id'));
  return result ? context.json(result) : context.json({ error: 'Paybox connection expired. Please reconnect.' }, 404);
});
app.delete('/v1/integrations/paybox/imports/:id', async context => {
  await deletePayboxImport(context.get('userId'), context.req.param('id'));
  return context.json({ ok: true });
});

app.get('/v1/account', async (context) => context.json(await getAccount(context.get('userId'))));

app.patch('/v1/account/preferences', async (context) => {
  const parsed = z.object({ trackFailedTransactions: z.boolean() }).strict().safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: 'Invalid preferences.' }, 400);
  return context.json({ preferences: await setTrackFailedTransactions(context.get('userId'), parsed.data.trackFailedTransactions) });
});

app.post('/v1/account/telegram-link', async (context) => {
  try { return context.json(await createTelegramLink(context.get('userId')), 201); }
  catch (error) {
    if (error instanceof AccountLinkError) return context.json({ error: error.message }, 409);
    throw error;
  }
});

app.delete('/v1/account/telegram-link', async (context) => {
  const db = await collections();
  await db.accountLinks.updateMany({ userId: context.get('userId'), status: 'pending' }, { $set: { status: 'cancelled' } });
  return context.json({ ok: true });
});

app.get('/v1/billing/products', async (context) => context.json(await billingCatalog(context.get('userId'), true)));
app.get('/v1/staking/offer', (context) => context.json(seekerStakingOffer()));
app.get('/v1/stakefast/status', async (context) => {
  const config = stakeFastConfig();
  context.header('Cache-Control', 'no-store');
  try { return context.json(await stakeFastStatus(context.get('userId'), config)); }
  catch { return context.json({ error: 'StakeFast status is temporarily unavailable.' }, 503); }
});
app.get('/v1/stakefast/wallets/:wallet/balances', async (context) => {
  context.header('Cache-Control', 'no-store');
  try { return context.json(await stakeFastWalletBalances(context.req.param('wallet'), stakeFastConfig())); }
  catch (error) {
    if (error instanceof StakeFastLinkError) return context.json({ error: error.message }, 400);
    return context.json({ error: 'Wallet balances are temporarily unavailable.' }, 503);
  }
});
app.post('/v1/stakefast/challenges', async (context) => {
  const config = stakeFastConfig();
  const input = z.object({ wallet: z.string().min(32).max(44) }).safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: 'Enter a valid Solana signing wallet.' }, 400);
  try { return context.json(await createStakeFastChallenge(context.get('userId'), input.data.wallet, config), 201); }
  catch (error) { if (error instanceof StakeFastLinkError) return context.json({ error: error.message }, 400); throw error; }
});
app.post('/v1/stakefast/link', async (context) => {
  const config = stakeFastConfig();
  const input = z.object({ challengeId: z.uuid(), signature: z.string().length(88) }).safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: 'Invalid wallet proof.' }, 400);
  try { return context.json(await linkStakeFastWallet(context.get('userId'), input.data.challengeId, input.data.signature, config)); }
  catch (error) { if (error instanceof StakeFastLinkError) return context.json({ error: error.message }, 409); throw error; }
});
app.delete('/v1/stakefast/wallets/:wallet', async (context) => {
  try {
    await unlinkStakeFastWallet(context.get('userId'), context.req.param('wallet'));
    return context.json({ ok: true });
  } catch (error) { if (error instanceof StakeFastLinkError) return context.json({ error: error.message }, 400); throw error; }
});
const stakingWallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const stakingAction = z.discriminatedUnion('action', [
  z.object({ wallet: stakingWallet, action: z.literal('stake'), amountRaw: z.string().regex(/^[1-9]\d{0,19}$/) }),
  z.object({ wallet: stakingWallet, action: z.enum(['unstake', 'cancel', 'claim']) }),
]);
app.post('/v1/stakefast/transactions', async (context) => {
  context.header('Cache-Control', 'no-store');
  const input = stakingAction.safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: 'Enter a valid staking action and amount.' }, 400);
  try {
    return context.json(await prepareStakeFastAction(context.get('userId'), input.data.wallet, input.data, stakeFastConfig()));
  } catch (error) {
    if (error instanceof StakeFastPreflightUnavailableError) return context.json({ error: error.message }, 503);
    const message = error instanceof Error ? error.message.replace(/([?&]api-key=)[^\s&]+/gi, '$1[redacted]') : 'Could not prepare the staking transaction.';
    return context.json({ error: message }, error instanceof StakeFastLinkError ? 403 : 400);
  }
});
app.get('/v1/stakefast/transactions/:signature', async (context) => {
  context.header('Cache-Control', 'no-store');
  const signature = context.req.param('signature');
  const lastValidBlockHeight = Number(context.req.query('lastValidBlockHeight'));
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature) || !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) {
    return context.json({ error: 'Invalid transaction reference.' }, 400);
  }
  try { return context.json({ status: await stakeFastConfirmation(signature, lastValidBlockHeight, stakeFastConfig()) }); }
  catch { return context.json({ error: 'Transaction confirmation is temporarily unavailable.' }, 503); }
});
app.post('/v1/billing/usdc/orders', (context) => context.json({ error: 'Premium purchases are paused.' }, 410));
app.get('/v1/billing/orders/:id', async (context) => {
  try { return context.json(await getPaymentOrder(context.get('userId'), context.req.param('id'))); }
  catch (error) { if (error instanceof BillingError) return context.json({ error: error.message }, 404); throw error; }
});
app.post('/v1/billing/orders/:id/confirm', async (context) => {
  const input = z.object({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/) }).safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: 'Invalid transaction signature.' }, 400);
  try { return context.json(await reportUsdcSignature(context.get('userId'), context.req.param('id'), input.data.signature)); }
  catch (error) { if (error instanceof BillingError) return context.json({ error: error.message }, 404); throw error; }
});

app.get('/v1/wallets', async (context) => {
  const db = await collections();
  const wallets = await db.wallets.find({
    userId: context.get('userId'), deletedAt: null,
  }).sort({ createdAt: -1 }).toArray();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const rows = await Promise.all(wallets.map(async (wallet) => ({
    id: wallet._id,
    name: wallet.name,
    address: wallet.address,
    chain: wallet.chain,
    status: wallet.status,
    createdAt: wallet.createdAt,
    transactionCount24h: await db.transactions.countDocuments({
      walletId: wallet._id, occurredAt: { $gte: since }, suppressed: { $ne: true },
    }),
  })));
  return context.json({ data: rows });
});

app.post('/v1/wallets', async (context) => {
  const parsed = walletSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: parsed.error.issues[0]?.message ?? 'Invalid wallet.' }, 400);

  const walletId = randomUUID();
  const createdAt = new Date();
  try {
    await withAccountMutation(context.get('userId'), async (db, session, accountId) => {
      await db.wallets.insertOne({
        _id: walletId,
        userId: accountId,
        name: parsed.data.name,
        address: parsed.data.address,
        chain: parsed.data.chain,
        status: 'active',
        createdAt,
        deletedAt: null,
      }, { session });
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return context.json({ error: 'This wallet is already being tracked.' }, 409);
    }
    throw error;
  }
  return context.json({
    id: walletId, ...parsed.data, status: 'active', transactionCount24h: 0, createdAt,
  }, 201);
});

app.delete('/v1/wallets/:walletId', async (context) => {
  const result = await withAccountMutation(context.get('userId'), (db, session, accountId) => db.wallets.updateOne(
    {
      _id: context.req.param('walletId'),
      userId: accountId,
      deletedAt: null,
    },
    { $set: { deletedAt: new Date() } },
    { session },
  ));
  if (!result.matchedCount) return context.json({ error: 'Wallet not found.' }, 404);

  return context.json({ ok: true });
});

app.get('/v1/activities', async (context) => {
  const requestedLimit = Number(context.req.query('limit') ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 100)) : 50;
  const rawCursor = context.req.query('cursor');
  const cursor = rawCursor ? decodeActivityCursor(rawCursor) : null;
  if (rawCursor && !cursor) return context.json({ error: 'Invalid activity cursor.' }, 400);
  const db = await collections();
  const storedTransactions = await db.transactions.find({
    userId: context.get('userId'),
    kind: { $in: ['balance', 'nft', 'multisig', 'swap', 'yield', 'launch', 'claim', 'failed'] },
    suppressed: { $ne: true },
    ...(cursor ? activityBeforeCursor(cursor) : {}),
  })
    .sort({ occurredAt: -1, createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
  const hasMore = storedTransactions.length > limit;
  const page = storedTransactions.slice(0, limit);
  const walletIds = [...new Set(page.map((transaction) => transaction.walletId))];
  const wallets = await db.wallets.find({ _id: { $in: walletIds } }).toArray();
  const walletById = new Map(wallets.map((wallet) => [wallet._id, wallet]));
  const transactions = await reclassifyStoredActivities(page, walletById, db);
  await warmActivityTokenMetadata(transactions);
  const enrichedTransactions = await Promise.all(transactions.map(async (transaction) => ({
    ...transaction,
    ...await enrichActivityMetadata(transaction),
  })));
  const withBalances = await withActivityBalances(enrichedTransactions, walletById, db);
  const rows = withBalances.map((transaction) => activityView(
    transaction,
    walletById.get(transaction.walletId),
  ));
  return context.json({ data: rows, nextCursor: hasMore ? encodeActivityCursor(page[page.length - 1]) : null });
});

app.get('/v1/activities/:activityId', async (context) => {
  const db = await collections();
  const transaction = await db.transactions.findOne({
    _id: context.req.param('activityId'),
    userId: context.get('userId'),
  });
  if (transaction?.mergedIntoTransactionId) {
    const retained = await db.transactions.findOne({ _id: transaction.mergedIntoTransactionId, userId: context.get('userId'), suppressed: { $ne: true } });
    if (retained) {
      const wallet = await db.wallets.findOne({ _id: retained.walletId });
      const [withBalances] = await withActivityBalances([{ ...retained, ...await enrichActivityMetadata(retained) }], new Map(wallet ? [[wallet._id, wallet]] : []), db);
      return context.json({ data: activityView(withBalances, wallet ?? undefined) });
    }
  }
  if (!transaction || transaction.suppressed) return context.json({ error: 'Activity not found.' }, 404);
  const wallet = await db.wallets.findOne({ _id: transaction.walletId });
  const [classified] = await reclassifyStoredActivities(
    [transaction], new Map(wallet ? [[wallet._id, wallet]] : []), db,
  );
  if (!classified) return context.json({ error: 'Activity not found.' }, 404);
  const enriched = await enrichActivityMetadata(classified);
  const [withBalances] = await withActivityBalances([{ ...classified, ...enriched }], new Map(wallet ? [[wallet._id, wallet]] : []), db);
  return context.json({ data: activityView(withBalances, wallet ?? undefined) });
});

app.post('/v1/devices', async (context) => {
  const parsed = deviceSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: parsed.error.issues[0]?.message ?? 'Invalid push token.' }, 400);
  const now = new Date();
  await withAccountMutation(context.get('userId'), async (db, session, accountId) => {
    await db.deviceTokens.updateOne(
      { token: parsed.data.token },
      {
        $set: {
          userId: accountId, platform: parsed.data.platform, lastSeenAt: now,
        },
        $setOnInsert: { _id: randomUUID(), token: parsed.data.token, createdAt: now },
        $unset: { disabledAt: '' },
      },
      { upsert: true, session },
    );
  });
  return context.json({ ok: true }, 201);
});

app.get('/internal/billing/support', async (context) => {
  const secret = context.req.header('authorization')?.replace('Bearer ', '') ?? '';
  const expected = process.env.INTERNAL_JOB_SECRET ?? '';
  if (!expected || !safeSecretEqual(secret, expected)) return context.json({ error: 'Unauthorized.' }, 401);
  const db = await collections();
  return context.json({ data: await db.billingSupport.find({ status: 'open' }).sort({ createdAt: 1 }).limit(100).toArray() });
});

app.post('/internal/accounts/:userId/tracking', async (context) => {
  const secret = context.req.header('authorization')?.replace('Bearer ', '') ?? '';
  const expected = process.env.INTERNAL_JOB_SECRET ?? '';
  if (!expected || !safeSecretEqual(secret, expected)) return context.json({ error: 'Unauthorized.' }, 401);
  const parsed = z.object({ paused: z.boolean() }).safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: 'Expected a paused boolean.' }, 400);
  const result = await setAccountTrackingPaused(context.req.param('userId'), parsed.data.paused);
  return context.json({ ...result, tracking: await getTrackingStatus(result.accountId) });
});

app.post('/internal/jobs/drain', async (context) => {
  const secret = context.req.header('authorization')?.replace('Bearer ', '') ?? '';
  const expected = process.env.INTERNAL_JOB_SECRET ?? '';
  if (!expected || !safeSecretEqual(secret, expected)) return context.json({ error: 'Unauthorized.' }, 401);
  return context.json(await drainNotificationJobs());
});

app.onError((error, context) => {
  console.error(error);
  return context.json({ error: 'Unexpected server error.' }, 500);
});
