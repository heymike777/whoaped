import { randomUUID } from 'node:crypto';

import { solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';
import { collections } from '../db.js';
import { enrichActivityMetadata } from './token-metadata.js';
import { withAccountMutation } from './accounts.js';
import { enqueueTelegramTransaction } from './telegram.js';
import { reconcileNativeBalanceChanges } from './native-balance-reconciliation.js';

export async function ingestParsedTransaction(
  transaction: ParsedSolanaTransaction,
  options: { provider: 'helius-parsed-stream' | 'helius-parsed-events'; watchedAddresses?: string[] },
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

  transaction = await reconcileNativeBalanceChanges(transaction, wallets.map((wallet) => wallet.address));
  const normalizedByWallet = wallets.map((wallet) => ({
    wallet,
    activities: failed ? [] : solanaAdapter.normalize(transaction, wallet.address),
  }));
  // Persist independently of mobile activity classification, including dust and failed transactions.
  await Promise.all(normalizedByWallet.map(({ wallet, activities }) =>
    enqueueTelegramTransaction(wallet, transaction, activities)));
  if (failed) return { activities: 0 };
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
      const activity = await enrichActivityMetadata(normalizedActivity);
      activities += await withAccountMutation(wallet.userId, async (database, session, accountId) => {
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
