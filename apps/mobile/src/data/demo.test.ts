import { demoActivities, demoWallets } from './demo';

describe('demo activity feed', () => {
  it('only references wallets present in the tracked wallet list', () => {
    const walletIds = new Set(demoWallets.map(wallet => wallet.id));

    expect(demoActivities.length).toBeGreaterThan(0);
    expect(demoActivities.every(activity => walletIds.has(activity.walletId))).toBe(true);
  });

  it('uses the Solana adapter contract during the Solana-first phase', () => {
    expect(demoWallets.every(wallet => wallet.chain === 'solana')).toBe(true);
    expect(demoActivities.every(activity => activity.chain === 'solana')).toBe(true);
  });
});
