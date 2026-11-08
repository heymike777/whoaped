import { getCrashlytics, log, recordError, setAttribute } from '@react-native-firebase/crashlytics';

type Screen = 'activity' | 'wallets' | 'discovery' | 'settings';

// Keep crash context useful without sending wallet addresses, names, or transaction IDs.
export function logCrashScreen(screen: Screen) {
  try {
    const crashlytics = getCrashlytics();
    log(crashlytics, `Opened ${screen} tab`);
    setAttribute(crashlytics, 'screen', screen).catch(() => undefined);
  } catch {
    // Crash reporting must never prevent a screen from opening.
  }
}

export function recordActivityRenderError(error: Error) {
  try {
    const crashlytics = getCrashlytics();
    log(crashlytics, 'Activity card render failed');
    recordError(crashlytics, error, 'ActivityRenderError');
  } catch {
    // An unavailable reporter must not turn a recovered card error into a crash.
  }
}
