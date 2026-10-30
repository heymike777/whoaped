import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getActivities, observeActivityStream } from '../api/client';
import { observeActivityNotifications } from '../lib/notifications';
import { Activity, FeedState } from '../types';

export function useActivityFeed(): FeedState {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isRefreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef<Promise<void> | null>(null);

  const load = useCallback(async (showRefresh: boolean, reportError = true) => {
    if (request.current) return request.current;
    if (mounted.current) {
      setError(null);
      if (showRefresh) setRefreshing(true);
    }
    const nextRequest = (async () => {
      try {
        const nextActivities = await getActivities();
        if (mounted.current) setActivities(nextActivities);
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
          if (!mounted.current) return;
          setError(null);
          setLoading(false);
          setActivities((current) => [
            activity,
            ...current.filter((item) => item.id !== activity.id),
          ].sort((left, right) => (
            new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
          )).slice(0, 50));
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
    const unsubscribeNotifications = observeActivityNotifications(() => { load(false, false); });

    return () => {
      mounted.current = false;
      stopStream();
      appStateSubscription.remove();
      unsubscribeNotifications();
    };
  }, [load]);

  return { activities, isLoading, isRefreshing, error, refresh };
}
