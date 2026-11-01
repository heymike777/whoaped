import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { darkColors, lightColors, type ThemeColors } from './theme';

export type AppearancePreference = 'system' | 'light' | 'dark';

const storageKey = 'whoaped.appearance';

type ThemeContextValue = {
  colors: ThemeColors;
  isDark: boolean;
  preference: AppearancePreference;
  setPreference: (value: AppearancePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  isDark: false,
  preference: 'system',
  setPreference: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setStoredPreference] = useState<AppearancePreference>('system');

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(storageKey).then((value) => {
      if (mounted && (value === 'system' || value === 'light' || value === 'dark')) {
        setStoredPreference(value);
      }
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  const setPreference = useCallback((value: AppearancePreference) => {
    setStoredPreference(value);
    AsyncStorage.setItem(storageKey, value).catch(() => undefined);
  }, []);
  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);
  const isDark = preference === 'dark' || (preference === 'system' && systemScheme === 'dark');
  const value = useMemo(() => ({
    colors: isDark ? darkColors : lightColors,
    isDark,
    preference,
    setPreference,
  }), [isDark, preference, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useThemedStyles<T>(factory: (colors: ThemeColors) => T) {
  const theme = useTheme();
  const styles = useMemo(() => factory(theme.colors), [factory, theme.colors]);
  return { ...theme, styles };
}
