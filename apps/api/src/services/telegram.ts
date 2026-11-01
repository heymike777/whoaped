import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { z } from 'zod';

import { collections, type WalletDocument } from '../db.js';
import type { NormalizedActivity } from '../chains/types.js';
import type { ParsedSolanaTransaction } from '../chains/solana.js';
import { enrichActivityMetadata } from './token-metadata.js';
import { buildTokenActionLinks } from '../config/token-actions.js';

const messageSchema = z.object({
  chat: z.object({ id: z.number().int().safe(), type: z.string() }),
  from: z.object({ id: z.number().int().safe(), is_bot: z.boolean().optional() }).optional(),
  text: z.string().max(4096).optional(),
});
export const telegramUpdateSchema = z.object({
  update_id: z.number().int().safe().nonnegative(),
  message: messageSchema.optional(),
  callback_query: z.object({
    id: z.string(), data: z.string().max(64).optional(), message: messageSchema.optional(),
    from: z.object({ id: z.number().int().safe(), is_bot: z.boolean().optional() }),
  }).optional(),
});
type Update = z.infer<typeof telegramUpdateSchema>;
type Button = { text: string; url?: string; callback_data?: string };
const menu: Button[][] = [[{ text: '➕ Add wallet', callback_data: 'add' }, { text: '👛 Wallets', callback_data: 'wallets' }], [{ text: '📜 Transactions', callback_data: 'history' }]];
const help = 'WhoAped · Solana wallet tracker\n\n/add ADDRESS Name — track a wallet\n/remove ADDRESS — stop tracking\n/wallets — manage wallets\n/transactions — transaction history\n\nSend a Solana address to add it. Notifications start from now, including unclassified and failed transactions.';

export function telegramWebhookSecret(token = process.env.TELEGRAM_BOT_TOKEN ?? '') {
  return createHash('sha256').update(`whoaped:telegram:webhook:${token}`).digest('hex');
}
export function authorizedTelegramWebhook(received: string) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  const a = Buffer.from(received), b = Buffer.from(telegramWebhookSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}
export class TelegramError extends Error {
  constructor(public code: number, public retryAfter = 0) { super(`Telegram API error ${code}`); }
}
export async function telegramCall<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  // Do not log fetch errors: their URL can contain the bot token.
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new TelegramError(503); }
  let result: { ok?: boolean; result: T; error_code?: number; parameters?: { retry_after?: number } };
  try { result = await response.json() as typeof result; } catch { throw new TelegramError(502); }
  if (!response.ok || !result.ok) throw new TelegramError(result.error_code ?? response.status, result.parameters?.retry_after);
  return result.result;
}
async function send(chatId: string, text: string, buttons: Button[][] = menu) {
  await telegramCall('sendMessage', {
    chat_id: chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: buttons },
  });
}

export function validSolanaAddress(address: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const char of address) value = value * 58n + BigInt(alphabet.indexOf(char));
  let bytes = 0;
  while (value > 0n) { bytes++; value >>= 8n; }
  return bytes + (address.match(/^1*/)?.[0].length ?? 0) === 32;
}

export async function handleTelegramUpdate(update: Update) {
  const callback = update.callback_query;
  const message = callback?.message ?? update.message;
  const sender = callback?.from ?? message?.from;
  if (!message || message.chat.type !== 'private' || sender?.is_bot || sender?.id !== message.chat.id) return;
  const chatId = String(message.chat.id), userId = `telegram:${chatId}`;
  const db = await collections();
  await db.telegramChats.updateOne({ _id: chatId }, { $setOnInsert: { createdAt: new Date() }, $unset: { disabledAt: '' } }, { upsert: true });
  if (callback) await telegramCall('answerCallbackQuery', { callback_query_id: callback.id }).catch(() => {});
  const text = message.text?.trim() ?? '';
  const [rawCommand = '', ...args] = text.split(/\s+/);
  const command = callback?.data ?? rawCommand.toLowerCase().split('@')[0];
  if (['/start', '/help'].includes(command)) return send(chatId, help);
  if (command === 'add' || command === '/add' && !args.length) return send(chatId, 'Send /add ADDRESS Name\nExample: /add 11111111111111111111111111111111 System');
  if (command === '/add' || validSolanaAddress(rawCommand)) {
    const address = command === '/add' ? args.shift() ?? '' : rawCommand;
    if (!validSolanaAddress(address)) return send(chatId, 'Invalid Solana address. Use /add ADDRESS Name.');
    const name = args.join(' ').slice(0, 40) || `${address.slice(0, 4)}…${address.slice(-4)}`;
    if (await db.wallets.countDocuments({ userId, deletedAt: null }) >= 100) return send(chatId, 'Limit: 100 wallets. Remove a wallet first.');
    try {
      // Stable id makes a retried command safe, even after wallet removal.
      await db.wallets.updateOne({ _id: `tg:${chatId}:${update.update_id}` }, { $setOnInsert: {
        userId, name, address, chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
      } }, { upsert: true });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return send(chatId, 'This wallet is already being tracked.');
      throw error;
    }
    return send(chatId, `Tracking ${name}\n${address}\n\nNotifications will start within a few seconds.`);
  }
  if (command === '/remove' || command.startsWith('remove:')) {
    const selector = command.startsWith('remove:') ? { _id: command.slice(7) } : { address: args[0] ?? '' };
    const result = await db.wallets.updateOne({ ...selector, userId, deletedAt: null }, { $set: { deletedAt: new Date() } });
    return send(chatId, result.matchedCount ? 'Wallet removed. Notifications stopped.' : 'Wallet not found. Use /remove ADDRESS or /wallets.');
  }
  if (command === '/wallets' || command === 'wallets' || command.startsWith('wallets:')) {
    const page = Math.max(0, Math.min(100, Number(command.split(':')[1]) || 0));
    const wallets = await db.wallets.find({ userId, deletedAt: null }).sort({ createdAt: 1, _id: 1 }).skip(page * 10).limit(11).toArray();
    const rows = wallets.slice(0, 10);
    const buttons: Button[][] = rows.map(w => [{ text: `✖ ${w.name}`, callback_data: `remove:${w._id}` }]);
    if (wallets.length > 10) buttons.push([{ text: 'Next →', callback_data: `wallets:${page + 1}` }]);
    return send(chatId, rows.length ? rows.map(w => `${w.name}\n${w.address}`).join('\n\n') : 'No wallets yet. Use /add ADDRESS Name.', [...buttons, ...menu]);
  }
  if (command === '/transactions' || command === 'history' || command.startsWith('history:')) {
    const cursor = command.startsWith('history:') ? command.slice(8) : undefined;
    // UUID cursor resolves to a chat-owned record; clients cannot inspect another chat.
    const anchor = cursor ? await db.telegramJobs.findOne({ _id: cursor, chatId }) : null;
    const jobs = await db.telegramJobs.find({ chatId, ...(anchor ? { $or: [
      { createdAt: { $lt: anchor.createdAt } }, { createdAt: anchor.createdAt, _id: { $lt: anchor._id } },
    ] } : {}) }).sort({ createdAt: -1, _id: -1 }).limit(6).toArray();
    const rows = jobs.slice(0, 5);
    return send(chatId, rows.length ? rows.map(j => `${j.text.slice(0, 500)}\nhttps://solscan.io/tx/${j.txHash}`).join('\n\n') : 'No transactions since tracking started.', [
      ...(jobs.length > 5 ? [[{ text: 'Older transactions →', callback_data: `history:${rows[rows.length - 1]._id}` }]] : []), ...menu,
    ]);
  }
  return send(chatId, help);
}

export function telegramNotification(wallet: WalletDocument, transaction: ParsedSolanaTransaction, activities: NormalizedActivity[]) {
  const failed = transaction.status === 'error' || transaction.transactionStatus === 'ERROR';
  const at = new Date((transaction.blockTime ?? Date.now() / 1000) * 1000).toISOString();
  const text = `${wallet.name}\n${wallet.address}\n\n${failed ? '❌ Failed transaction' : activities.map(a => [a.title, a.detail].filter(Boolean).join('\n')).join('\n\n') || 'On-chain transaction'}\n\n${at}\nSlot: ${transaction.slot}`.slice(0, 4000);
  const buttons: Array<Array<{ text: string; url: string }>> = [];
  const seen = new Set<string>();
  for (const activity of activities) {
    const actions = activity.metadata.tokenActions;
    if (!Array.isArray(actions)) continue;
    for (const item of actions) {
      const token = item?.token;
      if (typeof token?.mint !== 'string' || seen.has(token.mint)) continue;
      seen.add(token.mint);
      const ticker = String(token.symbol ?? token.mint.slice(0, 6)).replace(/^\$/, '').slice(0, 24);
      const links = buildTokenActionLinks(token.mint).map(link => ({ text: `${link.id === 'bonkbot' ? 'BonkBot' : link.label}: $${ticker}`, url: link.url }));
      for (let i = 0; i < links.length; i += 2) buttons.push(links.slice(i, i + 2));
      if (seen.size >= 2) break;
    }
    if (seen.size >= 2) break;
  }
  buttons.push([{ text: 'View transaction ↗', url: `https://solscan.io/tx/${encodeURIComponent(transaction.signature)}` }]);
  return { text, buttons };
}

export async function enqueueTelegramTransaction(wallet: WalletDocument, transaction: ParsedSolanaTransaction, activities: NormalizedActivity[]) {
  if (!wallet.userId.startsWith('telegram:')) return;
  // Replay/backfill must not deliver transactions from before this subscription.
  if (transaction.blockTime && transaction.blockTime * 1000 < wallet.createdAt.getTime() - 1000) return;
  const fallback: NormalizedActivity = {
    chain: 'solana', txHash: transaction.signature, eventIndex: 0, kind: 'unknown',
    title: 'On-chain transaction', detail: transaction.summary?.description ?? '',
    occurredAt: new Date((transaction.blockTime ?? Date.now() / 1000) * 1000),
    metadata: { tokenCandidates: [
      ...(transaction.tokenTransfers ?? []).filter(t => t.fromUserAccount === wallet.address || t.toUserAccount === wallet.address),
      ...(transaction.accountData ?? []).filter(a => a.account === wallet.address).flatMap(a => a.tokenBalanceChanges ?? []),
    ] },
  };
  const enriched = await Promise.all((activities.length ? activities : [fallback]).map(enrichActivityMetadata));
  const db = await collections();
  const now = new Date();
  await db.telegramJobs.updateOne({ walletId: wallet._id, txHash: transaction.signature }, { $setOnInsert: {
    _id: randomUUID(), chatId: wallet.userId.slice(9), walletId: wallet._id,
    txHash: transaction.signature, slot: transaction.slot, ...telegramNotification(wallet, transaction, enriched),
    status: 'pending', attempts: 0, availableAt: now, createdAt: now,
  } }, { upsert: true });
}

export async function drainTelegramJobs() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const db = await collections();
  const chats: string[] = [];
  // One command at a time preserves order; one notification per chat per tick respects rate limits.
  const update = await db.telegramUpdates.findOneAndUpdate({ status: { $in: ['pending', 'processing'] }, availableAt: { $lte: new Date() } }, {
    $set: { status: 'processing', availableAt: new Date(Date.now() + 120_000) }, $inc: { attempts: 1 },
  }, { sort: { createdAt: 1 }, returnDocument: 'after' });
  if (update) {
    const payload = telegramUpdateSchema.parse(update.payload);
    const commandChat = payload.callback_query?.message?.chat ?? payload.message?.chat;
    if (commandChat) chats.push(String(commandChat.id));
    try {
      await handleTelegramUpdate(payload);
      await db.telegramUpdates.updateOne({ _id: update._id }, { $set: { status: 'sent' } });
    } catch (error) {
      const permanent = error instanceof TelegramError && [400, 403].includes(error.code);
      await db.telegramUpdates.updateOne({ _id: update._id }, { $set: {
        status: permanent ? 'failed' : 'pending', availableAt: new Date(Date.now() + Math.max(5, error instanceof TelegramError ? error.retryAfter : 0) * 1000),
      } });
    }
  }
  for (let i = 0; i < 20; i++) {
    const job = await db.telegramJobs.findOneAndUpdate({ status: { $in: ['pending', 'processing'] }, availableAt: { $lte: new Date() }, chatId: { $nin: chats } }, {
      $set: { status: 'processing', availableAt: new Date(Date.now() + 60_000) }, $inc: { attempts: 1 },
    }, { sort: { createdAt: 1 }, returnDocument: 'after' });
    if (!job) break;
    chats.push(job.chatId);
    try {
      const [wallet, chat] = await Promise.all([
        db.wallets.findOne({ _id: job.walletId, userId: `telegram:${job.chatId}`, deletedAt: null }),
        db.telegramChats.findOne({ _id: job.chatId }),
      ]);
      if (!wallet || !chat || chat.disabledAt) {
        await db.telegramJobs.updateOne({ _id: job._id }, { $set: { status: 'failed', lastError: 'Subscription inactive' } });
        continue;
      }
      await send(job.chatId, job.text, job.buttons);
      await db.telegramJobs.updateOne({ _id: job._id }, { $set: { status: 'sent', sentAt: new Date() } });
    } catch (error) {
      const apiError = error instanceof TelegramError ? error : undefined;
      if (apiError?.code === 403) await db.telegramChats.updateOne({ _id: job.chatId }, { $set: { disabledAt: new Date() } });
      await db.telegramJobs.updateOne({ _id: job._id }, { $set: {
        status: apiError && [400, 403].includes(apiError.code) ? 'failed' : 'pending',
        availableAt: new Date(Date.now() + Math.max(apiError?.retryAfter ?? 0, Math.min(3600, 2 ** Math.min(job.attempts, 12))) * 1000),
        lastError: apiError?.message ?? 'Telegram delivery unavailable',
      } });
      if (apiError?.code === 429) break;
    }
  }
}
