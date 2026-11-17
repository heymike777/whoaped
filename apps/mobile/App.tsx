import { useEffect, useState } from 'react';
import { Alert, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GlassTabBar, TabKey } from './src/components/GlassTabBar';
import { startOverAfterDeletion, wasAccountDeleted } from './src/api/client';
import { ConnectivityBanner } from './src/components/ConnectivityBanner';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { DiscoveryScreen } from './src/screens/DiscoveryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WalletsScreen } from './src/screens/WalletsScreen';
import { enablePushNotifications, observePushTokenRefresh, observeTrackingNotifications } from './src/lib/notifications';
import { ThemeProvider, useTheme } from './src/themeContext';
import { logMobileScreen } from './src/lib/analytics';
import { logCrashScreen } from './src/lib/crashReporting';
import { typography } from './src/theme';

export default function App() {
  return <ThemeProvider><AppContent /></ThemeProvider>;
}

function AppContent() {
  const { colors, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('activity');
  const [accountDeleted, setAccountDeleted] = useState<boolean | null>(null);
  const [startingOver, setStartingOver] = useState(false);
  useEffect(() => {
    let mounted = true;
    wasAccountDeleted().catch(() => false).then(deleted => { if (mounted) setAccountDeleted(deleted); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (accountDeleted !== false) return;
    logMobileScreen(activeTab);
    logCrashScreen(activeTab);
  }, [activeTab, accountDeleted]);
  useEffect(() => {
    if (accountDeleted !== false) return;
    enablePushNotifications().catch(() => undefined);
    const unsubscribeToken = observePushTokenRefresh();
    const unsubscribeTracking = observeTrackingNotifications((title, body) => Alert.alert(title, body));
    return () => { unsubscribeToken(); unsubscribeTracking(); };
  }, [accountDeleted]);

  const startOver = async () => {
    setStartingOver(true);
    try {
      await startOverAfterDeletion();
      setAccountDeleted(false);
    } catch {
      Alert.alert('Could not start over', 'Please try again.');
    } finally {
      setStartingOver(false);
    }
  };

  return (
    <SafeAreaProvider>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

        {accountDeleted === true && (
          <View style={styles.deleted}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Account deleted</Text>
            <Text style={[styles.body, { color: colors.textMuted }]}>You can start a new watchlist anytime.</Text>
            <Pressable accessibilityRole="button" disabled={startingOver} accessibilityState={{ disabled: startingOver }}
              onPress={startOver} style={[styles.startButton, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.startLabel, { color: colors.primary }]}>{startingOver ? 'Starting…' : 'Start over'}</Text>
            </Pressable>
          </View>
        )}
        {accountDeleted === false && <>
        <View style={styles.content}>
          <ConnectivityBanner />
          {activeTab === 'activity' && (
            <ActivityScreen
              onAddWallet={() => setActiveTab('wallets')}
            />
          )}
          {activeTab === 'wallets' && <WalletsScreen />}
          {activeTab === 'discovery' && <DiscoveryScreen />}
          {activeTab === 'settings' && <SettingsScreen onAccountDeleted={() => {
            setActiveTab('activity');
            setAccountDeleted(true);
          }} />}
        </View>

        <GlassTabBar
          activeTab={activeTab}
          onChange={setActiveTab}
        />
        </>}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  deleted: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontFamily: typography.bold, fontSize: 30, textAlign: 'center' },
  body: { fontFamily: typography.regular, fontSize: 15, textAlign: 'center' },
  startButton: { borderRadius: 16, borderWidth: 1, marginTop: 6, paddingHorizontal: 22, minHeight: 48, justifyContent: 'center' },
  startLabel: { fontFamily: typography.semibold, fontSize: 15 },
});
