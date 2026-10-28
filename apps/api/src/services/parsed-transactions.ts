import { randomUUID } from 'node:crypto';

import { solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';
import { collections } from '../db.js';

export async function ingestParsedTransaction(
  transaction: ParsedSolanaTransaction,
  options: { provider: 'helius-parsed-stream' | 'helius-parsed-events'; watchedAddresses?: string[] },
) {
  if (!transaction.signature || !Number.isFinite(transaction.slot)) return { activities: 0 };
  if (transaction.status === 'error' || transaction.transactionStatus === 'ERROR') return { activities: 0 };

  const db = await collections();
  await db.ingestionEvents.updateOne(
    { provider: options.provider, externalId: transaction.signature },
    {
      $set: { slot: transaction.slot, payload: transaction },
      $setOnInsert: { _id: randomUUID(), receivedAt: new Date() },
    },
    { upsert: true },
  );

  const addresses = options.watchedAddresses ?? solanaAdapter.extractAddresses(transaction);
  if (!addresses.length) return { activities: 0 };

  const wallets = await db.wallets.find({
    chain: 'solana',
    deletedAt: null,
    status: { $ne: 'error' },
    address: { $in: addresses },
  }).toArray();

  let activities = 0;
  for (const wallet of wallets) {
    for (const activity of solanaAdapter.normalize(transaction, wallet.address)) {
      const transactionId = randomUUID();
      const saved = await db.transactions.updateOne(
        {
          walletId: wallet._id,
          chain: activity.chain,
          txHash: activity.txHash,
          eventIndex: activity.eventIndex,
        },
        {
          $max: { slot: transaction.slot },
          $setOnInsert: {
            _id: transactionId,
            userId: wallet.userId,
            walletId: wallet._id,
            chain: activity.chain,
            txHash: activity.txHash,
            eventIndex: activity.eventIndex,
            kind: activity.kind,
            title: activity.title,
            detail: activity.detail,
            ...(activity.source ? { source: activity.source } : {}),
            ...(activity.valueUsd == null ? {} : { valueUsd: activity.valueUsd }),
            occurredAt: activity.occurredAt,
            metadata: activity.metadata,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      if (!saved.upsertedCount) continue;
      activities += 1;
      const deviceTokens = await db.deviceTokens.find({
        userId: wallet.userId, disabledAt: { $exists: false },
      }).toArray();
      const now = new Date();
      await Promise.all(deviceTokens.map((device) => db.notificationJobs.updateOne(
        { deviceTokenId: device._id, transactionId },
        {
          $setOnInsert: {
            _id: randomUUID(),
            userId: wallet.userId,
            deviceTokenId: device._id,
            transactionId,
            title: wallet.name,
            body: activity.title,
            data: { transactionId, walletId: wallet._id },
            status: 'pending',
            attempts: 0,
            availableAt: now,
            createdAt: now,
          },
        },
        { upsert: true },
      )));
    }
  }

  return { activities };
}
