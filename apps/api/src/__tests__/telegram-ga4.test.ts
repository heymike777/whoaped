import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ claim: vi.fn(), save: vi.fn() }));
vi.mock('../db.js', () => ({ collections: async () => ({ telegramAnalyticsEvents: {
  findOneAndUpdate: mocks.claim, updateOne: mocks.save,
} }) }));
import { drainTelegramGa4Events, telegramGa4Payload } from '../services/telegram-ga4.js';
import type { TelegramAnalyticsEventDocument } from '../db.js';

describe('Telegram GA4 payload', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const event: TelegramAnalyticsEventDocument = {
    _id: '17:interaction:', chatId: '123456', type: 'interaction', command: 'add',
    surface: 'command', userStatus: 'new', occurredAt: new Date('2026-11-02T12:00:00Z'),
  };

  it('uses a stable pseudonymous client ID and supported event parameters', () => {
    const payload = telegramGa4Payload(event, 'server-only-secret');
    expect(payload.client_id).toHaveLength(32);
    expect(JSON.stringify(payload)).not.toContain(event.chatId);
    expect(payload).toMatchObject({
      timestamp_micros: event.occurredAt.getTime() * 1000,
      events: [{ name: 'telegram_interaction', params: { command_name: 'add', surface: 'command', user_status: 'new', engagement_time_msec: 1 } }],
    });
    expect(telegramGa4Payload(event, 'server-only-secret').client_id).toBe(payload.client_id);
    expect(telegramGa4Payload(event, 'different-secret').client_id).not.toBe(payload.client_id);
  });

  it('does not include wallet addresses or Telegram text', () => {
    expect(telegramGa4Payload({ ...event, type: 'wallet_added' }, 'secret').events[0].name).toBe('telegram_wallet_added');
    expect(telegramGa4Payload({ ...event, type: 'wallet_removed' }, 'secret').events[0].name).toBe('telegram_wallet_removed');
  });

  it('delivers queued events to a separate web stream without leaking the raw chat ID', async () => {
    vi.stubEnv('GA4_TELEGRAM_MEASUREMENT_ID', 'G-TEST123');
    vi.stubEnv('GA4_TELEGRAM_API_SECRET', 'private-secret');
    vi.stubEnv('INTERNAL_JOB_SECRET', 'identity-secret');
    mocks.claim.mockResolvedValue({ ...event, occurredAt: new Date() });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    await drainTelegramGa4Events();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('measurement_id=G-TEST123');
    expect(String(url)).toContain('api_secret=private-secret');
    expect(JSON.stringify(options?.body)).not.toContain(event.chatId);
    expect(mocks.save).toHaveBeenCalledWith({ _id: event._id }, { $set: expect.objectContaining({ gaStatus: 'sent' }) });
  });
});
