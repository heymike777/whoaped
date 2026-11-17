import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { getBillingCatalog, getPaymentStatus, getStakeOffer, PENDING_PREMIUM_PAYMENT_KEY, type BillingCatalog, type StakeOffer } from '../api/client';
import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function PremiumCard() {
  const { styles } = useThemedStyles(createStyles);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [offer, setOffer] = useState<StakeOffer | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const checking = useRef(false);
  const refresh = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const next = await getBillingCatalog();
      const nextOffer = await getStakeOffer().catch(() => null);
      const id = await AsyncStorage.getItem(PENDING_PREMIUM_PAYMENT_KEY);
      if (id) {
        const status = await getPaymentStatus(id);
        if (status.status !== 'pending') {
          await AsyncStorage.removeItem(PENDING_PREMIUM_PAYMENT_KEY);
          if (mounted.current) {
            setPending(null);
            setMessage(status.status === 'paid' ? 'Your earlier payment was confirmed.' : `Earlier payment ${status.status}. Contact /paysupport in @whoapedbot if you sent funds.`);
          }
        } else if (mounted.current) setPending(id);
      }
      if (mounted.current) { setCatalog(next); setOffer(nextOffer); }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : 'Could not check Premium status.');
    } finally { checking.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { mounted.current = false; subscription.remove(); };
  }, [refresh]);

  return (
    <View style={styles.section}>
      <Text style={styles.label}>PREMIUM</Text>
      <View style={styles.card}>
        <Text style={styles.title}>{catalog?.premium.active ? 'Premium active' : 'Premium · Coming Soon'}</Text>
        <Text style={styles.body}>{catalog?.premium.active
          ? `Valid until ${new Date(catalog.premium.expiresAt!).toLocaleDateString()}. Shared across the app and Telegram.`
          : 'Premium raises tracking limits to 60/min · 1,000/hour · 3,000/day.'}</Text>
        <Text style={styles.body}>Planned: stake {offer?.amount.toLocaleString('en-US') ?? '1,000,000'} project tokens with Streamflow. Request unstaking at any time, then wait 7 days before withdrawal.</Text>
        <Text style={styles.warning}>Coming Soon. Staking is not live; never send tokens to an address claiming to activate Premium.</Text>
        {message && <Text accessibilityRole="alert" style={styles.notice}>{message}</Text>}
        {pending && <Pressable accessibilityRole="button" onPress={refresh} style={styles.secondary}><Text style={styles.buttonText}>Check earlier payment</Text></Pressable>}
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  section: { marginTop: 32, gap: 12 }, label: { marginLeft: 4, color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.25 },
  card: { padding: 16, borderRadius: 22, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontFamily: typography.semibold, fontSize: 15 },
  body: { marginTop: 8, color: colors.textMuted, fontFamily: typography.regular, fontSize: 12, lineHeight: 18 },
  warning: { marginTop: 12, color: colors.coral, fontFamily: typography.medium, fontSize: 12, lineHeight: 18 },
  secondary: { minHeight: 48, marginTop: 8, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: colors.primary, fontFamily: typography.semibold, fontSize: 13 },
  notice: { marginTop: 12, color: colors.text, fontFamily: typography.regular, fontSize: 12, lineHeight: 18 },
});
