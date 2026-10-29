import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getActivities } from '../api/client';
import { observeActivityNotifications } from '../lib/notifications';
import { Activity, FeedState } from '../types';

const FOREGROUND_REFRESH_MS = 10_000;

export function useActivityFeed(): FeedState {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isRefreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const request = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (request.current) return request.current;
    if (mounted.current) {
      setError(null);
      setRefreshing(true);
    }
    const nextRequest = (async () => {
      try {
        const nextActivities = await getActivities();
        if (mounted.current) setActivities(nextActivities);
      } catch (reason) {
        if (mounted.current) {
          setError(reason instanceof Error ? reason.message : 'Activity could not be loaded.');
        }
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
        request.current = null;
      }
    })();
    request.current = nextRequest;
    return nextRequest;
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();

    const interval = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, FOREGROUND_REFRESH_MS);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const unsubscribeNotifications = observeActivityNotifications(refresh);

    return () => {
      mounted.current = false;
      clearInterval(interval);
      appStateSubscription.remove();
      unsubscribeNotifications();
    };
  }, [refresh]);

  return { activities, isLoading, isRefreshing, error, refresh };
}
