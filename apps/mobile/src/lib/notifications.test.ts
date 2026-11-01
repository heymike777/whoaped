import { onMessage } from '@react-native-firebase/messaging';
import { observeTrackingNotifications } from './notifications';
jest.mock('@react-native-firebase/app', () => ({ getApp: jest.fn(() => ({})) }));
jest.mock('@react-native-firebase/messaging', () => ({ getMessaging: jest.fn(() => ({})), onMessage: jest.fn() }));
jest.mock('react-native-permissions', () => ({ RESULTS: {} }));
jest.mock('../api/client', () => ({ registerPushToken: jest.fn() }));
describe('cooldown notifications', () => {
  it('surfaces a cooldown in the foreground without treating ordinary transactions as account alerts', () => {
    let receive: Parameters<typeof onMessage>[1] | undefined;
    const unsubscribe = jest.fn();
    jest.mocked(onMessage).mockImplementation((_, handler) => { receive = handler; return unsubscribe; });
    const show = jest.fn();
    const stop = observeTrackingNotifications(show);
    receive?.({ fcmOptions: {}, data: { transactionId: 'activity-1' }, notification: { title: 'Wallet activity', body: 'Transfer' } });
    expect(show).not.toHaveBeenCalled();
    receive?.({ fcmOptions: {}, data: { type: 'tracking_cooldown' }, notification: { title: 'Tracking paused', body: 'Cooldown until 12:01' } });
    expect(show).toHaveBeenCalledWith('Tracking paused', 'Cooldown until 12:01');
    stop(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
