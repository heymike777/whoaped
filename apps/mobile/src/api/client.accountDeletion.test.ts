import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { deleteAccount, startOverAfterDeletion, wasAccountDeleted } from './client';

jest.mock('react-native-config', () => ({ API_URL: 'https://api.example.test' }));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(), resetGenericPassword: jest.fn(), STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), multiRemove: jest.fn(),
}));

const originalFetch = globalThis.fetch;
const request = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  request.mockReset();
  globalThis.fetch = request;
});

afterAll(() => { globalThis.fetch = originalFetch; });

test('retains the credential for a retry when the server response is lost', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue({ username: 'whoaped-session', password: 'old-token',
    service: 'whoaped.session-token', storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH });
  request.mockRejectedValueOnce(new Error('Network connection lost')).mockResolvedValueOnce({ status: 204 });

  await expect(deleteAccount()).rejects.toThrow('Network connection lost');
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();

  const retry = deleteAccount();
  expect(deleteAccount()).toBe(retry);
  await retry;
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith('https://api.example.test/v1/account', expect.objectContaining({
    method: 'DELETE', headers: { Authorization: 'Bearer old-token' },
  }));
  expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['whoaped.local-wallets', 'whoaped.pending-premium-payment']);
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'whoaped.telegram-link' });
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'whoaped.session-token' });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('whoaped.account-deleted', 'true');
});

test('does not open a server session to delete local data or start over', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('true');
  await deleteAccount();
  expect(await wasAccountDeleted()).toBe(true);
  await startOverAfterDeletion();
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('whoaped.account-deleted');
  expect(request).not.toHaveBeenCalled();
});
