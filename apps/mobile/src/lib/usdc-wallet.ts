import { type PremiumPlanId, type UsdcCheckout } from '../api/client';
export async function purchaseUsdc(_plan: PremiumPlanId, _onOrder: (order: UsdcCheckout) => Promise<void>): Promise<{ orderId: string; signature: string }> {
  throw new Error('USDC purchases are available on Android with a Solana wallet.');
}
