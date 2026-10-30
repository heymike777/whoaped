import { getApp } from '@react-native-firebase/app';
import {
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
} from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import { checkNotifications, requestNotifications, RESULTS } from 'react-native-permissions';

import { registerPushToken } from '../api/client';

async function requestNotificationPermission() {
  if (Platform.OS === 'android') {
    if (Platform.Version < 33) return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  const current = await checkNotifications();
  if (current.status === RESULTS.GRANTED || current.status === RESULTS.LIMITED) return true;
  const requested = await requestNotifications(['alert', 'sound', 'badge']);
  return requested.status === RESULTS.GRANTED || requested.status === RESULTS.LIMITED;
}

function messagingInstance() {
  try {
    return getMessaging(getApp());
  } catch {
    throw new Error('Add the Firebase native configuration files before enabling notifications.');
  }
}

async function hasNotificationPermission() {
  if (Platform.OS === 'android') {
    if (Platform.Version < 33) return true;
    return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  const current = await checkNotifications();
  return current.status === RESULTS.GRANTED || current.status === RESULTS.LIMITED;
}

async function registerCurrentPushToken() {
  const messaging = messagingInstance();
  if (Platform.OS === 'ios') await registerDeviceForRemoteMessages(messaging);
  const token = await getToken(messaging);
  await registerPushToken(token, Platform.OS);
  return token;
}

export async function enablePushNotifications() {
  if (!(await requestNotificationPermission())) {
    throw new Error('Notification permission was not granted.');
  }

  return registerCurrentPushToken();
}

export async function syncEnabledPushNotifications() {
  try {
    if (!(await hasNotificationPermission())) return false;
    await registerCurrentPushToken();
    return true;
  } catch {
    return false;
  }
}

export function observeActivityNotifications(onActivity: (transactionId?: string) => void) {
  try {
    const messaging = messagingInstance();
    const unsubscribeMessage = onMessage(messaging, (message) => {
      onActivity(typeof message.data?.transactionId === 'string' ? message.data.transactionId : undefined);
    });
    const unsubscribeOpened = onNotificationOpenedApp(messaging, (message) => {
      onActivity(typeof message.data?.transactionId === 'string' ? message.data.transactionId : undefined);
    });
    getInitialNotification(messaging)
      .then((message) => {
        if (message) onActivity(typeof message.data?.transactionId === 'string' ? message.data.transactionId : undefined);
      })
      .catch(() => undefined);

    return () => {
      unsubscribeMessage();
      unsubscribeOpened();
    };
  } catch {
    return () => undefined;
  }
}

export function observePushTokenRefresh() {
  try {
    const messaging = messagingInstance();
    return onTokenRefresh(messaging, (token) => {
      registerPushToken(token, Platform.OS).catch(() => undefined);
    });
  } catch {
    return () => undefined;
  }
}
