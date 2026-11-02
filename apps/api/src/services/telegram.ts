import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { z } from 'zod';
import { BillingError } from '../config/premium.js';
import { answerStarsPreCheckout, billingCatalog, createBillingSupport, PAYMENT_TERMS, settleStarsPayment } from './billing.js';
import { TelegramError, telegramCall } from './telegram-api.js';

import { collections, type WalletDocument } from '../db.js';
import type { NormalizedActivity } from '../chains/types.js';
import type { ParsedSolanaTransaction } from '../chains/solana.js';
import { enrichActivityMetadata } from './token-metadata.js';
import { AccountLinkError, canonicalAccountId, confirmTelegramLink, linkHash, previewTelegramLink, setTrackFailedTransactions, withAccountMutation } from './accounts.js';
import { buildTokenActionLinks } from '../config/token-actions.js';
import { stakingOffer } from '../config/staking.js';
import { formatTelegramActivity } from './telegram-activity-format.js';
import { interactionLabel, recordTelegramEvent } from './telegram-analytics.js';

const starsPaymentSchema = z.object({ currency: z.string(), total_amount: z.number().int().positive(), invoice_payload: z.string().max(128), telegram_payment_charge_id: z.string().min(1).max(256) });
const messageSchema = z.object({
  chat: z.object({ id: z.number().int().safe(), type: z.string() }),
  from: z.object({ id: z.number().int().safe(), is_bot: z.boolean().optional(), username: z.string().optional() }).optional(),
  text: z.string().max(4096).optional(),
  successful_payment: starsPaymentSchema.optional(),
  refunded_payment: starsPaymentSchema.optional(),
});
export const telegramUpdateSchema = z.object({
  update_id: z.number().int().safe().nonnegative(),
  message: messageSchema.optional(),
  pre_checkout_query: z.object({ id: z.string(), from: z.object({ id: z.number().int().safe() }), currency: z.string(), total_amount: z.number().int().positive(), invoice_payload: z.string().max(128) }).optional(),
  callback_query: z.object({
    id: z.string(), data: z.string().max(64).optional(), message: messageSchema.optional(),
    from: z.object({ id: z.number().int().safe(), is_bot: z.boolean().optional(), username: z.string().optional() }),
  }).optional(),
});
type Update = z.infer<typeof telegramUpdateSchema>;
type Button = { text: string; url?: string; callback_data?: string };
const menu: Button[][] = [[{ text: '➕ Add wallets', callback_data: 'add' }, { text: '➖ Remove wallets', callback_data: 'remove' }], [{ text: '👛 Wallets', callback_data: 'wallets' }, { text: '⚙️ Settings', callback_data: 'settings' }], [{ text: '⭐ Premium', callback_data: 'premium' }]];
const help = 'WhoAped · Solana wallet tracker\n\n/add — add one or many wallets\n/remove — remove one or many wallets\n/wallets — manage wallets\n/settings — transaction preferences\n/cancel — cancel wallet input\n/premium — Premium status and token lock\n/paysupport — help with existing payments\n\nDetected confirmed transactions are sent directly to this chat. Failed onchain transactions are optional in /settings. Transactions that never land onchain cannot be detected.\n\nFree account limits: 20 transactions/minute, 100/hour, 300/day across all wallets. Exceeding a limit pauses tracking until quota becomes available. Transactions during a pause are not collected.';
const addPrompt = 'Send one or many wallets, one per line, in this format:\nADDRESS Name\nADDRESS Another name\n\nYou can also send /add followed by the list. Use /cancel to cancel.';
const removePrompt = 'Send the wallet addresses to remove, one per line:\nADDRESS\nADDRESS\n\nYou can also paste ADDRESS Name lines or send /remove followed by the list. Use /cancel to cancel.';

export function telegramWebhookSecret(token = process.env.TELEGRAM_BOT_TOKEN ?? '') {
  return createHash('sha256').update(`whoaped:telegram:webhook:${token}`).digest('hex');
}
export function authorizedTelegramWebhook(received: string) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  const a = Buffer.from(received), b = Buffer.from(telegramWebhookSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}
export { TelegramError, telegramCall } from './telegram-api.js';

async function send(chatId: string, text: string, buttons: Button[][] = menu, parseMode?: 'HTML') {
  await telegramCall('sendMessage', {
    chat_id: chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true },
    ...(parseMode ? { parse_mode: parseMode } : {}),
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
  if (update.pre_checkout_query) { await answerStarsPreCheckout(update.pre_checkout_query); return; }
  const callback = update.callback_query;
  const message = callback?.message ?? update.message;
  const sender = callback?.from ?? message?.from;
  if (!message || message.chat.type !== 'private') return;
  if (message.refunded_payment) {
    await settleStarsPayment(String(message.chat.id), message.refunded_payment, true);
    return;
  }
  if (sender?.is_bot || sender?.id !== message.chat.id) return;
  const chatId = String(message.chat.id);
  const db = await collections();
  const telegramChat = await db.telegramChats.findOne({ _id: chatId });
  const userId = telegramChat?.userId ?? `telegram:${chatId}`;
  await db.telegramChats.updateOne({ _id: chatId }, { $setOnInsert: { createdAt: new Date() }, $unset: { disabledAt: '' } }, { upsert: true });
  if (callback) await telegramCall('answerCallbackQuery', { callback_query_id: callback.id }).catch(() => {});
  if (message.successful_payment) {
    try {
      const access = await settleStarsPayment(chatId, message.successful_payment);
      return send(chatId, `Payment confirmed. Premium is active until ${access.expiresAt?.toISOString()}. Your access is shared with the mobile app. No auto-renewal.`);
    } catch (error) {
      if (!(error instanceof BillingError)) throw error;
      const ticket = await createBillingSupport(userId, `Payment review: ${message.successful_payment.telegram_payment_charge_id}. ${error.message}`);
      return send(chatId, `Your payment needs a support review. Reference: ${ticket}. Send /paysupport with any additional details.`);
    }
  }
  const text = callback ? '' : message.text?.trim() ?? '';
  const rawCommand = text.split(/\s+/)[0] ?? '';
  const command = callback?.data ?? rawCommand.toLowerCase().split('@')[0];
  const userStatus = (telegramChat?.createdAt ?? new Date()).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
    ? 'new' as const : 'returning' as const;
  await recordTelegramEvent(db, update.update_id, chatId, 'interaction', '', { ...interactionLabel(command, Boolean(callback)), userStatus })
    .catch(error => console.error('Telegram analytics interaction failed', error));
  if (command === '/settings' || command === 'settings' || command.startsWith('settings:failed:')) {
    if (command === 'settings:failed:on' || command === 'settings:failed:off') {
      await setTrackFailedTransactions(userId, command.endsWith(':on'));
    }
    const accountId = await canonicalAccountId(userId, db);
    const user = await db.users.findOne({ _id: accountId });
    const enabled = user?.trackFailedTransactions === true;
    return send(chatId, `Transaction settings\n\nFailed onchain transactions: ${enabled ? 'On' : 'Off'}\n\nThese landed in a block but failed during execution. Attempts that never land onchain are not visible. This setting is shared with the mobile app.`, [[{
      text: enabled ? 'Turn off failed transactions' : 'Turn on failed transactions',
      callback_data: enabled ? 'settings:failed:off' : 'settings:failed:on',
    }], ...menu]);
  }
  if (command === '/terms') return send(chatId, PAYMENT_TERMS);
  if (command === '/paysupport') {
    const detail = text.slice(rawCommand.length).trim();
    if (!detail) return send(chatId, 'For billing help or a refund request, send /paysupport followed by your message and payment reference. Never include a private key or seed phrase. Your request will be recorded for WhoAped support.');
    try { return send(chatId, `Billing request recorded. Reference: ${await createBillingSupport(userId, detail)}`); }
    catch (error) { if (error instanceof BillingError) return send(chatId, error.message); throw error; }
  }
  if (command === '/premium' || command === 'premium') {
    const catalog = await billingCatalog(userId);
    const status = catalog.premium.active ? `Premium active until ${catalog.premium.expiresAt?.toISOString()}.\n\n` : '';
    const offer = stakingOffer();
    return send(chatId, `${status}WhoAped Premium · Coming Soon\n\n60 transactions/minute · 1,000/hour · 3,000/day.\n\nPlanned: stake ${offer.amount.toLocaleString('en-US')} project tokens through Streamflow. Request unstaking at any time, then wait 7 days to withdraw.\n\nStaking and new purchases are not live. Do not send tokens to this bot or any address claiming to activate Premium.`, menu);
  }
  if (command.startsWith('purchase:')) {
    return send(chatId, 'New Premium purchases are paused. Existing invoices and refunds remain supported via /paysupport. Do not send tokens to any address claiming to activate staking.');
  }
  const linkToken = command === '/start' && text.slice(rawCommand.length).trim().startsWith('link_')
    ? text.slice(rawCommand.length).trim().slice(5) : command.startsWith('connect:') ? command.slice(8) : null;
  if (linkToken !== null) {
    try {
      if (command.startsWith('connect:')) {
        await confirmTelegramLink(linkToken, chatId, sender?.username);
        return send(chatId, 'Telegram connected. Your wallets are now shared with the mobile app. New transactions will arrive here and in the app. Return to WhoAped to see your account.');
      }
      const link = await previewTelegramLink(linkToken, chatId);
      return send(chatId, `Connect Telegram to WhoAped?\n\nVerification code: ${link.code}\n\nCheck that this code matches the one in your mobile app. Only confirm if you started this connection yourself. Your wallet lists will be combined into one account, including any account access and future subscriptions.`, [[
        { text: 'Confirm connection', callback_data: `connect:${linkToken}` },
        { text: 'Cancel', callback_data: `cancel-connect:${linkToken}` },
      ]]);
    } catch (error) {
      if (error instanceof AccountLinkError) return send(chatId, error.message);
      throw error;
    }
  }
  if (command.startsWith('cancel-connect:')) {
    const token = command.slice(15);
    await db.accountLinks.updateOne({ _id: linkHash(token), claimedChatId: chatId, status: 'pending' }, { $set: { status: 'cancelled' } });
    return send(chatId, 'Connection cancelled. Create a new link in the mobile app to try again.');
  }
  if (['/start', '/help', '/cancel'].includes(command)) {
    await db.telegramChats.updateOne({ _id: chatId }, { $unset: { pendingAction: '' } });
    return send(chatId, command === '/cancel' ? 'Wallet input cancelled.' : help);
  }
  if (command.startsWith('remove:')) {
    const result = await withAccountMutation(userId, (database, session, accountId) => database.wallets.updateOne({ _id: command.slice(7), userId: accountId, deletedAt: null }, { $set: { deletedAt: new Date() } }, { session }));
    if (result.matchedCount) await recordTelegramEvent(db, update.update_id, chatId, 'wallet_removed', '0')
      .catch(error => console.error('Telegram analytics wallet removal failed', error));
    return send(chatId, result.matchedCount ? 'Wallet removed. Notifications stopped.' : 'Wallet not found.');
  }
  const explicitAction: 'add' | 'remove' | undefined = ['/add', 'add'].includes(command) ? 'add'
    : ['/remove', 'remove'].includes(command) ? 'remove' : undefined;
  const input = explicitAction ? text.slice(rawCommand.length).trim() : text;
  if (explicitAction && !input) {
    await db.telegramChats.updateOne({ _id: chatId }, { $set: { pendingAction: explicitAction } });
    return send(chatId, explicitAction === 'add' ? addPrompt : removePrompt);
  }
  let action = explicitAction;
  if (!action && !callback && !command.startsWith('/')) {
    const [chat, storedUpdate] = await Promise.all([
      db.telegramChats.findOne({ _id: chatId }),
      db.telegramUpdates.findOne({ _id: String(update.update_id) }),
    ]);
    action = storedUpdate?.walletAction ?? chat?.pendingAction ?? (validSolanaAddress(rawCommand) ? 'add' : undefined);
  }
  if (action && input) {
    // Remember the chosen action before mutations, so a retried remove cannot become an add.
    await db.telegramUpdates.updateOne({ _id: String(update.update_id) }, { $set: { walletAction: action } });
    const lines = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length > 100) return send(chatId, 'Send at most 100 wallets per message.');
    const { results, completed, changedIndexes } = await withAccountMutation(userId, async (database, session, accountId) => {
      const options = { session };
      const results: string[] = [];
      const changedIndexes: number[] = [];
      let completed = 0;
      for (const [index, line] of lines.entries()) {
        const [address = '', ...nameParts] = line.split(/\s+/);
        const name = nameParts.join(' ');
        const label = `Line ${index + 1}`;
        if (!validSolanaAddress(address)) { results.push(`${label}: invalid Solana address.`); continue; }
        if (action === 'remove') {
          const result = await database.wallets.updateOne({ address, userId: accountId, deletedAt: null }, { $set: { deletedAt: new Date() } }, options);
          if (result.matchedCount) { completed++; changedIndexes.push(index); }
          else results.push(`${label}: wallet is not tracked.`);
          continue;
        }
        if (!name || name.length > 40) { results.push(`${label}: use ADDRESS Name (name: 1–40 characters).`); continue; }
        const walletId = `tg:${chatId}:${update.update_id}:${index}`;
        const existing = await database.wallets.findOne({ userId: accountId, address, deletedAt: null }, options);
        if (existing) {
          if (existing._id === walletId) { completed++; changedIndexes.push(index); }
          else results.push(`${label}: wallet is already tracked.`);
          continue;
        }
        if (await database.wallets.countDocuments({ userId: accountId, deletedAt: null }, options) >= 100) { results.push(`${label}: 100-wallet limit reached.`); continue; }
        try {
          await database.wallets.updateOne({ _id: walletId }, { $setOnInsert: {
            userId: accountId, name, address, chain: 'solana', status: 'active', createdAt: new Date(), deletedAt: null,
          } }, { ...options, upsert: true });
          completed++;
          changedIndexes.push(index);
        } catch (error) {
          if (error instanceof MongoServerError && error.code === 11000) results.push(`${label}: wallet is already tracked.`);
          else throw error;
        }
      }
      return { results, completed, changedIndexes };
    });
    // Keep the mode on invalid input so the user can correct and resend the list.
    if (!results.length) await db.telegramChats.updateOne({ _id: chatId }, { $unset: { pendingAction: '' } });
    else await db.telegramChats.updateOne({ _id: chatId }, { $set: { pendingAction: action } });
    for (const index of changedIndexes) await recordTelegramEvent(db, update.update_id, chatId,
      action === 'add' ? 'wallet_added' : 'wallet_removed', String(index))
      .catch(error => console.error('Telegram analytics wallet change failed', error));
    return send(chatId, [
      `${action === 'add' ? 'Added' : 'Removed'} ${completed} of ${lines.length} wallets.`,
      action === 'add' ? 'Every detected transaction will be sent directly to this chat.' : 'Notifications stopped for removed wallets.',
      ...results.slice(0, 20),
      ...(results.length > 20 ? [`…and ${results.length - 20} more errors.`] : []),
      ...(results.length ? ['Correct the listed lines and resend them, or use /cancel.'] : []),
    ].join('\n'));
  }
  if (command === '/wallets' || command === 'wallets' || command.startsWith('wallets:')) {
    const page = Math.max(0, Math.min(100, Number(command.split(':')[1]) || 0));
    const wallets = await db.wallets.find({ userId, deletedAt: null }).sort({ createdAt: 1, _id: 1 }).skip(page * 10).limit(11).toArray();
    const rows = wallets.slice(0, 10);
    const buttons: Button[][] = rows.map(w => [{ text: `✖ ${w.name}`, callback_data: `remove:${w._id}` }]);
    if (wallets.length > 10) buttons.push([{ text: 'Next →', callback_data: `wallets:${page + 1}` }]);
    return send(chatId, rows.length ? rows.map(w => `${w.name}\n${w.address}`).join('\n\n') : 'No wallets yet. Use /add ADDRESS Name.', [...buttons, ...menu]);
  }
  return send(chatId, help);
}

export function telegramNotification(wallet: WalletDocument, transaction: ParsedSolanaTransaction, activities: NormalizedActivity[], addressLabels?: ReadonlyMap<string, string>) {
  const text = formatTelegramActivity(wallet, transaction, activities, addressLabels);
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
  return { text, parseMode: 'HTML' as const, buttons };
}

export async function enqueueTelegramTransaction(wallet: WalletDocument, transaction: ParsedSolanaTransaction, activities: NormalizedActivity[]) {
  const db = await collections();
  const accountId = await canonicalAccountId(wallet.userId, db);
  const chatId = accountId.startsWith('telegram:') ? accountId.slice(9)
    : (await db.telegramChats.findOne({ userId: accountId }))?._id;
  if (!chatId) return;
  // Replay/backfill must not deliver transactions from before this subscription.
  if (transaction.blockTime && transaction.blockTime * 1000 < Math.max(wallet.createdAt.getTime(), wallet.telegramAlertsFrom?.getTime() ?? 0) - 1000) return;
  const fallback: NormalizedActivity = {
    chain: 'solana', txHash: transaction.signature, eventIndex: 0, kind: 'unknown',
    title: 'On-chain transaction', detail: transaction.summary?.description ?? '',
    occurredAt: new Date((transaction.blockTime ?? Date.now() / 1000) * 1000),
    metadata: { tokenCandidates: [
      ...(transaction.tokenTransfers ?? []).filter(t => t.fromUserAccount === wallet.address || t.toUserAccount === wallet.address),
      ...(transaction.accountData ?? []).filter(a => a.account === wallet.address).flatMap(a => a.tokenBalanceChanges ?? []),
    ] },
  };
  const enriched = transaction.status === 'error' || transaction.transactionStatus === 'ERROR'
    ? activities : await Promise.all((activities.length ? activities : [fallback]).map(enrichActivityMetadata));
  await withAccountMutation(accountId, async (database, session) => {
    if ((transaction.status === 'error' || transaction.transactionStatus === 'ERROR')
      && (await database.users.findOne({ _id: accountId }, { session }))?.trackFailedTransactions !== true) return;
    const original = await database.wallets.findOne({ _id: wallet._id }, { session });
    const currentWallet = original?.mergedIntoWalletId
      ? await database.wallets.findOne({ _id: original.mergedIntoWalletId }, { session }) : original;
    if (!currentWallet || currentWallet.deletedAt) return;
    if (transaction.blockTime && currentWallet.telegramAlertsFrom && transaction.blockTime * 1000 < currentWallet.telegramAlertsFrom.getTime() - 1000) return;
    const counterparties = [...new Set((transaction.nativeTransfers ?? []).flatMap(transfer =>
      transfer.fromUserAccount === currentWallet.address ? [transfer.toUserAccount] :
        transfer.toUserAccount === currentWallet.address ? [transfer.fromUserAccount] : [],
    ).filter((address): address is string => Boolean(address && address !== currentWallet.address)))];
    const addressLabels = new Map<string, string>();
    if (counterparties.length) {
      const named = await database.wallets.find({ userId: accountId, chain: 'solana', deletedAt: null,
        address: { $in: counterparties.slice(0, 20) } }, { session }).toArray();
      named.forEach(item => addressLabels.set(item.address, item.name));
    }
    const now = new Date();
    await database.telegramJobs.updateOne({ walletId: currentWallet._id, txHash: transaction.signature }, { $setOnInsert: {
      _id: randomUUID(), chatId, walletId: currentWallet._id, userId: accountId,
      ...((transaction.status === 'error' || transaction.transactionStatus === 'ERROR') ? { kind: 'failed' as const } : {}),
      txHash: transaction.signature, slot: transaction.slot, ...telegramNotification(currentWallet, transaction, enriched, addressLabels),
      status: 'pending', attempts: 0, availableAt: now, createdAt: now,
    } }, { upsert: true, session });
  });
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
    }, { sort: { priority: -1, createdAt: 1 }, returnDocument: 'after' });
    if (!job) break;
    chats.push(job.chatId);
    try {
      const chat = await db.telegramChats.findOne({ _id: job.chatId });
      const userId = chat?.userId ?? `telegram:${job.chatId}`;
      const subscriptionActive = job.kind === 'account' ? job.userId === userId
        : Boolean(await db.wallets.findOne({ _id: job.walletId, userId, deletedAt: null }));
      const failedEnabled = job.kind !== 'failed' || (await db.users.findOne({ _id: userId }))?.trackFailedTransactions === true;
      if (!subscriptionActive || !chat || chat.disabledAt || !failedEnabled) {
        await db.telegramJobs.updateOne({ _id: job._id }, { $set: { status: 'failed', lastError: 'Subscription inactive' } });
        continue;
      }
      await send(job.chatId, job.text, job.buttons, job.parseMode);
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
