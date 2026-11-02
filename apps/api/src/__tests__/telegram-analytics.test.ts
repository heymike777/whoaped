import { describe, expect, it, vi } from 'vitest';
import type { Collections } from '../db.js';
import { interactionLabel, recordTelegramEvent, telegramDailyAnalytics } from '../services/telegram-analytics.js';

describe('Telegram analytics', () => {
  it('classifies commands, buttons and free-form messages without storing payloads', () => {
    expect(interactionLabel('/add', false)).toEqual({ command: 'add', surface: 'command' });
    expect(interactionLabel('settings:failed:on', true)).toEqual({ command: 'settings', surface: 'button' });
    expect(interactionLabel('wallet-address', false)).toEqual({ surface: 'message' });
  });

  it('uses stable IDs for retried updates', async () => {
    const updateOne = vi.fn();
    const db = { telegramAnalyticsEvents: { updateOne } } as unknown as Collections;
    await recordTelegramEvent(db, 17, '123', 'wallet_added', '1');
    await recordTelegramEvent(db, 17, '123', 'wallet_added', '1');
    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(updateOne.mock.calls[0][0]).toEqual({ _id: '17:wallet_added:1' });
    expect(updateOne.mock.calls[1][0]).toEqual({ _id: '17:wallet_added:1' });
    expect(updateOne.mock.calls[0][1].$setOnInsert).not.toHaveProperty('text');
  });

  it('counts daily unique users, new and returning, commands, buttons and wallet changes', async () => {
    const at = (date: string) => new Date(`${date}T12:00:00Z`);
    const events = [
      { chatId: 'new', type: 'interaction', command: 'start', surface: 'command', occurredAt: at('2026-11-02') },
      { chatId: 'new', type: 'interaction', command: 'add', surface: 'button', occurredAt: at('2026-11-02') },
      { chatId: 'old', type: 'interaction', command: 'wallets', surface: 'command', occurredAt: at('2026-11-02') },
      { chatId: 'new', type: 'wallet_added', occurredAt: at('2026-11-02') },
      { chatId: 'old', type: 'wallet_removed', occurredAt: at('2026-11-02') },
    ];
    const db = {
      telegramAnalyticsEvents: { find: vi.fn().mockReturnValue({ toArray: async () => events }) },
      telegramChats: { find: vi.fn().mockReturnValue({ toArray: async () => [
        { _id: 'new', createdAt: at('2026-11-02') }, { _id: 'old', createdAt: at('2026-10-31') },
      ] }) },
    } as unknown as Collections;
    const days = await telegramDailyAnalytics(db, 2, at('2026-11-02'));
    expect(days[0]).toMatchObject({ date: '2026-11-01', activeUsers: 0 });
    expect(days[1]).toMatchObject({
      date: '2026-11-02', activeUsers: 2, newUsers: 1, returningUsers: 1,
      interactions: 3, commands: 2, buttonTaps: 1, walletsAdded: 1, walletsRemoved: 1,
      commandsByName: { start: 1, add: 1, wallets: 1 },
    });
  });
});
