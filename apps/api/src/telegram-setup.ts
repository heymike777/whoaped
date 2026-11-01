import { telegramCall, telegramWebhookSecret } from './services/telegram.js';

const origin = new URL(process.env.TELEGRAM_PUBLIC_URL ?? 'https://api.whoaped.com');
if (origin.protocol !== 'https:') throw new Error('TELEGRAM_PUBLIC_URL must use HTTPS');
const url = new URL('/telegram/webhook', origin).toString();
const secret = telegramWebhookSecret();
// A malformed authenticated request confirms the deployed endpoint and token before switching delivery.
const probe = await fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
  body: '{}', signal: AbortSignal.timeout(15_000),
});
if (probe.status !== 400) throw new Error(`Deploy Telegram endpoint before setup (HTTP ${probe.status})`);
const bot = await telegramCall<{ username: string }>('getMe', {});
await telegramCall('setMyCommands', { commands: [
  { command: 'start', description: 'Start tracking Solana wallets' },
  { command: 'add', description: 'Add one or many wallets' },
  { command: 'remove', description: 'Remove one or many wallets' },
  { command: 'wallets', description: 'List and manage tracked wallets' },
  { command: 'cancel', description: 'Cancel wallet input' },
  { command: 'help', description: 'Show commands' },
] });
await telegramCall('setMyDescription', { description: 'Track Solana wallets with WhoAped. Get transaction notifications and quick token links to BONKbot, GMGN, FOMO and DexScreener. Add a wallet to start.' });
await telegramCall('setWebhook', { url, secret_token: secret, max_connections: 1, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
const webhook = await telegramCall<{ url: string; pending_update_count: number; last_error_message?: string }>('getWebhookInfo', {});
console.log(JSON.stringify({ bot: `https://t.me/${bot.username}`, webhook: webhook.url, pendingUpdates: webhook.pending_update_count, lastError: webhook.last_error_message }));
