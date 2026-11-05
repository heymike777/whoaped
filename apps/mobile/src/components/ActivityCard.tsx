import { ArrowDownLeft, ArrowLeftRight, ArrowUpDown, CircleX, Image, Rocket, ShieldCheck, Sprout, Zap } from 'lucide-react-native';
import { Image as NativeImage, StyleSheet, Text, View } from 'react-native';

import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';
import { Activity, ActivityKind } from '../types';
import { TokenActionButtons } from './TokenActionButtons';
import { SolscanButton } from './SolscanButton';

const iconByKind = {
  balance: ArrowUpDown,
  multisig: ShieldCheck,
  swap: ArrowLeftRight,
  yield: Sprout,
  launch: Rocket,
  buy: Rocket,
  stake: Sprout,
  transfer: ArrowDownLeft,
  nft: Image,
  unknown: Zap,
  failed: CircleX,
};

const colorByKind = (colors: ThemeColors): Record<ActivityKind, string> => ({
  balance: colors.primary,
  multisig: colors.blue,
  swap: colors.blue,
  yield: colors.primary,
  launch: colors.coral,
  buy: colors.coral,
  stake: colors.primary,
  transfer: colors.gold,
  nft: colors.nft,
  unknown: colors.textMuted,
  failed: colors.destructive,
});

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function ActivityCard({ activity, onOpenSolscan }: { activity: Activity; onOpenSolscan: () => void }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const Icon = iconByKind[activity.kind];
  const accent = colorByKind(colors)[activity.kind];
  const nftImage = activity.kind === 'nft' && typeof activity.metadata?.nft === 'object' && activity.metadata.nft !== null
    ? (activity.metadata.nft as { imageUrl?: string }).imageUrl : undefined;

  return (
    <View style={[styles.card, activity.kind === 'failed' && styles.failedCard]}>
      <View style={styles.solscanAction}><SolscanButton onPress={onOpenSolscan} /></View>
      <View style={styles.mainRow}>
        <View style={[styles.iconWrap, { backgroundColor: `${accent}12` }]}>
          {nftImage?.startsWith('https://')
            ? <NativeImage source={{ uri: nftImage }} style={styles.nftImage} />
            : <Icon color={accent} size={20} strokeWidth={2.2} />}
        </View>
        <View style={styles.copy}>
          <View style={styles.metaRow}>
            <Text numberOfLines={1} style={styles.wallet}>{activity.walletName}</Text>
            <View style={styles.dot} />
            <Text style={styles.time}>{relativeTime(activity.occurredAt)}</Text>
          </View>
          <Text style={[styles.title, activity.kind === 'failed' && styles.failedTitle]}>{activity.kind === 'balance' && activity.metadata?.balanceChanges?.length ? 'Balance change' : activity.title}</Text>
          {activity.kind !== 'balance' && <Text numberOfLines={1} style={styles.detail}>{activity.detail}</Text>}
        </View>
        {activity.valueUsd != null && (
          <Text style={styles.value}>
            ${activity.valueUsd >= 1000
              ? `${(activity.valueUsd / 1000).toFixed(activity.valueUsd >= 10_000 ? 1 : 2)}k`
              : activity.valueUsd.toFixed(0)}
          </Text>
        )}
      </View>
      <TokenActionButtons actions={activity.metadata?.tokenActions} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    position: 'relative',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  failedCard: { backgroundColor: `${colors.destructive}0D` },
  solscanAction: { position: 'absolute', zIndex: 2, right: 12, top: 12 },
  mainRow: { paddingRight: 46, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nftImage: { width: 38, height: 38, borderRadius: 11 },
  copy: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  wallet: { maxWidth: 210, flexShrink: 1, color: colors.text, fontFamily: typography.medium, fontWeight: '700', fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textFaint },
  time: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 10 },
  title: { color: colors.text, fontFamily: typography.regular, fontWeight: '600', fontSize: 15, lineHeight: 19 },
  failedTitle: { color: colors.destructive },
  detail: { marginTop: 3, color: colors.textMuted, fontFamily: typography.regular, fontSize: 12, lineHeight: 16 },
  value: { color: colors.text, fontFamily: typography.mono, fontSize: 11, marginTop: 2 },
});
