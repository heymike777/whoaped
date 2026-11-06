import type { ParsedSolanaTransaction } from '../chains/solana.js';
import type { Collections, TransactionDocument, WalletDocument } from '../db.js';
import { transactionBalanceLines } from './transaction-balances.js';

/** Upgrade retained history from existing ingestion payloads, without paid RPC calls. */
export async function withActivityBalances(
  transactions: TransactionDocument[], wallets: Map<string, WalletDocument>,
  db: Pick<Collections, 'ingestionEvents' | 'transactions'>,
) {
  const needsRefresh = (tx: TransactionDocument) => {
    const lines = tx.metadata.balanceChanges;
    return tx.chain === 'solana' && (!Array.isArray(lines) || (tx.metadata.balanceChangesVersion !== 2
      && lines.some(line => typeof line === 'string' && line.endsWith(' SOL'))
      && lines.some(line => typeof line === 'string' && line.endsWith(' WSOL'))));
  };
  const missing = transactions.filter(needsRefresh);
  if (!missing.length) return transactions;
  const events = await db.ingestionEvents.find({ externalId: { $in: [...new Set(missing.map(tx => tx.txHash))] } })
    .sort({ receivedAt: -1 }).toArray();
  const payloads = new Map<string, ParsedSolanaTransaction>();
  for (const event of events) {
    const payload = event.payload as Partial<ParsedSolanaTransaction> | null;
    if (!payloads.has(event.externalId) && payload?.signature === event.externalId && typeof payload.slot === 'number') {
      payloads.set(event.externalId, payload as ParsedSolanaTransaction);
    }
  }
  return Promise.all(transactions.map(async tx => {
    if (!needsRefresh(tx)) return tx;
    const wallet = wallets.get(tx.walletId);
    const payload = payloads.get(tx.txHash);
    if (!wallet || !payload) return tx;
    const balanceChanges = transactionBalanceLines(payload, wallet.address, [tx]);
    const refreshed = Array.isArray(tx.metadata.balanceChanges);
    const fields = refreshed ? { 'metadata.balanceChanges': balanceChanges, 'metadata.balanceChangesVersion': 2 }
      : { 'metadata.balanceChanges': balanceChanges };
    await db.transactions.updateOne({ _id: tx._id }, { $set: fields });
    return { ...tx, metadata: { ...tx.metadata, balanceChanges, ...(refreshed ? { balanceChangesVersion: 2 } : {}) } };
  }));
}
