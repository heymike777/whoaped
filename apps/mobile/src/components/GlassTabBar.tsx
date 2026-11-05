import { Activity, Compass, Settings, WalletCards } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export type TabKey = 'activity' | 'wallets' | 'discovery' | 'settings';

type Props = {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
};

const tabs = [
  { key: 'activity' as const, label: 'Activity', Icon: Activity },
  { key: 'wallets' as const, label: 'Wallets', Icon: WalletCards },
  { key: 'discovery' as const, label: 'Discover', Icon: Compass },
  { key: 'settings' as const, label: 'Settings', Icon: Settings },
];

export function GlassTabBar({ activeTab, onChange }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();

  const select = (tab: TabKey) => {
    if (tab === activeTab) return;
    ReactNativeHapticFeedback.trigger('selection', {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
    onChange(tab);
  };

  return (
    <View style={[styles.positioner, { bottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.glass}>
        <View style={styles.inner}>
          {tabs.map(({ key, label, Icon }) => {
            const selected = key === activeTab;
            return (
              <Pressable
                accessibilityLabel={`${label} tab`}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                hitSlop={4}
                key={key}
                onPress={() => select(key)}
                style={({ pressed }) => [
                  styles.tab,
                  selected && styles.tabSelected,
                  pressed && styles.tabPressed,
                ]}
              >
                <Icon
                  color={selected ? colors.primary : colors.textMuted}
                  size={20}
                  strokeWidth={selected ? 2.4 : 1.8}
                />
                <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  positioner: {
    position: 'absolute',
    left: 18,
    right: 18,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.44,
    shadowRadius: 24,
    elevation: 18,
  },
  glass: {
    overflow: 'hidden',
    borderRadius: 27,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass,
  },
  inner: { flexDirection: 'row', gap: 4, padding: 5 },
  tab: {
    minHeight: 56,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 22,
  },
  tabSelected: { backgroundColor: colors.primarySoft },
  tabPressed: { opacity: 0.72 },
  label: {
    color: colors.textMuted,
    fontFamily: typography.medium,
    fontSize: 11,
    letterSpacing: 0.1,
  },
  labelSelected: { color: colors.primary },
});
