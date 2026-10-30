import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';

import { collections } from './db.js';

export type Variables = { userId: string };

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createAnonymousSession() {
  const userId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const db = await collections();
  const now = new Date();
  await db.users.insertOne({ _id: userId, createdAt: now });
  await db.sessions.insertOne({
    _id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000),
    createdAt: now,
  });
  return { token, userId };
}

export async function authenticateSessionToken(token: string) {
  if (!token) return null;
  const db = await collections();
  return db.sessions.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });
}

export async function requireSession(context: Context<{ Variables: Variables }>, next: Next) {
  const header = context.req.header('authorization');
  if (!header?.startsWith('Bearer ')) return context.json({ error: 'Authentication required.' }, 401);

  const session = await authenticateSessionToken(header.slice(7));
  if (!session) return context.json({ error: 'Session expired.' }, 401);
  context.set('userId', session.userId);
  await next();
}
