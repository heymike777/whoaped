import { describe, expect, it, vi } from 'vitest';

import type { TransactionDocument, WalletDocument } from '../db.js';
import { reclassifyStoredActivities } from '../services/activity-reclassification.js';

const walletAddress = '9Xt9Zj9HoAh13MpoB6hmY9UZz37L4Jabtyn8zE7AAsL';
const signature = '5gd69toC169WBCN9Nq2ygKDYP1Wxfb8g2T8Xer6kLVPLj4Yk7P6Ard967rSt3P9eK6MNikUG71nyvV4ebh9GxFC3';

describe('activity reclassification', () => {
  it('hides a previously stored swap attributed to a read-only Pump AMM account', async () => {
    const txHash = '2wcGijtz5XZ8dVAJBtqD3d79FpGMxrUR5d9fPXuEjZcKcmBr7SvSdZtRgdkvrPwUZgwqrvNRP8QuQv2eoMprg3UQ';
    const transaction = { _id: 'swap-readonly', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash, eventIndex: 0, slot: 468_073_539, kind: 'swap', title: 'Swapped token → SOL',
      detail: 'Pump.fun', occurredAt: new Date(), metadata: {}, createdAt: new Date(),
    } as TransactionDocument;
    const wallet = { _id: 'wallet-1', userId: 'user-1', name: 'heymike.sns', address: walletAddress,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
    } as WalletDocument;
    const payload = { signature: txHash, slot: transaction.slot,
      feePayer: '41g6ZszUMGqw5dDokJLDtGiyzpCoXYMR4BUscxaQeAtK',
      summary: { type: 'swap' },
      instructions: [{ programName: 'pump_amm', instructionName: 'buy_exact_quote_in',
        decoded: { accounts: [{ name: 'coin_creator', pubkey: walletAddress, isSigner: false }] } }],
    };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = { ingestionEvents: { find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ externalId: txHash, payload, receivedAt: new Date() }]),
    }) }) }, transactions: { updateOne } };
    expect(await reclassifyStoredActivities([transaction], new Map([[wallet._id, wallet]]), db as never)).toEqual([]);
    expect(updateOne).toHaveBeenCalledWith({ _id: transaction._id }, { $set: { suppressed: true } });
  });

  it('upgrades an already stored balance transfer to a Pump.fun creator-fee claim', async () => {
    const txHash = 't4Gxo9SsxLDpQmkw7Xb212G91rNzz9GiU5aYubGsbuVebNkjKn4WW3LaZve2SPHTXuD87QmwejqLsxDuHjooA2z';
    const transaction = { _id: 'claim-old', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash, eventIndex: 0, slot: 466_547_268, kind: 'balance', title: '+0.019 SOL', detail: 'Balance change',
      occurredAt: new Date(), metadata: {}, createdAt: new Date(),
    } as TransactionDocument;
    const wallet = { _id: 'wallet-1', userId: 'user-1', name: 'Watched', address: walletAddress,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
    } as WalletDocument;
    const payload = { signature: txHash, slot: transaction.slot, feePayer: walletAddress,
      summary: { type: 'transfer' },
      instructions: [
        { programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', instructionName: 'collect_creator_fee_v2',
          decoded: { accounts: [{ name: 'creator', pubkey: walletAddress },
            { name: 'quote_mint', pubkey: 'So11111111111111111111111111111111111111112' }] } },
        { programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', instructionName: 'CollectCreatorFeeEvent',
          decoded: { args: { creator: walletAddress, creator_fee: '240640', quote_mint: '11111111111111111111111111111111' } } },
      ],
    };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = { ingestionEvents: { find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ externalId: txHash, payload, receivedAt: new Date() }]),
    }) }) }, transactions: { updateOne } };
    const [result] = await reclassifyStoredActivities([transaction], new Map([[wallet._id, wallet]]), db as never);
    expect(result).toMatchObject({ kind: 'claim', source: 'Pump.fun', metadata: { claim: { amountSol: 0.00024064 } } });
    expect(updateOne).toHaveBeenCalledWith({ _id: transaction._id }, expect.objectContaining({
      $set: expect.objectContaining({ kind: 'claim' }),
    }));
  });
  it('upgrades a stored balance event for the supplied Magic Eden listing', async () => {
    const txHash = '3sQLPtzdegRYra6RGF5zUPZ7nZ6kKzy3VFcJYUUpEoPXgZLh9E4BNiMr5qEEha3r6cYyNe9o8zY1EogdNT1HDXXh';
    const mint = 'DgdFTE9MJd7TcoeUy9cHWJ9ye84k6tiQMU4bQdbC6VTC';
    const transaction = { _id: 'listing-old', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash, eventIndex: 0, slot: 465706234, kind: 'balance', title: '−0.006 SOL', detail: 'Balance change',
      occurredAt: new Date(), metadata: {}, createdAt: new Date(),
    } as TransactionDocument;
    const wallet = { _id: 'wallet-1', userId: 'user-1', name: 'Watched', address: walletAddress,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
    } as WalletDocument;
    const payload = { signature: txHash, slot: transaction.slot, feePayer: walletAddress, summary: { type: 'transfer' },
      instructions: [{ programId: 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', instructionName: 'mip1_sell',
        decoded: { args: { args: { price: '2617000000' } }, accounts: [
          { name: 'wallet', pubkey: walletAddress, isSigner: true }, { name: 'token_mint', pubkey: mint },
        ] },
      }],
    };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = { ingestionEvents: { find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ externalId: txHash, payload, receivedAt: new Date() }]),
    }) }) }, transactions: { updateOne } };
    const [result] = await reclassifyStoredActivities([transaction], new Map([[wallet._id, wallet]]), db as never);
    expect(result).toMatchObject({ kind: 'nft', source: 'Magic Eden', metadata: { nft: { action: 'list', mint, priceSol: 2.617 } } });
    expect(updateOne).toHaveBeenCalledWith({ _id: transaction._id }, expect.objectContaining({ $set: expect.objectContaining({ kind: 'nft' }) }));
  });
  it('hides a previously stored unsigned dust receipt', async () => {
    const transaction = {
      _id: 'dust-1', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash: 'dust-signature', eventIndex: 0, slot: 463_000_000, kind: 'balance',
      title: '+0.000001 SOL', detail: 'Balance change',
      occurredAt: new Date(), metadata: {}, createdAt: new Date(),
    } as TransactionDocument;
    const wallet = {
      _id: 'wallet-1', userId: 'user-1', name: 'Watched', address: walletAddress,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
    } as WalletDocument;
    const payload = {
      signature: transaction.txHash, slot: transaction.slot, feePayer: 'sender',
      summary: { type: 'transfer' },
      instructions: [{ programName: 'system', instructionName: 'transfer' }],
      nativeTransfers: [{ fromUserAccount: 'sender', toUserAccount: walletAddress, amount: 1_000 }],
    };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      ingestionEvents: { find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([
          { externalId: transaction.txHash, payload, receivedAt: new Date() },
        ]) }),
      }) },
      transactions: { updateOne },
    };

    expect(await reclassifyStoredActivities([transaction], new Map([[wallet._id, wallet]]), db as never)).toEqual([]);
    expect(updateOne).toHaveBeenCalledWith({ _id: transaction._id }, { $set: { suppressed: true } });
  });

  it('hides a previously stored unsigned sub-cent USDC receipt', async () => {
    const transaction = { _id: 'usdc-dust', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash: 'usdc-dust-signature', eventIndex: 0, slot: 463_000_001, kind: 'balance',
      title: '+0.001111 USDC', detail: 'Balance change', occurredAt: new Date(), metadata: {}, createdAt: new Date(),
    } as TransactionDocument;
    const wallet = { _id: 'wallet-1', userId: 'user-1', name: 'Watched', address: walletAddress,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
    } as WalletDocument;
    const payload = { signature: transaction.txHash, slot: transaction.slot, feePayer: 'sender',
      summary: { type: 'token_transfer' }, instructions: [{ programName: 'token', instructionName: 'transfer_checked' }],
      tokenTransfers: [{ fromUserAccount: 'sender', toUserAccount: walletAddress,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', rawTokenAmount: 1_111, decimals: 6 }],
    };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = { ingestionEvents: { find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ externalId: transaction.txHash, payload, receivedAt: new Date() }]),
    }) }) }, transactions: { updateOne } };
    expect(await reclassifyStoredActivities([transaction], new Map([[wallet._id, wallet]]), db as never)).toEqual([]);
    expect(updateOne).toHaveBeenCalledWith({ _id: transaction._id }, { $set: { suppressed: true } });
  });

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

  it('corrects a stored swap venue when Helius identifies Meteora over a Pump AMM cleanup instruction', async () => {
    const transaction = {
      _id: 'transaction-2', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash: signature, eventIndex: 0, slot: 463_373_296, kind: 'swap',
      title: 'Swapped token → SOL', detail: 'Pump.fun', source: 'Pump.fun',
      occurredAt: new Date('2026-10-30T17:42:23.000Z'), metadata: { swap: { dex: 'pumpfun' } }, createdAt: new Date(),
    } as TransactionDocument;
    const wallet = {
      _id: 'wallet-1', userId: 'user-1', name: 'Wallet', address: walletAddress,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
    } as WalletDocument;
    const payload = {
      signature, slot: transaction.slot, blockTime: 1_793_382_143, feePayer: walletAddress,
      summary: { type: 'swap', parsedData: {
        protocol: 'meteora_damm_v2', input_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        output_mint: 'So11111111111111111111111111111111111111112',
        in_amount: '1000000', actual_out_amount: '10000000',
      } },
      instructions: [{ programName: 'pump_amm', instructionName: 'close_user_volume_accumulator' }],
      tokenTransfers: [
        { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
        { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
      ],
    };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      ingestionEvents: { find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([
          { externalId: signature, payload, receivedAt: new Date() },
        ]) }),
      }) },
      transactions: { updateOne },
    };

    const [result] = await reclassifyStoredActivities([transaction], new Map([[wallet._id, wallet]]), db as never);

    expect(result).toMatchObject({ kind: 'swap', source: 'Meteora', metadata: { swap: { dex: 'meteora' } } });
    expect(updateOne).toHaveBeenCalledOnce();
  });

  it('upgrades an already stored swap with newly parsed route steps', async () => {
    const sol = 'So11111111111111111111111111111111111111112';
    const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const transaction = {
      _id: 'route-old', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash: 'route-signature', eventIndex: 0, slot: 123, kind: 'swap', source: 'Jupiter',
      title: 'Swapped SOL → SOL', detail: 'Jupiter', metadata: { swap: { dex: 'jupiter' } },
      occurredAt: new Date(), createdAt: new Date(),
    } as TransactionDocument;
    const wallet = { _id: 'wallet-1', userId: 'user-1', name: 'Wallet', address: walletAddress,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null } as WalletDocument;
    const payload = { signature: transaction.txHash, slot: 123, feePayer: walletAddress,
      nativeBalanceChanges: { [walletAddress]: 10_000_000 },
      summary: { type: 'swap', parsedData: { protocol: 'jupiter', input_mint: sol, output_mint: sol, inner_swaps: [
        { amm_program_name: 'raydium', input_mint: sol, output_mint: usdc, input_amount: '1000000000', output_amount: '100000000' },
        { amm_program_name: 'orca', input_mint: usdc, output_mint: sol, input_amount: '100000000', output_amount: '1010000000' },
      ] } },
      tokenTransfers: [{ mint: usdc, decimals: 6 }],
    };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = { ingestionEvents: { find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ externalId: transaction.txHash, payload, receivedAt: new Date() }]),
    }) }) }, transactions: { updateOne } };
    const [result] = await reclassifyStoredActivities([transaction], new Map([[wallet._id, wallet]]), db as never);
    expect(result).toMatchObject({ kind: 'swap', metadata: { swap: { steps: [{ dex: 'raydium' }, { dex: 'orca' }], arbitrage: { profit: 0.01 } } } });
    expect(updateOne).toHaveBeenCalledOnce();
  });
});
