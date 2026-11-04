import NetInfo from '@react-native-community/netinfo';
import { WifiOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function ConnectivityBanner() {
  const { colors, styles } = useThemedStyles(createStyles);
  const [offline, setOffline] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => NetInfo.addEventListener((state) => setOffline(state.isConnected === false)), []);
  if (!offline) return null;

  return (
    <View style={[styles.banner, { paddingTop: insets.top + 6, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
      <WifiOff color={colors.gold} size={15} />
      <Text style={styles.text}>Offline · reconnect to refresh</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  banner: {
    position: 'absolute',
    zIndex: 10,
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.offlineSurface,
  },
  text: { color: colors.offlineText, fontFamily: typography.medium, fontSize: 12 },
});
