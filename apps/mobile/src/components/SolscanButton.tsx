import { Pressable, StyleSheet } from 'react-native';

import { type ThemeColors } from '../theme';
import { useThemedStyles } from '../themeContext';
import { SolscanMark } from './SolscanMark';

export function SolscanButton({ onPress }: { onPress: () => void }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityHint="Opens this transaction inside WhoAped"
      accessibilityLabel="View transaction on Solscan"
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <SolscanMark opacity={0.58} size={17} />
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  pressed: { opacity: 0.55 },
});
