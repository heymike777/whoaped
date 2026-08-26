import { describe, expect, it } from 'vitest';

import { solanaAdapter, type HeliusTransaction } from '../chains/solana.js';

const wallet = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';

describe('solanaAdapter', () => {
  it('normalizes a SOL to USDC swap', () => {
    const payload: HeliusTransaction = {
      signature: 'swap-signature',
      timestamp: 1_700_000_000,
      type: 'SWAP',
      source: 'JUPITER',
      feePayer: wallet,
      events: {
        swap: {
          nativeInput: { amount: 100_000_000_000 },
          tokenOutputs: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenAmount: 10_000 }],
        },
      },
    };

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      title: 'Swapped 100 SOL to 10,000 USDC',
      detail: 'Jupiter',
    });
  });

  it('labels Pump.fun output as a buy', () => {
    const payload: HeliusTransaction = {
      signature: 'pump-signature',
      timestamp: 1_700_000_000,
      type: 'SWAP',
      source: 'PUMP_FUN',
      feePayer: wallet,
      events: {
        swap: {
          nativeInput: { amount: 6_200_000_000 },
          tokenOutputs: [{ mint: 'LumeN1111111111111111111111111111111111111', tokenAmount: 24_800 }],
        },
      },
    };

    const [activity] = solanaAdapter.normalize(payload, wallet);
    expect(activity.kind).toBe('buy');
    expect(activity.title).toContain('Bought 24,800');
    expect(activity.detail).toBe('Pump.fun · spent 6.2 SOL');
  });

  it('normalizes an incoming token transfer', () => {
    const payload: HeliusTransaction = {
      signature: 'transfer-signature',
      tokenTransfers: [{
        fromUserAccount: '9WzY1111111111111111111111111111111111111111',
        toUserAccount: wallet,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        tokenAmount: 1_250,
      }],
    };

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'transfer',
      title: 'Received 1,250 USDC',
    });
  });

  it('collects all potentially watched addresses once', () => {
    const addresses = solanaAdapter.extractAddresses({
      feePayer: wallet,
      nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'receiver' }],
      accountData: [{ account: 'program' }],
    });
    expect(addresses).toEqual([wallet, 'program', 'receiver']);
  });
});
