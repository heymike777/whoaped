import { Bell, CheckCircle2, ExternalLink, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TelegramAccountCard } from '../components/TelegramAccountCard';
import { deleteAccount, getAccount, setTrackFailedTransactions } from '../api/client';
import { enablePushNotifications, syncEnabledPushNotifications } from '../lib/notifications';
import { type ThemeColors, layout, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function SettingsScreen({ onAccountDeleted }: { onAccountDeleted: () => void }) {
  const { colors, styles, preference, setPreference } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [pushState, setPushState] = useState<'idle' | 'loading' | 'enabled' | 'error'>('idle');
  const [message, setMessage] = useState('Get an alert after a tracked transaction confirms.');
  const [trackFailed, setTrackFailed] = useState(false);
  const [failedLoading, setFailedLoading] = useState(true);
  const [failedSaving, setFailedSaving] = useState(false);
  const [failedError, setFailedError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let mounted = true;
    syncEnabledPushNotifications().then((enabled) => {
      if (!mounted || !enabled) return;
      setPushState('enabled');
      setMessage('Push alerts are connected to this device.');
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    getAccount().then((account) => {
      if (mounted) setTrackFailed(account.preferences?.trackFailedTransactions === true);
    }).catch((error) => {
      if (mounted) setFailedError(error instanceof Error ? error.message : 'Could not load transaction settings.');
    }).finally(() => { if (mounted) setFailedLoading(false); });
    return () => { mounted = false; };
  }, []);

  const toggleFailed = async (enabled: boolean) => {
    setFailedSaving(true);
    setFailedError(null);
    try {
      const result = await setTrackFailedTransactions(enabled);
      setTrackFailed(result.preferences.trackFailedTransactions);
    } catch (error) {
      setFailedError(error instanceof Error ? error.message : 'Could not save transaction settings.');
    } finally {
      setFailedSaving(false);
    }
  };

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

  const confirmDeletion = () => {
    Alert.alert('Delete account?',
      'This permanently removes your WhoAped watchlist and activity history, including any linked Telegram watchlist, and stops your alerts. Public blockchain records remain. We keep limited records of past payments for receipts, disputes, and refunds.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            await deleteAccount();
            onAccountDeleted();
          } catch {
            setDeleting(false);
            Alert.alert('Could not confirm deletion', 'Please try again. If the account was already deleted, trying again will finish clearing this device.');
          }
        } },
      ]);
  };

  return (
    <ScrollView contentContainerStyle={[styles.content, width >= 700 && styles.wideContent, {
      paddingTop: insets.top + 18,
      paddingLeft: layout.gutter + (width >= 700 ? 0 : insets.left),
      paddingRight: layout.gutter + (width >= 700 ? 0 : insets.right),
      paddingBottom: 90 + insets.bottom,
    }]} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Settings</Text>
      <Text style={styles.subheading}>Account and preferences.</Text>

      <TelegramAccountCard />

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: deleting, busy: deleting }}
          disabled={deleting} onPress={confirmDeletion} style={({ pressed }) => [styles.linksCard, pressed && styles.pressed]}>
          <View style={styles.legalLink}>
            <Text style={[styles.cardTitle, styles.errorText]}>{deleting ? 'Deleting account…' : 'Delete account'}</Text>
            <Trash2 color={colors.coral} size={18} />
          </View>
        </Pressable>
      </View>

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
        <Text style={styles.sectionLabel}>TRANSACTIONS</Text>
        <View style={styles.card}>
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>Failed transactions</Text>
            <Text style={styles.cardBody}>Show and alert on transactions that landed on Solana but failed during execution.</Text>
          </View>
          <Switch
            accessibilityLabel="Track failed transactions"
            disabled={failedLoading || failedSaving}
            onValueChange={toggleFailed}
            trackColor={{ false: colors.borderStrong, true: colors.primary }}
            thumbColor={colors.surface}
            value={trackFailed}
          />
        </View>
        {failedError && <Text accessibilityRole="alert" style={styles.errorText}>{failedError}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>APPEARANCE</Text>
        <View style={styles.appearanceCard}>
          <Text style={styles.cardTitle}>Theme</Text>
          <Text style={styles.cardBody}>Choose how WhoAped looks on this device.</Text>
          <View accessibilityRole="radiogroup" style={styles.themeOptions}>
            {(['system', 'light', 'dark'] as const).map((option) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: preference === option }}
                key={option}
                onPress={() => setPreference(option)}
                style={({ pressed }) => [styles.themeOption, preference === option && styles.themeOptionSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.themeOptionText, preference === option && styles.themeOptionTextSelected]}>
                  {option === 'system' ? 'System' : option === 'light' ? 'Light' : 'Dark'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.linksCard}>
          {([['Privacy Policy', 'https://whoaped.com/privacy/'], ['Terms of Service', 'https://whoaped.com/terms/']] as const).map(([label, url]) => (
            <Pressable
              key={label}
              accessibilityRole="link"
              onPress={() => { void Linking.openURL(url); }}
              style={({ pressed }) => [styles.legalLink, pressed && styles.pressed]}
            >
              <Text style={styles.cardTitle}>{label}</Text>
              <ExternalLink size={16} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.version}>WHOAPED · 1.0.0</Text>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  content: { width: '100%', alignSelf: 'center' },
  wideContent: { maxWidth: 720 },
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
  appearanceCard: { padding: 16, borderRadius: 22, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  linksCard: { paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  legalLink: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  themeOptions: { flexDirection: 'row', gap: 6, marginTop: 18, padding: 4, borderRadius: 15, backgroundColor: colors.background },
  themeOption: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  themeOptionSelected: { backgroundColor: colors.surfaceRaised },
  themeOptionText: { color: colors.textMuted, fontFamily: typography.medium, fontSize: 13 },
  themeOptionTextSelected: { color: colors.text, fontFamily: typography.semibold },
  pressed: { opacity: 0.7 },
  version: { marginTop: 28, color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.1, textAlign: 'center' },
});
