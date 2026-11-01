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
import { reclassifyStoredActivities } from './services/activity-reclassification.js';
import { drainNotificationJobs } from './services/push.js';
import { enrichActivityMetadata, warmActivityTokenMetadata } from './services/token-metadata.js';
import { AccountLinkError, createTelegramLink, getAccount, withAccountMutation } from './services/accounts.js';
import { getTrackingStatus, setAccountTrackingPaused } from './services/rate-limits.js';
import { authorizedTelegramWebhook, telegramUpdateSchema } from './services/telegram.js';

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
app.use('*', logger());
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
    payload: parsed.data, status: 'pending', attempts: 0, availableAt: now, createdAt: now,
  } }, { upsert: true });
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

app.post('/v1/sessions', async (context) => {
  if (!hasDatabase()) return context.json({ error: 'Database is not configured.' }, 503);
  return context.json(await createAnonymousSession(), 201);
});

app.use('/v1/*', requireSession);

app.get('/v1/account', async (context) => context.json(await getAccount(context.get('userId'))));

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
    kind: { $in: ['balance', 'nft', 'multisig', 'swap', 'yield', 'launch'] },
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
  const rows = enrichedTransactions.map((transaction) => activityView(
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
    if (retained) return context.json({ data: activityView({ ...retained, ...await enrichActivityMetadata(retained) }, await db.wallets.findOne({ _id: retained.walletId }) ?? undefined) });
  }
  if (!transaction || transaction.suppressed) return context.json({ error: 'Activity not found.' }, 404);
  const wallet = await db.wallets.findOne({ _id: transaction.walletId });
  const [classified] = await reclassifyStoredActivities(
    [transaction], new Map(wallet ? [[wallet._id, wallet]] : []), db,
  );
  if (!classified) return context.json({ error: 'Activity not found.' }, 404);
  const enriched = await enrichActivityMetadata(classified);
  return context.json({ data: activityView({ ...classified, ...enriched }, wallet ?? undefined) });
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
