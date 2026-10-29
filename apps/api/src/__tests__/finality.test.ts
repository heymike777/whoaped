import { afterEach, describe, expect, it, vi } from 'vitest';

import { getFinalizedSlot, waitForFinalizedSignature } from '../services/finality.js';

describe('waitForFinalizedSignature', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HELIUS_API_KEY;
  });

  it('waits until Helius reports finalized commitment', async () => {
    process.env.HELIUS_API_KEY = 'test-key';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: { value: [{ confirmationStatus: 'confirmed', err: null }] },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: { value: [{ confirmationStatus: 'finalized', err: null }] },
      })));
    vi.stubGlobal('fetch', fetchMock);

    await waitForFinalizedSignature('signature', { pollMs: 1, timeoutMs: 100 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      method: 'getSignatureStatuses',
      params: [['signature'], { searchTransactionHistory: true }],
    });
  });

  it('rejects a finalized failed transaction', async () => {
    process.env.HELIUS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { value: [{ confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] } }] },
    }))));

    await expect(waitForFinalizedSignature('failed-signature', { pollMs: 1, timeoutMs: 100 }))
      .rejects.toThrow('Finalized transaction failed-signature failed');
  });

  it('reads the checkpoint boundary at finalized commitment', async () => {
    process.env.HELIUS_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 123_456 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getFinalizedSlot()).resolves.toBe(123_456);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      method: 'getSlot',
      params: [{ commitment: 'finalized' }],
    });
  });
});
