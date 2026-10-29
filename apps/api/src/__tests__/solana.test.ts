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
  it.each([
    ['Jupiter', 'jupiter', 'Jupiter'],
    ['PumpSwap', 'pumpfun', 'Pump.fun'],
    ['Meteora DLMM', 'meteora', 'Meteora'],
    ['Orca Whirlpool', 'orca', 'Orca'],
    ['Titan', 'titan', 'Titan'],
    ['Raydium CPMM', 'raydium', 'Raydium'],
  ])('creates structured swap metadata for %s', (protocol, dex, dexName) => {
    const payload = parsedTransaction({
      summary: {
        type: 'SWAP',
        description: `Swap routed by ${protocol}`,
        parsedData: {
          protocol,
          input_mint: sol,
          output_mint: usdc,
          in_amount: '1250000000',
          actual_out_amount: '25000000',
        },
      },
      tokenTransfers: [
        { mint: sol, decimals: 9 },
        { mint: usdc, decimals: 6 },
      ],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      title: 'Swapped 1.25 SOL → 25 USDC',
      detail: dexName,
      metadata: {
        swap: {
          dex,
          dexName,
          input: { mint: sol, symbol: 'SOL', amount: 1.25 },
          output: { mint: usdc, symbol: 'USDC', amount: 25 },
        },
      },
    });
  });

  it('prefers the watched wallet balance deltas for exact swap amounts', () => {
    const payload = parsedTransaction({
      summary: {
        type: 'swap',
        description: 'Jupiter swap',
        parsedData: { protocol: 'Jupiter', input_mint: sol, output_mint: usdc },
      },
      accountData: [
        { account: wallet, nativeBalanceChange: -500_000_000 },
        { account: 'token-account', tokenBalanceChanges: [{
          userAccount: wallet,
          mint: usdc,
          rawTokenAmount: { tokenAmount: 12_345_678, decimals: 6 },
        }] },
      ],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]?.metadata.swap).toEqual(expect.objectContaining({
      input: expect.objectContaining({ amount: 0.5 }),
      output: expect.objectContaining({ amount: 12.345678 }),
    }));
  });

  it('treats a Pump.fun buy summary as a structured swap', () => {
    const payload = parsedTransaction({
      summary: {
        type: 'buy',
        description: `${wallet} bought a token via pump_fun`,
        parsedData: {
          protocol: 'pump_fun',
          input_mint: sol,
          output_mint: usdc,
          in_amount: '100000000',
          actual_out_amount: '2000000',
        },
      },
      tokenTransfers: [{ mint: sol, decimals: 9 }, { mint: usdc, decimals: 6 }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      source: 'Pump.fun',
    });
  });

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

  it('keeps a Metaplex Core mint semantic and appends its balance change', () => {
    const payload = parsedTransaction({
      feePayer: wallet,
      accountData: [{ account: wallet, nativeBalanceChange: -6_959_600 }],
      instructions: [{
        programId: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
        programName: 'mpl_core',
        instructionName: 'create_v1',
        decoded: { accounts: [{ name: 'owner', pubkey: wallet }] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'nft',
      title: 'Minted Core NFT  ·  −0.0069596 SOL',
      detail: 'Metaplex Core',
    });
  });

  it('keeps a Squads proposal approval even without a balance change', () => {
    const payload = parsedTransaction({
      instructions: [{
        programId: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
        programName: 'squads_multisig_program',
        instructionName: 'proposal_approve',
        decoded: {
          args: { transactionIndex: 42 },
          accounts: [
            { name: 'member', pubkey: wallet },
            { name: 'multisig', pubkey: 'multisig-address' },
          ],
        },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'multisig',
      title: 'Approved Squads proposal #42',
      detail: 'Squads multisig',
    });
  });

  it('shows the direction of a Core NFT transfer for the watched owner', () => {
    const payload = parsedTransaction({
      instructions: [{
        programName: 'metaplex_core',
        instructionName: 'transfer_v1',
        decoded: { accounts: [
          { name: 'authority', pubkey: 'previous-owner' },
          { name: 'new_owner', pubkey: wallet },
        ] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'nft',
      title: 'Received Core NFT',
    });
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
