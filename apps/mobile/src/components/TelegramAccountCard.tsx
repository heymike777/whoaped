import { CheckCircle2, Send } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTelegramAccount } from '../hooks/useTelegramAccount';
import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function TelegramAccountCard() {
  const { colors, styles } = useThemedStyles(createStyles);
  const { account, pending, loading, busy, error, connect, reopen, cancel, refresh } = useTelegramAccount();
  const connected = Boolean(account?.telegram);
  return (
    <View style={styles.section}>
      <Text style={styles.label}>ACCOUNT</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.icon}>
            {connected ? <CheckCircle2 color={colors.primary} size={22} /> : <Send color={colors.primary} size={22} />}
          </View>
          <View style={styles.copy}>
            <Text style={styles.title}>{connected ? 'Telegram connected' : 'Connect Telegram'}</Text>
            <Text style={styles.body}>
              {connected
                ? `${account?.telegram?.username ? `@${account.telegram.username} · ` : ''}One account. Your wallets are shared with the bot.`
                : 'Keep your wallets together in the app and Telegram. Get transaction alerts in both.'}
            </Text>
          </View>
        </View>
        {pending && !connected && (
          <View style={styles.verification}>
            <Text style={styles.body}>Match this code in @whoapedbot, then tap Confirm connection.</Text>
            <Text selectable accessibilityLabel={`Verification code ${pending.code}`} style={styles.code}>{pending.code}</Text>
            <Text style={styles.body}>Your wallet lists will be combined. The link expires after 10 minutes.</Text>
          </View>
        )}
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!connected && (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || loading }}
              disabled={busy || loading}
              onPress={pending ? reopen : account ? connect : refresh}
              style={({ pressed }) => [styles.button, (pressed || busy || loading) && styles.pressed]}
            >
              <Text style={styles.buttonText}>{loading ? 'Checking account…' : busy ? 'Please wait…' : pending ? 'Open Telegram' : account ? 'Connect Telegram' : 'Try again'}</Text>
            </Pressable>
            {pending && (
              <Pressable accessibilityRole="button" disabled={busy} onPress={cancel} style={styles.cancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  section: { marginTop: 32, gap: 12 },
  label: { marginLeft: 4, color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.25 },
  card: { padding: 16, borderRadius: 22, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  copy: { flex: 1 },
  title: { color: colors.text, fontFamily: typography.semibold, fontSize: 15 },
  body: { marginTop: 4, color: colors.textMuted, fontFamily: typography.regular, fontSize: 12, lineHeight: 18 },
  verification: { marginTop: 16, padding: 16, borderRadius: 16, backgroundColor: colors.background },
  code: { marginVertical: 12, color: colors.text, fontFamily: typography.mono, fontSize: 28, letterSpacing: 6 },
  error: { marginTop: 12, color: colors.coral, fontFamily: typography.regular, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  button: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primarySoft },
  buttonText: { color: colors.primary, fontFamily: typography.semibold, fontSize: 13 },
  cancel: { minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.textMuted, fontFamily: typography.medium, fontSize: 13 },
  pressed: { opacity: 0.65 },
});
