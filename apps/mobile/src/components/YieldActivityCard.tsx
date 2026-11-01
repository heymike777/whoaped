import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react-native';
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
import type { Activity, YieldAsset, YieldMetadata } from '../types';
import { TokenActionButtons } from './TokenActionButtons';
import { SolscanButton } from './SolscanButton';

const protocolLogos: Record<string, ImageSourcePropType> = {
  kamino: require('../assets/yield/kamino.png'),
  'jupiter-lend': require('../assets/dex/jupiter.png'),
  perena: require('../assets/yield/perena.png'),
  marginfi: require('../assets/yield/marginfi.png'),
  drift: require('../assets/yield/drift.png'),
  loopscale: require('../assets/yield/loopscale.png'),
  exponent: require('../assets/yield/exponent.png'),
  sanctum: require('../assets/yield/sanctum.png'),
  hylo: require('../assets/yield/hylo.png'),
  lulo: require('../assets/yield/lulo.png'),
  'meteora-dlmm': require('../assets/dex/meteora.png'),
  'meteora-vault': require('../assets/dex/meteora.png'),
};

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function formatAmount(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  if (value >= 10_000) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  if (value >= 1) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
  return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(value);
}

function ProtocolIcon({ metadata }: { metadata: YieldMetadata }) {
  const { styles } = useThemedStyles(createStyles);
  const source = protocolLogos[metadata.protocol];
  if (source) return <Image source={source} style={styles.protocolLogo} />;
  return (
    <View style={styles.protocolFallback}>
      <Text style={styles.protocolFallbackText}>{metadata.protocolName.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function AssetIcon({ asset }: { asset: YieldAsset }) {
  const { styles } = useThemedStyles(createStyles);
  const [failed, setFailed] = useState(false);
  if (!asset.iconUrl || failed) {
    return (
      <View style={styles.assetFallback}>
        <Text style={styles.assetFallbackText}>{asset.symbol.slice(0, 1).toUpperCase()}</Text>
      </View>
    );
  }
  if (/\.svg(?:\?|$)/i.test(asset.iconUrl)) {
    return (
      <View style={styles.assetIcon}>
        <SvgUri height="100%" onError={() => setFailed(true)} uri={asset.iconUrl} width="100%" />
      </View>
    );
  }
  return <Image onError={() => setFailed(true)} source={{ uri: asset.iconUrl }} style={styles.assetIcon} />;
}

function AssetRow({ asset, action }: { asset: YieldAsset; action: YieldMetadata['action'] }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.assetRow}>
      <AssetIcon asset={asset} />
      <View style={styles.assetCopy}>
        <Text numberOfLines={1} style={styles.assetSymbol}>{asset.symbol}</Text>
        {!!asset.name && <Text numberOfLines={1} style={styles.assetName}>{asset.name}</Text>}
      </View>
      <Text style={[styles.assetAmount, action === 'withdraw' && styles.withdrawAmount]}>
        {action === 'deposit' ? '−' : '+'}{formatAmount(asset.amount)}
      </Text>
    </View>
  );
}

export function YieldActivityCard({ activity, metadata, onOpenSolscan }: { activity: Activity; metadata: YieldMetadata; onOpenSolscan: () => void }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const isDeposit = metadata.action === 'deposit';
  const isLiquidity = metadata.positionType === 'liquidity';
  const ActionIcon = isDeposit ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <View style={styles.card}>
      <View style={styles.solscanAction}><SolscanButton onPress={onOpenSolscan} /></View>
      <View style={styles.header}>
        <View style={styles.metaRow}>
          <View style={styles.signal} />
          <Text numberOfLines={1} style={styles.wallet}>{activity.walletName}</Text>
          <View style={styles.dot} />
          <Text style={styles.time}>{relativeTime(activity.occurredAt)}</Text>
        </View>
        <View style={styles.protocolBadge}>
          <ProtocolIcon metadata={metadata} />
          <Text numberOfLines={1} style={styles.protocolName}>{metadata.protocolName}</Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <View style={[styles.actionIcon, !isDeposit && styles.withdrawIcon]}>
          <ActionIcon color={isDeposit ? colors.blue : colors.primary} size={20} strokeWidth={2.2} />
        </View>
        <View>
          <Text style={styles.actionEyebrow}>{isLiquidity ? 'Liquidity position' : 'Yield position'}</Text>
          <Text style={styles.actionTitle}>
            {isLiquidity ? isDeposit ? 'Added liquidity' : 'Removed liquidity' : isDeposit ? 'Deposit' : 'Withdrawal'}
          </Text>
        </View>
        <View style={[styles.statusPill, !isDeposit && styles.withdrawPill]}>
          <Text style={[styles.statusText, !isDeposit && styles.withdrawText]}>
            {isDeposit ? 'Supplied' : 'Received'}
          </Text>
        </View>
      </View>

      <View style={styles.assetsPanel}>
        {metadata.assets.map((asset) => (
          <AssetRow action={metadata.action} asset={asset} key={asset.mint} />
        ))}
      </View>

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
  signal: { width: 7, height: 7, borderRadius: 4, flexShrink: 0, backgroundColor: colors.positive },
  header: { paddingRight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 },
  metaRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  wallet: { maxWidth: 180, flexShrink: 1, color: colors.text, fontFamily: typography.medium, fontWeight: '700', fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textFaint },
  time: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 10 },
  protocolBadge: {
    maxWidth: 150,
    height: 34,
    marginLeft: 8,
    paddingLeft: 5,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  protocolLogo: { width: 24, height: 24, borderRadius: 12 },
  protocolFallback: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.goldSoft,
  },
  protocolFallbackText: { color: colors.gold, fontFamily: typography.bold, fontSize: 11 },
  protocolName: { flexShrink: 1, color: colors.text, fontFamily: typography.regular, fontWeight: '700', fontSize: 11 },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 13 },
  actionIcon: {
    width: 42,
    height: 42,
    marginRight: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.blueSoft,
  },
  withdrawIcon: { backgroundColor: colors.positiveSoft },
  actionEyebrow: { color: colors.textMuted, fontFamily: typography.regular, fontWeight: '600', fontSize: 11 },
  actionTitle: { marginTop: 2, color: colors.text, fontFamily: typography.semibold, fontSize: 17 },
  statusPill: { marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.blueSoft },
  withdrawPill: { backgroundColor: colors.positiveSoft },
  statusText: { color: colors.blue, fontFamily: typography.regular, fontWeight: '700', fontSize: 10 },
  withdrawText: { color: colors.positive },
  assetsPanel: { paddingHorizontal: 13, borderRadius: 14, backgroundColor: colors.background },
  assetRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  assetIcon: { width: 38, height: 38, overflow: 'hidden', borderRadius: 19, backgroundColor: colors.surfaceRaised },
  assetFallback: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryBorderStrong },
  assetFallbackText: { color: colors.primary, fontFamily: typography.bold, fontSize: 15 },
  assetCopy: { flex: 1, minWidth: 0, marginLeft: 10 },
  assetSymbol: { color: colors.text, fontFamily: typography.semibold, fontSize: 14 },
  assetName: { marginTop: 1, color: colors.textFaint, fontFamily: typography.regular, fontSize: 10 },
  assetAmount: { marginLeft: 10, color: colors.blue, fontFamily: typography.mono, fontSize: 14 },
  withdrawAmount: { color: colors.positive },
});
