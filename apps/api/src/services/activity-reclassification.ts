import { isDustInboundTransfer, solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';
import type { Collections, TransactionDocument, WalletDocument } from '../db.js';
import { reconcileNativeBalanceChanges } from './native-balance-reconciliation.js';
import { enrichActivityMetadata } from './token-metadata.js';

function hasRoute(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const swap = (value as { swap?: { steps?: unknown[] } }).swap;
  return Array.isArray(swap?.steps) && swap.steps.length > 1;
}

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
  const eventBySignature = new Map<string, { _id: string; payload: unknown }>();
  events.forEach((event) => {
    if (!eventBySignature.has(event.externalId)) eventBySignature.set(event.externalId, event);
  });

  await Promise.all([...eventBySignature.entries()].map(async ([signature, event]) => {
    if (!isParsedSolanaTransaction(event.payload)) return;
    const addresses = stale.filter((transaction) => transaction.txHash === signature)
      .map((transaction) => walletById.get(transaction.walletId)?.address)
      .filter((address): address is string => Boolean(address));
    const reconciled = await reconcileNativeBalanceChanges(event.payload, addresses);
    if (reconciled === event.payload) return;
    event.payload = reconciled;
    await db.ingestionEvents.updateOne({ _id: event._id }, { $set: { payload: reconciled } });
  }));

  const classified = await Promise.all(transactions.map(async (transaction) => {
    if (transaction.chain !== 'solana' || (transaction.kind !== 'balance' && transaction.kind !== 'swap')) return transaction;
    const wallet = walletById.get(transaction.walletId);
    const payload = eventBySignature.get(transaction.txHash)?.payload;
    if (!wallet || !isParsedSolanaTransaction(payload)) return transaction;
    if (transaction.kind === 'balance' && isDustInboundTransfer(payload, wallet.address)) {
      await db.transactions.updateOne({ _id: transaction._id }, { $set: { suppressed: true } });
      return null;
    }

    const normalized = solanaAdapter.normalize(payload, wallet.address)
      .find((activity) => activity.eventIndex === transaction.eventIndex);
    if (!normalized) return transaction;
    if (transaction.kind === 'balance' && normalized.kind === 'balance'
      && normalized.title === transaction.title) return transaction;
    if (transaction.kind === 'swap' && (normalized.kind !== 'swap' || (normalized.source === transaction.source && (!hasRoute(normalized.metadata) || hasRoute(transaction.metadata))))) return transaction;

    const enriched = normalized.kind === 'swap' || normalized.kind === 'nft'
      ? await enrichActivityMetadata(normalized) : normalized;

    const mutableFields = {
      kind: enriched.kind,
      title: enriched.title,
      detail: enriched.detail,
      occurredAt: enriched.occurredAt,
      metadata: { ...transaction.metadata, ...enriched.metadata },
      ...(enriched.source ? { source: enriched.source } : {}),
      ...(enriched.valueUsd == null ? {} : { valueUsd: enriched.valueUsd }),
    };
    const unsetFields = {
      ...(enriched.source ? {} : { source: '' as const }),
      ...(enriched.valueUsd == null ? { valueUsd: '' as const } : {}),
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
