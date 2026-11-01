import { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GlassTabBar, TabKey } from './src/components/GlassTabBar';
import { ConnectivityBanner } from './src/components/ConnectivityBanner';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WalletsScreen } from './src/screens/WalletsScreen';
import { enablePushNotifications, observePushTokenRefresh } from './src/lib/notifications';
import { colors } from './src/theme';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('activity');
  useEffect(() => {
    enablePushNotifications().catch(() => undefined);
    return observePushTokenRefresh();
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

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
  root: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
});
