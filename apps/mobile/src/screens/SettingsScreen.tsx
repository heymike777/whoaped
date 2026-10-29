import { Bell, CheckCircle2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enablePushNotifications, syncEnabledPushNotifications } from '../lib/notifications';
import { colors, layout, typography } from '../theme';

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'enabled' | 'error'>('idle');
  const [message, setMessage] = useState('Get an alert after a tracked transaction confirms.');

  useEffect(() => {
    let mounted = true;
    syncEnabledPushNotifications().then((enabled) => {
      if (!mounted || !enabled) return;
      setPushState('enabled');
      setMessage('Push alerts are connected to this device.');
    });
    return () => { mounted = false; };
  }, []);

  const enable = async () => {
    setPushState('loading');
    try {
      await enablePushNotifications();
      setPushState('enabled');
      setMessage('Push alerts are connected to this device.');
    } catch (reason) {
      setPushState('error');
      setMessage(reason instanceof Error ? reason.message : 'Notifications could not be enabled.');
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Settings</Text>
      <Text style={styles.subheading}>Notification preferences.</Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
        <View style={styles.card}>
          <View style={[styles.icon, pushState === 'enabled' && styles.iconEnabled]}>
            {pushState === 'enabled' ? <CheckCircle2 color={colors.primary} size={21} /> : <Bell color={colors.gold} size={21} />}
          </View>
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>Wallet activity</Text>
            <Text style={[styles.cardBody, pushState === 'error' && styles.errorText]}>{message}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pushState === 'loading' || pushState === 'enabled' }}
            disabled={pushState === 'loading' || pushState === 'enabled'}
            onPress={enable}
            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
          >
            <Text style={styles.smallButtonText}>{pushState === 'enabled' ? 'On' : pushState === 'loading' ? 'Wait' : 'Enable'}</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.version}>WHOAPED · MVP 0.1.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingBottom: 124 },
  eyebrow: { color: colors.primary, fontFamily: typography.mono, fontSize: 10, letterSpacing: 1.35 },
  heading: { color: colors.text, fontFamily: typography.bold, fontSize: 38, letterSpacing: -1.1 },
  subheading: { marginTop: 7, color: colors.textMuted, fontFamily: typography.regular, fontSize: 15 },
  section: { marginTop: 30, gap: 10 },
  sectionLabel: { marginLeft: 3, color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.25 },
  card: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 22, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  icon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  iconEnabled: { backgroundColor: colors.primarySoft },
  copy: { flex: 1 },
  cardTitle: { color: colors.text, fontFamily: typography.semibold, fontSize: 15 },
  cardBody: { marginTop: 4, color: colors.textMuted, fontFamily: typography.regular, fontSize: 12, lineHeight: 17 },
  errorText: { color: colors.coral },
  smallButton: { minWidth: 58, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, borderRadius: 14, backgroundColor: colors.primarySoft },
  smallButtonText: { color: colors.primary, fontFamily: typography.semibold, fontSize: 12 },
  pressed: { opacity: 0.7 },
  version: { marginTop: 28, color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.1, textAlign: 'center' },
});
