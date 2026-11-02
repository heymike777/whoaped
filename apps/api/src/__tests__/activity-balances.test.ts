import { describe, expect, it, vi } from 'vitest';
import { withActivityBalances } from '../services/activity-balances.js';
import type { Collections, TransactionDocument, WalletDocument } from '../db.js';

describe('balance changes in retained mobile history', () => {
  it('backfills failed and classified cards using each wallet address and persists the result', async () => {
    const transactions = ['payer', 'recipient'].map((walletId, i) => ({
      _id: String(i), txHash: 'sig', walletId, chain: 'solana', kind: 'failed', metadata: {},
    } as TransactionDocument));
    const wallets = new Map(['payer', 'recipient'].map(address => [address, { address } as WalletDocument]));
    const toArray = vi.fn().mockResolvedValue([{ externalId: 'sig', payload: {
      signature: 'sig', slot: 1, status: 'error', feePayer: 'payer', fee: 5000,
      nativeBalanceChanges: { payer: -5000, recipient: 0 },
    } }]);
    const updateOne = vi.fn();
    const db = { ingestionEvents: { find: vi.fn().mockReturnValue({ sort: () => ({ toArray }) }) }, transactions: { updateOne } };
    const rows = await withActivityBalances(transactions, wallets, db as unknown as Collections);
    expect(rows[0].metadata.balanceChanges).toEqual(['−0.000005 SOL']);
    expect(rows[1].metadata.balanceChanges).toEqual(['No balance changes']);
    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(updateOne).toHaveBeenCalledWith({ _id: '0' }, { $set: { 'metadata.balanceChanges': ['−0.000005 SOL'] } });
  });
  it('preserves computed balances and does not query expired ingestion payloads again', async () => {
    const tx = { chain: 'solana', metadata: { balanceChanges: ['+1 SOL'] } } as unknown as TransactionDocument;
    expect(await withActivityBalances([tx], new Map(), {} as Collections)).toEqual([tx]);
  });
  it('leaves missing history unknown rather than inventing balance changes', async () => {
    const tx = { chain: 'solana', txHash: 'old', metadata: {} } as TransactionDocument;
    const db = { ingestionEvents: { find: () => ({ sort: () => ({ toArray: async () => [] }) }) } };
    expect(await withActivityBalances([tx], new Map(), db as unknown as Collections)).toEqual([tx]);
  });
});
