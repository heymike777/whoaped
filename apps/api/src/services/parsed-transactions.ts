import { randomUUID } from 'node:crypto';

import { solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';
import { query } from '../db.js';

type WalletRow = {
  id: string;
  user_id: string;
  name: string;
  address: string;
};

export async function ingestParsedTransaction(
  transaction: ParsedSolanaTransaction,
  options: { provider: 'helius-parsed-stream' | 'helius-parsed-events'; watchedAddresses?: string[] },
) {
  if (!transaction.signature || !Number.isFinite(transaction.slot)) return { activities: 0 };
  if (transaction.status === 'error' || transaction.transactionStatus === 'ERROR') return { activities: 0 };

  await query(
    `INSERT INTO ingestion_events (id, provider, external_id, slot, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (provider, external_id) DO UPDATE
       SET slot = EXCLUDED.slot, payload = EXCLUDED.payload`,
    [randomUUID(), options.provider, transaction.signature, transaction.slot, JSON.stringify(transaction)],
  );

  const addresses = options.watchedAddresses ?? solanaAdapter.extractAddresses(transaction);
  if (!addresses.length) return { activities: 0 };

  const wallets = await query<WalletRow>(
    `SELECT id, user_id, name, address FROM wallets
     WHERE chain = 'solana' AND deleted_at IS NULL AND status != 'error'
       AND address = ANY($1::text[])`,
    [addresses],
  );

  let activities = 0;
  for (const wallet of wallets) {
    for (const activity of solanaAdapter.normalize(transaction, wallet.address)) {
      const [saved] = await query<{ id: string }>(
        `INSERT INTO transactions
           (id, user_id, wallet_id, chain, tx_hash, event_index, slot, kind, title, detail, source, value_usd, occurred_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
         ON CONFLICT (wallet_id, chain, tx_hash, event_index) DO UPDATE
           SET slot = COALESCE(transactions.slot, EXCLUDED.slot)
         RETURNING id`,
        [
          randomUUID(), wallet.user_id, wallet.id, activity.chain, activity.txHash,
          activity.eventIndex, transaction.slot, activity.kind, activity.title, activity.detail,
          activity.source ?? null, activity.valueUsd ?? null, activity.occurredAt,
          JSON.stringify(activity.metadata),
        ],
      );
      if (!saved) continue;
      activities += 1;
      await query(
        `INSERT INTO notification_jobs (id, user_id, device_token_id, transaction_id, title, body, data)
         SELECT gen_random_uuid(), $1, id, $2, $3, $4, $5::jsonb
         FROM device_tokens WHERE user_id = $1 AND disabled_at IS NULL
         ON CONFLICT (device_token_id, transaction_id) DO NOTHING`,
        [
          wallet.user_id,
          saved.id,
          wallet.name,
          activity.title,
          JSON.stringify({ transactionId: saved.id, walletId: wallet.id }),
        ],
      );
    }
  }

  return { activities };
}
