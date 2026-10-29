import { Bell, CheckCircle2, Database, Server, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enablePushNotifications } from '../lib/notifications';
import { colors, layout, typography } from '../theme';

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'enabled' | 'error'>('idle');
  const [message, setMessage] = useState('Get an alert after a tracked transaction confirms.');

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
      <Text style={styles.subheading}>Notifications, tracking and privacy.</Text>

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

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>TRACKING STACK</Text>
        <StackRow icon={Server} label="Solana ingestion" value="Helius webhooks" />
        <StackRow icon={Database} label="Transaction store" value="MongoDB" />
        <StackRow icon={ShieldCheck} label="Wallet access" value="Watch-only" />
      </View>

      <View style={styles.privacyCard}>
        <ShieldCheck color={colors.primary} size={22} />
        <Text style={styles.privacyTitle}>Public addresses only</Text>
        <Text style={styles.privacyBody}>WhoAped never connects to, signs with, or stores private wallet credentials.</Text>
      </View>

      <Text style={styles.version}>WHOAPED · MVP 0.1.0</Text>
    </ScrollView>
  );
}

function StackRow({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Icon color={colors.textMuted} size={19} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
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
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 15, borderRadius: 18, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  rowLabel: { flex: 1, color: colors.text, fontFamily: typography.medium, fontSize: 13 },
  rowValue: { color: colors.textMuted, fontFamily: typography.mono, fontSize: 10 },
  privacyCard: { marginTop: 30, alignItems: 'flex-start', padding: 20, borderRadius: 22, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryBorder },
  privacyTitle: { marginTop: 13, color: colors.text, fontFamily: typography.semibold, fontSize: 16 },
  privacyBody: { marginTop: 5, maxWidth: 320, color: colors.textMuted, fontFamily: typography.regular, fontSize: 13, lineHeight: 19 },
  version: { marginTop: 28, color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.1, textAlign: 'center' },
});
