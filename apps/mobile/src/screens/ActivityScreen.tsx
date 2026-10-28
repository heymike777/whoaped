import { BellRing, Plus, RefreshCw, Radar, ShieldCheck, WalletCards } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getWallets } from '../api/client';
import { ActivityCard } from '../components/ActivityCard';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { getActivityEmptyMode } from '../lib/emptyState';
import { colors, layout, typography } from '../theme';

export function ActivityScreen({
  onAddWallet,
  reduceMotion,
}: {
  onAddWallet: () => void;
  reduceMotion: boolean;
}) {
  const insets = useSafeAreaInsets();
  const feed = useActivityFeed();
  const [walletCount, setWalletCount] = useState<number | null>(null);
  const [walletsLoaded, setWalletsLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    getWallets()
      .then((wallets) => { if (mounted) setWalletCount(wallets.length); })
      .catch(() => { if (mounted) setWalletCount(null); })
      .finally(() => { if (mounted) setWalletsLoaded(true); });
    return () => { mounted = false; };
  }, []);

  const waitingForState = !feed.error && feed.activities.length === 0 && !walletsLoaded;
  const hasNoWallets = walletsLoaded && walletCount === 0;

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}
      refreshControl={
        <RefreshControl
          progressViewOffset={insets.top}
          refreshing={!feed.isLoading && false}
          onRefresh={feed.refresh}
          tintColor={colors.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topline}>
        <View style={styles.brandMark}><Radar color={colors.primary} size={19} strokeWidth={2.4} /></View>
        <Text style={styles.brand}>WHOAPED</Text>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <Text style={styles.eyebrow}>ON-CHAIN, WITHOUT THE NOISE</Text>
      <Text style={styles.heading}>Know when{`\n`}they move.</Text>
      <Text style={styles.subheading}>Track any wallet. See every balance change as it happens.</Text>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{hasNoWallets ? 'Start tracking' : 'Latest activity'}</Text>
      </View>

      {(feed.isLoading || waitingForState) && <LoadingState />}
      {feed.error && <ErrorState message={feed.error} onRetry={feed.refresh} />}
      {!feed.isLoading && !waitingForState && !feed.error && feed.activities.length === 0 && (
        <EmptyState onAddWallet={onAddWallet} walletCount={walletCount} />
      )}
      {!feed.error && feed.activities.map((activity) => (
        <ActivityCard activity={activity} key={activity.id} />
      ))}

      <Text style={styles.footerNote}>
        {reduceMotion ? 'Motion reduced · ' : ''}Tracking confirms after on-chain finality.
      </Text>
    </ScrollView>
  );
}

function LoadingState() {
  return (
    <View style={styles.loadingStack} accessibilityLabel="Loading wallet activity">
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonLine, styles.skeletonShort]} />
            <View style={[styles.skeletonLine, styles.skeletonLong]} />
            <View style={[styles.skeletonLine, styles.skeletonMedium]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.stateCard}>
      <RefreshCw color={colors.coral} size={24} />
      <Text style={styles.stateTitle}>Activity paused</Text>
      <Text style={styles.stateBody}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.stateAction}>
        <Text style={styles.stateActionText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function EmptyState({
  onAddWallet,
  walletCount,
}: {
  onAddWallet: () => void;
  walletCount: number | null;
}) {
  if (getActivityEmptyMode(walletCount) === 'needs-wallet') {
    return (
      <View style={[styles.stateCard, styles.onboardingCard]}>
        <View style={styles.emptyVisual}>
          <View style={styles.emptyRingOuter} />
          <View style={styles.emptyRingInner} />
          <View style={styles.emptyIcon}>
            <WalletCards color={colors.primary} size={29} strokeWidth={1.9} />
          </View>
        </View>
        <Text style={styles.stateEyebrow}>NOTHING TO TRACK YET</Text>
        <Text style={styles.emptyTitle}>Add your first wallet</Text>
        <Text style={styles.emptyBody}>Paste a public Solana address and WhoAped will start watching it immediately.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onAddWallet}
          style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
        >
          <Plus color={colors.primaryInk} size={18} strokeWidth={2.6} />
          <Text style={styles.primaryActionText}>Add wallet</Text>
        </Pressable>
        <View style={styles.safetyRow}>
          <ShieldCheck color={colors.textFaint} size={14} />
          <Text style={styles.safetyText}>Watch-only · no keys or signatures</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.stateCard, styles.listeningCard]}>
      <View style={styles.listeningIcon}>
        <View style={styles.liveHalo} />
        <BellRing color={colors.primary} size={27} strokeWidth={1.9} />
      </View>
      <Text style={styles.stateEyebrow}>
        {walletCount ? `${walletCount} ${walletCount === 1 ? 'WALLET' : 'WALLETS'} ON WATCH` : 'TRACKER IS LIVE'}
      </Text>
      <Text style={styles.emptyTitle}>You’re all caught up</Text>
      <Text style={styles.emptyBody}>We’re watching for balance changes. The next one will appear here and trigger a notification.</Text>
      <View style={styles.watchingPill}>
        <View style={styles.liveDot} />
        <Text style={styles.watchingText}>Listening on Solana</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.gutter,
    paddingBottom: 124,
    gap: 12,
  },
  topline: { flexDirection: 'row', alignItems: 'center', marginBottom: 26 },
  brandMark: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorderStrong,
  },
  brand: { marginLeft: 9, color: colors.text, fontFamily: typography.bold, fontSize: 14, letterSpacing: 1.6 },
  livePill: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.glass },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  liveText: { color: colors.textMuted, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.2 },
  eyebrow: { color: colors.primary, fontFamily: typography.mono, fontSize: 10, letterSpacing: 1.35 },
  heading: { color: colors.text, fontFamily: typography.semibold, fontSize: 39, lineHeight: 42, letterSpacing: -1.5 },
  subheading: { maxWidth: 330, marginTop: 2, color: colors.textMuted, fontFamily: typography.regular, fontSize: 15, lineHeight: 22 },
  sectionHeader: { marginTop: 23, marginBottom: 1, flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontFamily: typography.semibold, fontSize: 18 },
  loadingStack: { gap: 12 },
  skeletonCard: { height: 112, flexDirection: 'row', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  skeletonIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.surfaceRaised },
  skeletonCopy: { flex: 1, gap: 10, paddingTop: 2 },
  skeletonLine: { height: 9, borderRadius: 5, backgroundColor: colors.surfaceRaised },
  skeletonShort: { width: '38%' },
  skeletonLong: { width: '84%', height: 14 },
  skeletonMedium: { width: '58%' },
  stateCard: { minHeight: 210, alignItems: 'center', justifyContent: 'center', padding: 28, borderRadius: 26, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  onboardingCard: { minHeight: 390, paddingHorizontal: 24 },
  listeningCard: { minHeight: 330, paddingHorizontal: 24 },
  stateTitle: { marginTop: 16, color: colors.text, fontFamily: typography.semibold, fontSize: 17, textAlign: 'center' },
  stateBody: { marginTop: 7, maxWidth: 280, color: colors.textMuted, fontFamily: typography.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  stateEyebrow: { marginTop: 22, color: colors.primary, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.2, textAlign: 'center' },
  emptyVisual: { width: 118, height: 118, alignItems: 'center', justifyContent: 'center' },
  emptyRingOuter: { position: 'absolute', width: 118, height: 118, borderRadius: 59, borderWidth: 1, borderColor: colors.primaryBorder },
  emptyRingInner: { position: 'absolute', width: 84, height: 84, borderRadius: 42, borderWidth: 1, borderColor: colors.primaryBorderStrong, backgroundColor: colors.primarySoft },
  emptyIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.primaryBorderStrong },
  emptyTitle: { marginTop: 8, color: colors.text, fontFamily: typography.semibold, fontSize: 21, letterSpacing: -0.35, textAlign: 'center' },
  emptyBody: { marginTop: 8, maxWidth: 290, color: colors.textMuted, fontFamily: typography.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  primaryAction: { minHeight: 52, marginTop: 22, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 18, backgroundColor: colors.primary },
  primaryActionText: { color: colors.primaryInk, fontFamily: typography.semibold, fontSize: 14 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  safetyRow: { marginTop: 17, flexDirection: 'row', alignItems: 'center', gap: 6 },
  safetyText: { color: colors.textFaint, fontFamily: typography.regular, fontSize: 11 },
  listeningIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryBorderStrong },
  liveHalo: { position: 'absolute', width: 108, height: 108, borderRadius: 54, borderWidth: 1, borderColor: colors.primaryBorder },
  watchingPill: { minHeight: 38, marginTop: 20, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 19, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  watchingText: { color: colors.textMuted, fontFamily: typography.medium, fontSize: 11 },
  stateAction: { minHeight: 40, marginTop: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  stateActionText: { color: colors.primary, fontFamily: typography.semibold, fontSize: 13 },
  footerNote: { marginTop: 10, color: colors.textFaint, fontFamily: typography.regular, fontSize: 11, textAlign: 'center' },
});
