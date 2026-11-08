import { BellRing, Plus, RefreshCw, WalletCards } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getWallets } from '../api/client';
import { ActivityCard } from '../components/ActivityCard';
import { ActivityRenderBoundary } from '../components/ActivityRenderBoundary';
import { BalanceChanges } from '../components/BalanceChanges';
import { BrandMark } from '../components/BrandMark';
import { LaunchActivityCard } from '../components/LaunchActivityCard';
import { ShimmerBlock, ShimmerGroup } from '../components/Shimmer';
import { SolscanWebView } from '../components/SolscanWebView';
import { SwapActivityCard } from '../components/SwapActivityCard';
import { YieldActivityCard } from '../components/YieldActivityCard';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { getActivityEmptyMode } from '../lib/emptyState';
import { type ThemeColors, layout, typography } from '../theme';
import { useThemedStyles } from '../themeContext';
import type { Activity } from '../types';

export function ActivityScreen({ onAddWallet }: { onAddWallet: () => void }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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

  return <>
      <FlatList
      data={feed.error || feed.isLoading || waitingForState ? [] : feed.activities}
      keyExtractor={activity => activity.id}
      renderItem={({ item }) => <View style={styles.feedItem}>
        <ActivityRenderBoundary activityId={item.id} onOpenSolscan={() => setSolscanSignature(item.signature)}>
          <ActivityFeedItem activity={item} onOpenSolscan={() => setSolscanSignature(item.signature)} />
        </ActivityRenderBoundary>
      </View>}
      initialNumToRender={6}
      maxToRenderPerBatch={5}
      windowSize={5}
      removeClippedSubviews={false}
      contentContainerStyle={[styles.content, width >= 700 && styles.wideContent, {
        paddingTop: insets.top + 18,
        paddingLeft: layout.gutter + (width >= 700 ? 0 : insets.left),
        paddingRight: layout.gutter + (width >= 700 ? 0 : insets.right),
        paddingBottom: 90 + insets.bottom,
      }]}
      refreshControl={<RefreshControl progressViewOffset={insets.top} refreshing={feed.isRefreshing && !feed.isLoading} onRefresh={feed.refresh} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={<View style={styles.brandRow}>
        <View style={styles.wordmark}>
          <View style={styles.mark}><BrandMark size={22} /></View>
          <Text style={styles.brand}>WhoAped</Text>
        </View>
      </View>}
      ListEmptyComponent={<View style={styles.feedList}>
        {(feed.isLoading || waitingForState) && <LoadingState />}
        {feed.error && <ErrorState message={feed.error} onRetry={feed.refresh} />}
        {!feed.isLoading && !waitingForState && !feed.error && feed.activities.length === 0 && <EmptyState onAddWallet={onAddWallet} walletCount={walletCount} />}
      </View>}
      ListFooterComponent={
        !feed.error && feed.hasMore ? (
          <View style={styles.loadMoreWrap}>
            <Pressable accessibilityRole="button" disabled={feed.isLoadingMore} onPress={feed.loadMore} style={styles.loadMoreButton}>
              <Text style={styles.loadMoreText}>{feed.isLoadingMore ? 'Loading…' : 'Load older activity'}</Text>
            </Pressable>
            {feed.loadMoreError && <Text style={styles.loadMoreError}>{feed.loadMoreError}</Text>}
          </View>
        ) : null
      }
      />
      <SolscanWebView onClose={() => setSolscanSignature(null)} signature={solscanSignature} />
    </>;
}

function ActivityFeedItem({ activity, onOpenSolscan }: { activity: Activity; onOpenSolscan: () => void }) {
  const { styles } = useThemedStyles(createStyles);
  const failed = activity.kind === 'failed';
  const visibleImpacts = activity.walletImpacts?.filter(impact =>
    impact.balanceChanges?.some(line => typeof line === 'string' && line.trim().length > 0));
  return <View accessibilityLabel={`${activity.walletImpacts?.map(impact => impact.walletName).join(', ') ?? activity.walletName}: ${activity.title}`} style={[styles.activityItem, failed && styles.failedActivityItem]}>
    {activity.kind === 'swap' && activity.metadata?.swap
      ? <SwapActivityCard activity={activity} onOpenSolscan={onOpenSolscan} swap={activity.metadata.swap} />
      : activity.kind === 'yield' && activity.metadata?.yield
        ? <YieldActivityCard activity={activity} metadata={activity.metadata.yield} onOpenSolscan={onOpenSolscan} />
        : activity.kind === 'launch' && activity.metadata?.launch
          ? <LaunchActivityCard activity={activity} metadata={activity.metadata.launch} onOpenSolscan={onOpenSolscan} />
          : <ActivityCard activity={activity} onOpenSolscan={onOpenSolscan} />}
    {activity.walletImpacts && activity.walletImpacts.length > 1
      ? visibleImpacts?.length ? <View>
          <Text style={[styles.walletGroupLabel, failed && styles.failedWalletGroupLabel]}>TRACKED WALLETS</Text>
          {visibleImpacts.map(impact => <BalanceChanges key={impact.walletId} lines={impact.balanceChanges} failed={failed}
            walletName={`${impact.walletName} · ${impact.walletAddress.slice(0, 6)}…${impact.walletAddress.slice(-5)}`} />)}
        </View> : null
      : <BalanceChanges lines={activity.metadata?.balanceChanges} failed={failed} />}
  </View>;
}

function LoadingState() {
  const { styles } = useThemedStyles(createStyles);
  return (
    <ShimmerGroup>
      <View accessibilityLabel="Loading wallet activity">
        <View style={[styles.activityItem, styles.loadingCard]}>
          <View style={styles.loadingHeader}>
            <ShimmerBlock style={styles.loadingIcon} />
            <View style={styles.loadingCopy}>
              <ShimmerBlock style={styles.loadingName} />
              <ShimmerBlock style={styles.loadingTitle} />
            </View>
            <ShimmerBlock style={styles.loadingBadge} />
          </View>
          <View style={styles.loadingSwapPanel}>
            <View style={styles.loadingSwapRow}><View style={styles.loadingCopy}><ShimmerBlock style={styles.loadingTiny} /><ShimmerBlock style={styles.loadingAmount} /></View><ShimmerBlock style={styles.loadingToken} /></View>
            <View style={styles.loadingPanelRule} />
            <View style={styles.loadingSwapRow}><View style={styles.loadingCopy}><ShimmerBlock style={styles.loadingTiny} /><ShimmerBlock style={styles.loadingAmountShort} /></View><ShimmerBlock style={styles.loadingToken} /></View>
          </View>
        </View>
        {[0, 1].map(item => <View key={item} style={[styles.activityItem, styles.loadingCard]}>
          <View style={styles.loadingHeader}>
            <ShimmerBlock style={styles.loadingIcon} />
            <View style={styles.loadingCopy}>
              <ShimmerBlock style={styles.loadingName} />
              <ShimmerBlock style={styles.loadingTitle} />
            </View>
            <ShimmerBlock style={styles.loadingAction} />
          </View>
          <View style={styles.loadingRule} />
          <ShimmerBlock style={styles.loadingBalanceLabel} />
          <View style={styles.loadingBalanceRow}><ShimmerBlock style={styles.loadingCurrency} /><ShimmerBlock style={styles.loadingValue} /></View>
        </View>)}
      </View>
    </ShimmerGroup>
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
  content: { width: '100%', alignSelf: 'center' },
  wideContent: { maxWidth: 720 },
  brandRow: { minHeight: 40, marginBottom: 24, flexDirection: 'row', alignItems: 'center' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.black },
  brand: { color: colors.text, fontFamily: typography.bold, fontSize: 16, letterSpacing: -0.3 },
  feedList: { gap: 8 },
  feedItem: { marginBottom: 8 },
  activityItem: {
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  failedActivityItem: { borderColor: `${colors.destructive}52`, backgroundColor: `${colors.destructive}0D` },
  walletGroupLabel: { marginHorizontal: 12, marginTop: 3, color: colors.textFaint, fontFamily: typography.mono, fontSize: 9, letterSpacing: 1.2 },
  failedWalletGroupLabel: { color: colors.destructive },
  loadMoreWrap: { alignItems: 'center', paddingVertical: 16 },
  loadMoreButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong },
  loadMoreText: { color: colors.text, fontFamily: typography.medium, fontSize: 13 },
  loadMoreError: { marginTop: 8, color: colors.destructive, fontFamily: typography.regular, fontSize: 12 },
  loadingCard: { padding: 16, marginBottom: 8 },
  loadingHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadingIcon: { width: 40, height: 40, borderRadius: 12 },
  loadingCopy: { flex: 1, gap: 8 },
  loadingName: { width: '46%', height: 10 },
  loadingTitle: { width: '70%', height: 16 },
  loadingBadge: { width: 74, height: 28, borderRadius: 10 },
  loadingAction: { width: 30, height: 30, borderRadius: 10 },
  loadingSwapPanel: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: colors.background, gap: 12 },
  loadingSwapRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 12 },
  loadingTiny: { width: 42, height: 9 },
  loadingAmount: { width: 116, height: 19 },
  loadingAmountShort: { width: 94, height: 19 },
  loadingToken: { width: 34, height: 34, borderRadius: 17 },
  loadingPanelRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  loadingRule: { marginTop: 16, marginBottom: 12, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  loadingBalanceLabel: { width: 88, height: 8 },
  loadingBalanceRow: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  loadingCurrency: { width: 52, height: 13 },
  loadingValue: { width: 104, height: 14 },
  state: { width: '100%', maxWidth: 420, alignSelf: 'center', minHeight: 330, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 38 },
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
