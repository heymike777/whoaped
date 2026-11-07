import { StyleSheet, Text, View } from 'react-native';
import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function BalanceChanges({ lines, walletName, failed = false }: { lines?: string[]; walletName?: string; failed?: boolean }) {
  const { styles } = useThemedStyles(createStyles);
  const changes = lines?.filter(line => typeof line === 'string' && line.trim().length > 0) ?? [];
  if (changes.length === 0) return null;
  return (
    <View testID="balance-changes" style={[styles.container, failed && styles.failedContainer]}>
      <Text numberOfLines={1} style={[walletName ? styles.walletLabel : styles.label, failed && styles.failedLabel]}>{walletName ?? 'NET CHANGE'}</Text>
      {changes.map((line, index) => {
        const match = /^([+−-][\d,.]+)\s+(.+)$/.exec(line);
        return match ? (
          <View key={index} style={styles.row}>
            <Text numberOfLines={1} style={styles.asset}>{match[2]}</Text>
            <Text selectable style={[styles.amount, line.startsWith('+') ? styles.incoming : styles.outgoing]}>{match[1]}</Text>
          </View>
        ) : <Text key={index} style={styles.neutral}>{line}</Text>;
      })}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { marginHorizontal: 12, marginBottom: 12, paddingTop: 11, gap: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  failedContainer: { borderTopColor: `${colors.destructive}30` },
  label: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.2, marginBottom: 2 },
  failedLabel: { color: colors.destructive },
  walletLabel: { color: colors.text, fontFamily: typography.semibold, fontSize: 12, marginBottom: 3 },
  row: { minHeight: 22, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  asset: { flex: 1, color: colors.textMuted, fontFamily: typography.medium, fontSize: 12 },
  amount: { color: colors.text, fontFamily: typography.mono, fontSize: 13, lineHeight: 20, flexShrink: 0 },
  incoming: { color: colors.positive },
  outgoing: { color: colors.destructive },
  neutral: { color: colors.textMuted, fontFamily: typography.regular, fontSize: 12 },
});
