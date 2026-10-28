import { describe, expect, it } from 'vitest';

import { solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';

const wallet = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';
const sol = 'So11111111111111111111111111111111111111112';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function parsedTransaction(overrides: Partial<ParsedSolanaTransaction>): ParsedSolanaTransaction {
  return {
    signature: 'signature',
    slot: 433_950_192,
    blockTime: 1_700_000_000,
    accountKeys: [wallet],
    nativeTransfers: [],
    tokenTransfers: [],
    accountData: [],
    instructions: [],
    ...overrides,
  };
}

describe('solanaAdapter balance changes', () => {
  it('aggregates actual native and token balance changes for the watched wallet', () => {
    const payload = parsedTransaction({
      accountData: [
        { account: wallet, nativeBalanceChange: -100_005_000_000 },
        {
          account: 'associated-token-account',
          tokenBalanceChanges: [{
            userAccount: wallet,
            mint: usdc,
            rawTokenAmount: { tokenAmount: '10000000000', decimals: 6 },
          }],
        },
      ],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'balance',
      title: '−100.01 SOL  ·  +10,000 USDC',
      detail: 'Balance change',
      metadata: { slot: 433_950_192 },
    });
  });

  it('falls back to transfer amounts when account deltas are unavailable', () => {
    const payload = parsedTransaction({
      accountData: undefined,
      nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'receiver', amount: 80_000_000 }],
      tokenTransfers: [{
        fromUserAccount: 'sender',
        toUserAccount: wallet,
        mint: usdc,
        rawTokenAmount: 1_250_000_000,
        decimals: 6,
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'balance',
      title: '−0.08 SOL  ·  +1,250 USDC',
    });
  });

  it('does not create noisy activity when the watched balance did not change', () => {
    const payload = parsedTransaction({
      summary: { description: `${wallet} created account with 0.00069596 SOL` },
      instructions: [{ programName: 'Compute Budget' }],
    });

    expect(solanaAdapter.normalize(payload, wallet)).toEqual([]);
  });

  it('collects balance, transfer, raw, and decoded accounts once', () => {
    const addresses = solanaAdapter.extractAddresses(parsedTransaction({
      feePayer: wallet,
      accountKeys: [wallet, 'program'],
      accountData: [{
        account: wallet,
        tokenBalanceChanges: [{ userAccount: 'token-owner', mint: sol }],
      }],
      nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'receiver' }],
      instructions: [{
        rawAccounts: ['program', 'raw-account'],
        decoded: { accounts: [{ name: 'authority', pubkey: 'decoded-account' }] },
      }],
    }));
    expect(addresses).toEqual([
      wallet,
      'program',
      'token-owner',
      'receiver',
      'raw-account',
      'decoded-account',
    ]);
  });
});
