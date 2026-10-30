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
      <SolscanMark size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.text,
  },
  pressed: { opacity: 0.55 },
});
