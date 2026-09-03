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
    instructions: [],
    ...overrides,
  };
}

describe('solanaAdapter for Helius Parsed Events', () => {
  it('normalizes a SOL to USDC swap from raw summary amounts', () => {
    const payload = parsedTransaction({
      summary: {
        type: 'swap',
        parsedData: {
          protocol: 'jupiter',
          in_amount: '100000000000',
          actual_out_amount: '10000000000',
          input_mint: sol,
          output_mint: usdc,
        },
      },
      tokenTransfers: [{ mint: usdc, rawTokenAmount: 10_000_000_000, decimals: 6 }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      title: 'Swapped 100 SOL to 10,000 USDC',
      detail: 'Jupiter',
      metadata: { slot: 433_950_192 },
    });
  });

  it('labels a Pump.fun swap output as a buy', () => {
    const mint = 'LumeN1111111111111111111111111111111111111';
    const payload = parsedTransaction({
      summary: {
        type: 'swap',
        parsedData: {
          protocol: 'pump_fun',
          in_amount: '6200000000',
          actual_out_amount: '24800000000',
          input_mint: sol,
          output_mint: mint,
        },
      },
      tokenTransfers: [{ mint, rawTokenAmount: 24_800_000_000, decimals: 6 }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'buy',
      title: 'Bought 24,800 Lume…1111',
      detail: 'Pump.fun · spent 6.2 SOL',
    });
  });

  it('normalizes an incoming token transfer', () => {
    const payload = parsedTransaction({
      tokenTransfers: [{
        fromUserAccount: '9WzY1111111111111111111111111111111111111111',
        toUserAccount: wallet,
        mint: usdc,
        rawTokenAmount: 1_250_000_000,
        decimals: 6,
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'transfer',
      title: 'Received 1,250 USDC',
    });
  });

  it('collects transaction, transfer, raw, and decoded accounts once', () => {
    const addresses = solanaAdapter.extractAddresses(parsedTransaction({
      feePayer: wallet,
      accountKeys: [wallet, 'program'],
      nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'receiver' }],
      instructions: [{
        rawAccounts: ['program', 'raw-account'],
        decoded: { accounts: [{ name: 'authority', pubkey: 'decoded-account' }] },
      }],
    }));
    expect(addresses).toEqual([wallet, 'program', 'receiver', 'raw-account', 'decoded-account']);
  });
});
