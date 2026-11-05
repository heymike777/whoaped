import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  telegramUpdates: { findOneAndUpdate: vi.fn(), updateOne: vi.fn() },
  telegramJobs: { findOneAndUpdate: vi.fn(), updateOne: vi.fn() },
  telegramChats: { findOne: vi.fn(), updateOne: vi.fn() },
  wallets: { findOne: vi.fn() },
}));
vi.mock('../db.js', () => ({ collections: async () => db }));
import { drainTelegramJobs } from '../services/telegram.js';
const job = { _id: 'j1', walletId: 'w1', chatId: '123', text: '<b>Bought TEST</b>', parseMode: 'HTML', buttons: [], attempts: 1 };
describe('Telegram delivery queue', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    db.telegramUpdates.findOneAndUpdate.mockResolvedValue(null);
    db.telegramJobs.findOneAndUpdate.mockResolvedValue(null).mockResolvedValueOnce(job);
    db.wallets.findOne.mockResolvedValue({ _id: 'w1' });
    db.telegramChats.findOne.mockResolvedValue({ _id: '123' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) }));
  });
  it('sends and marks a job sent, excluding the chat from the rest of the tick', async () => {
    await drainTelegramJobs();
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({ parse_mode: 'HTML', text: '<b>Bought TEST</b>' });
    expect(db.telegramJobs.updateOne).toHaveBeenCalledWith({ _id: 'j1' }, { $set: expect.objectContaining({ status: 'sent' }) });
    expect(db.telegramJobs.findOneAndUpdate.mock.calls[1][0].chatId).toEqual({ $nin: ['123'] });
  });
  it('drops pending alerts after removal without calling Telegram', async () => {
    db.wallets.findOne.mockResolvedValue(null); await drainTelegramJobs();
    expect(fetch).not.toHaveBeenCalled();
    expect(db.wallets.findOne).toHaveBeenCalledWith({ _id: 'w1', userId: 'telegram:123', deletedAt: null });
    expect(db.telegramJobs.updateOne).toHaveBeenCalledWith({ _id: 'j1' }, { $set: expect.objectContaining({ status: 'failed' }) });
  });
  it('delivers an account cooldown notice even without an active wallet', async () => {
    db.telegramJobs.findOneAndUpdate.mockReset().mockResolvedValue(null).mockResolvedValueOnce({ ...job, kind: 'account', userId: 'telegram:123' });
    db.wallets.findOne.mockResolvedValue(null);
    await drainTelegramJobs();
    expect(fetch).toHaveBeenCalledOnce();
    expect(db.wallets.findOne).not.toHaveBeenCalled();
    expect(db.telegramJobs.updateOne).toHaveBeenCalledWith({ _id: 'j1' }, { $set: expect.objectContaining({ status: 'sent' }) });
    expect(db.telegramJobs.findOneAndUpdate.mock.calls[0][2].sort).toEqual({ priority: -1, createdAt: 1 });
  });
  it('delivers a Discovery report only to its bound chat without a tracked wallet', async () => {
    db.telegramJobs.findOneAndUpdate.mockReset().mockResolvedValue(null).mockResolvedValueOnce({ ...job, kind: 'discovery', userId: 'telegram:123', text: 'Спарсено сейчас: 563' });
    db.wallets.findOne.mockResolvedValue(null);
    await drainTelegramJobs();
    expect(fetch).toHaveBeenCalledOnce();
    expect(db.wallets.findOne).not.toHaveBeenCalled();
    expect(db.telegramJobs.updateOne).toHaveBeenCalledWith({ _id: 'j1' }, { $set: expect.objectContaining({ status: 'sent' }) });
  });
  it('retries rate limits after retry_after and stops the tick', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 60 } }) } as Response);
    const start = Date.now(); await drainTelegramJobs();
    const set = db.telegramJobs.updateOne.mock.calls[0][1].$set;
    expect(set.status).toBe('pending'); expect(set.availableAt.getTime()).toBeGreaterThanOrEqual(start + 60_000);
    expect(db.telegramJobs.findOneAndUpdate).toHaveBeenCalledOnce();
  });
  it('disables blocked chats and records a terminal failure', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, json: async () => ({ ok: false, error_code: 403 }) } as Response);
    await drainTelegramJobs();
    expect(db.telegramChats.updateOne).toHaveBeenCalledWith({ _id: '123' }, { $set: { disabledAt: expect.any(Date) } });
    expect(db.telegramJobs.updateOne).toHaveBeenCalledWith({ _id: 'j1' }, { $set: expect.objectContaining({ status: 'failed' }) });
  });
  it('retries network errors without logging a token-bearing URL', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('secret URL')); await drainTelegramJobs();
    expect(db.telegramJobs.updateOne).toHaveBeenCalledWith({ _id: 'j1' }, { $set: expect.objectContaining({ status: 'pending', lastError: 'Telegram API error 503' }) });
  });
});
