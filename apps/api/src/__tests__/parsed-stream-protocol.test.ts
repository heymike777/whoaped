import { describe, expect, it } from 'vitest';

import {
  ADDRESSES_PER_CONNECTION,
  chunks,
  streamSubscriptions,
} from '../services/parsed-stream-protocol.js';

describe('Parsed Streams protocol', () => {
  it('keeps each subscription within the 100-account API limit', () => {
    const addresses = Array.from({ length: 201 }, (_, index) => `wallet-${index}`);
    const subscriptions = streamSubscriptions(addresses);

    expect(subscriptions).toHaveLength(3);
    expect(subscriptions.map((item) => item.params[0]!.accounts.include.length)).toEqual([100, 100, 1]);
    expect(subscriptions[0]?.method).toBe('parsedTransactionSubscribe');
    expect(subscriptions[0]?.params[1]).toEqual({ commitment: 'confirmed', details: 'full' });
  });

  it('caps a connection at 25 subscriptions', () => {
    const addresses = Array.from({ length: ADDRESSES_PER_CONNECTION + 1 }, (_, index) => `wallet-${index}`);
    expect(chunks(addresses, ADDRESSES_PER_CONNECTION).map((group) => streamSubscriptions(group).length))
      .toEqual([25, 1]);
  });
});
