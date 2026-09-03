import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db.js', () => ({ query: mocks.query }));

import type { ParsedSolanaTransaction } from '../chains/solana.js';
import { ingestParsedTransaction } from '../services/parsed-transactions.js';

const walletAddress = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';

function transaction(overrides: Partial<ParsedSolanaTransaction> = {}): ParsedSolanaTransaction {
  return {
    signature: 'stream-signature',
    slot: 433_950_192,
    accountKeys: [walletAddress],
    nativeTransfers: [{
      fromUserAccount: walletAddress,
      toUserAccount: 'receiver',
      amount: 1_000_000_000,
    }],
    ...overrides,
  };
}

describe('parsed transaction ingestion', () => {
  beforeEach(() => mocks.query.mockReset());

  it('stores the slot and creates an idempotent notification job', async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'wallet-1', user_id: 'user-1', name: 'Main', address: walletAddress,
      }])
      .mockResolvedValueOnce([{ id: 'transaction-1' }])
      .mockResolvedValueOnce([]);

    await ingestParsedTransaction(transaction(), { provider: 'helius-parsed-stream' });

    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.query.mock.calls[0]?.[0]).toContain('ingestion_events');
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      'helius-parsed-stream', 'stream-signature', 433_950_192,
    ]));
    expect(mocks.query.mock.calls[2]?.[0]).toContain('slot');
    expect(mocks.query.mock.calls[3]?.[0]).toContain('ON CONFLICT (device_token_id, transaction_id) DO NOTHING');
  });

  it('ignores failed transactions before touching storage', async () => {
    await expect(ingestParsedTransaction(transaction({ status: 'error' }), {
      provider: 'helius-parsed-stream',
    })).resolves.toEqual({ activities: 0 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
