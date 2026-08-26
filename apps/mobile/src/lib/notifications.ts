import { getApp } from '@react-native-firebase/app';
import {
  getMessaging,
  getToken,
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

export async function enablePushNotifications() {
  if (!(await requestNotificationPermission())) {
    throw new Error('Notification permission was not granted.');
  }

  const messaging = messagingInstance();
  if (Platform.OS === 'ios') await registerDeviceForRemoteMessages(messaging);
  const token = await getToken(messaging);
  await registerPushToken(token, Platform.OS);
  return token;
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
