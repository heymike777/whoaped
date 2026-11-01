import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import {
  type Account, type TelegramLink, cancelTelegramLink, createTelegramLink,
  getAccount, getSavedTelegramLink, saveTelegramLink,
} from '../api/client';

export function useTelegramAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [pending, setPending] = useState<TelegramLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const next = await getAccount();
      const saved = await getSavedTelegramLink();
      const expired = saved && new Date(saved.expiresAt).getTime() <= Date.now();
      if (next.telegram || expired) await saveTelegramLink(null);
      if (!mounted.current) return;
      setAccount(next);
      setPending(next.telegram || expired ? null : saved);
      setError(expired && !next.telegram ? 'Connection expired. Tap Connect Telegram to try again.' : null);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not load your account.');
    } finally {
      refreshing.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => { mounted.current = false; subscription.remove(); };
  }, [refresh]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const connect = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const link = await createTelegramLink();
      await saveTelegramLink(link);
      if (mounted.current) setPending(link);
      await Linking.openURL(link.url);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not open Telegram. Try again.');
    } finally { if (mounted.current) setBusy(false); }
  }, []);

  const reopen = useCallback(async () => {
    if (!pending) return;
    try { await Linking.openURL(pending.url); }
    catch { setError('Could not open Telegram. Install Telegram or open the link in your browser.'); }
  }, [pending]);

  const cancel = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      await cancelTelegramLink();
      await saveTelegramLink(null);
      if (mounted.current) setPending(null);
      await refresh();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not cancel. Try again.');
    } finally { if (mounted.current) setBusy(false); }
  }, [refresh]);

  return { account, pending, loading, busy, error, connect, reopen, cancel, refresh };
}
