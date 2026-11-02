import { randomUUID } from 'node:crypto';

import { solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';
import { collections } from '../db.js';
import { enrichActivityMetadata } from './token-metadata.js';
import { admitAccountTransaction, walletTrackingEligible } from './rate-limits.js';
import { withAccountMutation } from './accounts.js';
import { enqueueTelegramTransaction } from './telegram.js';
import { reconcileNativeBalanceChanges } from './native-balance-reconciliation.js';
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
  const normalizedByWallet = await Promise.all(eligibleWallets.map(async (wallet) => ({
    wallet,
    activities: await Promise.all((failed ? [{
      chain: 'solana' as const, txHash: transaction.signature, eventIndex: 0,
      kind: 'failed' as const, title: 'Transaction failed', detail: 'Execution failed on Solana.',
      occurredAt: new Date((transaction.blockTime ?? Date.now() / 1000) * 1000),
      metadata: { failed: true },
    }] : solanaAdapter.normalize(transaction, wallet.address)).map(enrichActivityMetadata)),
  })));
  // Persist independently of mobile activity classification, including dust and failed transactions.
  await Promise.all(normalizedByWallet.map(({ wallet, activities }) =>
    enqueueTelegramTransaction(wallet, transaction, activities)));
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
  for (const { wallet, activities: normalizedActivities } of normalizedByWallet) {
    for (const normalizedActivity of normalizedActivities) {
      const activity = { ...normalizedActivity, metadata: { ...normalizedActivity.metadata,
        balanceChanges: transactionBalanceLines(transaction, wallet.address, [normalizedActivity]),
      } };
      activities += await withAccountMutation(wallet.userId, async (database, session, accountId) => {
        if (failed && (await database.users.findOne({ _id: accountId }, { session }))?.trackFailedTransactions !== true) return 0;
        const original = await database.wallets.findOne({ _id: wallet._id }, { session });
        const currentWallet = original?.mergedIntoWalletId
          ? await database.wallets.findOne({ _id: original.mergedIntoWalletId }, { session }) : original;
        if (!currentWallet || currentWallet.deletedAt) return 0;
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
        if (!saved.upsertedCount) return 0;
        const deviceTokens = await database.deviceTokens.find({
          userId: accountId, disabledAt: { $exists: false },
        }, { session }).toArray();
        const now = new Date();
        for (const device of deviceTokens) await database.notificationJobs.updateOne(
          { deviceTokenId: device._id, transactionId },
          {
            $setOnInsert: {
              _id: randomUUID(),
              userId: accountId,
              deviceTokenId: device._id,
              transactionId,
              ...(failed ? { failedTransaction: true } : {}),
              title: currentWallet.name,
              body: activity.title,
              data: { transactionId, walletId: currentWallet._id },
              status: 'pending',
              attempts: 0,
              availableAt: now,
              createdAt: now,
            },
          },
          { upsert: true, session },
        );
        return 1;
      });
    }
  }

  return { activities };
}
