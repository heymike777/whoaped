import type { ParsedSolanaTransaction } from '../chains/solana.js';
import { ingestParsedTransaction } from './parsed-transactions.js';

type ParsedEventResult = {
  signature: string;
  parserStatus: 'OK' | 'ERROR';
  parsed?: Omit<ParsedSolanaTransaction, 'signature'>;
  parserError?: { code?: string; message?: string };
};

type ParsedHistoryPage = {
  data: ParsedEventResult[];
  paginationToken?: string;
};

const parsedEventsBaseUrl = 'https://mainnet.helius-rpc.com/v1/parsed-events';

export function parsedEventTransaction(result: ParsedEventResult): ParsedSolanaTransaction | null {
  if (result.parserStatus !== 'OK' || !result.parsed) return null;
  return { signature: result.signature, ...result.parsed };
}

async function parsedEventsRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY is not configured');

  const response = await fetch(`${parsedEventsBaseUrl}${path}?api-key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Helius Parsed Events failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`);
  }
  return response.json() as Promise<T>;
}

export async function backfillParsedEvents(
  address: string,
  fromSlot: number,
  toSlot: number,
  maxPages = 20,
) {
  const configuredMaxPages = Number(process.env.HELIUS_BACKFILL_MAX_PAGES);
  const pageLimit = Number.isFinite(configuredMaxPages) && configuredMaxPages > 0
    ? Math.min(Math.floor(configuredMaxPages), 1_000)
    : maxPages;
  let paginationToken: string | undefined;
  let pages = 0;
  let processed = 0;

  do {
    const page = await parsedEventsRequest<ParsedHistoryPage>('/transaction-history', {
      address,
      limit: 100,
      sortOrder: 'asc',
      commitment: 'finalized',
      slot: { gte: fromSlot, lte: toSlot },
      ...(paginationToken ? { paginationToken } : {}),
    });
    pages += 1;

    for (const result of page.data) {
      const transaction = parsedEventTransaction(result);
      if (!transaction) continue;
      await ingestParsedTransaction(transaction, {
        provider: 'helius-parsed-events',
        watchedAddresses: [address],
      });
      processed += 1;
    }

    paginationToken = page.paginationToken;
  } while (paginationToken && pages < pageLimit);

  if (paginationToken) {
    throw new Error(`Parsed Events backfill exceeded ${pageLimit} pages for ${address}`);
  }
  return { pages, processed };
}
