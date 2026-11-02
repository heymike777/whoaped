import { StyleSheet, Text, View } from 'react-native';
import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function BalanceChanges({ lines }: { lines?: string[] }) {
  const { styles } = useThemedStyles(createStyles);
  const changes = lines?.filter(line => typeof line === 'string');
  return (
    <View style={styles.container}>
      <Text style={styles.label}>NET CHANGE</Text>
      {(changes?.length ? changes : ['Balance changes unavailable']).map((line, index) => {
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
  label: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.2, marginBottom: 2 },
  row: { minHeight: 22, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  asset: { flex: 1, color: colors.textMuted, fontFamily: typography.medium, fontSize: 12 },
  amount: { color: colors.text, fontFamily: typography.mono, fontSize: 13, lineHeight: 20, flexShrink: 0 },
  incoming: { color: colors.positive },
  outgoing: { color: colors.destructive },
  neutral: { color: colors.textMuted, fontFamily: typography.regular, fontSize: 12 },
});
