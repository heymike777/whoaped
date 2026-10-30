import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getActivities, getActivity, observeActivityStream } from '../api/client';
import { observeActivityNotifications } from '../lib/notifications';
import { Activity, FeedState } from '../types';

function mergeActivities(...groups: Activity[][]) {
  return [...new Map(groups.flat().map((activity) => [activity.id, activity])).values()]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}

export function useActivityFeed(): FeedState {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isRefreshing, setRefreshing] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef<Promise<void> | null>(null);
  const olderRequest = useRef<Promise<void> | null>(null);
  const nextCursor = useRef<string | null>(null);
  const incoming = useRef(new Map<string, { activity: Activity; receivedAt: number }>());

  const insertIncoming = useCallback((activity: Activity) => {
    if (!mounted.current) return;
    incoming.current.set(activity.id, { activity, receivedAt: Date.now() });
    if (incoming.current.size > 100) incoming.current.delete(incoming.current.keys().next().value!);
    setError(null);
    setLoading(false);
    setActivities((current) => mergeActivities([activity], current));
  }, []);

  const load = useCallback(async (showRefresh: boolean, reportError = true) => {
    if (request.current) return request.current;
    if (mounted.current) {
      setError(null);
      if (showRefresh) setRefreshing(true);
    }
    const startedAt = Date.now();
    const nextRequest = (async () => {
      try {
        const page = await getActivities();
        if (mounted.current) {
          nextCursor.current = page.nextCursor;
          setHasMore(Boolean(page.nextCursor));
          const newIncoming = [...incoming.current.values()]
            .filter((item) => item.receivedAt >= startedAt)
            .map((item) => item.activity);
          setActivities(mergeActivities(page.data, newIncoming));
        }
      } catch (reason) {
        if (mounted.current && reportError) {
          setError(reason instanceof Error ? reason.message : 'Activity could not be loaded.');
        }
      } finally {
        if (mounted.current) {
          setLoading(false);
          if (showRefresh) setRefreshing(false);
        }
        request.current = null;
      }
    })();
    request.current = nextRequest;
    return nextRequest;
  }, []);

  const refresh = useCallback(() => load(true, true), [load]);

  const loadMore = useCallback(async () => {
    if (olderRequest.current) return olderRequest.current;
    const cursor = nextCursor.current;
    if (!cursor) return;
    setLoadMoreError(null);
    setLoadingMore(true);
    const nextRequest = (async () => {
      try {
        const page = await getActivities(cursor);
        if (!mounted.current || nextCursor.current !== cursor) return;
        nextCursor.current = page.nextCursor;
        setHasMore(Boolean(page.nextCursor));
        setActivities((current) => mergeActivities(current, page.data));
      } catch (reason) {
        if (mounted.current) setLoadMoreError(reason instanceof Error ? reason.message : 'Older activity could not be loaded.');
      } finally {
        if (mounted.current) setLoadingMore(false);
        olderRequest.current = null;
      }
    })();
    olderRequest.current = nextRequest;
    return nextRequest;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const initialLoad = load(false);

    let unsubscribeStream: () => void = () => undefined;
    let streamActive = false;
    const stopStream = () => {
      unsubscribeStream();
      unsubscribeStream = () => undefined;
      streamActive = false;
    };
    const startStream = () => {
      if (streamActive) return;
      streamActive = true;
      unsubscribeStream = observeActivityStream(
        (activity) => {
          insertIncoming(activity);
        },
        () => { load(false, false); },
      );
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') {
      initialLoad.finally(() => {
        if (mounted.current && AppState.currentState !== 'background' && AppState.currentState !== 'inactive') {
          startStream();
        }
      });
    }

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        load(false, false).finally(() => {
          if (mounted.current && AppState.currentState === 'active') startStream();
        });
      } else {
        stopStream();
      }
    });
    const unsubscribeNotifications = observeActivityNotifications((transactionId) => {
      load(false, false).then(async () => {
        if (!transactionId) return;
        try {
          insertIncoming(await getActivity(transactionId));
        } catch {
          // A background refresh still keeps the feed usable if a notification is stale.
        }
      });
    });

    return () => {
      mounted.current = false;
      stopStream();
      appStateSubscription.remove();
      unsubscribeNotifications();
    };
  }, [insertIncoming, load]);

  return { activities, isLoading, isRefreshing, isLoadingMore, hasMore, loadMoreError, error, refresh, loadMore };
}
