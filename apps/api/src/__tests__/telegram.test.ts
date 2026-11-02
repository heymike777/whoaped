import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ walletUpdate: vi.fn(), walletCount: vi.fn(), jobUpdate: vi.fn(), chatUpdate: vi.fn(), walletFind: vi.fn(), chatFind: vi.fn(), updateFind: vi.fn(), updateSave: vi.fn(), userFind: vi.fn(), userUpdate: vi.fn() }));
vi.mock('../db.js', () => ({ collections: async () => ({
  wallets: { updateOne: mocks.walletUpdate, countDocuments: mocks.walletCount, findOne: mocks.walletFind },
  telegramChats: { updateOne: mocks.chatUpdate, findOne: mocks.chatFind }, telegramUpdates: { findOne: mocks.updateFind, updateOne: mocks.updateSave }, telegramJobs: { updateOne: mocks.jobUpdate },
  users: { findOne: mocks.userFind, updateOne: mocks.userUpdate },
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
    mocks.userFind.mockResolvedValue({ trackFailedTransactions: true });
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
    expect(notification.parseMode).toBe('HTML');
    expect(notification.text).not.toContain('Slot:');
    expect(notification.text).not.toContain(wallet.address);
  });
  it('retains generic and failed transactions', async () => {
    mocks.walletFind.mockResolvedValue(wallet);
    await enqueueTelegramTransaction(wallet, { ...transaction, status: 'error' }, []);
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ walletId: 'w1', txHash: 'sig' }, expect.objectContaining({ $setOnInsert: expect.objectContaining({ chatId: '123', text: expect.stringContaining('FAILED TRANSACTION'), slot: 123 }) }), { upsert: true });
    expect(telegramNotification(wallet, { ...transaction, status: 'error' }, []).text.startsWith('🔴 <b>FAILED TRANSACTION</b>')).toBe(true);
    expect(telegramNotification(wallet, transaction, []).text).toContain('<b>ACTIVITY</b>');
    expect(telegramNotification(wallet, { ...transaction, status: 'error', feePayer: address, fee: 5000 }, []).text)
      .toContain('<b>Balance changes</b>\n• <code>−0.000005 SOL</code>');
  });
  it('structures a swap into an action and wallet-scoped balance section', () => {
    const swap: NormalizedActivity = { ...activity, metadata: { swap: {
      dex: 'jupiter', dexName: 'Jupiter',
      input: { mint: 'SOL', symbol: 'SOL', amount: 1 }, output: { mint: 'USDC', symbol: 'USDC', amount: 98.5 },
    } }, source: 'Jupiter' };
    const text = telegramNotification(wallet, { ...transaction, feePayer: address, fee: 5000,
      nativeBalanceChanges: { [address]: -1000005000 },
      tokenTransfers: [{ toUserAccount: address, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', rawTokenAmount: '98500000', decimals: 6 }],
    }, [swap]).text;
    expect(text).toContain('🔁 <b>SWAP</b> · Jupiter');
    expect(text).toContain('<b>1 SOL</b>  →  <b>98.5 USDC</b>');
    expect(text).toContain('• <code>−1.000005 SOL</code>');
    expect(text).toContain('• <code>+98.5 USDC</code>');
  });
  it('shows transfer recipients without dumping a long raw description', () => {
    const recipient = 'Recipient111111111111111111111111111111111';
    const text = telegramNotification(wallet, { ...transaction, feePayer: address, fee: 5000,
      nativeTransfers: [{ fromUserAccount: address, toUserAccount: recipient, amount: 10000000 }],
    }, [{ ...activity, kind: 'balance', title: '−0.010005 SOL', detail: 'Balance change', metadata: {} }],
    new Map([[recipient, 'Cashflow Fees']])).text;
    expect(text).toContain('💸 <b>TRANSFER</b>');
    expect(text).toContain('↳ <b>0.01 SOL</b> → <b>Cashflow Fees</b>  <code>Recipi…11111</code>');
    expect(text).toContain('• <code>−0.010005 SOL</code>');
  });
  it('escapes wallet and token text before sending Telegram HTML', () => {
    const text = telegramNotification({ ...wallet, name: 'Alice <admin> & Bob' }, transaction,
      [{ ...activity, kind: 'nft', title: 'Minted <fake> NFT', metadata: {} }]).text;
    expect(text).toContain('Alice &lt;admin&gt; &amp; Bob');
    expect(text).toContain('Minted &lt;fake&gt; NFT');
    expect(text).not.toContain('<fake>');
  });
  it('shows the failed-transaction setting in the bot', async () => {
    mocks.userFind.mockResolvedValue({ trackFailedTransactions: false });
    await handleTelegramUpdate(update('/settings'));
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.text).toContain('Failed onchain transactions: Off');
    expect(payload.reply_markup.inline_keyboard.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ callback_data: 'settings:failed:on' }),
    ]));
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
    mocks.userFind.mockResolvedValue({ trackFailedTransactions: true });
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
