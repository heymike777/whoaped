import { Chain, Wallet } from '../types';

export function isWalletAlreadyTracked(
  wallets: Wallet[],
  address: string,
  chain: Chain,
) {
  const cleanAddress = address.trim();
  return wallets.some(
    (wallet) => wallet.chain === chain && wallet.address === cleanAddress,
  );
}

export function transactionCount24hLabel(count: number) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `${safeCount} ${safeCount === 1 ? 'transaction' : 'transactions'} · 24h`;
}
