import { Pressable, StyleSheet } from 'react-native';

import { colors } from '../theme';
import { SolscanMark } from './SolscanMark';

export function SolscanButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityHint="Opens this transaction inside WhoAped"
      accessibilityLabel="View transaction on Solscan"
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <SolscanMark size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: colors.background,
  },
  pressed: { opacity: 0.55 },
});
