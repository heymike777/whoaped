import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ walletUpdate: vi.fn(), walletCount: vi.fn(), jobUpdate: vi.fn(), chatUpdate: vi.fn() }));
vi.mock('../db.js', () => ({ collections: async () => ({
  wallets: { updateOne: mocks.walletUpdate, countDocuments: mocks.walletCount },
  telegramChats: { updateOne: mocks.chatUpdate }, telegramJobs: { updateOne: mocks.jobUpdate },
}) }));
vi.mock('../services/token-metadata.js', () => ({ enrichActivityMetadata: async (a: unknown) => a }));
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
    vi.clearAllMocks(); vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
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
    expect(mocks.walletUpdate).toHaveBeenCalledWith({ _id: 'tg:123:1' }, { $setOnInsert: expect.objectContaining({ userId: 'telegram:123', address, name: 'Whale', status: 'active' }) }, { upsert: true });
  });
  it('scopes removal to the current owner', async () => {
    await handleTelegramUpdate({ update_id: 2, callback_query: { id: 'cb', data: 'remove:other-wallet', from: { id: 123 }, message: { chat: { id: 123, type: 'private' } } } });
    expect(mocks.walletUpdate).toHaveBeenCalledWith({ _id: 'other-wallet', userId: 'telegram:123', deletedAt: null }, expect.anything());
  });
  it('ignores groups and callbacks from a different user', async () => {
    await handleTelegramUpdate(update(`/add ${address}`, -100, 'supergroup'));
    await handleTelegramUpdate({ update_id: 2, callback_query: { id: 'cb', data: 'remove:w1', from: { id: 456 }, message: { chat: { id: 123, type: 'private' } } } });
    expect(mocks.walletUpdate).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
