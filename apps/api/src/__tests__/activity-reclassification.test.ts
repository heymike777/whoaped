import { describe, expect, it, vi } from 'vitest';

import type { TransactionDocument, WalletDocument } from '../db.js';
import { reclassifyStoredActivities } from '../services/activity-reclassification.js';

const walletAddress = '9Xt9Zj9HoAh13MpoB6hmY9UZz37L4Jabtyn8zE7AAsL';
const signature = '5gd69toC169WBCN9Nq2ygKDYP1Wxfb8g2T8Xer6kLVPLj4Yk7P6Ard967rSt3P9eK6MNikUG71nyvV4ebh9GxFC3';

describe('activity reclassification', () => {
  it('upgrades a stored balance event when the current parser recognizes Meteora liquidity', async () => {
    const transaction: TransactionDocument = {
      _id: 'transaction-1', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash: signature, eventIndex: 0, slot: 463_276_655, kind: 'balance',
      title: '−17.12 MET', detail: 'Solana activity',
      occurredAt: new Date('2026-10-30T11:58:02.000Z'), metadata: {}, createdAt: new Date(),
    };
    const wallet: WalletDocument = {
      _id: 'wallet-1', userId: 'user-1', name: 'heymike.sns', address: walletAddress,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
    };
    const payload = {
      signature, slot: 463_276_655, blockTime: 1_793_361_482, feePayer: walletAddress,
      summary: {
        type: 'add_liquidity', description: `${walletAddress} added liquidity to Meteora DLMM`,
        parsedData: {
          type: 'liquidity', protocol: 'meteora_dlmm', operation: 'add',
          token_a_mint: 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL', token_a_amount: '17121298',
          token_b_mint: 'So11111111111111111111111111111111111111112', token_b_amount: '49850605',
        },
      },
      tokenTransfers: [
        { fromUserAccount: walletAddress, mint: 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL', rawTokenAmount: 17_121_298, decimals: 6 },
        { fromUserAccount: walletAddress, mint: 'So11111111111111111111111111111111111111112', rawTokenAmount: 49_850_605, decimals: 9 },
      ],
      instructions: [{
        programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', programName: 'lb_clmm',
        instructionName: 'add_liquidity_by_strategy2', decoded: { accounts: [{ name: 'sender', pubkey: walletAddress }] },
      }],
    };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      ingestionEvents: {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([{ externalId: signature, payload, receivedAt: new Date() }]),
          }),
        }),
      },
      transactions: { updateOne },
    };

    const result = await reclassifyStoredActivities(
      [transaction],
      new Map([[wallet._id, wallet]]),
      db as never,
    );

    expect(result[0]).toMatchObject({
      kind: 'yield', detail: 'Meteora DLMM',
      metadata: { yield: { positionType: 'liquidity', protocol: 'meteora-dlmm' } },
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: transaction._id },
      expect.objectContaining({ $set: expect.objectContaining({ kind: 'yield' }) }),
    );
  });
});
