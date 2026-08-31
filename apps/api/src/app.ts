import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';

import { createAnonymousSession, requireSession, type Variables } from './auth.js';
import { solanaAdapter, type HeliusTransaction } from './chains/solana.js';
import { hasDatabase, query } from './db.js';
import { syncHeliusAddresses } from './services/helius-webhooks.js';
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

app.get('/health', (context) => context.json({ ok: true, database: hasDatabase() ? 'configured' : 'missing' }));

app.post('/v1/sessions', async (context) => {
  if (!hasDatabase()) return context.json({ error: 'Database is not configured.' }, 503);
  return context.json(await createAnonymousSession(), 201);
});

app.use('/v1/*', requireSession);

app.get('/v1/wallets', async (context) => {
  const rows = await query<Record<string, unknown>>(
    `SELECT w.id, w.name, w.address, w.chain, w.status, w.created_at AS "createdAt",
       (SELECT count(*)::integer FROM transactions t
        WHERE t.wallet_id = w.id AND t.occurred_at >= now() - interval '24 hours') AS "transactionCount24h"
     FROM wallets w
     WHERE w.user_id = $1 AND w.deleted_at IS NULL
     ORDER BY w.created_at DESC`,
    [context.get('userId')],
  );
  return context.json({ data: rows });
});

app.post('/v1/wallets', async (context) => {
  const parsed = walletSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: parsed.error.issues[0]?.message ?? 'Invalid wallet.' }, 400);

  const walletId = randomUUID();
  const [wallet] = await query<Record<string, unknown>>(
    `INSERT INTO wallets (id, user_id, name, address, chain, status)
     VALUES ($1, $2, $3, $4, $5, 'syncing')
     ON CONFLICT (user_id, chain, address) WHERE deleted_at IS NULL
     DO NOTHING
     RETURNING id, name, address, chain, status, 0 AS "transactionCount24h", created_at AS "createdAt"`,
    [walletId, context.get('userId'), parsed.data.name, parsed.data.address, parsed.data.chain],
  );
  if (!wallet) return context.json({ error: 'This wallet is already being tracked.' }, 409);

  try {
    const sync = await syncHeliusAddresses();
    const status = sync.configured ? 'active' : 'syncing';
    await query('UPDATE wallets SET status = $1 WHERE id = $2', [status, wallet.id]);
    return context.json({ ...wallet, status }, 201);
  } catch (error) {
    await query('UPDATE wallets SET status = $1, sync_error = $2 WHERE id = $3', ['error', error instanceof Error ? error.message : String(error), wallet.id]);
    return context.json({ ...wallet, status: 'error' }, 201);
  }
});

app.delete('/v1/wallets/:walletId', async (context) => {
  const [wallet] = await query<{ id: string }>(
    `UPDATE wallets SET deleted_at = now()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [context.req.param('walletId'), context.get('userId')],
  );
  if (!wallet) return context.json({ error: 'Wallet not found.' }, 404);

  syncHeliusAddresses().catch((error) => console.error('Helius address sync deferred', error));
  return context.json({ ok: true });
});

app.get('/v1/activities', async (context) => {
  const limit = Math.min(Number(context.req.query('limit') ?? 50) || 50, 100);
  const rows = await query<Record<string, unknown>>(
    `SELECT t.id, t.wallet_id AS "walletId", w.name AS "walletName",
       w.address AS "walletAddress", t.chain, t.kind, t.title, t.detail,
       t.source, t.value_usd AS "valueUsd", t.tx_hash AS signature,
       t.occurred_at AS "occurredAt"
     FROM transactions t
     JOIN wallets w ON w.id = t.wallet_id
     WHERE t.user_id = $1
     ORDER BY t.occurred_at DESC, t.created_at DESC
     LIMIT $2`,
    [context.get('userId'), limit],
  );
  return context.json({ data: rows });
});

app.post('/v1/devices', async (context) => {
  const parsed = deviceSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: parsed.error.issues[0]?.message ?? 'Invalid push token.' }, 400);
  await query(
    `INSERT INTO device_tokens (id, user_id, token, platform)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now()`,
    [randomUUID(), context.get('userId'), parsed.data.token, parsed.data.platform],
  );
  return context.json({ ok: true }, 201);
});

app.post('/webhooks/helius/:secret', async (context) => {
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  if (!expected || !safeSecretEqual(context.req.param('secret'), expected)) return context.json({ error: 'Not found.' }, 404);
  const payload = await context.req.json().catch(() => null);
  if (!Array.isArray(payload)) return context.json({ error: 'Expected an array of Helius transactions.' }, 400);

  let inserted = 0;
  for (const item of payload as HeliusTransaction[]) {
    const eventId = randomUUID();
    const [accepted] = await query<{ id: string }>(
      `INSERT INTO webhook_events (id, provider, external_id, payload)
       VALUES ($1, 'helius', $2, $3::jsonb)
       ON CONFLICT (provider, external_id) DO NOTHING
       RETURNING id`,
      [eventId, item.signature ?? eventId, JSON.stringify(item)],
    );
    if (!accepted) continue;

    const addresses = solanaAdapter.extractAddresses(item);
    if (!addresses.length) continue;
    const wallets = await query<{ id: string; user_id: string; name: string; address: string }>(
      `SELECT id, user_id, name, address FROM wallets
       WHERE chain = 'solana' AND deleted_at IS NULL AND status != 'error'
         AND address = ANY($1::text[])`,
      [addresses],
    );

    for (const wallet of wallets) {
      for (const activity of solanaAdapter.normalize(item, wallet.address)) {
        const transactionId = randomUUID();
        const [transaction] = await query<{ id: string }>(
          `INSERT INTO transactions
             (id, user_id, wallet_id, chain, tx_hash, event_index, kind, title, detail, source, value_usd, occurred_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
           ON CONFLICT (wallet_id, chain, tx_hash, event_index) DO NOTHING
           RETURNING id`,
          [transactionId, wallet.user_id, wallet.id, activity.chain, activity.txHash, activity.eventIndex, activity.kind, activity.title, activity.detail, activity.source ?? null, activity.valueUsd ?? null, activity.occurredAt, JSON.stringify(activity.metadata)],
        );
        if (!transaction) continue;
        inserted += 1;
        await query(
          `INSERT INTO notification_jobs (id, user_id, device_token_id, transaction_id, title, body, data)
           SELECT gen_random_uuid(), $1, id, $2, $3, $4, $5::jsonb
           FROM device_tokens WHERE user_id = $1 AND disabled_at IS NULL
           ON CONFLICT (device_token_id, transaction_id) DO NOTHING`,
          [wallet.user_id, transaction.id, wallet.name, activity.title, JSON.stringify({ transactionId: transaction.id, walletId: wallet.id })],
        );
      }
    }
  }

  if (inserted) await drainNotificationJobs().catch((error) => console.error('Push delivery deferred', error));
  return context.json({ accepted: payload.length, inserted }, 202);
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
