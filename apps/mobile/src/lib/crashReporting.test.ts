import { getCrashlytics, log, recordError, setAttribute } from '@react-native-firebase/crashlytics';

import { logCrashScreen, recordActivityRenderError } from './crashReporting';

jest.mock('@react-native-firebase/crashlytics', () => ({
  getCrashlytics: jest.fn(() => ({})),
  log: jest.fn(),
  recordError: jest.fn(),
  setAttribute: jest.fn(() => Promise.resolve()),
}));

it('tags a screen without wallet or transaction identifiers', () => {
  logCrashScreen('activity');
  expect(log).toHaveBeenCalledWith(expect.anything(), 'Opened activity tab');
  expect(setAttribute).toHaveBeenCalledWith(expect.anything(), 'screen', 'activity');
});

it('records a recovered activity render error as non-fatal', () => {
  const error = new Error('Malformed card');
  recordActivityRenderError(error);
  expect(recordError).toHaveBeenCalledWith(expect.anything(), error, 'ActivityRenderError');
});

it('does not let a reporting failure crash the UI', () => {
  (getCrashlytics as jest.Mock).mockImplementationOnce(() => { throw new Error('SDK unavailable'); });
  expect(() => logCrashScreen('activity')).not.toThrow();
});
