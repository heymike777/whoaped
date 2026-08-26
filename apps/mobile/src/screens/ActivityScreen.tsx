import { BellRing, RefreshCw, Radar } from 'lucide-react-native';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '../components/ActivityCard';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { colors, layout, typography } from '../theme';

export function ActivityScreen({ reduceMotion }: { reduceMotion: boolean }) {
  const insets = useSafeAreaInsets();
  const feed = useActivityFeed();

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
      <Text style={styles.heading}>Your wallets{`\n`}just moved.</Text>
      <Text style={styles.subheading}>Every swap, buy, stake and transfer — translated as it happens.</Text>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Latest activity</Text>
        {feed.isDemo && <Text style={styles.demoLabel}>PREVIEW DATA</Text>}
      </View>

      {feed.isLoading && <LoadingState />}
      {feed.error && <ErrorState message={feed.error} onRetry={feed.refresh} />}
      {!feed.isLoading && !feed.error && feed.activities.length === 0 && <EmptyState />}
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

function EmptyState() {
  return (
    <View style={styles.stateCard}>
      <BellRing color={colors.primary} size={25} />
      <Text style={styles.stateTitle}>Listening for your first move</Text>
      <Text style={styles.stateBody}>Add a wallet, then WhoAped will put its next confirmed transaction here.</Text>
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
  demoLabel: { marginLeft: 'auto', color: colors.textFaint, fontFamily: typography.mono, fontSize: 8, letterSpacing: 1.1 },
  loadingStack: { gap: 12 },
  skeletonCard: { height: 112, flexDirection: 'row', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  skeletonIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.surfaceRaised },
  skeletonCopy: { flex: 1, gap: 10, paddingTop: 2 },
  skeletonLine: { height: 9, borderRadius: 5, backgroundColor: colors.surfaceRaised },
  skeletonShort: { width: '38%' },
  skeletonLong: { width: '84%', height: 14 },
  skeletonMedium: { width: '58%' },
  stateCard: { minHeight: 210, alignItems: 'center', justifyContent: 'center', padding: 28, borderRadius: 24, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  stateTitle: { marginTop: 16, color: colors.text, fontFamily: typography.semibold, fontSize: 17, textAlign: 'center' },
  stateBody: { marginTop: 7, maxWidth: 280, color: colors.textMuted, fontFamily: typography.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  stateAction: { minHeight: 40, marginTop: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  stateActionText: { color: colors.primary, fontFamily: typography.semibold, fontSize: 13 },
  footerNote: { marginTop: 10, color: colors.textFaint, fontFamily: typography.regular, fontSize: 11, textAlign: 'center' },
});
