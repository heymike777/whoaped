import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { getActivities } from '../api/client';
import { observeActivityNotifications } from '../lib/notifications';
import { FeedState } from '../types';
import { useActivityFeed } from './useActivityFeed';

jest.mock('../api/client', () => ({ getActivities: jest.fn() }));
jest.mock('../lib/notifications', () => ({ observeActivityNotifications: jest.fn() }));

const mockGetActivities = getActivities as jest.MockedFunction<typeof getActivities>;
const mockObserveNotifications = observeActivityNotifications as jest.MockedFunction<typeof observeActivityNotifications>;

const activity = {
  id: 'activity-1',
  walletId: 'wallet-1',
  walletName: 'Primary',
  walletAddress: 'address',
  chain: 'solana' as const,
  kind: 'balance' as const,
  title: 'Balance changed',
  detail: '+1 SOL',
  signature: 'signature',
  occurredAt: '2026-10-29T12:00:00.000Z',
};

describe('useActivityFeed', () => {
  let latest: FeedState | undefined;
  let notificationHandler: (() => void) | undefined;
  const unsubscribe = jest.fn();

  function Probe() {
    latest = useActivityFeed();
    return null;
  }

  beforeEach(() => {
    latest = undefined;
    notificationHandler = undefined;
    unsubscribe.mockReset();
    mockGetActivities.mockReset().mockResolvedValue([]);
    mockObserveNotifications.mockReset().mockImplementation((handler) => {
      notificationHandler = handler;
      return unsubscribe;
    });
  });

  it('refreshes the feed when a foreground push arrives', async () => {
    let root: TestRenderer.ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(<Probe />);
    });
    expect(mockGetActivities).toHaveBeenCalledTimes(1);

    mockGetActivities.mockResolvedValueOnce([activity]);
    await act(async () => {
      notificationHandler?.();
      await Promise.resolve();
    });

    expect(mockGetActivities).toHaveBeenCalledTimes(2);
    expect(latest?.activities).toEqual([activity]);

    act(() => root!.unmount());
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
