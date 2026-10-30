import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { getActivities, observeActivityStream } from '../api/client';
import { observeActivityNotifications } from '../lib/notifications';
import { FeedState } from '../types';
import { useActivityFeed } from './useActivityFeed';

jest.mock('../api/client', () => ({ getActivities: jest.fn(), observeActivityStream: jest.fn() }));
jest.mock('../lib/notifications', () => ({ observeActivityNotifications: jest.fn() }));

const mockGetActivities = getActivities as jest.MockedFunction<typeof getActivities>;
const mockObserveStream = observeActivityStream as jest.MockedFunction<typeof observeActivityStream>;
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
  let streamHandler: ((nextActivity: typeof activity) => void) | undefined;
  const unsubscribe = jest.fn();
  const unsubscribeStream = jest.fn();

  function Probe() {
    latest = useActivityFeed();
    return null;
  }

  beforeEach(() => {
    latest = undefined;
    notificationHandler = undefined;
    streamHandler = undefined;
    unsubscribe.mockReset();
    unsubscribeStream.mockReset();
    mockGetActivities.mockReset().mockResolvedValue([]);
    mockObserveNotifications.mockReset().mockImplementation((handler) => {
      notificationHandler = handler;
      return unsubscribe;
    });
    mockObserveStream.mockReset().mockImplementation((handler) => {
      streamHandler = handler;
      return unsubscribeStream;
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
    expect(latest?.isRefreshing).toBe(false);

    act(() => root!.unmount());
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribeStream).toHaveBeenCalledTimes(1);
  });

  it('adds a realtime activity without polling the feed again', async () => {
    let root: TestRenderer.ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(<Probe />);
    });
    expect(mockGetActivities).toHaveBeenCalledTimes(1);

    act(() => streamHandler?.(activity));

    expect(latest?.activities).toEqual([activity]);
    expect(mockGetActivities).toHaveBeenCalledTimes(1);
    act(() => root!.unmount());
  });
});
