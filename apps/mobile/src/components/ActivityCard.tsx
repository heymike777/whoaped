import { ArrowDownLeft, ArrowLeftRight, ArrowUpDown, Image, Rocket, ShieldCheck, Sprout, Zap } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../theme';
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
};

const colorByKind: Record<ActivityKind, string> = {
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
};

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function ActivityCard({ activity, onOpenSolscan }: { activity: Activity; onOpenSolscan: () => void }) {
  const Icon = iconByKind[activity.kind];
  const accent = colorByKind[activity.kind];

  return (
    <View style={styles.card}>
      <View style={styles.solscanAction}><SolscanButton onPress={onOpenSolscan} /></View>
      <View style={styles.mainRow}>
        <View style={[styles.iconWrap, { backgroundColor: `${accent}12` }]}>
          <Icon color={accent} size={20} strokeWidth={2.2} />
        </View>
        <View style={styles.copy}>
          <View style={styles.metaRow}>
            <View style={[styles.signal, { backgroundColor: accent }]} />
            <Text numberOfLines={1} style={styles.wallet}>{activity.walletName}</Text>
            <View style={styles.dot} />
            <Text style={styles.time}>{relativeTime(activity.occurredAt)}</Text>
          </View>
          <Text style={styles.title}>{activity.title}</Text>
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

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  solscanAction: { position: 'absolute', zIndex: 2, right: 12, top: 12 },
  signal: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  mainRow: { paddingRight: 46, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  wallet: { maxWidth: 210, flexShrink: 1, color: colors.text, fontFamily: typography.medium, fontWeight: '700', fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textFaint },
  time: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 10 },
  title: { color: colors.text, fontFamily: typography.regular, fontWeight: '600', fontSize: 15, lineHeight: 19 },
  detail: { marginTop: 3, color: colors.textMuted, fontFamily: typography.regular, fontSize: 12, lineHeight: 16 },
  value: { color: colors.text, fontFamily: typography.mono, fontSize: 11, marginTop: 2 },
});
