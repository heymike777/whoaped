import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import { MongoServerError } from 'mongodb';

import { createAnonymousSession, requireSession, type Variables } from './auth.js';
import { collections, getDatabase, hasDatabase } from './db.js';
import { drainNotificationJobs } from './services/push.js';

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
      walletId: wallet._id, occurredAt: { $gte: since },
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
    const db = await collections();
    await db.wallets.insertOne({
      _id: walletId,
      userId: context.get('userId'),
      name: parsed.data.name,
      address: parsed.data.address,
      chain: parsed.data.chain,
      status: 'active',
      createdAt,
      deletedAt: null,
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
  const db = await collections();
  const result = await db.wallets.updateOne(
    {
      _id: context.req.param('walletId'),
      userId: context.get('userId'),
      deletedAt: null,
    },
    { $set: { deletedAt: new Date() } },
  );
  if (!result.matchedCount) return context.json({ error: 'Wallet not found.' }, 404);

  return context.json({ ok: true });
});

app.get('/v1/activities', async (context) => {
  const limit = Math.min(Number(context.req.query('limit') ?? 50) || 50, 100);
  const db = await collections();
  const transactions = await db.transactions.find({
    userId: context.get('userId'),
    kind: { $in: ['balance', 'nft', 'multisig'] },
  })
    .sort({ occurredAt: -1, createdAt: -1 }).limit(limit).toArray();
  const walletIds = [...new Set(transactions.map((transaction) => transaction.walletId))];
  const wallets = await db.wallets.find({ _id: { $in: walletIds } }).toArray();
  const walletById = new Map(wallets.map((wallet) => [wallet._id, wallet]));
  const rows = transactions.map((transaction) => {
    const wallet = walletById.get(transaction.walletId);
    return {
      id: transaction._id,
      walletId: transaction.walletId,
      walletName: wallet?.name ?? 'Wallet',
      walletAddress: wallet?.address ?? '',
      chain: transaction.chain,
      kind: transaction.kind,
      title: transaction.title,
      detail: transaction.detail,
      source: transaction.source,
      valueUsd: transaction.valueUsd,
      signature: transaction.txHash,
      occurredAt: transaction.occurredAt,
    };
  });
  return context.json({ data: rows });
});

app.post('/v1/devices', async (context) => {
  const parsed = deviceSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: parsed.error.issues[0]?.message ?? 'Invalid push token.' }, 400);
  const db = await collections();
  const now = new Date();
  await db.deviceTokens.updateOne(
    { token: parsed.data.token },
    {
      $set: {
        userId: context.get('userId'), platform: parsed.data.platform, lastSeenAt: now,
      },
      $setOnInsert: { _id: randomUUID(), token: parsed.data.token, createdAt: now },
      $unset: { disabledAt: '' },
    },
    { upsert: true },
  );
  return context.json({ ok: true }, 201);
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
