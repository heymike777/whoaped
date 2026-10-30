import { ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, typography } from '../theme';
import { SolscanMark } from './SolscanMark';

export function SolscanButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityHint="Opens this transaction inside WhoAped"
      accessibilityLabel="View transaction on Solscan"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <SolscanMark size={18} />
      <Text style={styles.label}>View on Solscan</Text>
      <ChevronRight color={colors.textFaint} size={15} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-end',
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: colors.textMuted,
    fontFamily: typography.medium,
    fontWeight: '700',
    fontSize: 11,
  },
  pressed: { opacity: 0.55 },
});
