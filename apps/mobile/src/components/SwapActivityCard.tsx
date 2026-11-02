import { ArrowDown } from 'lucide-react-native';
import { useState } from 'react';
import { SvgUri } from 'react-native-svg';
import {
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';
import type { Activity, SwapDex, SwapMetadata, SwapToken } from '../types';
import { TokenActionButtons } from './TokenActionButtons';
import { SolscanButton } from './SolscanButton';

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
  const { styles } = useThemedStyles(createStyles);
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

function TokenIcon({ token, compact = false }: { token: SwapToken; compact?: boolean }) {
  const { styles } = useThemedStyles(createStyles);
  const [failed, setFailed] = useState(false);
  if (!token.iconUrl || failed) {
    return (
      <View style={[styles.tokenFallback, compact && styles.compactTokenIcon]}>
        <Text style={styles.tokenFallbackText}>{token.symbol.slice(0, 1).toUpperCase()}</Text>
      </View>
    );
  }
  if (/\.svg(?:\?|$)/i.test(token.iconUrl)) {
    return (
      <View style={[styles.tokenIcon, compact && styles.compactTokenIcon]}>
        <SvgUri height="100%" onError={() => setFailed(true)} uri={token.iconUrl} width="100%" />
      </View>
    );
  }
  return <Image onError={() => setFailed(true)} source={{ uri: token.iconUrl }} style={[styles.tokenIcon, compact && styles.compactTokenIcon]} />;
}

function SwapRoute({ swap }: { swap: SwapMetadata }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const steps = swap.steps ?? [];
  return (
    <View style={styles.stepsPanel}>
      <Text style={styles.routeHeading}>{swap.arbitrage ? 'ARBITRAGE ROUTE' : 'SWAP ROUTE'} · {steps.length} STEPS</Text>
      {steps.map((step, index) => (
        <View key={`${index}-${step.dex}`} style={[styles.step, index > 0 && styles.stepBorder]}>
          <View style={styles.stepIndex}><Text style={styles.stepIndexText}>{index + 1}</Text></View>
          <View style={styles.stepContent}>
            <View style={styles.stepAmounts}>
              <Text numberOfLines={1} style={styles.stepAmount}>{formatAmount(step.input.amount)} {step.input.symbol}</Text>
              <ArrowDown color={colors.textFaint} size={13} strokeWidth={2} style={styles.stepArrow} />
              <Text numberOfLines={1} style={styles.stepAmount}>{formatAmount(step.output.amount)} {step.output.symbol}</Text>
            </View>
            <Text style={styles.stepDex}>{step.dexName}</Text>
          </View>
          <TokenIcon compact token={step.output} />
        </View>
      ))}
      {swap.arbitrage && (
        <View style={styles.profitRow}>
          <Text style={styles.profitLabel}>NET RESULT{swap.arbitrage.includesNetworkFee ? ' · INCL. NETWORK FEE' : ''}</Text>
          <Text style={[styles.profitValue, swap.arbitrage.profit != null && swap.arbitrage.profit < 0 && styles.lossValue]}>
            {swap.arbitrage.profit == null ? 'Unavailable' : `${swap.arbitrage.profit >= 0 ? '+' : '−'}${formatAmount(swap.arbitrage.profit)} ${swap.arbitrage.symbol}`}
          </Text>
        </View>
      )}
    </View>
  );
}

function TokenLeg({ label, token, output }: { label: string; token: SwapToken; output?: boolean }) {
  const { styles } = useThemedStyles(createStyles);
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
  onOpenSolscan,
  swap,
}: {
  activity: Activity;
  onOpenSolscan: () => void;
  swap: SwapMetadata;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.card}>
      <View style={styles.solscanAction}><SolscanButton onPress={onOpenSolscan} /></View>
      <View style={styles.header}>
        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={styles.wallet}>{activity.walletName}</Text>
          <View style={styles.dot} />
          <Text style={styles.time}>{relativeTime(activity.occurredAt)}</Text>
        </View>
        <View style={styles.dexBadge}>
          {swap.steps && swap.steps.length > 1 ? <Text style={styles.dexName}>{swap.arbitrage ? 'Arbitrage' : `${swap.steps.length} swaps`}</Text> : <><DexIcon swap={swap} /><Text style={styles.dexName}>{swap.dexName}</Text></>}
        </View>
      </View>

      {swap.steps && swap.steps.length > 1 ? <SwapRoute swap={swap} /> : <View style={styles.swapPanel}>
        <TokenLeg label="Sent" token={swap.input} />
        <View style={styles.route}>
          <View style={styles.routeLine} />
          <View style={styles.routeArrow}>
            <ArrowDown color={colors.primary} size={14} strokeWidth={2.6} />
          </View>
          <View style={styles.routeLine} />
        </View>
        <TokenLeg label="Received" output token={swap.output} />
      </View>}

      <TokenActionButtons actions={activity.metadata?.tokenActions} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    position: 'relative',
    paddingVertical: 18,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  solscanAction: { position: 'absolute', zIndex: 2, right: 14, top: 16 },
  header: { paddingRight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  metaRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  wallet: { maxWidth: 180, flexShrink: 1, color: colors.text, fontFamily: typography.medium, fontWeight: '700', fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textFaint },
  time: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 10 },
  dexBadge: {
    height: 32,
    marginLeft: 8,
    paddingLeft: 5,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  dexLogo: { width: 22, height: 22, borderRadius: 11 },
  dexFallback: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.primarySoft },
  dexFallbackText: { color: colors.primary, fontFamily: typography.bold, fontSize: 10 },
  dexName: { color: colors.text, fontFamily: typography.regular, fontWeight: '700', fontSize: 11 },
  swapPanel: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.background,
  },
  leg: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legCopy: { flex: 1, minWidth: 0 },
  legLabel: { color: colors.textMuted, fontFamily: typography.regular, fontWeight: '600', fontSize: 11 },
  amount: { marginTop: 4, color: colors.text, fontFamily: typography.semibold, fontSize: 24, letterSpacing: -0.6 },
  outputAmount: { color: colors.positive },
  symbol: { marginTop: 1, color: colors.textMuted, fontFamily: typography.regular, fontWeight: '600', fontSize: 12 },
  tokenIcon: { width: 48, height: 48, marginLeft: 14, overflow: 'hidden', borderRadius: 24, backgroundColor: colors.surfaceRaised },
  compactTokenIcon: { width: 30, height: 30, marginLeft: 8, borderRadius: 15 },
  tokenFallback: {
    width: 48,
    height: 48,
    marginLeft: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  tokenFallbackText: { color: colors.text, fontFamily: typography.bold, fontSize: 18 },
  route: { height: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeLine: { flex: 1, height: 1, backgroundColor: colors.border },
  routeArrow: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  stepsPanel: { paddingHorizontal: 13, paddingTop: 12, paddingBottom: 4, borderRadius: 14, backgroundColor: colors.background },
  routeHeading: { marginBottom: 4, color: colors.textMuted, fontFamily: typography.semibold, fontSize: 10, letterSpacing: 0.8 },
  step: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBorder: { borderTopWidth: 1, borderColor: colors.border },
  stepIndex: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surface },
  stepIndexText: { color: colors.textMuted, fontFamily: typography.mono, fontSize: 10 },
  stepContent: { flex: 1, minWidth: 0 },
  stepAmounts: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stepAmount: { flexShrink: 1, color: colors.text, fontFamily: typography.semibold, fontSize: 11 },
  stepArrow: { transform: [{ rotate: '-90deg' }] },
  stepDex: { marginTop: 3, color: colors.textMuted, fontFamily: typography.regular, fontSize: 10 },
  profitRow: { minHeight: 52, paddingTop: 9, borderTopWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  profitLabel: { flexShrink: 1, color: colors.textMuted, fontFamily: typography.semibold, fontSize: 9, letterSpacing: 0.6 },
  profitValue: { color: colors.positive, fontFamily: typography.semibold, fontSize: 15 },
  lossValue: { color: colors.destructive },
});
