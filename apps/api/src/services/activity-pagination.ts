import type { Filter } from 'mongodb';

import type { TransactionDocument } from '../db.js';

type Cursor = { occurredAt: Date; createdAt: Date; id: string };

export function encodeActivityCursor(transaction: TransactionDocument) {
  return Buffer.from(JSON.stringify({
    occurredAt: transaction.occurredAt.toISOString(),
    createdAt: transaction.createdAt.toISOString(),
    id: transaction._id,
  })).toString('base64url');
}

export function decodeActivityCursor(value: string): Cursor | null {
  try {
    const raw = JSON.parse(Buffer.from(value, 'base64url').toString()) as Record<string, unknown>;
    if (typeof raw.occurredAt !== 'string' || typeof raw.createdAt !== 'string'
      || typeof raw.id !== 'string' || !raw.id || raw.id.length > 100) return null;
    const occurredAt = new Date(raw.occurredAt);
    const createdAt = new Date(raw.createdAt);
    if (!Number.isFinite(occurredAt.getTime()) || !Number.isFinite(createdAt.getTime())) return null;
    return { occurredAt, createdAt, id: raw.id };
  } catch {
    return null;
  }
}

export function activityBeforeCursor(cursor: Cursor): Filter<TransactionDocument> {
  return { $or: [
    { occurredAt: { $lt: cursor.occurredAt } },
    { occurredAt: cursor.occurredAt, createdAt: { $lt: cursor.createdAt } },
    { occurredAt: cursor.occurredAt, createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
  ] };
}
