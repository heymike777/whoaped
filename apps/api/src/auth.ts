import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';

import { query } from './db.js';

export type Variables = { userId: string };

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createAnonymousSession() {
  const userId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  await query('INSERT INTO users (id) VALUES ($1)', [userId]);
  await query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '365 days')`,
    [randomUUID(), userId, hashToken(token)],
  );
  return { token, userId };
}

export async function requireSession(context: Context<{ Variables: Variables }>, next: Next) {
  const header = context.req.header('authorization');
  if (!header?.startsWith('Bearer ')) return context.json({ error: 'Authentication required.' }, 401);

  const rows = await query<{ user_id: string }>(
    `SELECT user_id FROM sessions
     WHERE token_hash = $1 AND expires_at > now()
     LIMIT 1`,
    [hashToken(header.slice(7))],
  );
  if (!rows[0]) return context.json({ error: 'Session expired.' }, 401);
  context.set('userId', rows[0].user_id);
  await next();
}
