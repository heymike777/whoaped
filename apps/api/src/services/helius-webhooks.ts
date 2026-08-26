type HeliusWebhook = {
  webhookID: string;
  webhookURL: string;
  accountAddresses: string[];
  transactionTypes: string[];
  webhookType: string;
  authHeader?: string;
};

import { query } from '../db.js';

const baseUrl = 'https://api.helius.xyz/v0/webhooks';

export async function syncHeliusAddresses() {
  const apiKey = process.env.HELIUS_API_KEY;
  const webhookId = process.env.HELIUS_WEBHOOK_ID;
  if (!apiKey || !webhookId) return { configured: false as const };

  const url = `${baseUrl}/${webhookId}?api-key=${encodeURIComponent(apiKey)}`;
  const currentResponse = await fetch(url);
  if (!currentResponse.ok) throw new Error(`Helius webhook lookup failed (${currentResponse.status})`);
  const current = await currentResponse.json() as HeliusWebhook;
  const rows = await query<{ address: string }>(
    `SELECT DISTINCT address FROM wallets
     WHERE chain = 'solana' AND deleted_at IS NULL AND status != 'error'
     ORDER BY address`,
  );
  const desired = rows.map((row) => row.address);
  if (
    current.accountAddresses.length === desired.length
    && current.accountAddresses.every((address) => desired.includes(address))
  ) return { configured: true as const };

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookURL: current.webhookURL,
      transactionTypes: current.transactionTypes?.length ? current.transactionTypes : ['Any'],
      accountAddresses: desired,
      webhookType: current.webhookType || 'enhanced',
      authHeader: current.authHeader,
    }),
  });
  if (!response.ok) throw new Error(`Helius webhook update failed (${response.status})`);
  return { configured: true as const };
}
