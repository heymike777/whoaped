export type ActivityEmptyMode = 'needs-wallet' | 'listening';

export function getActivityEmptyMode(walletCount: number | null): ActivityEmptyMode {
  return walletCount === 0 ? 'needs-wallet' : 'listening';
}
