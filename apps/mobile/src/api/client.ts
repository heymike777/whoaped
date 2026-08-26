import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import Config from 'react-native-config';

import { demoActivities, demoWallets } from '../data/demo';
import { Activity, Chain, Wallet } from '../types';

const API_URL = Config.API_URL?.replace(/\/$/, '');
const SESSION_KEY = 'whoaped.session-token';
const LOCAL_WALLETS_KEY = 'whoaped.local-wallets';

type SessionResponse = { token: string };

async function getSessionToken() {
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

export function isDemoMode() {
  return !API_URL;
}

export async function getActivities(): Promise<Activity[]> {
  if (!API_URL) {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 450));
    return demoActivities;
  }
  const result = await apiFetch<{ data: Activity[] }>('/v1/activities?limit=50');
  return result.data;
}

export async function getWallets(): Promise<Wallet[]> {
  if (!API_URL) {
    const saved = await AsyncStorage.getItem(LOCAL_WALLETS_KEY);
    return saved ? JSON.parse(saved) as Wallet[] : demoWallets;
  }
  const result = await apiFetch<{ data: Wallet[] }>('/v1/wallets');
  return result.data;
}

export async function addWallet(input: { name: string; address: string; chain: Chain }) {
  if (!API_URL) {
    const wallets = await getWallets();
    const wallet: Wallet = {
      id: `local-${Date.now()}`,
      ...input,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(LOCAL_WALLETS_KEY, JSON.stringify([wallet, ...wallets]));
    return wallet;
  }
  return apiFetch<Wallet>('/v1/wallets', { method: 'POST', body: JSON.stringify(input) });
}

export async function registerPushToken(token: string, platform: string) {
  if (!API_URL) return;
  await apiFetch('/v1/devices', {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  });
}
