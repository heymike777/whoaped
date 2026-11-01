import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ walletUpdate: vi.fn(), walletCount: vi.fn(), jobUpdate: vi.fn(), chatUpdate: vi.fn(), walletFind: vi.fn(), chatFind: vi.fn(), updateFind: vi.fn(), updateSave: vi.fn() }));
vi.mock('../db.js', () => ({ collections: async () => ({
  wallets: { updateOne: mocks.walletUpdate, countDocuments: mocks.walletCount, findOne: mocks.walletFind },
  telegramChats: { updateOne: mocks.chatUpdate, findOne: mocks.chatFind }, telegramUpdates: { findOne: mocks.updateFind, updateOne: mocks.updateSave }, telegramJobs: { updateOne: mocks.jobUpdate },
}) }));
vi.mock('../services/token-metadata.js', () => ({ enrichActivityMetadata: async (a: unknown) => a }));
vi.mock('../services/accounts.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/accounts.js')>(),
  canonicalAccountId: async (userId: string) => userId,
  withAccountMutation: async (userId: string, work: Function) => work(await (await import('../db.js')).collections(), undefined, userId),
}));

import { authorizedTelegramWebhook, enqueueTelegramTransaction, handleTelegramUpdate, telegramNotification, telegramWebhookSecret, validSolanaAddress } from '../services/telegram.js';
import type { WalletDocument } from '../db.js';
import type { NormalizedActivity } from '../chains/types.js';
const address = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';
const wallet: WalletDocument = { _id: 'w1', userId: 'telegram:123', name: 'Whale', address, chain: 'solana', status: 'active', createdAt: new Date(0) };
const transaction = { signature: 'sig', slot: 123, blockTime: 100 };
const activity: NormalizedActivity = { chain: 'solana', txHash: 'sig', eventIndex: 0, kind: 'swap', title: 'Bought TEST', detail: '1 SOL', occurredAt: new Date(), metadata: { tokenActions: [{ token: { mint: address, symbol: 'TEST' } }] } };
function update(text: string, chatId = 123, type = 'private') { return { update_id: 1, message: { text, chat: { id: chatId, type }, from: { id: chatId } } }; }
describe('Telegram tracker', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) }));
    mocks.walletCount.mockResolvedValue(0); mocks.walletUpdate.mockResolvedValue({ matchedCount: 1 });
  });
  it('authenticates webhooks with a token-derived secret', () => {
    expect(authorizedTelegramWebhook('')).toBe(false); expect(authorizedTelegramWebhook('wrong')).toBe(false);
    expect(authorizedTelegramWebhook(telegramWebhookSecret())).toBe(true);
  });
  it('validates decoded Solana key length', () => {
    expect(validSolanaAddress(address)).toBe(true);
    expect(validSolanaAddress('11111111111111111111111111111111')).toBe(true);
    expect(validSolanaAddress('111111111111111111111111111111111')).toBe(false);
    expect(validSolanaAddress('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
  });
  it('uses referral URLs and ticker labels for token buttons', () => {
    const notification = telegramNotification(wallet, transaction, [activity]);
    expect(notification.buttons.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'BonkBot: $TEST', url: expect.stringContaining(`ref_ceqh3_ca_${address}`) }),
      expect.objectContaining({ text: 'GMGN: $TEST', url: expect.stringContaining(`i_gSWRgmGL_c_${address}`) }),
    ])); expect(notification.text).toContain('Bought TEST');
  });
  it('retains generic and failed transactions', async () => {
    mocks.walletFind.mockResolvedValue(wallet);
    await enqueueTelegramTransaction(wallet, { ...transaction, status: 'error' }, []);
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ walletId: 'w1', txHash: 'sig' }, expect.objectContaining({ $setOnInsert: expect.objectContaining({ chatId: '123', text: expect.stringContaining('Failed transaction'), slot: 123 }) }), { upsert: true });
    expect(telegramNotification(wallet, transaction, []).text).toContain('On-chain transaction');
  });
  it('does not enqueue mobile wallets or transactions before tracking', async () => {
    await enqueueTelegramTransaction({ ...wallet, userId: 'mobile-user' }, transaction, []);
    await enqueueTelegramTransaction({ ...wallet, createdAt: new Date(200_000) }, transaction, []);
    expect(mocks.jobUpdate).not.toHaveBeenCalled();
  });
  it('adds wallets under the Telegram owner using stable command IDs', async () => {
    await handleTelegramUpdate(update(`/add ${address} Whale`));
    expect(mocks.walletUpdate).toHaveBeenCalledWith({ _id: 'tg:123:1:0' }, { $setOnInsert: expect.objectContaining({ userId: 'telegram:123', address, name: 'Whale', status: 'active' }) }, { upsert: true });
  });
  it('scopes removal to the current owner', async () => {
    await handleTelegramUpdate({ update_id: 2, callback_query: { id: 'cb', data: 'remove:other-wallet', from: { id: 123 }, message: { chat: { id: 123, type: 'private' } } } });
    expect(mocks.walletUpdate).toHaveBeenCalledWith({ _id: 'other-wallet', userId: 'telegram:123', deletedAt: null }, expect.anything(), { session: undefined });
  });
  it('ignores groups and callbacks from a different user', async () => {
    await handleTelegramUpdate(update(`/add ${address}`, -100, 'supergroup'));
    await handleTelegramUpdate({ update_id: 2, callback_query: { id: 'cb', data: 'remove:w1', from: { id: 456 }, message: { chat: { id: 123, type: 'private' } } } });
    expect(mocks.walletUpdate).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('bulk wallet conversation', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) }));
    mocks.walletCount.mockResolvedValue(0); mocks.walletUpdate.mockResolvedValue({ matchedCount: 1 });
  });
  it('prompts for multiple wallets and remembers add mode', async () => {
    await handleTelegramUpdate(update('/add'));
    expect(mocks.chatUpdate).toHaveBeenCalledWith({ _id: '123' }, { $set: { pendingAction: 'add' } });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).text).toContain('one per line');
    expect(mocks.walletUpdate).not.toHaveBeenCalled();
  });
  it('adds every line of a follow-up with independent stable IDs and multiword names', async () => {
    mocks.chatFind.mockResolvedValue({ pendingAction: 'add' });
    await handleTelegramUpdate(update(`${address} First whale\n11111111111111111111111111111111 System`));
    expect(mocks.walletUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.walletUpdate.mock.calls[0][0]).toEqual({ _id: 'tg:123:1:0' });
    expect(mocks.walletUpdate.mock.calls[0][1].$setOnInsert.name).toBe('First whale');
    expect(mocks.walletUpdate.mock.calls[1][0]).toEqual({ _id: 'tg:123:1:1' });
    expect(mocks.chatUpdate).toHaveBeenCalledWith({ _id: '123' }, { $unset: { pendingAction: '' } });
  });
  it('supports an inline multiline add and reports invalid or unnamed rows', async () => {
    await handleTelegramUpdate(update(`/add ${address} Whale\ninvalid Bad\n11111111111111111111111111111111`));
    expect(mocks.walletUpdate).toHaveBeenCalledTimes(1);
    const text = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).text;
    expect(text).toContain('Added 1 of 3'); expect(text).toContain('Line 2'); expect(text).toContain('Line 3');
  });
  it('prompts and removes multiple addresses from a follow-up under the current owner', async () => {
    await handleTelegramUpdate(update('/remove'));
    expect(mocks.chatUpdate).toHaveBeenCalledWith({ _id: '123' }, { $set: { pendingAction: 'remove' } });
    mocks.chatFind.mockResolvedValue({ pendingAction: 'remove' });
    await handleTelegramUpdate(update(`${address} Whale\n11111111111111111111111111111111`));
    expect(mocks.walletUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.walletUpdate.mock.calls[0][0]).toEqual({ address, userId: 'telegram:123', deletedAt: null });
    expect(mocks.walletUpdate.mock.calls[1][0].userId).toBe('telegram:123');
  });
  it('retains the remove action on retry after conversation state is cleared', async () => {
    mocks.updateFind.mockResolvedValue({ walletAction: 'remove' });
    await handleTelegramUpdate(update(address));
    expect(mocks.walletUpdate.mock.calls[0][0]).toEqual({ address, userId: 'telegram:123', deletedAt: null });
    expect(mocks.updateSave).toHaveBeenCalledWith({ _id: '1' }, { $set: { walletAction: 'remove' } });
  });
  it('does not offer a transactions command or history button', async () => {
    await handleTelegramUpdate(update('/start'));
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.text).not.toContain('/transactions');
    expect(JSON.stringify(payload.reply_markup)).not.toContain('history');
  });
  it('lets cancel exit remove mode', async () => {
    await handleTelegramUpdate(update('/cancel'));
    expect(mocks.chatUpdate).toHaveBeenCalledWith({ _id: '123' }, { $unset: { pendingAction: '' } });
    expect(mocks.walletUpdate).not.toHaveBeenCalled();
  });
});
