import { describe, expect, it } from 'vitest';

import type { TransactionDocument } from '../db.js';
import { activityBeforeCursor, decodeActivityCursor, encodeActivityCursor } from '../services/activity-pagination.js';

describe('activity pagination', () => {
  const transaction = {
    _id: 'activity-2',
    occurredAt: new Date('2026-10-30T17:42:23.000Z'),
    createdAt: new Date('2026-10-30T17:42:24.000Z'),
  } as TransactionDocument;

  it('round-trips a stable cursor with a tie-breaker', () => {
    const cursor = decodeActivityCursor(encodeActivityCursor(transaction));
    expect(cursor).toEqual({
      occurredAt: transaction.occurredAt,
      createdAt: transaction.createdAt,
      id: transaction._id,
    });
    expect(activityBeforeCursor(cursor!)).toEqual({ $or: [
      { occurredAt: { $lt: transaction.occurredAt } },
      { occurredAt: transaction.occurredAt, createdAt: { $lt: transaction.createdAt } },
      { occurredAt: transaction.occurredAt, createdAt: transaction.createdAt, _id: { $lt: transaction._id } },
    ] });
  });

  it('rejects invalid cursors', () => {
    expect(decodeActivityCursor('not-a-cursor')).toBeNull();
    expect(decodeActivityCursor(Buffer.from(JSON.stringify({ occurredAt: 'bad', createdAt: 'bad', id: 'x' })).toString('base64url'))).toBeNull();
  });
});
