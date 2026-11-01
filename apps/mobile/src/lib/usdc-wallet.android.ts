import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { getBase58Decoder, getBase64Encoder } from '@solana/codecs-strings';
import { createUsdcCheckout, type PremiumPlanId, type UsdcCheckout } from '../api/client';
export async function purchaseUsdc(plan: PremiumPlanId, onOrder: (order: UsdcCheckout) => Promise<void>) {
  return transact(async wallet => {
    const authorization = await wallet.authorize({ chain: 'solana:mainnet', identity: { name: 'WhoAped', uri: 'https://www.whoaped.com', icon: '/assets/mark.svg' } });
    const account = authorization.accounts[0];
    if (!account) throw new Error('No wallet account was selected.');
    const payer = getBase58Decoder().decode(getBase64Encoder().encode(account.address));
    const requestKey = `usdc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const order = await createUsdcCheckout(plan, payer, requestKey);
    await onOrder(order);
    const result = await wallet.signAndSendTransactions({ payloads: [order.transaction], options: { commitment: 'confirmed', skip_preflight: false } });
    if (!result.signatures[0]) throw new Error('No transaction signature returned. Check payment status before trying again.');
    return { orderId: order.id, signature: getBase58Decoder().decode(getBase64Encoder().encode(result.signatures[0])) };
  });
}
