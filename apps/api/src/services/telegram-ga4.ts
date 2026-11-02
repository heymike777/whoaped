import { createHmac } from 'node:crypto';
import { collections, type TelegramAnalyticsEventDocument } from '../db.js';

type Config = { measurementId: string; apiSecret: string; identitySecret: string };
let warnedAboutConfig = false;

function config(): Config | null {
  const measurementId = process.env.GA4_TELEGRAM_MEASUREMENT_ID ?? '';
  const apiSecret = process.env.GA4_TELEGRAM_API_SECRET ?? '';
  const identitySecret = process.env.INTERNAL_JOB_SECRET ?? '';
  if (!measurementId && !apiSecret) return null;
  if (!/^G-[A-Z0-9]+$/.test(measurementId) || !apiSecret || !identitySecret) {
    if (!warnedAboutConfig) console.error('Telegram GA4 disabled: configure GA4_TELEGRAM_MEASUREMENT_ID, GA4_TELEGRAM_API_SECRET and INTERNAL_JOB_SECRET');
    warnedAboutConfig = true;
    return null;
  }
  return { measurementId, apiSecret, identitySecret };
}

export function telegramGa4Payload(event: TelegramAnalyticsEventDocument, identitySecret: string) {
  const clientId = createHmac('sha256', identitySecret).update(`telegram:${event.chatId}`).digest('hex').slice(0, 32);
  const name = event.type === 'interaction' ? 'telegram_interaction'
    : event.type === 'wallet_added' ? 'telegram_wallet_added' : 'telegram_wallet_removed';
  return {
    client_id: clientId,
    timestamp_micros: event.occurredAt.getTime() * 1000,
    events: [{ name, params: {
      engagement_time_msec: 1,
      session_id: Math.floor(event.occurredAt.getTime() / 1_800_000),
      ...(event.type === 'interaction' ? { surface: event.surface ?? 'message', user_status: event.userStatus ?? 'unknown',
        ...(event.command ? { command_name: event.command } : {}) } : {}),
    } }],
  };
}

export async function drainTelegramGa4Events() {
  const settings = config();
  if (!settings) return;
  const db = await collections();
  const now = new Date();
  const event = await db.telegramAnalyticsEvents.findOneAndUpdate({
    occurredAt: { $gte: new Date(now.getTime() - 71 * 60 * 60 * 1000) },
    $or: [{ gaStatus: { $exists: false } }, { gaStatus: 'pending', gaAvailableAt: { $lte: now } },
      { gaStatus: 'processing', gaAvailableAt: { $lte: now } }],
  }, { $set: { gaStatus: 'processing', gaAvailableAt: new Date(now.getTime() + 60_000) }, $inc: { gaAttempts: 1 } },
  { sort: { occurredAt: 1 }, returnDocument: 'after' });
  if (!event) return;
  try {
    const url = new URL('https://www.google-analytics.com/mp/collect');
    url.searchParams.set('measurement_id', settings.measurementId);
    url.searchParams.set('api_secret', settings.apiSecret);
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramGa4Payload(event, settings.identitySecret)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GA4 HTTP ${response.status}`);
    await db.telegramAnalyticsEvents.updateOne({ _id: event._id }, { $set: { gaStatus: 'sent', gaSentAt: new Date() } });
  } catch (error) {
    const delay = Math.min(300_000, 5_000 * 2 ** Math.min(event.gaAttempts ?? 1, 6));
    await db.telegramAnalyticsEvents.updateOne({ _id: event._id }, {
      $set: { gaStatus: 'pending', gaAvailableAt: new Date(Date.now() + delay) },
    });
    console.error('Telegram GA4 delivery failed', error instanceof Error ? error.message : 'Unknown error');
  }
}
