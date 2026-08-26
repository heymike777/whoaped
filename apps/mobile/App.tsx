import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StatusBar, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GlassTabBar, TabKey } from './src/components/GlassTabBar';
import { ConnectivityBanner } from './src/components/ConnectivityBanner';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WalletsScreen } from './src/screens/WalletsScreen';
import { observePushTokenRefresh } from './src/lib/notifications';
import { colors } from './src/theme';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('activity');
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => observePushTokenRefresh(), []);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <LinearGradient
          colors={[colors.background, colors.backgroundMid, colors.background]}
          locations={[0, 0.52, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.glowTop} pointerEvents="none" />
        <View style={styles.glowBottom} pointerEvents="none" />

        <View style={styles.content}>
          <ConnectivityBanner />
          {activeTab === 'activity' && <ActivityScreen reduceMotion={reduceMotion} />}
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
  glowTop: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.glowMint,
    top: Platform.OS === 'ios' ? -130 : -160,
    right: -90,
  },
  glowBottom: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: colors.glowBlue,
    bottom: 40,
    left: -160,
  },
});
