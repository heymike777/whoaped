import { ExternalLink } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../theme';
import type { TokenAction } from '../types';

export function TokenActionButtons({ actions }: { actions?: TokenAction[] }) {
  if (!actions?.length) return null;
  return (
    <View style={styles.wrap}>
      {actions.map((action) => (
        <View key={action.token.mint} style={styles.tokenBlock}>
          <Text numberOfLines={1} style={styles.heading}>TRADE ${action.token.symbol}</Text>
          <View style={styles.grid}>
            {action.links.map((link) => (
              <Pressable
                accessibilityHint={`Opens ${action.token.symbol} on ${link.label}`}
                accessibilityLabel={`${link.label}: ${action.token.symbol}`}
                accessibilityRole="link"
                key={link.id}
                onPress={() => Linking.openURL(link.url).catch(() => undefined)}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <Text numberOfLines={1} style={styles.label}>{link.label}</Text>
                <ExternalLink color={colors.primary} size={12} strokeWidth={2.2} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, gap: 10 },
  tokenBlock: { gap: 7 },
  heading: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 8, letterSpacing: 1.05 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  button: {
    width: '48.7%',
    height: 36,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  pressed: { opacity: 0.72 },
  label: { flexShrink: 1, color: colors.primary, fontFamily: typography.semibold, fontSize: 10 },
});
