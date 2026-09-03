export const ADDRESSES_PER_SUBSCRIPTION = 100;
export const SUBSCRIPTIONS_PER_CONNECTION = 25;
export const ADDRESSES_PER_CONNECTION = ADDRESSES_PER_SUBSCRIPTION * SUBSCRIPTIONS_PER_CONNECTION;

export type ParsedStreamSubscription = {
  jsonrpc: '2.0';
  id: number;
  method: 'parsedTransactionSubscribe';
  params: [
    {
      accounts: { include: string[] };
      includeFailed: false;
      includeCpi: true;
    },
    { commitment: 'confirmed'; details: 'full' },
  ];
};

export function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size));
}

export function streamSubscriptions(addresses: string[]) {
  return chunks(addresses, ADDRESSES_PER_SUBSCRIPTION).map((addressChunk, index): ParsedStreamSubscription => ({
    jsonrpc: '2.0' as const,
    id: index + 1,
    method: 'parsedTransactionSubscribe' as const,
    params: [
      {
        accounts: { include: addressChunk },
        includeFailed: false,
        includeCpi: true,
      },
      { commitment: 'confirmed', details: 'full' },
    ],
  }));
}
