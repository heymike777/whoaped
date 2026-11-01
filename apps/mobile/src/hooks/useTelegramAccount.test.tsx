import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import * as api from '../api/client';
import { useTelegramAccount } from './useTelegramAccount';
jest.mock('../api/client', () => ({ getAccount: jest.fn(), getSavedTelegramLink: jest.fn(), saveTelegramLink: jest.fn(), createTelegramLink: jest.fn(), cancelTelegramLink: jest.fn() }));
const mock = api as jest.Mocked<typeof api>;
const account: api.Account = { id: 'mobile', telegram: null, entitlements: [], preferences: { trackFailedTransactions: false } };
const link: api.TelegramLink = { url: 'https://t.me/whoapedbot?start=link_token', code: '123456', expiresAt: new Date(Date.now() + 600_000).toISOString() };
let latest: ReturnType<typeof useTelegramAccount>;
function Probe() { latest = useTelegramAccount(); return null; }
describe('Connect Telegram', () => {
  let root: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks();
    mock.getAccount.mockResolvedValue(account); mock.getSavedTelegramLink.mockResolvedValue(null);
    mock.createTelegramLink.mockResolvedValue(link); mock.saveTelegramLink.mockResolvedValue(undefined);
    mock.cancelTelegramLink.mockResolvedValue({});
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => { act(() => root?.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });
  it('stores a one-time link before opening Telegram and shows its verification code', async () => {
    await act(async () => { root = TestRenderer.create(<Probe />); });
    await act(async () => { await latest.connect(); });
    expect(mock.saveTelegramLink).toHaveBeenCalledWith(link);
    expect(Linking.openURL).toHaveBeenCalledWith(link.url);
    expect(latest.pending?.code).toBe('123456');
  });
  it('recognizes bot confirmation on returning to the app and clears the pending link', async () => {
    let resume: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { resume = listener; return { remove: jest.fn() }; });
    mock.getSavedTelegramLink.mockResolvedValue(link);
    await act(async () => { root = TestRenderer.create(<Probe />); });
    mock.getAccount.mockResolvedValue({ ...account, id: 'telegram:123', telegram: { connected: true, username: 'mike' } });
    await act(async () => { resume?.('active'); });
    expect(latest.account?.telegram?.username).toBe('mike');
    expect(latest.pending).toBeNull(); expect(mock.saveTelegramLink).toHaveBeenCalledWith(null);
  });
  it('invalidates a cancelled connection on the server', async () => {
    mock.getSavedTelegramLink.mockResolvedValue(link);
    await act(async () => { root = TestRenderer.create(<Probe />); });
    mock.getSavedTelegramLink.mockResolvedValue(null);
    await act(async () => { await latest.cancel(); });
    expect(mock.cancelTelegramLink).toHaveBeenCalledTimes(1);
    expect(latest.pending).toBeNull();
  });
  it('keeps a pending link available if opening Telegram fails', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('Cannot open Telegram'));
    await act(async () => { root = TestRenderer.create(<Probe />); });
    await act(async () => { await latest.connect(); });
    expect(latest.pending?.code).toBe(link.code); expect(latest.error).toContain('Cannot open');
  });
  it('expires a saved link without connecting the account', async () => {
    mock.getSavedTelegramLink.mockResolvedValue({ ...link, expiresAt: new Date(0).toISOString() });
    await act(async () => { root = TestRenderer.create(<Probe />); });
    expect(latest.pending).toBeNull(); expect(latest.error).toContain('expired');
    expect(latest.account?.telegram).toBeNull();
  });
});
