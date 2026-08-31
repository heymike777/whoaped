import { getActivityEmptyMode } from './emptyState';

describe('activity empty state', () => {
  it('prompts for a wallet when none are tracked', () => {
    expect(getActivityEmptyMode(0)).toBe('needs-wallet');
  });

  it('shows the live listening state once wallets are tracked', () => {
    expect(getActivityEmptyMode(1)).toBe('listening');
    expect(getActivityEmptyMode(4)).toBe('listening');
  });

  it('does not claim there are no wallets when the count is unavailable', () => {
    expect(getActivityEmptyMode(null)).toBe('listening');
  });
});
