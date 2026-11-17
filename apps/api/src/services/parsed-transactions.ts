import { randomUUID } from 'node:crypto';

import { isDustInboundTransfer, solanaAdapter, walletHasDirectActivity, type ParsedSolanaTransaction } from '../chains/solana.js';
import { collections, type WalletDocument } from '../db.js';
import { enrichActivityMetadata } from './token-metadata.js';
import { admitAccountTransaction, walletTrackingEligible } from './rate-limits.js';
import { withAccountMutation } from './accounts.js';
import { enqueueTelegramTransactionGroup } from './telegram.js';
import { needsNativeReconciliation, reconcileNativeBalanceChanges } from './native-balance-reconciliation.js';
import { transactionBalanceLines } from './transaction-balances.js';

export async function ingestParsedTransaction(
  transaction: ParsedSolanaTransaction,
  options: { provider: 'helius-parsed-stream' | 'helius-parsed-events'; watchedAddresses?: string[]; onCooldown?: () => Promise<void> },
) {
  if (!transaction.signature || !Number.isFinite(transaction.slot)) return { activities: 0 };
  const failed = transaction.status === 'error' || transaction.transactionStatus === 'ERROR';

  const db = await collections();
  const addresses = options.watchedAddresses ?? solanaAdapter.extractAddresses(transaction);
  if (!addresses.length) return { activities: 0 };

  const wallets = await db.wallets.find({
    chain: 'solana',
    deletedAt: null,
    status: { $ne: 'error' },
    address: { $in: addresses },
  }).toArray();
  const enabledFailedAccounts = failed ? new Set((await db.users.find({
    _id: { $in: [...new Set(wallets.map((wallet) => wallet.userId))] },
    trackFailedTransactions: true,
  }).toArray()).map((user) => user._id)) : null;

  const admissions = new Map<string, boolean>();
  const eligibleWallets = [];
  let cooldownStarted = false;
  for (const wallet of wallets) {
    if (failed && !enabledFailedAccounts?.has(wallet.userId)) continue;
    if (!failed && !walletHasDirectActivity(transaction, wallet.address)
      && !needsNativeReconciliation(transaction, wallet.address)) continue;
    if (!failed && isDustInboundTransfer(transaction, wallet.address)) continue;
    if (!await walletTrackingEligible(wallet, transaction.slot, transaction.blockTime)) continue;
    // Admission itself resolves aliases and serializes concurrent stream connections.
    if (!admissions.has(wallet.userId)) {
      const decision = await admitAccountTransaction(wallet.userId, transaction.signature, transaction.slot);
      admissions.set(wallet.userId, decision.allowed);
      cooldownStarted ||= decision.cooldownStarted;
    }
    if (admissions.get(wallet.userId)) eligibleWallets.push(wallet);
  }
  // Rebuild upstream subscriptions before processing another queued stream message.
  if (cooldownStarted) await options.onCooldown?.();
  if (!eligibleWallets.length) return { activities: 0 };
  if (!failed) transaction = await reconcileNativeBalanceChanges(transaction, eligibleWallets.map((wallet) => wallet.address));
  const involvedWallets = failed ? eligibleWallets : eligibleWallets.filter((wallet) => walletHasDirectActivity(transaction, wallet.address));
  if (!involvedWallets.length) return { activities: 0 };
  const normalizedByWallet = await Promise.all(involvedWallets.map(async (wallet) => ({
    wallet,
    activities: await Promise.all((failed ? [{
      chain: 'solana' as const, txHash: transaction.signature, eventIndex: 0,
      kind: 'failed' as const, title: 'Transaction failed', detail: 'Execution failed on Solana.',
      occurredAt: new Date((transaction.blockTime ?? Date.now() / 1000) * 1000),
      metadata: { failed: true },
    }] : solanaAdapter.normalize(transaction, wallet.address)).map(enrichActivityMetadata)),
  })));
  // Persist independently of mobile activity classification, including dust and failed transactions.
  await enqueueTelegramTransactionGroup(normalizedByWallet, transaction);
  if (!normalizedByWallet.some(({ activities }) => activities.length)) return { activities: 0 };

  await db.ingestionEvents.updateOne(
    { provider: options.provider, externalId: transaction.signature },
    {
      $set: { slot: transaction.slot, payload: transaction },
      $setOnInsert: { _id: randomUUID(), receivedAt: new Date() },
    },
    { upsert: true },
  );

  let activities = 0;
  const insertedByAccount = new Map<string, Array<{ wallet: WalletDocument; title: string; balanceChanges: string[]; transactionId: string }>>();
  for (const { wallet, activities: normalizedActivities } of normalizedByWallet) {
    for (const normalizedActivity of normalizedActivities) {
      const activity = { ...normalizedActivity, metadata: { ...normalizedActivity.metadata,
        balanceChanges: transactionBalanceLines(transaction, wallet.address, [normalizedActivity]),
      } };
      const inserted = await withAccountMutation(wallet.userId, async (database, session, accountId) => {
        if (failed && (await database.users.findOne({ _id: accountId }, { session }))?.trackFailedTransactions !== true) return null;
        const original = await database.wallets.findOne({ _id: wallet._id }, { session });
        const currentWallet = original?.mergedIntoWalletId
          ? await database.wallets.findOne({ _id: original.mergedIntoWalletId }, { session }) : original;
        if (!currentWallet || currentWallet.deletedAt) return null;
        const transactionId = randomUUID();
        const mutableFields = {
          kind: activity.kind,
          title: activity.title,
          detail: activity.detail,
          occurredAt: activity.occurredAt,
          metadata: activity.metadata,
          ...(activity.source ? { source: activity.source } : {}),
          ...(activity.valueUsd == null ? {} : { valueUsd: activity.valueUsd }),
        };
        const unsetFields: Partial<Record<'source' | 'valueUsd', ''>> = {
          ...(activity.source ? {} : { source: '' }),
          ...(activity.valueUsd == null ? { valueUsd: '' } : {}),
        };
        const saved = await database.transactions.updateOne(
          {
            walletId: currentWallet._id,
            chain: activity.chain,
            txHash: activity.txHash,
            eventIndex: activity.eventIndex,
          },
          {
            $max: { slot: transaction.slot },
            $set: mutableFields,
            ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
            $setOnInsert: {
              _id: transactionId,
              userId: accountId,
              walletId: currentWallet._id,
              chain: activity.chain,
              txHash: activity.txHash,
              eventIndex: activity.eventIndex,
              createdAt: new Date(),
            },
          },
          { upsert: true, session },
        );
        return saved.upsertedCount ? { wallet: currentWallet, accountId, title: activity.title,
          balanceChanges: activity.metadata.balanceChanges as string[], transactionId } : null;
      }, () => null);
      if (inserted) {
        activities += 1;
        const group = insertedByAccount.get(inserted.accountId) ?? [];
        group.push(inserted);
        insertedByAccount.set(inserted.accountId, group);
      }
    }
  }

  for (const [userId, entries] of insertedByAccount) await withAccountMutation(userId, async (database, session, accountId) => {
    const deviceTokens = await database.deviceTokens.find({
      userId: accountId, disabledAt: { $exists: false },
    }, { session }).toArray();
    const uniqueWallets = [...new Map(entries.map(entry => [entry.wallet._id, entry])).values()];
    const title = uniqueWallets.length === 1 ? uniqueWallets[0].wallet.name
      : `${uniqueWallets.length} wallets in one transaction`;
    const body = uniqueWallets.length === 1 ? uniqueWallets[0].title : uniqueWallets
      .map(entry => `${entry.wallet.name}: ${entry.balanceChanges.slice(0, 2).join(', ')}`)
      .join(' · ').slice(0, 240);
    const primary = entries[0];
    const now = new Date();
    const dedupeKey = `${primary.wallet.chain}:${transaction.signature}`;
    for (const device of deviceTokens) await database.notificationJobs.updateOne(
      { deviceTokenId: device._id, dedupeKey },
      { $setOnInsert: {
        _id: randomUUID(), userId: accountId, deviceTokenId: device._id, dedupeKey,
        transactionId: primary.transactionId, ...(failed ? { failedTransaction: true } : {}),
        title, body, data: { transactionId: primary.transactionId, walletId: primary.wallet._id, signature: transaction.signature },
        status: 'pending', attempts: 0, availableAt: now, createdAt: now,
      } },
      { upsert: true, session },
    );
  }, () => undefined);

  return { activities };
}
