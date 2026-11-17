import type { ClientSession } from 'mongodb';
import type { Collections, TelegramAnalyticsEventDocument } from '../db.js';

// No message text, wallet address, username or callback payload is stored.
export function interactionLabel(command: string, callback: boolean): Pick<TelegramAnalyticsEventDocument, 'command' | 'surface'> {
  const known = new Set(['start', 'help', 'add', 'remove', 'wallets', 'portfolio', 'settings', 'premium', 'cancel', 'terms', 'paysupport', 'purchase', 'connect', 'cancel-connect', 'discoveryreports']);
  if (callback) {
    const label = command.split(':')[0] || 'unknown';
    return { command: known.has(label) ? label : 'other', surface: 'button' };
  }
  if (command.startsWith('/')) {
    const label = command.slice(1);
    return { command: known.has(label) ? label : 'other', surface: 'command' };
  }
  return { surface: 'message' };
}

export async function recordTelegramEvent(db: Collections, updateId: number, chatId: string,
  type: TelegramAnalyticsEventDocument['type'], suffix = '', details: Pick<TelegramAnalyticsEventDocument, 'command' | 'surface' | 'userStatus'> = {}, session?: ClientSession) {
  const event: TelegramAnalyticsEventDocument = {
    _id: `${updateId}:${type}:${suffix}`, chatId, type, ...details, occurredAt: new Date(),
  };
  // The Telegram update ID is globally unique for this bot. Retries cannot double-count.
  await db.telegramAnalyticsEvents.updateOne({ _id: event._id }, { $setOnInsert: event }, { upsert: true, ...(session ? { session } : {}) });
}

export type TelegramDailyAnalytics = {
  date: string; activeUsers: number; newUsers: number; returningUsers: number;
  interactions: number; commands: number; buttonTaps: number;
  walletsAdded: number; walletsRemoved: number; commandsByName: Record<string, number>;
};

export async function telegramDailyAnalytics(db: Collections, days = 30, now = new Date()): Promise<TelegramDailyAnalytics[]> {
  const count = Math.max(1, Math.min(366, Math.trunc(days)));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - (count - 1) * 86_400_000);
  const events = await db.telegramAnalyticsEvents.find({ occurredAt: { $gte: since } }, {
    projection: { _id: 0, chatId: 1, type: 1, command: 1, surface: 1, occurredAt: 1 },
  }).toArray();
  const activeChatIds = [...new Set(events.filter(event => event.type === 'interaction').map(event => event.chatId))];
  const chats = activeChatIds.length ? await db.telegramChats.find({ _id: { $in: activeChatIds } }, {
    projection: { _id: 1, createdAt: 1 },
  }).toArray() : [];
  const firstSeen = new Map(chats.map(chat => [chat._id, chat.createdAt.toISOString().slice(0, 10)]));
  const result = Array.from({ length: count }, (_, index) => ({
    date: new Date(today - (count - index - 1) * 86_400_000).toISOString().slice(0, 10),
    activeUsers: 0, newUsers: 0, returningUsers: 0, interactions: 0, commands: 0,
    buttonTaps: 0, walletsAdded: 0, walletsRemoved: 0, commandsByName: {} as Record<string, number>,
  }));
  const byDate = new Map(result.map(day => [day.date, day]));
  const active = new Map<string, Set<string>>();
  for (const event of events) {
    const date = event.occurredAt.toISOString().slice(0, 10);
    const day = byDate.get(date);
    if (!day) continue;
    if (event.type === 'wallet_added') day.walletsAdded++;
    else if (event.type === 'wallet_removed') day.walletsRemoved++;
    else {
      day.interactions++;
      if (!active.has(date)) active.set(date, new Set());
      active.get(date)!.add(event.chatId);
      if (event.surface === 'command') day.commands++;
      if (event.surface === 'button') day.buttonTaps++;
      if (event.command) day.commandsByName[event.command] = (day.commandsByName[event.command] ?? 0) + 1;
    }
  }
  for (const day of result) {
    for (const chatId of active.get(day.date) ?? []) {
      day.activeUsers++;
      if (firstSeen.get(chatId) === day.date) day.newUsers++;
      else day.returningUsers++;
    }
  }
  return result;
}
