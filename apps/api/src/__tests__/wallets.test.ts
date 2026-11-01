import { MongoServerError } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  walletFind: vi.fn(),
  walletInsertOne: vi.fn(),
  walletUpdateOne: vi.fn(),
  transactionCountDocuments: vi.fn(),
}));

vi.mock('../db.js', () => ({
  hasDatabase: () => true,
  collections: async () => ({
    wallets: {
      find: mocks.walletFind,
      insertOne: mocks.walletInsertOne,
      updateOne: mocks.walletUpdateOne,
    },
    transactions: { countDocuments: mocks.transactionCountDocuments },
  }),
}));

vi.mock('../auth.js', () => ({
  createAnonymousSession: vi.fn(),
  requireSession: async (context: any, next: any) => {
    context.set('userId', 'user-1');
    await next();
  },
}));

vi.mock('../services/push.js', () => ({ drainNotificationJobs: vi.fn() }));

vi.mock('../services/accounts.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/accounts.js')>(),
  canonicalAccountId: async (userId: string) => userId,
  withAccountMutation: async (userId: string, work: Function) => work(await (await import('../db.js')).collections(), undefined, userId),
}));

import { app } from '../app.js';

const address = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';

describe('wallet routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a transaction count for the last 24 hours with each wallet', async () => {
    const wallet = {
      _id: 'wallet-1', userId: 'user-1', name: 'Main', address, chain: 'solana',
      status: 'active', createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const cursor = { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([wallet]) };
    mocks.walletFind.mockReturnValue(cursor);
    mocks.transactionCountDocuments.mockResolvedValue(3);

    const response = await app.request('/v1/wallets');

    expect(response.status).toBe(200);
    expect(mocks.transactionCountDocuments).toHaveBeenCalledWith({
      walletId: 'wallet-1', occurredAt: { $gte: expect.any(Date) }, suppressed: { $ne: true },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'wallet-1', transactionCount24h: 3 }],
    });
  });

  it('rejects an already tracked wallet instead of renaming it', async () => {
    mocks.walletInsertOne.mockRejectedValue(new MongoServerError({ message: 'duplicate', code: 11000 }));

    const response = await app.request('/v1/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Main wallet', address, chain: 'solana' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'This wallet is already being tracked.',
    });
  });

  it('soft-deletes a wallet for the stream worker to remove on refresh', async () => {
    mocks.walletUpdateOne.mockResolvedValue({ matchedCount: 1 });

    const response = await app.request('/v1/wallets/wallet-1', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(mocks.walletUpdateOne).toHaveBeenCalledWith(
      { _id: 'wallet-1', userId: 'user-1', deletedAt: null },
      { $set: { deletedAt: expect.any(Date) } },
      { session: undefined },
    );
  });
});
