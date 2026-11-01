export const PREMIUM_PLANS = {
  month: { id: 'month', label: '30 days', days: 30, usdcAtomic: 9_000_000, stars: 700 },
  year: { id: 'year', label: '365 days', days: 365, usdcAtomic: 69_000_000, stars: 5300 },
} as const;
export type PremiumPlan = keyof typeof PREMIUM_PLANS;
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export class BillingError extends Error {}
export function premiumPlan(value: string): PremiumPlan {
  if (value !== 'month' && value !== 'year') throw new BillingError('Unknown Premium plan.');
  return value;
}
