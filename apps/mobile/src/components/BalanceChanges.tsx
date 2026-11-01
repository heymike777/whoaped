import { StyleSheet, Text, View } from 'react-native';
import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function BalanceChanges({ lines }: { lines?: string[] }) {
  const { styles } = useThemedStyles(createStyles);
  const changes = lines?.filter(line => typeof line === 'string');
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Balance changes</Text>
      {(changes?.length ? changes : ['Balance changes unavailable']).map((line, index) => (
        <Text key={index} selectable style={[styles.amount,
          line.startsWith('+') ? styles.incoming : line.startsWith('−') ? styles.outgoing : styles.neutral,
        ]}>{line}</Text>
      ))}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { marginHorizontal: 12, marginBottom: 12, paddingTop: 12, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  label: { color: colors.textMuted, fontFamily: typography.medium, fontSize: 11, marginBottom: 4 },
  amount: { fontFamily: typography.mono, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  incoming: { color: colors.positive },
  outgoing: { color: colors.destructive },
  neutral: { color: colors.textMuted },
});
