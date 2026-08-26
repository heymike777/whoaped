import { Check, ChevronRight, Plus, Radio, Search, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import { addWallet, getWallets } from '../api/client';
import { colors, layout, typography } from '../theme';
import { Wallet } from '../types';

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function WalletsScreen() {
  const insets = useSafeAreaInsets();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    getWallets().then(setWallets).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return wallets;
    return wallets.filter((wallet) =>
      wallet.name.toLowerCase().includes(query) || wallet.address.toLowerCase().includes(query),
    );
  }, [search, wallets]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>WATCHLIST</Text>
            <Text style={styles.heading}>Your wallets</Text>
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

        <View style={styles.searchBox}>
          <Search color={colors.textFaint} size={18} />
          <TextInput
            accessibilityLabel="Search wallets"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder="Search name or address"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            value={search}
          />
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryNumber}>{wallets.length}</Text>
          <Text style={styles.summaryLabel}>wallets tracked</Text>
          <View style={styles.summaryDivider} />
          <Radio color={colors.primary} size={15} />
          <Text style={styles.summaryLive}>Helius live</Text>
        </View>

        {loading && [0, 1, 2].map((item) => <View key={item} style={styles.walletSkeleton} />)}
        {!loading && filtered.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{search ? 'No wallet matches' : 'No wallets yet'}</Text>
            <Text style={styles.emptyBody}>{search ? 'Try a shorter name or address.' : 'Add a public address. WhoAped never asks for keys.'}</Text>
          </View>
        )}
        {filtered.map((wallet) => <WalletRow key={wallet.id} wallet={wallet} />)}

        <View style={styles.evmCard}>
          <View style={styles.evmBadge}><Text style={styles.evmBadgeText}>NEXT</Text></View>
          <Text style={styles.evmTitle}>EVM chains</Text>
          <Text style={styles.evmBody}>Ethereum and Base plug into the same feed through a chain adapter.</Text>
        </View>
      </ScrollView>

      <AddWalletModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={(wallet) => setWallets((current) => [wallet, ...current])}
      />
    </View>
  );
}

function WalletRow({ wallet }: { wallet: Wallet }) {
  return (
    <View
      accessibilityLabel={`${wallet.name}, ${wallet.status}`}
      style={styles.walletCard}
    >
      <View style={styles.walletAvatar}><Text style={styles.walletInitial}>{wallet.name[0]?.toUpperCase()}</Text></View>
      <View style={styles.walletCopy}>
        <Text numberOfLines={1} style={styles.walletName}>{wallet.name}</Text>
        <Text numberOfLines={1} style={styles.walletAddress}>{wallet.address.slice(0, 5)}…{wallet.address.slice(-5)}</Text>
      </View>
      <View style={styles.activeStatus}><View style={styles.statusDot} /><Text style={styles.statusText}>{wallet.status}</Text></View>
      <ChevronRight color={colors.textFaint} size={17} />
    </View>
  );
}

function AddWalletModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (wallet: Wallet) => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    if (saving) return;
    setName(''); setAddress(''); setError(null); onClose();
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanAddress = address.trim();
    if (cleanName.length < 2) return setError('Give this wallet a name with at least 2 characters.');
    if (!SOLANA_ADDRESS.test(cleanAddress)) return setError('Enter a valid Solana public address.');

    setSaving(true); setError(null);
    try {
      const wallet = await addWallet({ name: cleanName, address: cleanAddress, chain: 'solana' });
      ReactNativeHapticFeedback.trigger('notificationSuccess', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
      onCreated(wallet);
      setSaving(false); setName(''); setAddress(''); setError(null); onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Wallet could not be added.');
      setSaving(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={close} transparent visible={open}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable accessibilityLabel="Close add wallet" onPress={close} style={styles.scrim} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.eyebrow}>SOLANA</Text>
              <Text style={styles.sheetTitle}>Track a wallet</Text>
            </View>
            <Pressable accessibilityLabel="Close" onPress={close} style={styles.closeButton}><X color={colors.textMuted} size={20} /></Pressable>
          </View>
          <Text style={styles.sheetBody}>Paste a public address. Tracking begins as soon as Helius confirms the subscription.</Text>

          <Text style={styles.label}>Wallet name</Text>
          <TextInput
            autoCapitalize="sentences"
            autoComplete="off"
            onChangeText={setName}
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
            multiline
            onChangeText={setAddress}
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingBottom: 124, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 14 },
  eyebrow: { color: colors.primary, fontFamily: typography.mono, fontSize: 10, letterSpacing: 1.35 },
  heading: { marginTop: 5, color: colors.text, fontFamily: typography.semibold, fontSize: 32, letterSpacing: -1 },
  addButton: { marginLeft: 'auto', width: 48, height: 48, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  searchBox: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, borderRadius: 18, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minHeight: 48, color: colors.text, fontFamily: typography.regular, fontSize: 14 },
  summary: { flexDirection: 'row', alignItems: 'baseline', minHeight: 46, paddingHorizontal: 4 },
  summaryNumber: { color: colors.text, fontFamily: typography.mono, fontSize: 16 },
  summaryLabel: { marginLeft: 7, color: colors.textMuted, fontFamily: typography.regular, fontSize: 13 },
  summaryDivider: { marginHorizontal: 12, width: 1, height: 15, backgroundColor: colors.borderStrong },
  summaryLive: { marginLeft: 6, color: colors.primary, fontFamily: typography.medium, fontSize: 12 },
  walletCard: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 21, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  walletAvatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.surfaceRaised },
  walletInitial: { color: colors.primary, fontFamily: typography.semibold, fontSize: 16 },
  walletCopy: { flex: 1, minWidth: 0 },
  walletName: { color: colors.text, fontFamily: typography.semibold, fontSize: 15 },
  walletAddress: { marginTop: 4, color: colors.textMuted, fontFamily: typography.mono, fontSize: 10 },
  activeStatus: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  statusText: { color: colors.textMuted, fontFamily: typography.regular, fontSize: 10 },
  walletSkeleton: { height: 78, borderRadius: 21, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border },
  empty: { minHeight: 170, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.glass },
  emptyTitle: { color: colors.text, fontFamily: typography.semibold, fontSize: 16 },
  emptyBody: { marginTop: 7, maxWidth: 260, textAlign: 'center', color: colors.textMuted, fontFamily: typography.regular, fontSize: 13, lineHeight: 19 },
  evmCard: { marginTop: 8, padding: 18, borderRadius: 22, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong },
  evmBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: colors.primarySoft },
  evmBadgeText: { color: colors.primary, fontFamily: typography.mono, fontSize: 8, letterSpacing: 1 },
  evmTitle: { marginTop: 12, color: colors.text, fontFamily: typography.semibold, fontSize: 16 },
  evmBody: { marginTop: 5, color: colors.textMuted, fontFamily: typography.regular, fontSize: 13, lineHeight: 19 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: { paddingHorizontal: 20, paddingTop: 10, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
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
