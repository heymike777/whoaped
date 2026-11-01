import { useEffect, useState } from 'react';
import { Alert, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GlassTabBar, TabKey } from './src/components/GlassTabBar';
import { ConnectivityBanner } from './src/components/ConnectivityBanner';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WalletsScreen } from './src/screens/WalletsScreen';
import { enablePushNotifications, observePushTokenRefresh, observeTrackingNotifications } from './src/lib/notifications';
import { ThemeProvider, useTheme } from './src/themeContext';

export default function App() {
  return <ThemeProvider><AppContent /></ThemeProvider>;
}

function AppContent() {
  const { colors, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('activity');
  useEffect(() => {
    enablePushNotifications().catch(() => undefined);
    const unsubscribeToken = observePushTokenRefresh();
    const unsubscribeTracking = observeTrackingNotifications((title, body) => Alert.alert(title, body));
    return () => { unsubscribeToken(); unsubscribeTracking(); };
  }, []);

  return (
    <SafeAreaProvider>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

        <View style={styles.content}>
          <ConnectivityBanner />
          {activeTab === 'activity' && (
            <ActivityScreen
              onAddWallet={() => setActiveTab('wallets')}
            />
          )}
          {activeTab === 'wallets' && <WalletsScreen />}
          {activeTab === 'settings' && <SettingsScreen />}
        </View>

        <GlassTabBar
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
