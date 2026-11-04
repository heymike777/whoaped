import { logMobileEvent } from '../lib/analytics';
import { BellRing, Check, Plus, Search, ShieldCheck, Trash2, WalletCards, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import { PayboxImport } from '../components/PayboxImport';
import { addWallet, deleteWallet, getWallets } from '../api/client';
import { isWalletAlreadyTracked, transactionCount24hLabel } from '../lib/wallets';
import { type ThemeColors, layout, typography } from '../theme';
import { useThemedStyles } from '../themeContext';
import { Wallet } from '../types';

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function WalletsScreen() {
  const { colors, styles, isDark } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let mounted = true;
    let running = false;
    const reload = async () => {
      if (running) return;
      running = true;
      try {
        const next = await getWallets();
        if (mounted) { setWallets(next); setWalletError(null); }
      } catch (reason) {
        if (mounted) setWalletError(reason instanceof Error ? reason.message : 'Wallets could not be loaded.');
      } finally { running = false; if (mounted) setLoading(false); }
    };
    reload();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') reload(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') reload(); }, 10_000);
    return () => { mounted = false; clearInterval(timer); subscription.remove(); };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return wallets;
    return wallets.filter((wallet) =>
      wallet.name.toLowerCase().includes(query) || wallet.address.toLowerCase().includes(query),
    );
  }, [search, wallets]);

  const confirmRemove = (wallet: Wallet) => {
    Alert.alert(
      `Remove ${wallet.name}?`,
      'WhoAped will stop tracking new transactions from this wallet. Existing activity stays in your feed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setRemovingId(wallet.id);
            deleteWallet(wallet.id)
              .then(() => { logMobileEvent('wallet_removed', { chain: wallet.chain }); setWallets((current) => current.filter((item) => item.id !== wallet.id)); })
              .catch((reason) => {
                logMobileEvent('wallet_remove_failed');
                Alert.alert(
                  'Could not remove wallet',
                  reason instanceof Error ? reason.message : 'Please try again.',
                );
              })
              .finally(() => setRemovingId(null));
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, width >= 700 && styles.wideContent, {
          paddingTop: insets.top + 18,
          paddingLeft: layout.gutter + insets.left,
          paddingRight: layout.gutter + insets.right,
          paddingBottom: 90 + insets.bottom,
        }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.heading}>Wallets</Text>
          </View>
          <Pressable
            accessibilityLabel="Add wallet"
            accessibilityRole="button"
            onPress={() => setShowAdd(true)}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <Plus color={colors.primaryInk} size={21} strokeWidth={2.7} />
          </Pressable>
        </View>

        <PayboxImport wallets={wallets} onCreated={wallet => setWallets(current => current.some(item => item.id === wallet.id) ? current : [wallet, ...current])} />

        {(loading || wallets.length > 0) && (
          <>
            <View style={styles.searchBox}>
              <Search color={colors.textFaint} size={18} />
              <TextInput
                accessibilityLabel="Search wallets"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                onChangeText={setSearch}
                placeholder="Search name or address"
                placeholderTextColor={colors.textFaint}
                style={styles.searchInput}
                value={search}
              />
            </View>

            <View style={styles.summary}>
              <Text style={styles.summaryNumber}>{wallets.length}</Text>
              <Text style={styles.summaryLabel}>{wallets.length === 1 ? 'wallet tracked' : 'wallets tracked'}</Text>
            </View>
          </>
        )}

        {walletError && <Text accessibilityRole="alert" style={styles.error}>{walletError}</Text>}
        {loading && [0, 1, 2].map((item) => <View key={item} style={styles.walletSkeleton} />)}
        {!loading && wallets.length === 0 && (
          <WalletEmptyState onAdd={() => setShowAdd(true)} />
        )}
        {!loading && wallets.length > 0 && filtered.length === 0 && (
          <View style={styles.empty}>
            <Search color={colors.textFaint} size={24} />
            <Text style={styles.emptyTitle}>No wallet matches</Text>
            <Text style={styles.emptyBody}>Try a shorter name or address.</Text>
          </View>
        )}
        {filtered.map((wallet) => (
          <WalletRow
            key={wallet.id}
            onRemove={() => confirmRemove(wallet)}
            removing={removingId === wallet.id}
            wallet={wallet}
          />
        ))}
      </ScrollView>

      <AddWalletModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={(wallet) => setWallets((current) => [wallet, ...current])}
        wallets={wallets}
      />
    </View>
  );
}

function WalletEmptyState({ onAdd }: { onAdd: () => void }) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.onboardingCard}>
      <View style={styles.walletVisual}>
        <View style={styles.walletVisualIcon}>
          <WalletCards color={colors.text} size={28} strokeWidth={1.9} />
        </View>
      </View>

      <View style={styles.watchOnlyBadge}>
        <ShieldCheck color={colors.positive} size={13} />
        <Text style={styles.watchOnlyText}>Watch only</Text>
      </View>
      <Text style={styles.onboardingTitle}>Your wallet.{`\n`}Every move.</Text>
      <Text style={styles.onboardingBody}>Add a public Solana address. We’ll watch for new activity and let you know the moment it lands.</Text>

      <Pressable
        accessibilityRole="button"
        onPress={onAdd}
        style={({ pressed }) => [styles.onboardingAction, pressed && styles.pressed]}
      >
        <Plus color={colors.primaryInk} size={19} strokeWidth={2.7} />
        <Text style={styles.onboardingActionText}>Track a wallet</Text>
      </Pressable>

      <View style={styles.onboardingNote}>
        <BellRing color={colors.textFaint} size={14} />
        <Text style={styles.onboardingNoteText}>New balance changes appear in your feed and notifications.</Text>
      </View>
    </View>
  );
}

function WalletRow({
  wallet,
  onRemove,
  removing,
}: {
  wallet: Wallet;
  onRemove: () => void;
  removing: boolean;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View
      accessibilityLabel={`${wallet.name}, ${transactionCount24hLabel(wallet.transactionCount24h)}`}
      style={styles.walletCard}
    >
      <View style={styles.walletCopy}>
        <Text numberOfLines={1} style={styles.walletName}>{wallet.name}</Text>
        <Text numberOfLines={1} style={styles.walletAddress}>{wallet.address.slice(0, 5)}…{wallet.address.slice(-5)}</Text>
        <Text style={styles.walletActivity}>{transactionCount24hLabel(wallet.transactionCount24h)}</Text>
      </View>
      <Pressable
        accessibilityLabel={`Remove ${wallet.name}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: removing }}
        disabled={removing}
        hitSlop={8}
        onPress={onRemove}
        style={({ pressed }) => [styles.removeButton, pressed && styles.pressed, removing && styles.disabled]}
      >
        <Trash2 color={colors.destructive} size={18} strokeWidth={1.9} />
      </Pressable>
    </View>
  );
}

function AddWalletModal({
  open,
  onClose,
  onCreated,
  wallets,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (wallet: Wallet) => void;
  wallets: Wallet[];
}) {
  const { colors, styles, isDark } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!open) return;
    dismissing.current = false;
    backdropOpacity.setValue(0);
    sheetProgress.setValue(0);
    if (reduceMotion) {
      backdropOpacity.setValue(1);
      sheetProgress.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(sheetProgress, {
        toValue: 1,
        damping: 23,
        stiffness: 275,
        mass: 0.9,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, open, reduceMotion, sheetProgress]);

  const close = (force = false) => {
    if ((saving && !force) || dismissing.current) return;
    dismissing.current = true;
    const finish = () => {
      setName(''); setAddress(''); setError(null); onClose();
    };
    if (reduceMotion) return finish();
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(sheetProgress, {
        toValue: 0,
        duration: 210,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => { if (finished) finish(); });
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanAddress = address.trim();
    if (cleanName.length < 2) return setError('Give this wallet a name with at least 2 characters.');
    if (!SOLANA_ADDRESS.test(cleanAddress)) return setError('Enter a valid Solana public address.');
    if (isWalletAlreadyTracked(wallets, cleanAddress, 'solana')) {
      return setError('This wallet is already being tracked.');
    }

    setSaving(true); setError(null);
    try {
      const wallet = await addWallet({ name: cleanName, address: cleanAddress, chain: 'solana' });
      logMobileEvent('wallet_added', { chain: 'solana', source: 'manual' });
      ReactNativeHapticFeedback.trigger('notificationSuccess', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
      onCreated(wallet);
      setSaving(false); close(true);
    } catch (reason) {
      logMobileEvent('wallet_add_failed');
      setError(reason instanceof Error ? reason.message : 'Wallet could not be added.');
      setSaving(false);
    }
  };

  return (
    <Modal animationType="none" onRequestClose={() => close()} transparent visible={open}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Animated.View pointerEvents="box-none" style={[styles.scrim, { opacity: backdropOpacity }]}>
          <Pressable accessibilityLabel="Close add wallet" onPress={() => close()} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.sheet, width >= 700 && styles.wideSheet, {
          paddingBottom: Math.max(insets.bottom, 20),
          opacity: sheetProgress,
          transform: [
            { translateY: sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [64, 0] }) },
            { scale: sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
          ],
        }]}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.sheetScroll}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.eyebrow}>SOLANA</Text>
                <Text style={styles.sheetTitle}>Track a wallet</Text>
              </View>
              <Pressable accessibilityLabel="Close" onPress={() => close()} style={styles.closeButton}><X color={colors.textMuted} size={20} /></Pressable>
            </View>
            <Text style={styles.sheetBody}>Paste a public address. Tracking starts immediately after it is added.</Text>

            <Text style={styles.label}>Wallet name</Text>
            <TextInput
              autoCapitalize="sentences"
              autoComplete="off"
              keyboardAppearance={isDark ? 'dark' : 'light'}
              onChangeText={(value) => { setName(value); setError(null); }}
              placeholder="e.g. degen vault"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              value={name}
            />
            <Text style={styles.label}>Public address</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              multiline
              onChangeText={(value) => { setAddress(value); setError(null); }}
              placeholder="Paste Solana address"
              placeholderTextColor={colors.textFaint}
              style={[styles.input, styles.addressInput]}
              value={address}
            />
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={submit}
              style={({ pressed }) => [styles.submitButton, pressed && styles.pressed, saving && styles.disabled]}
            >
              {saving ? <Text style={styles.submitText}>Starting tracker…</Text> : <><Check color={colors.primaryInk} size={19} /><Text style={styles.submitText}>Start tracking</Text></>}
            </Pressable>
            <Text style={styles.safety}>Watch-only. Never share a seed phrase or private key.</Text>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', alignSelf: 'center', gap: 12 },
  wideContent: { maxWidth: 720 },
  headerRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  eyebrow: { color: colors.primary, fontFamily: typography.regular, fontWeight: '700', fontSize: 11 },
  heading: { color: colors.text, fontFamily: typography.bold, fontSize: 38, letterSpacing: -1.1 },
  addButton: { marginLeft: 'auto', width: 48, height: 48, borderRadius: 13, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  searchBox: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, borderRadius: 18, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minHeight: 48, color: colors.text, fontFamily: typography.regular, fontSize: 14 },
  summary: { flexDirection: 'row', alignItems: 'baseline', minHeight: 46, paddingHorizontal: 4 },
  summaryNumber: { color: colors.text, fontFamily: typography.mono, fontSize: 16 },
  summaryLabel: { marginLeft: 7, color: colors.textMuted, fontFamily: typography.regular, fontSize: 13 },
  walletCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong, backgroundColor: colors.surface },
  walletCopy: { flex: 1, minWidth: 0 },
  walletName: { color: colors.text, fontFamily: typography.semibold, fontSize: 15 },
  walletAddress: { marginTop: 4, color: colors.textMuted, fontFamily: typography.mono, fontSize: 10 },
  walletActivity: { marginTop: 6, color: colors.positive, fontFamily: typography.medium, fontWeight: '700', fontSize: 11 },
  removeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.surfaceRaised },
  walletSkeleton: { height: 88, borderRadius: 21, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  empty: { minHeight: 170, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { marginTop: 12, color: colors.text, fontFamily: typography.semibold, fontSize: 16 },
  emptyBody: { marginTop: 7, maxWidth: 260, textAlign: 'center', color: colors.textMuted, fontFamily: typography.regular, fontSize: 13, lineHeight: 19 },
  onboardingCard: { minHeight: 420, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32, backgroundColor: colors.surface },
  walletVisual: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  walletOrbitOuter: { position: 'absolute', width: 136, height: 136, borderRadius: 68, borderWidth: 1, borderColor: colors.primaryBorder },
  walletOrbitInner: { position: 'absolute', width: 94, height: 94, borderRadius: 47, borderWidth: 1, borderColor: colors.primaryBorderStrong, backgroundColor: colors.primarySoft },
  walletVisualIcon: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.surfaceRaised },
  orbitDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  orbitDotTop: { top: 8, right: 31 },
  orbitDotBottom: { bottom: 17, left: 20, opacity: 0.5 },
  watchOnlyBadge: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 28, borderRadius: 9, backgroundColor: colors.positiveSoft },
  watchOnlyText: { color: colors.positive, fontFamily: typography.regular, fontWeight: '700', fontSize: 10 },
  onboardingTitle: { marginTop: 16, color: colors.text, fontFamily: typography.semibold, fontSize: 28, lineHeight: 31, letterSpacing: -0.8 },
  onboardingBody: { marginTop: 10, maxWidth: 300, color: colors.textMuted, fontFamily: typography.regular, fontSize: 14, lineHeight: 21 },
  onboardingAction: { minHeight: 54, marginTop: 24, paddingHorizontal: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 13, backgroundColor: colors.primary },
  onboardingActionText: { color: colors.primaryInk, fontFamily: typography.semibold, fontSize: 15 },
  onboardingNote: { marginTop: 18, maxWidth: 285, flexDirection: 'row', alignItems: 'center', gap: 7 },
  onboardingNoteText: { flexShrink: 1, color: colors.textFaint, fontFamily: typography.regular, fontSize: 11, lineHeight: 16 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: { width: '100%', alignSelf: 'center', maxHeight: '90%', paddingHorizontal: 20, paddingTop: 10, borderRadius: 30, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  wideSheet: { maxWidth: 560, marginBottom: 20 },
  sheetScroll: { flexGrow: 0 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center' },
  sheetTitle: { marginTop: 4, color: colors.text, fontFamily: typography.semibold, fontSize: 27, letterSpacing: -0.7 },
  closeButton: { marginLeft: 'auto', width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  sheetBody: { marginTop: 10, marginBottom: 20, maxWidth: 330, color: colors.textMuted, fontFamily: typography.regular, fontSize: 13, lineHeight: 19 },
  label: { marginBottom: 6, color: colors.textMuted, fontFamily: typography.medium, fontSize: 12 },
  input: { minHeight: 50, marginBottom: 16, paddingHorizontal: 14, borderRadius: 16, color: colors.text, fontFamily: typography.regular, fontSize: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderStrong },
  addressInput: { minHeight: 72, paddingTop: 13, fontFamily: typography.mono, fontSize: 12 },
  error: { marginTop: -7, marginBottom: 12, color: colors.coral, fontFamily: typography.medium, fontSize: 12 },
  submitButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 18, backgroundColor: colors.primary },
  submitText: { color: colors.primaryInk, fontFamily: typography.semibold, fontSize: 15 },
  disabled: { opacity: 0.55 },
  safety: { marginTop: 12, color: colors.textFaint, fontFamily: typography.regular, fontSize: 11, textAlign: 'center' },
});
