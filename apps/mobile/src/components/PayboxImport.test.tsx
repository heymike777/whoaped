import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import * as api from '../api/client';
import { PayboxImport } from './PayboxImport';
import type { Wallet } from '../types';
jest.mock('../api/client', () => ({ getPayboxAvailability: jest.fn(), startPayboxImport: jest.fn(), getPayboxImport: jest.fn(), cancelPayboxImport: jest.fn(), addWallet: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('../themeContext', () => ({ useThemedStyles: (factory: any) => ({ colors: require('../theme').lightColors, styles: factory(require('../theme').lightColors) }) }));
jest.mock('lucide-react-native', () => ({ Check: () => null, WalletCards: () => null, X: () => null }));
const mock = api as jest.Mocked<typeof api>;
const address = 'So11111111111111111111111111111111111111112';
describe('Paybox import selection', () => {
  let root: TestRenderer.ReactTestRenderer;
  let resume: ((state: AppStateStatus) => void) | undefined;
  const created = jest.fn();
  const pressText = async (text: string) => {
    const button = root.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.findAll(child => typeof child.type === 'string' && String(child.type) === 'Text').some(child => String(child.props.children).includes(text)));
    if (!button) throw new Error(`Missing button: ${text}`);
    await act(async () => { await button.props.onPress(); });
  };
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks();
    mock.getPayboxAvailability.mockResolvedValue({ available: true });
    mock.startPayboxImport.mockResolvedValue({ id: 'import', url: 'https://api.paybox.sh/oauth/authorize' });
    mock.getPayboxImport.mockResolvedValue({ status: 'pending', wallets: [] });
    mock.cancelPayboxImport.mockResolvedValue({});
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { resume = listener; return { remove: jest.fn() }; });
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  });
  afterEach(() => { act(() => root?.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });
  it('imports only explicitly selected wallets after browser authorization', async () => {
    const wallet = { id: 'new', name: 'Trading', address, chain: 'solana', transactionCount24h: 0 } as Wallet;
    mock.addWallet.mockResolvedValue(wallet);
    await act(async () => { root = TestRenderer.create(<PayboxImport wallets={[]} onCreated={created} />); });
    await pressText('Import from Paybox'); await pressText('Continue to Paybox');
    expect(Linking.openURL).toHaveBeenCalledWith('https://api.paybox.sh/oauth/authorize');
    mock.getPayboxImport.mockResolvedValue({ status: 'ready', wallets: [{ name: 'Trading', address }] });
    await act(async () => { resume?.('active'); });
    expect(mock.addWallet).not.toHaveBeenCalled();
    const checkbox = root.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.props.accessibilityRole === 'checkbox')!;
    await act(async () => { checkbox.props.onPress(); });
    await pressText('Track selected');
    expect(mock.addWallet).toHaveBeenCalledWith({ name: 'Trading', address, chain: 'solana' });
    expect(created).toHaveBeenCalledWith(wallet);
  });
  it('hides the entry when the backend is not enabled', async () => {
    mock.getPayboxAvailability.mockResolvedValue({ available: false });
    await act(async () => { root = TestRenderer.create(<PayboxImport wallets={[]} onCreated={created} />); });
    expect(root.toJSON()).toBeNull();
  });
  it('cancels a pending authorization when the sheet closes', async () => {
    await act(async () => { root = TestRenderer.create(<PayboxImport wallets={[]} onCreated={created} />); });
    await pressText('Import from Paybox'); await pressText('Continue to Paybox');
    const close = root.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.props.accessibilityLabel === 'Close')!;
    await act(async () => { close.props.onPress(); });
    expect(mock.cancelPayboxImport).toHaveBeenCalledWith('import');
  });
});
