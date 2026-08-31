import { isWalletAlreadyTracked, transactionCount24hLabel } from './wallets';
import { Wallet } from '../types';

const wallet: Wallet = {
  id: 'wallet-1',
  name: 'Main',
  address: '7YWHMfk9JZe0LM0g1Do5zN8XyF2PMQvCkA6jRtB3sUa',
  chain: 'solana',
  status: 'active',
  transactionCount24h: 2,
  createdAt: '2026-08-26T12:00:00.000Z',
};

describe('wallet helpers', () => {
  it('detects the same tracked address on the same chain', () => {
    expect(isWalletAlreadyTracked([wallet], ` ${wallet.address} `, 'solana')).toBe(true);
  });

  it('keeps address comparison case-sensitive', () => {
    expect(isWalletAlreadyTracked([wallet], wallet.address.toLowerCase(), 'solana')).toBe(false);
  });

  it('formats the last-24-hour transaction count', () => {
    expect(transactionCount24hLabel(0)).toBe('0 transactions · 24h');
    expect(transactionCount24hLabel(1)).toBe('1 transaction · 24h');
    expect(transactionCount24hLabel(12)).toBe('12 transactions · 24h');
  });
});
