import { ExternalLink, Rocket } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../theme';
import type { Activity, LaunchMetadata } from '../types';

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function compactAddress(value: string) {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

function TokenArtwork({ metadata }: { metadata: LaunchMetadata }) {
  const [failed, setFailed] = useState(false);
  if (metadata.token.iconUrl && !failed) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
        source={{ uri: metadata.token.iconUrl }}
        style={styles.tokenImage}
      />
    );
  }
  return (
    <View style={styles.tokenFallback}>
      <Text style={styles.tokenFallbackText}>{metadata.token.symbol.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

export function LaunchActivityCard({ activity, metadata }: { activity: Activity; metadata: LaunchMetadata }) {
  const openBuy = () => { Linking.openURL(metadata.buyUrl).catch(() => undefined); };
  const tokenName = metadata.token.name ?? metadata.token.symbol;

  return (
    <View style={styles.card}>
      <View style={styles.glow} />
      <View style={styles.header}>
        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={styles.wallet}>{activity.walletName}</Text>
          <View style={styles.dot} />
          <Text style={styles.time}>{relativeTime(activity.occurredAt)}</Text>
        </View>
        <View style={styles.platformBadge}>
          <View style={styles.platformIcon}>
            <Text style={styles.platformLetter}>{metadata.platformName.slice(0, 1)}</Text>
          </View>
          <Text numberOfLines={1} style={styles.platformName}>{metadata.platformName}</Text>
        </View>
      </View>

      <View style={styles.launchBody}>
        <View style={styles.artworkWrap}>
          <View style={styles.artworkHalo} />
          <TokenArtwork metadata={metadata} />
          <View style={styles.rocketBadge}><Rocket color={colors.primaryInk} size={13} strokeWidth={2.6} /></View>
        </View>
        <View style={styles.tokenCopy}>
          <Text style={styles.eyebrow}>NEW TOKEN LAUNCHED</Text>
          <Text numberOfLines={2} style={styles.tokenName}>{tokenName}</Text>
          <Text numberOfLines={1} style={styles.symbol}>${metadata.token.symbol}</Text>
        </View>
      </View>

      <View style={styles.mintRow}>
        <Text style={styles.mintLabel}>MINT</Text>
        <Text selectable style={styles.mint}>{compactAddress(metadata.token.mint)}</Text>
      </View>

      <Pressable
        accessibilityHint="Opens this token in an external exchange"
        accessibilityLabel={`Buy ${metadata.token.symbol} on ${metadata.buyProviderName ?? 'Jupiter'}`}
        accessibilityRole="link"
        onPress={openBuy}
        style={({ pressed }) => [styles.buyButton, pressed && styles.buyButtonPressed]}
      >
        <Text style={styles.buyText}>Buy on {metadata.buyProviderName ?? 'Jupiter'}</Text>
        <ExternalLink color={colors.primaryInk} size={17} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: 'rgba(255, 140, 120, 0.30)',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 180,
    height: 180,
    right: -65,
    top: 20,
    borderRadius: 90,
    backgroundColor: 'rgba(255, 140, 120, 0.07)',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  metaRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  wallet: { maxWidth: 120, color: colors.textMuted, fontFamily: typography.medium, fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textFaint },
  time: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 10 },
  platformBadge: {
    maxWidth: 145,
    height: 32,
    marginLeft: 10,
    paddingLeft: 5,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  platformIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.coral },
  platformLetter: { color: colors.primaryInk, fontFamily: typography.bold, fontSize: 10 },
  platformName: { flexShrink: 1, color: colors.text, fontFamily: typography.semibold, fontSize: 10 },
  launchBody: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  artworkWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  artworkHalo: { position: 'absolute', width: 78, height: 78, borderRadius: 39, backgroundColor: 'rgba(102, 244, 180, 0.10)' },
  tokenImage: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.surfaceRaised },
  tokenFallback: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', borderRadius: 34, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryBorderStrong },
  tokenFallbackText: { color: colors.primary, fontFamily: typography.bold, fontSize: 25 },
  rocketBadge: { position: 'absolute', right: 3, bottom: 3, width: 27, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.backgroundMid },
  tokenCopy: { flex: 1, minWidth: 0, marginLeft: 16 },
  eyebrow: { color: colors.coral, fontFamily: typography.mono, fontSize: 8, letterSpacing: 1.15 },
  tokenName: { marginTop: 6, color: colors.text, fontFamily: typography.bold, fontSize: 22, lineHeight: 25, letterSpacing: -0.5 },
  symbol: { marginTop: 3, color: colors.primary, fontFamily: typography.semibold, fontSize: 13 },
  mintRow: { marginTop: 13, paddingHorizontal: 12, height: 36, flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: 'rgba(5, 14, 15, 0.52)', borderWidth: 1, borderColor: colors.border },
  mintLabel: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 8, letterSpacing: 1 },
  mint: { marginLeft: 'auto', color: colors.textMuted, fontFamily: typography.mono, fontSize: 10 },
  buyButton: { marginTop: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, backgroundColor: colors.primary },
  buyButtonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  buyText: { color: colors.primaryInk, fontFamily: typography.bold, fontSize: 14 },
});
