import { ExternalLink } from 'lucide-react-native';
import {
  Image,
  type ImageSourcePropType,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';
import type { TokenAction } from '../types';

const providerLogos: Record<string, ImageSourcePropType> = {
  bonkbot: require('../assets/trade/bonkbot.png'),
  gmgn: require('../assets/trade/gmgn.png'),
  fomo: require('../assets/trade/fomo.png'),
  dexscreener: require('../assets/trade/dexscreener.png'),
};

export function TokenActionButtons({ actions }: { actions?: TokenAction[] }) {
  const { colors, styles } = useThemedStyles(createStyles);
  if (!actions?.length) return null;
  return (
    <View style={styles.wrap}>
      {actions.map((action) => (
        <View key={action.token.mint} style={styles.tokenBlock}>
          <Text numberOfLines={1} style={styles.heading}>Trade ${action.token.symbol}</Text>
          <View style={styles.providers}>
            {action.links.map((link) => (
              <Pressable
                accessibilityHint={`Opens ${action.token.symbol} on ${link.label}`}
                accessibilityLabel={`${link.label}: ${action.token.symbol}`}
                accessibilityRole="link"
                key={link.id}
                onPress={() => Linking.openURL(link.url).catch(() => undefined)}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                {providerLogos[link.id] ? (
                  <Image source={providerLogos[link.id]} style={styles.logo} />
                ) : (
                  <ExternalLink color={colors.text} size={18} strokeWidth={2} />
                )}
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 12, gap: 10 },
  tokenBlock: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1, color: colors.textMuted, fontFamily: typography.regular, fontWeight: '700', fontSize: 12 },
  providers: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  pressed: { opacity: 0.6, transform: [{ scale: 0.96 }] },
  logo: { width: 32, height: 32, borderRadius: 9, resizeMode: 'contain' },
});
