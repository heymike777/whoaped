import { ArrowDown } from 'lucide-react-native';
import { useState } from 'react';
import {
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, typography } from '../theme';
import type { Activity, SwapDex, SwapMetadata, SwapToken } from '../types';

const dexLogos: Partial<Record<SwapDex, ImageSourcePropType>> = {
  jupiter: require('../assets/dex/jupiter.png'),
  pumpfun: require('../assets/dex/pumpfun.png'),
  meteora: require('../assets/dex/meteora.png'),
  orca: require('../assets/dex/orca.png'),
  titan: require('../assets/dex/titan.png'),
  raydium: require('../assets/dex/raydium.png'),
  phoenix: require('../assets/dex/phoenix.png'),
  openbook: require('../assets/dex/openbook.png'),
  manifest: require('../assets/dex/manifest.png'),
  lifinity: require('../assets/dex/lifinity.png'),
  saber: require('../assets/dex/saber.png'),
  saros: require('../assets/dex/saros.png'),
  invariant: require('../assets/dex/invariant.png'),
  goosefx: require('../assets/dex/goosefx.png'),
  dflow: require('../assets/dex/dflow.png'),
  byreal: require('../assets/dex/byreal.png'),
};

function DexIcon({ swap }: { swap: SwapMetadata }) {
  const source = dexLogos[swap.dex];
  if (source) return <Image source={source} style={styles.dexLogo} />;
  return (
    <View style={styles.dexFallback}>
      <Text style={styles.dexFallbackText}>{swap.dexName.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function formatAmount(value: number) {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(absolute / 1_000_000).toFixed(2)}m`;
  if (absolute >= 10_000) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(absolute);
  if (absolute >= 1) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(absolute);
  return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(absolute);
}

function TokenIcon({ token }: { token: SwapToken }) {
  const [failed, setFailed] = useState(false);
  if (!token.iconUrl || failed) {
    return (
      <View style={styles.tokenFallback}>
        <Text style={styles.tokenFallbackText}>{token.symbol.slice(0, 1).toUpperCase()}</Text>
      </View>
    );
  }
  return <Image onError={() => setFailed(true)} source={{ uri: token.iconUrl }} style={styles.tokenIcon} />;
}

function TokenLeg({ label, token, output }: { label: string; token: SwapToken; output?: boolean }) {
  return (
    <View style={styles.leg}>
      <View style={styles.legCopy}>
        <Text style={styles.legLabel}>{label}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.amount, output && styles.outputAmount]}>
          {output ? '+' : '−'}{formatAmount(token.amount)}
        </Text>
        <Text numberOfLines={1} style={styles.symbol}>{token.symbol}</Text>
      </View>
      <TokenIcon token={token} />
    </View>
  );
}

export function SwapActivityCard({
  activity,
  swap,
}: {
  activity: Activity;
  swap: SwapMetadata;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={styles.wallet}>{activity.walletName}</Text>
          <View style={styles.dot} />
          <Text style={styles.time}>{relativeTime(activity.occurredAt)}</Text>
        </View>
        <View style={styles.dexBadge}>
          <DexIcon swap={swap} />
          <Text style={styles.dexName}>{swap.dexName}</Text>
        </View>
      </View>

      <View style={styles.swapPanel}>
        <TokenLeg label="YOU SENT" token={swap.input} />
        <View style={styles.route}>
          <View style={styles.routeLine} />
          <View style={styles.routeArrow}>
            <ArrowDown color={colors.primary} size={14} strokeWidth={2.6} />
          </View>
          <View style={styles.routeLine} />
        </View>
        <TokenLeg label="YOU RECEIVED" output token={swap.output} />
      </View>

      <View style={styles.footer}>
        <View style={styles.confirmedDot} />
        <Text style={styles.confirmed}>SWAP CONFIRMED</Text>
        <Text style={styles.routeText}>{swap.input.symbol} → {swap.output.symbol}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  metaRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  wallet: { maxWidth: 128, color: colors.textMuted, fontFamily: typography.medium, fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textFaint },
  time: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 10 },
  dexBadge: {
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
  dexLogo: { width: 22, height: 22, borderRadius: 11 },
  dexFallback: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.primarySoft },
  dexFallbackText: { color: colors.primary, fontFamily: typography.bold, fontSize: 10 },
  dexName: { color: colors.text, fontFamily: typography.semibold, fontSize: 11 },
  swapPanel: {
    padding: 14,
    borderRadius: 19,
    backgroundColor: 'rgba(5, 14, 15, 0.58)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  leg: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legCopy: { flex: 1, minWidth: 0 },
  legLabel: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 8, letterSpacing: 1.1 },
  amount: { marginTop: 4, color: colors.text, fontFamily: typography.semibold, fontSize: 23, letterSpacing: -0.6 },
  outputAmount: { color: colors.primary },
  symbol: { marginTop: 1, color: colors.textMuted, fontFamily: typography.medium, fontSize: 12 },
  tokenIcon: { width: 48, height: 48, marginLeft: 14, borderRadius: 24, backgroundColor: colors.surfaceRaised },
  tokenFallback: {
    width: 48,
    height: 48,
    marginLeft: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorderStrong,
  },
  tokenFallbackText: { color: colors.primary, fontFamily: typography.bold, fontSize: 18 },
  route: { height: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeLine: { flex: 1, height: 1, backgroundColor: colors.border },
  routeArrow: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorderStrong,
  },
  footer: { marginTop: 12, flexDirection: 'row', alignItems: 'center' },
  confirmedDot: { width: 5, height: 5, marginRight: 7, borderRadius: 3, backgroundColor: colors.primary },
  confirmed: { color: colors.primary, fontFamily: typography.mono, fontSize: 8, letterSpacing: 1.05 },
  routeText: { marginLeft: 'auto', color: colors.textFaint, fontFamily: typography.mono, fontSize: 9 },
});
