import type { TransactionDocument, WalletDocument } from '../db.js';

export function activityView(transaction: TransactionDocument, wallet?: WalletDocument) {
  return {
    id: transaction._id,
    walletId: transaction.walletId,
    walletName: wallet?.name ?? 'Wallet',
    walletAddress: wallet?.address ?? '',
    chain: transaction.chain,
    kind: transaction.kind,
    title: transaction.title,
    detail: transaction.detail,
    source: transaction.source,
    valueUsd: transaction.valueUsd,
    signature: transaction.txHash,
    occurredAt: transaction.occurredAt,
    metadata: transaction.metadata,
  };
}
