import { describe, expect, it } from 'vitest';
import { transactionBalanceLines } from '../services/transaction-balances.js';
import type { ParsedSolanaTransaction } from '../chains/solana.js';

const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const base: ParsedSolanaTransaction = { signature: 'sig', slot: 1 };
const lines = (tx: Partial<ParsedSolanaTransaction>, wallet = 'mine') => transactionBalanceLines({ ...base, ...tx }, wallet, []);

describe('Telegram wallet balance changes', () => {
  it('shows the fee of a failed transaction without rolled-back transfers', () => {
    expect(lines({ status: 'error', feePayer: 'mine', fee: 5000,
      nativeTransfers: [{ fromUserAccount: 'mine', amount: 1e9 }],
      tokenTransfers: [{ toUserAccount: 'mine', mint: usdc, rawTokenAmount: '1000000', decimals: 6 }],
    })).toEqual(['−0.000005 SOL']);
  });
  it('uses authoritative native balances once, including rent refunds and fees', () => {
    expect(lines({ nativeBalanceChanges: { mine: 2034280 }, feePayer: 'mine', fee: 5000,
      accountData: [{ account: 'mine', nativeBalanceChange: -5000 }],
    })).toEqual(['+0.00203428 SOL']);
    expect(lines({ nativeBalanceChanges: { mine: 0 }, feePayer: 'mine', fee: 5000 })).toEqual(['No balance changes']);
  });
  it('nets token accounts owned by this wallet and avoids counting transfer duplicates', () => {
    expect(lines({ accountData: [
      { account: 'ata1', tokenBalanceChanges: [{ userAccount: 'mine', mint: usdc, rawTokenAmount: { tokenAmount: '-3000000', decimals: 6 } }] },
      { account: 'ata2', tokenBalanceChanges: [{ userAccount: 'mine', mint: usdc, rawTokenAmount: '1000000', decimals: 6 }, { userAccount: 'other', mint: usdc, rawTokenAmount: '9000000', decimals: 6 }] },
    ], tokenTransfers: [{ fromUserAccount: 'mine', mint: usdc, rawTokenAmount: '2000000', decimals: 6 }] })).toEqual(['−2 USDC']);
  });
  it('shows each watched wallet’s own direction and fee on transfer fallback', () => {
    const tx = { feePayer: 'mine', fee: 5000, nativeTransfers: [{ fromUserAccount: 'mine', toUserAccount: 'other', amount: 1e9 }] };
    expect(lines(tx)).toEqual(['−1.000005 SOL']);
    expect(lines(tx, 'other')).toEqual(['+1 SOL']);
  });
  it('keeps atomic precision and separates WSOL from native SOL', () => {
    expect(lines({ nativeBalanceChanges: { mine: -5000 }, accountData: [{ tokenBalanceChanges: [
      { userAccount: 'mine', mint: usdc, rawTokenAmount: '9007199254740993', decimals: 6 },
      { userAccount: 'mine', mint: 'So11111111111111111111111111111111111111112', rawTokenAmount: '1', decimals: 9 },
    ] }] })).toEqual(['−0.000005 SOL', '+9007199254.740993 USDC', '+0.000000001 WSOL']);
  });
  it('does not count the Jupiter SOL-to-WSOL wrap as a second payment', () => {
    const wallet = '8PMZDad1XaeHgxyUzjPVHxvw3fGGKKZGiyyJ2t7J3aU1';
    const wrapped = 'Cd7WQ7STA4YsYUAj3C8DWjhaKW1WUXaBF5LpBs8Gxc96';
    expect(lines({ feePayer: wallet, fee: 7423,
      nativeTransfers: [
        { fromUserAccount: wallet, toUserAccount: wrapped, amount: 1488440 },
        { fromUserAccount: wallet, toUserAccount: wrapped, amount: 77847364 },
        { fromUserAccount: wrapped, toUserAccount: wallet, amount: 1488440 },
      ],
      tokenTransfers: [
        { fromUserAccount: wallet, fromTokenAccount: wrapped, mint: 'So11111111111111111111111111111111111111112', rawTokenAmount: 77769517, decimals: 9 },
        { fromUserAccount: wallet, fromTokenAccount: wrapped, mint: 'So11111111111111111111111111111111111111112', rawTokenAmount: 77847, decimals: 9 },
        { toUserAccount: wallet, mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', rawTokenAmount: 550290424, decimals: 6 },
      ],
      instructions: [
        { instructionName: 'sync_native', decoded: { accounts: [{ name: 'account', pubkey: wrapped }] } },
        { instructionName: 'close_account', decoded: { accounts: [{ name: 'account', pubkey: wrapped }, { name: 'destination', pubkey: wallet }] } },
      ],
    }, wallet)).toEqual(['−0.077854787 SOL', '+550.290424 SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3']);
  });
  it('still counts WSOL already held before a transaction', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    expect(lines({ feePayer: 'mine', fee: 5000,
      tokenTransfers: [{ fromUserAccount: 'mine', fromTokenAccount: 'existing', mint, rawTokenAmount: 70000000, decimals: 9 }],
    })).toEqual(['−0.000005 SOL', '−0.07 WSOL']);
    expect(lines({ feePayer: 'mine', fee: 5000,
      nativeTransfers: [{ fromUserAccount: 'mine', toUserAccount: 'existing', amount: 30000000 }],
      tokenTransfers: [{ fromUserAccount: 'mine', fromTokenAccount: 'existing', mint, rawTokenAmount: 70000000, decimals: 9 }],
      instructions: [{ instructionName: 'sync_native', decoded: { accounts: [{ name: 'account', pubkey: 'existing' }] } }],
    })).toEqual(['−0.030005 SOL', '−0.04 WSOL']);
  });
  it('does not count WSOL received into an account that is unwrapped to the wallet', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    expect(lines({ nativeTransfers: [{ fromUserAccount: 'wrapped', toUserAccount: 'mine', amount: 70000000 }],
      tokenTransfers: [{ toUserAccount: 'mine', toTokenAccount: 'wrapped', mint, rawTokenAmount: 70000000, decimals: 9 }],
      instructions: [{ instructionName: 'close_account', decoded: { accounts: [
        { name: 'account', pubkey: 'wrapped' }, { name: 'destination', pubkey: 'mine' },
      ] } }],
    })).toEqual(['+0.07 SOL']);
  });
  it('does not invent a zero balance when balances are absent', () => {
    expect(lines({})).toEqual(['Balance changes unavailable']);
  });
});
