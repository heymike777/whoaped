import { closeDatabase, collections } from './db.js';
import { telegramDailyAnalytics } from './services/telegram-analytics.js';

const days = Number(process.argv[2] ?? 30);
if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('Usage: npm run analytics:telegram -- [1-366 days]');
try {
  const daily = await telegramDailyAnalytics(await collections(), days);
  const totals = daily.reduce((value, day) => ({
    interactions: value.interactions + day.interactions,
    commands: value.commands + day.commands,
    walletsAdded: value.walletsAdded + day.walletsAdded,
    walletsRemoved: value.walletsRemoved + day.walletsRemoved,
    newUsers: value.newUsers + day.newUsers,
  }), { interactions: 0, commands: 0, walletsAdded: 0, walletsRemoved: 0, newUsers: 0 });
  process.stdout.write(`${JSON.stringify({ timezone: 'UTC', days, totals, daily }, null, 2)}\n`);
} finally { await closeDatabase(); }
