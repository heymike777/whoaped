import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import Config from 'react-native-config';

import { Activity, Chain, Wallet } from '../types';

const API_URL = Config.API_URL?.replace(/\/$/, '');
const SESSION_KEY = 'whoaped.session-token';
const LOCAL_WALLETS_KEY = 'whoaped.local-wallets';

type SessionResponse = { token: string };

let sessionRequest: Promise<string | null> | undefined;
async function getSessionToken() {
  if (sessionRequest) return sessionRequest;
  sessionRequest = loadSessionToken().finally(() => { sessionRequest = undefined; });
  return sessionRequest;
}

async function loadSessionToken() {
  const saved = await Keychain.getGenericPassword({ service: SESSION_KEY });
  if (saved) return saved.password;
  if (!API_URL) return null;

  const response = await fetch(`${API_URL}/v1/sessions`, { method: 'POST' });
  if (!response.ok) throw new Error('Could not create a secure session.');
  const { token } = (await response.json()) as SessionResponse;
  await Keychain.setGenericPassword('whoaped-session', token, {
    service: SESSION_KEY,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return token;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('API is not configured.');
  const token = await getSessionToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'WhoAped could not reach the tracker.');
  }
  return response.json() as Promise<T>;
}

export type ActivityPage = { data: Activity[]; nextCursor: string | null };

export async function getActivities(cursor?: string): Promise<ActivityPage> {
  if (!API_URL) return { data: [], nextCursor: null };
  const path = `/v1/activities?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  return apiFetch<ActivityPage>(path);
}

export async function getActivity(activityId: string): Promise<Activity> {
  const result = await apiFetch<{ data: Activity }>(`/v1/activities/${encodeURIComponent(activityId)}`);
  return result.data;
}

export function observeActivityStream(
  onActivity: (activity: Activity) => void,
  onReady: () => void,
) {
  if (!API_URL) return () => undefined;

  let stopped = false;
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 1_000;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  };

  const connect = async () => {
    try {
      const token = await getSessionToken();
      if (stopped || !token) return;
      const realtimeUrl = `${API_URL.replace(/^http/, 'ws')}/realtime/activities`;
      socket = new WebSocket(realtimeUrl);
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'auth', token }));
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            data?: Activity;
          };
          if (message.type === 'ready' || message.type === 'sync') {
            reconnectDelay = 1_000;
            onReady();
          } else if (message.type === 'activity' && message.data) {
            onActivity(message.data);
          } else if (message.type === 'ping') {
            socket?.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore malformed realtime frames; the next valid event can still be handled.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = scheduleReconnect;
    } catch {
      scheduleReconnect();
    }
  };

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    socket?.close(1000, 'Activity screen inactive');
    socket = undefined;
  };
}

export async function getWallets(): Promise<Wallet[]> {
  if (!API_URL) {
    const saved = await AsyncStorage.getItem(LOCAL_WALLETS_KEY);
    const wallets = saved ? JSON.parse(saved) as Wallet[] : [];
    return wallets.map((wallet) => ({
      ...wallet,
      transactionCount24h: Number.isFinite(wallet.transactionCount24h)
        ? wallet.transactionCount24h
        : 0,
    }));
  }
  const result = await apiFetch<{ data: Wallet[] }>('/v1/wallets');
  return result.data.map((wallet) => ({
    ...wallet,
    transactionCount24h: Number(wallet.transactionCount24h) || 0,
  }));
}

export async function addWallet(input: { name: string; address: string; chain: Chain }) {
  if (!API_URL) {
    const wallets = await getWallets();
    if (wallets.some((wallet) => wallet.chain === input.chain && wallet.address === input.address)) {
      throw new Error('This wallet is already being tracked.');
    }
    const wallet: Wallet = {
      id: `local-${Date.now()}`,
      ...input,
      status: 'active',
      transactionCount24h: 0,
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(LOCAL_WALLETS_KEY, JSON.stringify([wallet, ...wallets]));
    return wallet;
  }
  return apiFetch<Wallet>('/v1/wallets', { method: 'POST', body: JSON.stringify(input) });
}

export async function deleteWallet(walletId: string) {
  if (!API_URL) {
    const wallets = await getWallets();
    await AsyncStorage.setItem(
      LOCAL_WALLETS_KEY,
      JSON.stringify(wallets.filter((wallet) => wallet.id !== walletId)),
    );
    return;
  }
  await apiFetch<{ ok: true }>(`/v1/wallets/${encodeURIComponent(walletId)}`, {
    method: 'DELETE',
  });
}

export async function registerPushToken(token: string, platform: string) {
  if (!API_URL) return;
  await apiFetch('/v1/devices', {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  });
}


export type Account = {
  id: string;
  preferences: { trackFailedTransactions: boolean };
  telegram: { connected: true; username: string | null; linkedAt?: string } | null;
  entitlements: Array<{ feature: string; expiresAt: string | null }>;
  premium?: { active: boolean; expiresAt: string | null };
  tracking?: { tier?: 'free' | 'premium'; paused: boolean; cooldownUntil: string | null; resuming: boolean; reason: string | null; limits: { minute: number; hour: number; day: number } };
};
export type TelegramLink = { url: string; code: string; expiresAt: string };
const TELEGRAM_LINK_KEY = 'whoaped.telegram-link';
export const getAccount = () => apiFetch<Account>('/v1/account');
export const setTrackFailedTransactions = (enabled: boolean) => apiFetch<{ preferences: Account['preferences'] }>('/v1/account/preferences', {
  method: 'PATCH', body: JSON.stringify({ trackFailedTransactions: enabled }),
});
export const createTelegramLink = () => apiFetch<TelegramLink>('/v1/account/telegram-link', { method: 'POST' });
export const cancelTelegramLink = () => apiFetch('/v1/account/telegram-link', { method: 'DELETE' });
export async function saveTelegramLink(link: TelegramLink | null) {
  if (!link) { await Keychain.resetGenericPassword({ service: TELEGRAM_LINK_KEY }); return; }
  await Keychain.setGenericPassword('telegram-link', JSON.stringify(link), {
    service: TELEGRAM_LINK_KEY, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
export async function getSavedTelegramLink(): Promise<TelegramLink | null> {
  const saved = await Keychain.getGenericPassword({ service: TELEGRAM_LINK_KEY });
  if (!saved) return null;
  try { return JSON.parse(saved.password) as TelegramLink; } catch { return null; }
}

export type PremiumPlanId = 'month' | 'year';
export type BillingCatalog = {
  plans: Array<{ id: PremiumPlanId; label: string; days: number; usdc: number; stars: number }>;
  usdcAvailable: boolean; terms: string; termsVersion: string;
  premium: { active: boolean; expiresAt: string | null };
};
export type StakeOffer = { chain: 'solana'; tokenSymbol: string; tokenMint: string; amount: number; cooldownSeconds: number; available: boolean };
export const getStakeOffer = () => apiFetch<StakeOffer>('/v1/staking/offer');
export type UsdcCheckout = { id: string; transaction: string; amount: number; mint: string; recipient: string; reference: string; expiresAt: string };
export type PaymentStatus = { id: string; status: 'pending' | 'paid' | 'expired' | 'refunded'; premiumUntil: string | null };
export const getBillingCatalog = () => apiFetch<BillingCatalog>('/v1/billing/products');
export const createUsdcCheckout = (plan: PremiumPlanId, payer: string, requestKey: string) => apiFetch<UsdcCheckout>('/v1/billing/usdc/orders', {
  method: 'POST', body: JSON.stringify({ plan, payer, requestKey, acceptsTerms: true }),
});
export const confirmUsdcPayment = (id: string, signature: string) => apiFetch<PaymentStatus>(`/v1/billing/orders/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({ signature }) });
export const getPaymentStatus = (id: string) => apiFetch<PaymentStatus>(`/v1/billing/orders/${encodeURIComponent(id)}`);
