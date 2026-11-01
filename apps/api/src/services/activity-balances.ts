import type { ParsedSolanaTransaction } from '../chains/solana.js';
import type { Collections, TransactionDocument, WalletDocument } from '../db.js';
import { transactionBalanceLines } from './transaction-balances.js';

/** Upgrade retained history from existing ingestion payloads, without paid RPC calls. */
export async function withActivityBalances(
  transactions: TransactionDocument[], wallets: Map<string, WalletDocument>,
  db: Pick<Collections, 'ingestionEvents' | 'transactions'>,
) {
  const missing = transactions.filter(tx => tx.chain === 'solana' && !Array.isArray(tx.metadata.balanceChanges));
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
    if (tx.chain !== 'solana' || Array.isArray(tx.metadata.balanceChanges)) return tx;
    const wallet = wallets.get(tx.walletId);
    const payload = payloads.get(tx.txHash);
    if (!wallet || !payload) return tx;
    const balanceChanges = transactionBalanceLines(payload, wallet.address, [tx]);
    await db.transactions.updateOne({ _id: tx._id }, { $set: { 'metadata.balanceChanges': balanceChanges } });
    return { ...tx, metadata: { ...tx.metadata, balanceChanges } };
  }));
}
