import { getAnalytics } from '@react-native-firebase/analytics';

// Never pass wallet addresses, transaction hashes, names or Telegram IDs to GA4.
export function logMobileEvent(name: 'wallet_added' | 'wallet_removed' | 'wallet_add_failed' | 'wallet_remove_failed',
  params: Record<string, string> = {}) {
  getAnalytics().logEvent(name, params).catch(() => undefined);
}

export function logMobileScreen(screen: 'activity' | 'wallets' | 'discovery' | 'settings') {
  getAnalytics().logScreenView({ screen_name: screen, screen_class: 'WhoApedTab' }).catch(() => undefined);
}
