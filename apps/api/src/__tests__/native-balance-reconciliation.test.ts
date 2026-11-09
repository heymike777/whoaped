import { afterEach, describe, expect, it, vi } from 'vitest';

import { solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';
import type { TransactionDocument, WalletDocument } from '../db.js';
import { reclassifyStoredActivities } from '../services/activity-reclassification.js';
import { reconcileNativeBalanceChanges } from '../services/native-balance-reconciliation.js';
import { formatTelegramActivity } from '../services/telegram-activity-format.js';
import { transactionBalanceLines } from '../services/transaction-balances.js';

const signature = '3xjqax8cPC3wZQNekQiDaqRdTMJTVtZDYyzKharQZd2zNvASADLYXHBQRe2d7U3ftVemqNeTnpF81PY8o5V91f8V';
const wallet = 'kFee8WRgfV6CwNxFS4QzhqyMLm3ZMbpyshZakRGPiic';
const parsed: ParsedSolanaTransaction = {
  signature,
  slot: 464_029_983,
  feePayer: wallet,
  fee: 155_000,
  nativeTransfers: [
    { fromUserAccount: wallet, toUserAccount: '6QmDAuijEyXSyY1sfkqhcHDtwGnyASkyJKjdSKS5n41v', amount: 1_762_760 },
    { fromUserAccount: wallet, toUserAccount: 'BbiosAugyx1n5umt89bwEXGnYSMn5rJm3RNu8X8TPE3o', amount: 2_956_560 },
    { fromUserAccount: wallet, toUserAccount: '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE', amount: 1_000_000 },
  ],
  instructions: [
    { programName: 'squads_multisig_program', instructionName: 'config_transaction_create' },
    { programName: 'squads_multisig_program', instructionName: 'config_transaction_accounts_close' },
  ],
};

function mockRpc() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: {
      transaction: { message: { accountKeys: [{ pubkey: wallet }] } },
      meta: { preBalances: [511_698_943], postBalances: [513_070_423] },
    } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('HELIUS_API_KEY', 'test-key');
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('native SOL balance reconciliation', () => {
  it('uses the exact pre/post balance for the Squads rent-refund transaction', async () => {
    const fetchMock = mockRpc();
    expect(solanaAdapter.normalize(parsed, wallet)[0].title).toBe('−0.00587432 SOL');

    const corrected = await reconcileNativeBalanceChanges(parsed, [wallet]);

    expect(corrected.nativeBalanceChanges?.[wallet]).toBe(1_371_480);
    expect(solanaAdapter.normalize(corrected, wallet)[0].title).toBe('+0.00137148 SOL');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).params[1].maxSupportedTransactionVersion).toBe(1);
    expect(await reconcileNativeBalanceChanges(corrected, [wallet])).toBe(corrected);
  });

  it('includes the network fee for an ordinary outgoing transfer without an RPC lookup', async () => {
    const fetchMock = mockRpc();
    const ordinary = { ...parsed, instructions: [{ programName: 'system', instructionName: 'transfer' }],
      nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'recipient', amount: 1_000_000 }] };
    expect(await reconcileNativeBalanceChanges(ordinary, [wallet])).toBe(ordinary);
    expect(solanaAdapter.normalize(ordinary, wallet)[0].title).toBe('−0.001155 SOL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recovers SOL received through an opaque program even when Parsed Events omits the transfer', async () => {
    const recipient = 'heyRCBh8cD3GjtkdmW6PcNTqWUgJz67tgZ5GCvUNiqD';
    const feePayer = 'W97m2N12NdSgWu3bppYCPHdXNwz15SDUZNoD5jNFaqH';
    const opaque = {
      signature: '3uDEpv8h6x1mkkbgZuvXJ7cppx36JeC3PD7dmZbtKD49cSmGvdgwYGs9mPRHfvJnPxkvgC57rHTTNbaWFbbbUpZJ',
      slot: 467_362_696,
      feePayer,
      fee: 165_000,
      nativeTransfers: [{ fromUserAccount: feePayer, toUserAccount: 'other-account', amount: 695_960 }],
      instructions: [{ programId: '9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD',
        programName: null, instructionName: null, rawAccounts: [feePayer, recipient] }],
    } satisfies ParsedSolanaTransaction;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: {
      transaction: { message: { accountKeys: [{ pubkey: feePayer }, { pubkey: recipient }] } },
      meta: { preBalances: [9392652888, 6_963_371], postBalances: [9391095968, 529_108_371] },
    } }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('HELIUS_API_KEY', 'test-key');

    expect(transactionBalanceLines(opaque, recipient, [])).toEqual(['Balance changes unavailable']);
    expect(solanaAdapter.normalize(opaque, recipient)).toEqual([]);

    const corrected = await reconcileNativeBalanceChanges(opaque, [recipient]);
    const activities = solanaAdapter.normalize(corrected, recipient);
    const watched = { _id: 'wallet-2', userId: 'user-1', name: 'HeyWallet', address: recipient,
      chain: 'solana', status: 'active', createdAt: new Date() } as WalletDocument;

    expect(corrected.nativeBalanceChanges?.[recipient]).toBe(522_145_000);
    expect(activities[0]).toMatchObject({ kind: 'balance', title: '+0.522145 SOL' });
    expect(transactionBalanceLines(corrected, recipient, activities)).toEqual(['+0.522145 SOL']);
    expect(formatTelegramActivity(watched, corrected, activities)).toContain('• <code>+0.522145 SOL</code>');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('repairs an already stored wrong-sign balance from the saved parsed event', async () => {
    mockRpc();
    const stored = {
      _id: 'tx-1', userId: 'user-1', walletId: 'wallet-1', chain: 'solana',
      txHash: signature, eventIndex: 0, slot: parsed.slot, kind: 'balance',
      title: '−0.00571932 SOL', detail: 'Balance change',
      occurredAt: new Date(), metadata: {}, createdAt: new Date(),
    } as TransactionDocument;
    const watched = {
      _id: 'wallet-1', userId: 'user-1', name: 'Kinbay Admin Fee Payer', address: wallet,
      chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
    } as WalletDocument;
    const updateEvent = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const updateTransaction = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      ingestionEvents: { find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: 'event-1', externalId: signature, payload: parsed }]),
      }) }), updateOne: updateEvent },
      transactions: { updateOne: updateTransaction },
    };

    const [corrected] = await reclassifyStoredActivities([stored], new Map([[watched._id, watched]]), db as never);

    expect(corrected.title).toBe('+0.00137148 SOL');
    expect(updateEvent).toHaveBeenCalledWith({ _id: 'event-1' }, expect.objectContaining({
      $set: { payload: expect.objectContaining({ nativeBalanceChanges: { [wallet]: 1_371_480 } }) },
    }));
    expect(updateTransaction).toHaveBeenCalledWith({ _id: 'tx-1' }, expect.objectContaining({
      $set: expect.objectContaining({ title: '+0.00137148 SOL' }),
    }));
  });
});
