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
  it('repairs a previously stored duplicate SOL and WSOL debit on read', async () => {
    const tx = { _id: 'old-swap', txHash: 'sig', walletId: 'wallet', chain: 'solana', kind: 'swap',
      metadata: { balanceChanges: ['−0.077854787 SOL', '−0.077847364 WSOL', '+550.290424 SKR'] },
    } as unknown as TransactionDocument;
    const wallet = { address: 'mine' } as WalletDocument;
    const payload = { signature: 'sig', slot: 1, feePayer: 'mine', fee: 7423,
      nativeTransfers: [{ fromUserAccount: 'mine', toUserAccount: 'wrapped', amount: 77847364 }],
      tokenTransfers: [{ fromUserAccount: 'mine', fromTokenAccount: 'wrapped', mint: 'So11111111111111111111111111111111111111112', rawTokenAmount: 77847364, decimals: 9 }],
      instructions: [{ instructionName: 'sync_native', decoded: { accounts: [{ name: 'account', pubkey: 'wrapped' }] } }],
    };
    const updateOne = vi.fn();
    const db = { ingestionEvents: { find: () => ({ sort: () => ({ toArray: async () => [{ externalId: 'sig', payload }] }) }) },
      transactions: { updateOne } };
    const [repaired] = await withActivityBalances([tx], new Map([['wallet', wallet]]), db as unknown as Collections);
    expect(repaired.metadata.balanceChanges).toEqual(['−0.077854787 SOL']);
    expect(repaired.metadata.balanceChangesVersion).toBe(2);
    expect(updateOne).toHaveBeenCalledWith({ _id: 'old-swap' }, { $set: {
      'metadata.balanceChanges': ['−0.077854787 SOL'], 'metadata.balanceChangesVersion': 2,
    } });
  });
  it('leaves missing history unknown rather than inventing balance changes', async () => {
    const tx = { chain: 'solana', txHash: 'old', metadata: {} } as TransactionDocument;
    const db = { ingestionEvents: { find: () => ({ sort: () => ({ toArray: async () => [] }) }) } };
    expect(await withActivityBalances([tx], new Map(), db as unknown as Collections)).toEqual([tx]);
  });
});
