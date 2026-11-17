import { hashToken } from '../auth.js';
import { withDatabaseTransaction } from '../db.js';
import { canonicalAccountId, lockAccount } from './accounts.js';

const RECEIPT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function deleteAccountForSession(token: string) {
  const tokenHash = hashToken(token);
  return withDatabaseTransaction(async (db, session) => {
    const options = { session };
    const now = new Date();
    // A retry after a lost response succeeds without restoring an account or session.
    if (await db.accountDeletionReceipts.findOne({ _id: tokenHash, expiresAt: { $gt: now } }, options)) return true;
    const login = await db.sessions.findOne({ tokenHash, expiresAt: { $gt: now } }, options);
    if (!login) return false;

    const accountId = await canonicalAccountId(login.userId, db, session);
    if (!await lockAccount(db, session, accountId)) return false;
    const accountIds = new Set([accountId]);
    let parents = [accountId];
    while (parents.length) {
      const aliases = await db.users.distinct('_id', { mergedInto: { $in: parents } }, options);
      parents = aliases.filter(alias => !accountIds.has(alias));
      for (const alias of parents) accountIds.add(alias);
    }

    const owners = [...accountIds];
    const owned = { userId: { $in: owners } };
    const legacyChatIds = owners.filter(id => id.startsWith('telegram:')).map(id => id.slice(9));
    const chats = { $or: [owned, { _id: { $in: legacyChatIds }, userId: { $exists: false } }] };
    const chatIds = await db.telegramChats.distinct('_id', chats, options);
    const chatNumbers = chatIds.map(Number).filter(Number.isSafeInteger);
    const walletIds = await db.wallets.distinct('_id', owned, options);

    // Preserve only settled payment records needed for receipts, disputes and refunds.
    await db.paymentOrders.deleteMany({ ...owned, status: { $nin: ['paid', 'refunded'] } }, options);
    await db.paymentOrders.updateMany(owned, {
      $set: { userId: 'deleted-account', accountDeletedAt: now },
      $unset: { requestKey: '', payer: '', recipient: '', sourceTokenAccount: '', destinationTokenAccount: '',
        reference: '', memo: '', nextCheckAt: '', checks: '', lastError: '', accessStartsAt: '', accessEndsAt: '' },
    }, options);

    await db.sessions.deleteMany(owned, options);
    await db.wallets.deleteMany(owned, options);
    await db.transactions.deleteMany({ $or: [owned, { walletId: { $in: walletIds } }] }, options);
    await db.deviceTokens.deleteMany(owned, options);
    await db.notificationJobs.deleteMany(owned, options);
    await db.telegramJobs.deleteMany({ $or: [owned, { chatId: { $in: chatIds } }, { walletId: { $in: walletIds } }] }, options);
    await db.telegramChats.deleteMany(chats, options);
    await db.telegramAnalyticsEvents.deleteMany({ chatId: { $in: chatIds } }, options);
    await db.discoverySync.updateMany({ reportChatId: { $in: chatIds } }, { $unset: { reportChatId: '' } }, options);
    // Keep update IDs for deduplication. A retried webhook must not replay a deleted command.
    await db.telegramUpdates.updateMany({ $or: [
      { 'payload.message.chat.id': { $in: chatNumbers } },
      { 'payload.callback_query.message.chat.id': { $in: chatNumbers } },
      { 'payload.pre_checkout_query.from.id': { $in: chatNumbers } },
    ] }, { $set: { payload: null, status: 'sent' }, $unset: { walletAction: '' } }, options);
    await db.accountLinks.deleteMany({ $or: [owned, { claimedChatId: { $in: chatIds } }, { confirmedChatId: { $in: chatIds } }] }, options);
    await db.payboxImports.deleteMany(owned, options);
    await db.accountEntitlements.deleteMany(owned, options);
    await db.trackingStates.deleteMany({ _id: { $in: owners } }, options);
    await db.rateEvents.deleteMany(owned, options);
    await db.portfolioSnapshots.deleteMany({ _id: { $in: owners } }, options);
    await db.billingSupport.deleteMany(owned, options);
    await db.users.deleteMany({ _id: { $in: owners } }, options);
    await db.accountDeletionReceipts.insertOne({ _id: tokenHash, expiresAt: new Date(now.getTime() + RECEIPT_LIFETIME_MS) }, options);
    return true;
  });
}
