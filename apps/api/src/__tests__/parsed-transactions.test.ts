import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ingestionUpdateOne: vi.fn(),
  walletFind: vi.fn(),
  transactionUpdateOne: vi.fn(),
  deviceFind: vi.fn(),
  notificationUpdateOne: vi.fn(),
}));

vi.mock('../db.js', () => ({
  hasDatabase: () => false,
  collections: async () => ({
    ingestionEvents: { updateOne: mocks.ingestionUpdateOne },
    wallets: { find: mocks.walletFind },
    transactions: { updateOne: mocks.transactionUpdateOne },
    deviceTokens: { find: mocks.deviceFind },
    notificationJobs: { updateOne: mocks.notificationUpdateOne },
  }),
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.walletFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{
      _id: 'wallet-1', userId: 'user-1', name: 'Main', address: walletAddress,
    }]) });
    mocks.transactionUpdateOne.mockResolvedValue({ upsertedCount: 1 });
    mocks.deviceFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{
      _id: 'device-1', userId: 'user-1', token: 'push-token',
    }]) });
  });

  it('stores the slot and creates an idempotent notification job', async () => {
    await ingestParsedTransaction(transaction(), { provider: 'helius-parsed-stream' });

    expect(mocks.ingestionUpdateOne).toHaveBeenCalledWith(
      { provider: 'helius-parsed-stream', externalId: 'stream-signature' },
      expect.objectContaining({ $set: expect.objectContaining({ slot: 433_950_192 }) }),
      { upsert: true },
    );
    expect(mocks.transactionUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'wallet-1', txHash: 'stream-signature' }),
      expect.objectContaining({
        $max: { slot: 433_950_192 },
        $set: expect.objectContaining({ kind: 'balance', title: '−1 SOL' }),
        $setOnInsert: expect.objectContaining({ _id: expect.any(String), userId: 'user-1' }),
      }),
      { upsert: true },
    );
    expect(mocks.notificationUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ deviceTokenId: 'device-1' }),
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ status: 'pending' }) }),
      { upsert: true },
    );
  });

  it('does not enqueue another notification when the transaction already exists', async () => {
    mocks.transactionUpdateOne.mockResolvedValue({ upsertedCount: 0 });

    await ingestParsedTransaction(transaction(), { provider: 'helius-parsed-events' });

    expect(mocks.notificationUpdateOne).not.toHaveBeenCalled();
    expect(mocks.transactionUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ kind: 'balance' }) }),
      { upsert: true },
    );
  });

  it('ignores failed transactions before touching storage', async () => {
    await expect(ingestParsedTransaction(transaction({ status: 'error' }), {
      provider: 'helius-parsed-stream',
    })).resolves.toEqual({ activities: 0 });
    expect(mocks.ingestionUpdateOne).not.toHaveBeenCalled();
  });

  it('does not store or notify a pure unsigned dust receipt', async () => {
    const result = await ingestParsedTransaction(transaction({
      feePayer: 'sender',
      summary: { type: 'transfer' },
      nativeTransfers: [{ fromUserAccount: 'sender', toUserAccount: walletAddress, amount: 1_000 }],
      instructions: [{ programName: 'system', instructionName: 'transfer' }],
    }), { provider: 'helius-parsed-stream' });

    expect(result).toEqual({ activities: 0 });
    expect(mocks.ingestionUpdateOne).not.toHaveBeenCalled();
    expect(mocks.transactionUpdateOne).not.toHaveBeenCalled();
    expect(mocks.notificationUpdateOne).not.toHaveBeenCalled();
  });
});
