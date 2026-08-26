import { ArrowDownLeft, ArrowLeftRight, Image, Rocket, Sprout, Zap } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../theme';
import { Activity, ActivityKind } from '../types';

const iconByKind = {
  swap: ArrowLeftRight,
  buy: Rocket,
  stake: Sprout,
  transfer: ArrowDownLeft,
  nft: Image,
  unknown: Zap,
};

const colorByKind: Record<ActivityKind, string> = {
  swap: colors.blue,
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

export function ActivityCard({ activity }: { activity: Activity }) {
  const Icon = iconByKind[activity.kind];
  const accent = colorByKind[activity.kind];

  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: `${accent}18` }]}>
        <Icon color={accent} size={20} strokeWidth={2.2} />
      </View>
      <View style={styles.copy}>
        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={styles.wallet}>{activity.walletName}</Text>
          <View style={styles.dot} />
          <Text style={styles.time}>{relativeTime(activity.occurredAt)}</Text>
        </View>
        <Text style={styles.title}>{activity.title}</Text>
        <Text numberOfLines={1} style={styles.detail}>{activity.detail}</Text>
      </View>
      {activity.valueUsd != null && (
        <Text style={styles.value}>
          ${activity.valueUsd >= 1000
            ? `${(activity.valueUsd / 1000).toFixed(activity.valueUsd >= 10_000 ? 1 : 2)}k`
            : activity.valueUsd.toFixed(0)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 22,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  wallet: { maxWidth: 150, color: colors.textMuted, fontFamily: typography.medium, fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textFaint },
  time: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 10 },
  title: { color: colors.text, fontFamily: typography.semibold, fontSize: 15, lineHeight: 20 },
  detail: { marginTop: 5, color: colors.textMuted, fontFamily: typography.regular, fontSize: 12 },
  value: { color: colors.text, fontFamily: typography.mono, fontSize: 11, marginTop: 2 },
});
