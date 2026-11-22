import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ingestionUpdateOne: vi.fn(),
  walletFind: vi.fn(),
  transactionUpdateOne: vi.fn(),
  deviceFind: vi.fn(),
  notificationUpdateOne: vi.fn(),
  usersFind: vi.fn(),
  userFindOne: vi.fn(),
  admit: vi.fn(),
}));

vi.mock('../db.js', () => ({
  hasDatabase: () => false,
  collections: async () => ({
    telegramChats: { findOne: vi.fn().mockResolvedValue(null) },
    users: { find: mocks.usersFind, findOne: mocks.userFindOne },
    ingestionEvents: { updateOne: mocks.ingestionUpdateOne },
    wallets: { find: mocks.walletFind, findOne: vi.fn().mockResolvedValue({ _id: 'wallet-1', userId: 'user-1', name: 'Main', address: '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe', chain: 'solana', createdAt: new Date(0) }) },
    transactions: { updateOne: mocks.transactionUpdateOne },
    deviceTokens: { find: mocks.deviceFind },
    notificationJobs: { updateOne: mocks.notificationUpdateOne },
  }),
}));

vi.mock('../services/accounts.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/accounts.js')>(),
  canonicalAccountId: async (userId: string) => userId,
  withAccountMutation: async (userId: string, work: Function) => work(await (await import('../db.js')).collections(), undefined, userId),
}));

vi.mock('../services/rate-limits.js', () => ({
  walletTrackingEligible: async () => true,
  admitAccountTransaction: mocks.admit,
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
    mocks.usersFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    mocks.userFindOne.mockResolvedValue({ trackFailedTransactions: true });
    mocks.admit.mockImplementation(async (userId: string) => ({ allowed: true, cooldownStarted: false, accountId: userId }));
    mocks.deviceFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{
      _id: 'device-1', userId: 'user-1', token: 'push-token',
    }]) });
  });

  it('stores the slot and creates an idempotent notification job', async () => {
    await ingestParsedTransaction(transaction(), {
      provider: 'helius-parsed-stream', streamTiming: { streamReceivedAt: 1000, streamProcessingStartedAt: 1200 },
    });

    expect(mocks.ingestionUpdateOne).toHaveBeenCalledWith(
      { provider: 'helius-parsed-stream', externalId: 'stream-signature' },
      expect.objectContaining({
        $set: expect.objectContaining({ slot: 433_950_192 }),
        $setOnInsert: expect.objectContaining({ streamReceivedAt: new Date(1000), streamProcessingStartedAt: new Date(1200) }),
      }),
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

  it('ignores failed transactions when opt-in is off', async () => {
    await expect(ingestParsedTransaction(transaction({ status: 'error' }), {
      provider: 'helius-parsed-stream',
    })).resolves.toEqual({ activities: 0 });
    expect(mocks.ingestionUpdateOne).not.toHaveBeenCalled();
    expect(mocks.notificationUpdateOne).not.toHaveBeenCalled();
  });

  it('stores and pushes failed transactions only after opt-in', async () => {
    mocks.usersFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: 'user-1' }]) });
    await expect(ingestParsedTransaction(transaction({ status: 'error' }), {
      provider: 'helius-parsed-stream',
    })).resolves.toEqual({ activities: 1 });
    expect(mocks.transactionUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: 'stream-signature' }),
      expect.objectContaining({ $set: expect.objectContaining({ kind: 'failed', title: 'Transaction failed' }) }),
      { upsert: true },
    );
    expect(mocks.notificationUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ failedTransaction: true }) }),
      { upsert: true },
    );
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
  it('does not ingest or alert on an unsigned USDC receipt below one cent', async () => {
    const result = await ingestParsedTransaction(transaction({
      feePayer: 'sender', summary: { type: 'token_transfer' }, nativeTransfers: [],
      tokenTransfers: [{ fromUserAccount: 'sender', toUserAccount: walletAddress,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', rawTokenAmount: 1_111, decimals: 6 }],
      instructions: [{ programName: 'token', instructionName: 'transfer_checked' }],
    }), { provider: 'helius-parsed-stream' });
    expect(result).toEqual({ activities: 0 });
    expect(mocks.ingestionUpdateOne).not.toHaveBeenCalled();
    expect(mocks.transactionUpdateOne).not.toHaveBeenCalled();
    expect(mocks.notificationUpdateOne).not.toHaveBeenCalled();
  });

  it('does not notify a read-only address about another wallet\'s Pump.fun swap', async () => {
    const creator = '9Xt9Zj9HoAh13MpoB6hmY9UZz37L4Jabtyn8zE7AAsL';
    const trader = '41g6ZszUMGqw5dDokJLDtGiyzpCoXYMR4BUscxaQeAtK';
    mocks.walletFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{
      _id: 'wallet-1', userId: 'user-1', name: 'heymike.sns', address: creator,
    }]) });
    const result = await ingestParsedTransaction(transaction({
      signature: '2wcGijtz5XZ8dVAJBtqD3d79FpGMxrUR5d9fPXuEjZcKcmBr7SvSdZtRgdkvrPwUZgwqrvNRP8QuQv2eoMprg3UQ',
      slot: 468_073_539, feePayer: trader, accountKeys: [trader, creator], nativeTransfers: [],
      summary: { type: 'swap', parsedData: { protocol: 'pump_fun_amm',
        input_mint: '8Uajau44UoTrk9tWYao8Ev8CWxq99w2h868BKav3bonk',
        output_mint: 'So11111111111111111111111111111111111111112',
        in_amount: '255083648', actual_out_amount: '167903529' } },
      tokenTransfers: [{ fromUserAccount: trader, toUserAccount: 'pool',
        mint: '8Uajau44UoTrk9tWYao8Ev8CWxq99w2h868BKav3bonk', rawTokenAmount: 255_083_648, decimals: 6 }],
      instructions: [{ programName: 'pump_amm', instructionName: 'buy_exact_quote_in',
        decoded: { accounts: [{ name: 'coin_creator', pubkey: creator, isSigner: false }] } },
      { programName: 'token', instructionName: 'close_account', rawAccounts: [trader, 'temporary-wsol-account'] }],
    }), { provider: 'helius-parsed-stream' });
    expect(result).toEqual({ activities: 0 });
    expect(mocks.ingestionUpdateOne).not.toHaveBeenCalled();
    expect(mocks.transactionUpdateOne).not.toHaveBeenCalled();
    expect(mocks.notificationUpdateOne).not.toHaveBeenCalled();
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it('still ingests an opaque transfer after RPC reveals the watched wallet received SOL', async () => {
    const recipient = 'heyRCBh8cD3GjtkdmW6PcNTqWUgJz67tgZ5GCvUNiqD';
    mocks.walletFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([{
      _id: 'wallet-1', userId: 'user-1', name: 'HeyWallet', address: recipient,
    }]) });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: {
      transaction: { message: { accountKeys: [{ pubkey: recipient }] } },
      meta: { preBalances: [6_963_371], postBalances: [529_108_371] },
    } }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('HELIUS_API_KEY', 'test-key');
    try {
      const result = await ingestParsedTransaction(transaction({
        signature: '3uDEpv8h6x1mkkbgZuvXJ7cppx36JeC3PD7dmZbtKD49cSmGvdgwYGs9mPRHfvJnPxkvgC57rHTTNbaWFbbbUpZJ',
        slot: 467_362_696, feePayer: 'other-payer', accountKeys: [recipient], nativeTransfers: [],
        instructions: [{ programId: 'opaque-program', instructionName: null, rawAccounts: [recipient] }],
      }), { provider: 'helius-parsed-stream' });
      expect(result).toEqual({ activities: 1 });
      expect(mocks.transactionUpdateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        $set: expect.objectContaining({ title: '+0.522145 SOL', metadata: expect.objectContaining({
          balanceChanges: ['+0.522145 SOL'],
        }) }),
      }), expect.anything());
      expect(mocks.notificationUpdateOne).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
