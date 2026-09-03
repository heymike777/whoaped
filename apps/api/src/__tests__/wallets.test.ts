import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../db.js', () => ({
  hasDatabase: () => true,
  query: mocks.query,
}));

vi.mock('../auth.js', () => ({
  createAnonymousSession: vi.fn(),
  requireSession: async (context: any, next: any) => {
    context.set('userId', 'user-1');
    await next();
  },
}));

vi.mock('../services/push.js', () => ({
  drainNotificationJobs: vi.fn(),
}));

import { app } from '../app.js';

const address = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';

describe('wallet routes', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('returns a transaction count for the last 24 hours with each wallet', async () => {
    mocks.query.mockResolvedValueOnce([]);

    const response = await app.request('/v1/wallets');

    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("now() - interval '24 hours'");
  });

  it('rejects an already tracked wallet instead of renaming it', async () => {
    mocks.query.mockResolvedValueOnce([]);

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
    mocks.query.mockResolvedValueOnce([{ id: 'wallet-1' }]);

    const response = await app.request('/v1/wallets/wallet-1', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0]?.[0]).toContain('deleted_at = now()');
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(['wallet-1', 'user-1']);
  });
});
