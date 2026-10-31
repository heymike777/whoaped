import { isDustInboundTransfer, solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';
import type { Collections, TransactionDocument, WalletDocument } from '../db.js';

function isParsedSolanaTransaction(value: unknown): value is ParsedSolanaTransaction {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ParsedSolanaTransaction>;
  return typeof candidate.signature === 'string' && typeof candidate.slot === 'number';
}

export async function reclassifyStoredActivities(
  transactions: TransactionDocument[],
  walletById: Map<string, WalletDocument>,
  db: Pick<Collections, 'ingestionEvents' | 'transactions'>,
) {
  const stale = transactions.filter((transaction) => transaction.chain === 'solana'
    && (transaction.kind === 'balance' || transaction.kind === 'swap'));
  if (!stale.length) return transactions;

  const events = await db.ingestionEvents.find({
    externalId: { $in: [...new Set(stale.map((transaction) => transaction.txHash))] },
  }).sort({ receivedAt: -1 }).toArray();
  const eventBySignature = new Map<string, unknown>();
  events.forEach((event) => {
    if (!eventBySignature.has(event.externalId)) eventBySignature.set(event.externalId, event.payload);
  });

  const classified = await Promise.all(transactions.map(async (transaction) => {
    if (transaction.chain !== 'solana' || (transaction.kind !== 'balance' && transaction.kind !== 'swap')) return transaction;
    const wallet = walletById.get(transaction.walletId);
    const payload = eventBySignature.get(transaction.txHash);
    if (!wallet || !isParsedSolanaTransaction(payload)) return transaction;
    if (transaction.kind === 'balance' && isDustInboundTransfer(payload, wallet.address)) {
      await db.transactions.updateOne({ _id: transaction._id }, { $set: { suppressed: true } });
      return null;
    }

    const normalized = solanaAdapter.normalize(payload, wallet.address)
      .find((activity) => activity.eventIndex === transaction.eventIndex);
    if (!normalized) return transaction;
    if (transaction.kind === 'balance' && normalized.kind === 'balance') return transaction;
    if (transaction.kind === 'swap' && (normalized.kind !== 'swap' || normalized.source === transaction.source)) return transaction;

    const mutableFields = {
      kind: normalized.kind,
      title: normalized.title,
      detail: normalized.detail,
      occurredAt: normalized.occurredAt,
      metadata: normalized.metadata,
      ...(normalized.source ? { source: normalized.source } : {}),
      ...(normalized.valueUsd == null ? {} : { valueUsd: normalized.valueUsd }),
    };
    const unsetFields = {
      ...(normalized.source ? {} : { source: '' as const }),
      ...(normalized.valueUsd == null ? { valueUsd: '' as const } : {}),
    };
    await db.transactions.updateOne(
      { _id: transaction._id },
      {
        $set: mutableFields,
        ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
      },
    );
    return { ...transaction, ...mutableFields };
  }));
  return classified.filter((transaction): transaction is TransactionDocument => transaction !== null);
}
