import { ArrowUpRight, Search, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addWallet, getDiscoveryProfiles, getWallets, type DiscoveryProfile } from '../api/client';
import { ShimmerBlock, ShimmerGroup } from '../components/Shimmer';
import { type ThemeColors, layout, typography } from '../theme';
import { useThemedStyles } from '../themeContext';

export function DiscoveryScreen() {
  const { colors, styles, isDark } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<DiscoveryProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    getWallets().then(wallets => setTracked(new Set(wallets.map(wallet => wallet.address)))).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      getDiscoveryProfiles(query).then(page => {
        if (cancelled) return;
        setProfiles(page.data);
        setTotal(page.total);
        setNextOffset(page.nextOffset);
      }).catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load Discovery.');
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const loadMore = useCallback(() => {
    if (nextOffset === null || loading || loadingMore) return;
    setLoadingMore(true);
    getDiscoveryProfiles(query, nextOffset).then(page => {
      setProfiles(current => [...current, ...page.data]);
      setNextOffset(page.nextOffset);
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load more profiles.'))
      .finally(() => setLoadingMore(false));
  }, [loading, loadingMore, nextOffset, query]);

  const follow = async (profile: DiscoveryProfile) => {
    if (tracked.has(profile.address) || adding) return;
    setAdding(profile.address);
    try {
      await addWallet({ name: profile.name.slice(0, 40), address: profile.address, chain: 'solana' });
      setTracked(current => new Set(current).add(profile.address));
    } catch (reason) {
      Alert.alert('Could not track wallet', reason instanceof Error ? reason.message : 'Please try again.');
    } finally { setAdding(null); }
  };

  const openSocial = (url: string) => Linking.openURL(url).catch(() => Alert.alert('Could not open link'));

  return (
    <View style={styles.screen}>
      <ShimmerGroup enabled={loading || loadingMore}>
      <FlatList
        data={loading ? [] : profiles}
        keyExtractor={profile => profile.address}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.list, { paddingTop: insets.top + 18, paddingBottom: 100 + insets.bottom }]}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={<>
          <Text style={styles.heading}>Discovery</Text>
          <Text style={styles.subtitle}>People worth watching. Track only the wallets you choose.</Text>
          <View style={styles.search}>
            <Search size={18} color={colors.textFaint} />
            <TextInput
              accessibilityLabel="Search Discovery"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              onChangeText={setQuery}
              placeholder="Search name, address or social"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              value={query}
            />
            {query ? <Pressable accessibilityLabel="Clear search" onPress={() => setQuery('')}><X size={18} color={colors.textMuted} /></Pressable> : null}
          </View>
          {loading ? <ShimmerBlock style={styles.loadingCount} /> : <Text style={styles.count}>{total} profiles · Solana · Source: Kolscan</Text>}
          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        </>}
        ListEmptyComponent={loading ? <DiscoveryLoadingState /> : !error ? <Text style={styles.empty}>No profiles found.</Text> : null}
        ListFooterComponent={loadingMore ? <DiscoveryLoadingState count={1} /> : null}
        renderItem={({ item }) => <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.identity}>
              <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
              <Text selectable style={styles.address}>{item.address}</Text>
            </View>
            <Pressable
              accessibilityLabel={tracked.has(item.address) ? `${item.name} already tracked` : `Track ${item.name}`}
              accessibilityRole="button"
              disabled={tracked.has(item.address) || adding === item.address}
              onPress={() => follow(item)}
              style={[styles.track, tracked.has(item.address) && styles.tracked]}
            >
              <Text style={[styles.trackText, tracked.has(item.address) && styles.trackedText]}>{tracked.has(item.address) ? 'Tracking' : adding === item.address ? 'Adding…' : 'Track'}</Text>
            </Pressable>
          </View>
          {(item.twitter || item.telegram) && <View style={styles.socials}>
            {item.twitter && <Pressable accessibilityRole="link" onPress={() => openSocial(item.twitter!)} style={styles.social}><Text style={styles.socialText}>X</Text><ArrowUpRight size={12} color={colors.textMuted} /></Pressable>}
            {item.telegram && <Pressable accessibilityRole="link" onPress={() => openSocial(item.telegram!)} style={styles.social}><Text style={styles.socialText}>Telegram</Text><ArrowUpRight size={12} color={colors.textMuted} /></Pressable>}
          </View>}
        </View>}
      />
      </ShimmerGroup>
    </View>
  );
}

function DiscoveryLoadingState({ count = 3 }: { count?: number }) {
  const { styles } = useThemedStyles(createStyles);
  return <View accessibilityLabel="Loading Discovery profiles">
    {Array.from({ length: count }, (_, index) => <View key={index} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.loadingIdentity}>
          <ShimmerBlock style={styles.loadingName} />
          <ShimmerBlock style={styles.loadingAddress} />
        </View>
        <ShimmerBlock style={styles.loadingTrack} />
      </View>
      <View style={styles.loadingSocials}><ShimmerBlock style={styles.loadingSocial} /><ShimmerBlock style={styles.loadingSocialShort} /></View>
    </View>)}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: layout.gutter },
  heading: { color: colors.text, fontFamily: typography.bold, fontSize: 34, marginBottom: 5 },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 22 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  count: { color: colors.textMuted, fontSize: 12, marginTop: 18, marginBottom: 12 },
  loadingCount: { width: 160, height: 11, marginTop: 20, marginBottom: 17 },
  error: { color: colors.destructive, marginBottom: 14 },
  empty: { color: colors.textMuted, paddingVertical: 32, textAlign: 'center' },
  footer: { color: colors.textMuted, textAlign: 'center', paddingVertical: 18 },
  card: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadingIdentity: { flex: 1, gap: 9 },
  loadingName: { width: '57%', height: 15 },
  loadingAddress: { width: '82%', height: 10 },
  loadingTrack: { width: 70, height: 36, borderRadius: 11 },
  loadingSocials: { marginTop: 16, flexDirection: 'row', gap: 8 },
  loadingSocial: { width: 54, height: 27, borderRadius: 8 },
  loadingSocialShort: { width: 88, height: 27, borderRadius: 8 },
  identity: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontFamily: typography.semibold, fontSize: 17 },
  address: { color: colors.textFaint, fontFamily: typography.mono, fontSize: 11, lineHeight: 16, marginTop: 5 },
  track: { backgroundColor: colors.primary, borderRadius: 11, minWidth: 74, paddingHorizontal: 13, paddingVertical: 10, alignItems: 'center' },
  tracked: { backgroundColor: colors.surfaceRaised },
  trackText: { color: colors.primaryInk, fontFamily: typography.semibold, fontSize: 12 },
  trackedText: { color: colors.textMuted },
  socials: { flexDirection: 'row', gap: 8, marginTop: 16 },
  social: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceRaised, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  socialText: { color: colors.textMuted, fontSize: 12 },
});
