import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), next: vi.fn(), hasDatabase: vi.fn(() => true) }));

vi.mock('../db.js', () => ({
  hasDatabase: mocks.hasDatabase,
  collections: async () => ({
    wallets: { aggregate: mocks.aggregate },
    trackingStates: { collectionName: 'tracking_states' },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  mocks.aggregate.mockReturnValue({ next: mocks.next });
  mocks.hasDatabase.mockReturnValue(true);
});

afterEach(() => vi.useRealTimers());

it('shares an in-flight refresh, then refreshes the count after five minutes', async () => {
  mocks.next.mockResolvedValueOnce({ uniqueWalletsTracked: 4 }).mockResolvedValueOnce(null);
  const { getPublicWalletStats } = await import('../services/public-stats.js');
  const first = { uniqueWalletsTracked: 4, asOf: '2026-11-20T12:00:00.000Z' };
  await expect(Promise.all([getPublicWalletStats(), getPublicWalletStats()])).resolves.toEqual([first, first]);
  vi.setSystemTime(new Date('2026-11-20T12:04:59Z'));
  await expect(getPublicWalletStats()).resolves.toEqual(first);
  expect(mocks.aggregate).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date('2026-11-20T12:05:00Z'));
  await expect(getPublicWalletStats()).resolves.toEqual({ uniqueWalletsTracked: 0, asOf: '2026-11-20T12:05:00.000Z' });
  expect(mocks.aggregate).toHaveBeenCalledTimes(2);
});

it('does not guess a count or expose database errors and backs off on failure', async () => {
  mocks.next.mockRejectedValueOnce(new Error('internal database info')).mockResolvedValueOnce({ uniqueWalletsTracked: 4 });
  const { app } = await import('../app.js');
  for (const response of await Promise.all([app.request('/public/stats'), app.request('/public/stats')])) {
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('30');
    await expect(response.json()).resolves.toEqual({ error: 'Stats temporarily unavailable.' });
  }
  expect((await app.request('/public/stats')).status).toBe(503);
  expect(mocks.aggregate).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date('2026-11-20T12:00:30Z'));
  expect((await app.request('/public/stats')).status).toBe(200);
  expect(mocks.aggregate).toHaveBeenCalledTimes(2);
});
