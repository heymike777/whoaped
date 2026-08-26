import { useCallback, useEffect, useState } from 'react';

import { getActivities, isDemoMode } from '../api/client';
import { Activity, FeedState } from '../types';

export function useActivityFeed(): FeedState {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setActivities(await getActivities());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Activity could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { activities, isLoading, error, isDemo: isDemoMode(), refresh };
}
