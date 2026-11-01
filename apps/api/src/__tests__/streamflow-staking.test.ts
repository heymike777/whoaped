import { describe, expect, it } from 'vitest';
import { STREAMFLOW_UNSTAKE_SECONDS, stakingOffer, streamflowConfig } from '../config/staking.js';
import { assertPremiumPool, summarizeStreamflowPosition, type StreamflowEntrySnapshot } from '../services/streamflow-staking.js';

const config = streamflowConfig({
  STREAMFLOW_CLUSTER: 'devnet', STREAMFLOW_POOL_ADDRESS: 'Pool111', STREAMFLOW_TOKEN_MINT: 'Mint111',
  STREAMFLOW_TOKEN_SYMBOL: 'TEST', STREAMFLOW_REQUIRED_AMOUNT_RAW: '100000000000',
});
const pool = { address: 'Pool111', mint: 'Mint111', stakeMint: 'StakeMint111', unstakePeriod: STREAMFLOW_UNSTAKE_SECONDS,
  minDuration: 0, maxDuration: 0, freezeStakeMint: true, autoUnstake: false };
const entry = (overrides: Partial<StreamflowEntrySnapshot> = {}): StreamflowEntrySnapshot => ({
  address: 'Entry111', authority: 'Owner111', pool: 'Pool111', amountRaw: 100_000_000_000n, duration: 0, closedTs: 0, unstakeTs: 0, ...overrides,
});

describe('Streamflow Premium preparation', () => {
  it('keeps the offer unavailable regardless of environment values', () => {
    const offer = stakingOffer({ STREAMFLOW_CLUSTER: 'mainnet', STREAMFLOW_POOL_ADDRESS: 'Pool111', STREAMFLOW_TOKEN_MINT: 'Mint111', STREAMFLOW_TOKEN_SYMBOL: 'WHO', STREAMFLOW_REQUIRED_AMOUNT_RAW: '100000000000', STREAMFLOW_ENABLED: 'true' });
    expect(offer).toMatchObject({ provider: 'streamflow', status: 'coming_soon', available: false, poolAddress: null, amount: 1_000_000 });
  });

  it('requires a verified pool with request-based seven-day unstaking and frozen receipts', () => {
    expect(() => assertPremiumPool(config, pool)).not.toThrow();
    expect(() => assertPremiumPool(config, { ...pool, unstakePeriod: 0 })).toThrow(/7-day/);
    expect(() => assertPremiumPool(config, { ...pool, freezeStakeMint: false })).toThrow(/frozen/);
    expect(() => assertPremiumPool(config, { ...pool, minDuration: 1 })).toThrow(/any time/);
    expect(() => assertPremiumPool(config, { ...pool, mint: 'Wrong' })).toThrow(/mismatch/);
  });

  it('counts only open owner positions and keeps access eligible during cooldown', () => {
    const requestedAt = 1_800_000_000;
    const result = summarizeStreamflowPosition(config, 'Owner111', [
      entry({ amountRaw: 60_000_000_000n }),
      entry({ address: 'Entry222', amountRaw: 40_000_000_000n, unstakeTs: requestedAt }),
      entry({ address: 'Other', authority: 'SomeoneElse' }),
      entry({ address: 'Closed', closedTs: requestedAt }),
      entry({ address: 'FixedTerm', duration: 604800 }),
    ]);
    expect(result.amountRaw).toBe('100000000000');
    expect(result.eligible).toBe(true);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1]).toMatchObject({ status: 'cooldown', unlockAvailableAt: new Date((requestedAt + STREAMFLOW_UNSTAKE_SECONDS) * 1000).toISOString() });
  });

  it('does not infer eligibility without a configured atomic threshold', () => {
    expect(summarizeStreamflowPosition({ ...config, requiredAmountRaw: null }, 'Owner111', [entry()]).eligible).toBe(false);
  });
});
