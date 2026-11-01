import { BellRing, Plus, RefreshCw, WalletCards } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getWallets } from '../api/client';
import { ActivityCard } from '../components/ActivityCard';
import { BrandMark } from '../components/BrandMark';
import { LaunchActivityCard } from '../components/LaunchActivityCard';
import { SolscanWebView } from '../components/SolscanWebView';
import { SwapActivityCard } from '../components/SwapActivityCard';
import { YieldActivityCard } from '../components/YieldActivityCard';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { getActivityEmptyMode } from '../lib/emptyState';
import { type ThemeColors, layout, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function ActivityScreen({ onAddWallet }: { onAddWallet: () => void }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const feed = useActivityFeed();
  const [walletCount, setWalletCount] = useState<number | null>(null);
  const [walletsLoaded, setWalletsLoaded] = useState(false);
  const [solscanSignature, setSolscanSignature] = useState<string | null>(null);

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
  const walletStatus = walletCount == null
    ? 'Solana watchlist'
    : `${walletCount} ${walletCount === 1 ? 'wallet' : 'wallets'} on watch`;

  return (
    <>
      <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}
      refreshControl={<RefreshControl progressViewOffset={insets.top} refreshing={feed.isRefreshing && !feed.isLoading} onRefresh={feed.refresh} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.brandRow}>
        <View style={styles.wordmark}>
          <View style={styles.mark}><BrandMark size={22} /></View>
          <Text style={styles.brand}>WhoAped</Text>
        </View>
      </View>

      <View style={styles.intro}>
        <Text style={styles.heading}>Activity</Text>
      </View>

      <View style={styles.feedHeader}>
        <Text style={styles.feedTitle}>{hasNoWallets ? 'Get started' : 'Latest'}</Text>
        <Text style={styles.feedMeta}>{walletStatus}</Text>
      </View>

      <View style={styles.feedList}>
        {(feed.isLoading || waitingForState) && <LoadingState />}
        {feed.error && <ErrorState message={feed.error} onRetry={feed.refresh} />}
        {!feed.isLoading && !waitingForState && !feed.error && feed.activities.length === 0 && <EmptyState onAddWallet={onAddWallet} walletCount={walletCount} />}
        {!feed.error && feed.activities.map((activity) => (
          <View accessibilityLabel={`${activity.walletName}: ${activity.title}`} key={activity.id} style={styles.activityItem}>
            {activity.kind === 'swap' && activity.metadata?.swap
              ? <SwapActivityCard activity={activity} onOpenSolscan={() => setSolscanSignature(activity.signature)} swap={activity.metadata.swap} />
              : activity.kind === 'yield' && activity.metadata?.yield
                ? <YieldActivityCard activity={activity} metadata={activity.metadata.yield} onOpenSolscan={() => setSolscanSignature(activity.signature)} />
                : activity.kind === 'launch' && activity.metadata?.launch
                  ? <LaunchActivityCard activity={activity} metadata={activity.metadata.launch} onOpenSolscan={() => setSolscanSignature(activity.signature)} />
                  : <ActivityCard activity={activity} onOpenSolscan={() => setSolscanSignature(activity.signature)} />}
          </View>
        ))}
        {!feed.error && feed.hasMore && (
          <View style={styles.loadMoreWrap}>
            <Pressable accessibilityRole="button" disabled={feed.isLoadingMore} onPress={feed.loadMore} style={styles.loadMoreButton}>
              <Text style={styles.loadMoreText}>{feed.isLoadingMore ? 'Loading…' : 'Load older activity'}</Text>
            </Pressable>
            {feed.loadMoreError && <Text style={styles.loadMoreError}>{feed.loadMoreError}</Text>}
          </View>
        )}
      </View>

      </ScrollView>
      <SolscanWebView onClose={() => setSolscanSignature(null)} signature={solscanSignature} />
    </>
  );
}

function LoadingState() {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View accessibilityLabel="Loading wallet activity">
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.activityItem}>
          <View style={styles.skeletonRow}>
            <View style={styles.signalColumn}><View style={styles.skeletonSignal} /></View>
            <View style={styles.skeletonCopy}>
              <View style={[styles.skeletonLine, styles.skeletonShort]} />
              <View style={[styles.skeletonLine, styles.skeletonLong]} />
              <View style={[styles.skeletonLine, styles.skeletonMedium]} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.state}>
      <View style={styles.stateIcon}><RefreshCw color={colors.destructive} size={23} /></View>
      <Text style={styles.stateTitle}>Activity couldn’t refresh</Text>
      <Text style={styles.stateBody}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Try again</Text></Pressable>
    </View>
  );
}

function EmptyState({ onAddWallet, walletCount }: { onAddWallet: () => void; walletCount: number | null }) {
  const { colors, styles } = useThemedStyles(createStyles);
  if (getActivityEmptyMode(walletCount) === 'needs-wallet') {
    return (
      <View style={styles.state}>
        <View style={styles.stateIcon}><WalletCards color={colors.text} size={26} strokeWidth={1.8} /></View>
        <Text style={styles.stateTitle}>Your activity starts here</Text>
        <Text style={styles.stateBody}>Add a public Solana address. New activity will land here as soon as it confirms.</Text>
        <Pressable accessibilityRole="button" onPress={onAddWallet} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}>
          <Plus color={colors.primaryInk} size={18} strokeWidth={2.5} />
          <Text style={styles.primaryActionText}>Add wallet</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, styles.listeningIcon]}><BellRing color={colors.positive} size={25} strokeWidth={1.9} /><View style={styles.listeningDot} /></View>
      <Text style={styles.stateTitle}>Nothing new yet</Text>
      <Text style={styles.stateBody}>WhoAped is listening. The next confirmed balance change will appear here and trigger a notification.</Text>
      <View style={styles.listeningRow}><View style={styles.positiveDot} /><Text style={styles.listeningText}>Listening on Solana</Text></View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingBottom: 124 },
  brandRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.text },
  brand: { color: colors.text, fontFamily: typography.bold, fontSize: 16, letterSpacing: -0.3 },
  intro: { marginTop: 34, maxWidth: 340 },
  heading: { color: colors.text, fontFamily: typography.bold, fontSize: 46, lineHeight: 50, letterSpacing: -1.5 },
  feedHeader: { marginTop: 28, minHeight: 38, flexDirection: 'row', alignItems: 'baseline', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.text },
  feedTitle: { color: colors.text, fontFamily: typography.semibold, fontSize: 20, letterSpacing: -0.35 },
  feedMeta: { marginLeft: 'auto', color: colors.textMuted, fontFamily: typography.regular, fontWeight: '600', fontSize: 12 },
  feedList: { gap: 8, paddingTop: 12 },
  activityItem: {
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  loadMoreWrap: { alignItems: 'center', paddingVertical: 16 },
  loadMoreButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong },
  loadMoreText: { color: colors.text, fontFamily: typography.medium, fontSize: 13 },
  loadMoreError: { marginTop: 8, color: colors.destructive, fontFamily: typography.regular, fontSize: 12 },
  skeletonRow: { minHeight: 116, flexDirection: 'row', paddingVertical: 18, paddingHorizontal: 14 },
  signalColumn: { width: 34, alignItems: 'flex-start', paddingTop: 2 },
  skeletonSignal: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.surfaceRaised },
  skeletonCopy: { flex: 1, gap: 11 },
  skeletonLine: { height: 10, borderRadius: 3, backgroundColor: colors.surfaceRaised },
  skeletonShort: { width: '34%' },
  skeletonLong: { width: '82%', height: 16 },
  skeletonMedium: { width: '56%' },
  state: { minHeight: 330, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 38 },
  stateIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.surfaceRaised },
  listeningIcon: { backgroundColor: colors.positiveSoft },
  listeningDot: { position: 'absolute', right: 9, top: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.positive },
  stateTitle: { marginTop: 24, maxWidth: 300, color: colors.text, fontFamily: typography.semibold, fontSize: 25, lineHeight: 29, letterSpacing: -0.55 },
  stateBody: { marginTop: 10, maxWidth: 300, color: colors.textMuted, fontFamily: typography.regular, fontSize: 15, lineHeight: 22 },
  primaryAction: { minHeight: 52, marginTop: 24, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 13, backgroundColor: colors.primary },
  primaryActionText: { color: colors.primaryInk, fontFamily: typography.medium, fontWeight: '700', fontSize: 15 },
  secondaryAction: { minHeight: 48, marginTop: 20, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.text },
  secondaryActionText: { color: colors.surface, fontFamily: typography.medium, fontWeight: '700', fontSize: 14 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  listeningRow: { minHeight: 38, marginTop: 20, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, backgroundColor: colors.positiveSoft },
  positiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.positive },
  listeningText: { color: colors.positive, fontFamily: typography.medium, fontWeight: '700', fontSize: 12 },
});
