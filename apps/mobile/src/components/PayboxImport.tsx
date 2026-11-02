import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, WalletCards, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addWallet, cancelPayboxImport, getPayboxAvailability, getPayboxImport, startPayboxImport, type PayboxWallet } from '../api/client';
import { isWalletAlreadyTracked } from '../lib/wallets';
import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';
import type { Wallet } from '../types';

export function PayboxImport({ wallets, onCreated }: { wallets: Wallet[]; onCreated: (wallet: Wallet) => void }) {
  const { styles, colors } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ id: string; url: string; startedAt: number } | null>(null);
  const [candidates, setCandidates] = useState<PayboxWallet[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<string | null>(null);
  useEffect(() => {
    let mounted = true;
    getPayboxAvailability().then(result => { if (mounted) setAvailable(result.available); }).catch(() => undefined);
    return () => { mounted = false; if (active.current) cancelPayboxImport(active.current).catch(() => undefined); };
  }, []);
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let running = false;
    const check = async () => {
      if (stopped || running || AppState.currentState !== 'active') return;
      if (Date.now() - pending.startedAt >= 10 * 60_000) {
        setError('Paybox connection expired. Please reconnect.');
        setPending(null); active.current = null;
        cancelPayboxImport(pending.id).catch(() => undefined);
        return;
      }
      running = true;
      try {
        const result = await getPayboxImport(pending.id);
        if (stopped) return;
        setError(null);
        if (result.status === 'ready') {
          setCandidates(result.wallets); setSelected([]); setPending(null);
          active.current = null;
          cancelPayboxImport(pending.id).catch(() => undefined);
        } else if (result.status === 'error') {
          setError('Paybox connection was cancelled or could not complete. Please reconnect.');
          setPending(null); active.current = null;
          cancelPayboxImport(pending.id).catch(() => undefined);
        }
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : 'Could not check Paybox.');
      } finally { running = false; }
    };
    check();
    const timer = setInterval(check, 3000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { stopped = true; clearInterval(timer); subscription.remove(); };
  }, [pending]);
  const close = () => {
    if (busy) return;
    if (active.current) cancelPayboxImport(active.current).catch(() => undefined);
    active.current = null; setPending(null); setCandidates(null); setSelected([]); setError(null); setOpen(false);
  };
  const connect = async () => {
    setBusy(true); setError(null);
    try {
      if (active.current) await cancelPayboxImport(active.current);
      const result = await startPayboxImport();
      active.current = result.id; setPending({ ...result, startedAt: Date.now() }); setCandidates(null);
      await Linking.openURL(result.url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open Paybox.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(null);
    const added = new Set<string>();
    try {
      for (const candidate of candidates ?? []) {
        if (!selected.includes(candidate.address) || isWalletAlreadyTracked(wallets, candidate.address, 'solana')) continue;
        const wallet = await addWallet({ name: candidate.name.length >= 2 ? candidate.name : 'Paybox wallet', address: candidate.address, chain: 'solana' });
        added.add(candidate.address); onCreated(wallet);
        setSelected(current => current.filter(address => address !== candidate.address));
      }
      setOpen(false); setCandidates(null); setSelected([]);
    } catch (reason) {
      setCandidates(current => current?.filter(candidate => !added.has(candidate.address)) ?? null);
      setError(reason instanceof Error ? reason.message : 'Some wallets could not be added. Try again.');
    } finally { setBusy(false); }
  };
  if (!available) return null;
  return <>
    <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.connectButton}>
      <WalletCards color={colors.text} size={20} /><Text style={styles.buttonText}>Import from Paybox</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.root}>
        <Pressable accessibilityLabel="Close Paybox import" onPress={close} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={styles.header}><Text style={styles.title}>Import from Paybox</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" disabled={busy} onPress={close} style={styles.close}><X color={colors.text} size={22} /></Pressable></View>
          {candidates === null ? <>
            <Text style={styles.body}>Choose which wallets to share in Paybox, then return here to select the Solana addresses to track.</Text>
            <Text style={styles.note}>Paybox grants general connector access. WhoAped only reads wallet names and public addresses for this import and discards the access token. Choose approval for every operation in Paybox.</Text>
            {pending && <Text accessibilityLiveRegion="polite" style={styles.body}>Waiting for Paybox. Complete the connection in your browser, then return to WhoAped.</Text>}
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <Pressable accessibilityRole="button" disabled={busy} onPress={connect} style={[styles.primary, busy && styles.disabled]}><Text style={styles.primaryText}>{busy ? 'Connecting…' : pending ? 'Reconnect Paybox' : 'Continue to Paybox'}</Text></Pressable>
            {pending && <Pressable accessibilityRole="button" onPress={() => Linking.openURL(pending.url).catch(() => setError('Could not open your browser.'))} style={styles.connectButton}><Text style={styles.buttonText}>Open browser again</Text></Pressable>}
          </> : <>
            <Text style={styles.body}>{candidates.length ? 'Select the wallets you want to track.' : 'No shared Solana wallets found. Reconnect and select a Solana wallet in Paybox.'}</Text>
            <ScrollView style={styles.list}>
              {candidates.map(candidate => {
                const tracked = isWalletAlreadyTracked(wallets, candidate.address, 'solana');
                const checked = selected.includes(candidate.address);
                return <Pressable key={candidate.address} accessibilityRole="checkbox" accessibilityState={{ checked: tracked || checked, disabled: tracked || busy }}
                  disabled={tracked || busy} onPress={() => setSelected(current => checked ? current.filter(address => address !== candidate.address) : [...current, candidate.address])} style={styles.row}>
                  <View style={styles.copy}><Text numberOfLines={1} style={styles.buttonText}>{candidate.name}</Text><Text selectable style={styles.address}>{candidate.address}</Text>{tracked && <Text style={styles.body}>Already tracked</Text>}</View>
                  {(tracked || checked) && <Check size={22} color={colors.primary} />}
                </Pressable>;
              })}
            </ScrollView>
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {candidates.length > 0 && <Pressable accessibilityRole="button" disabled={busy || selected.length === 0} onPress={save} style={[styles.primary, (busy || !selected.length) && styles.disabled]}><Text style={styles.primaryText}>{busy ? 'Adding wallets…' : `Track selected (${selected.length})`}</Text></Pressable>}
            <Pressable accessibilityRole="button" disabled={busy} onPress={connect} style={styles.connectButton}><Text style={styles.buttonText}>Reconnect Paybox</Text></Pressable>
          </>}
        </View>
      </View>
    </Modal>
  </>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  connectButton: { minHeight: 48, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.borderStrong, padding: 12, marginTop: 8 },
  buttonText: { color: colors.text, fontFamily: typography.semibold, fontSize: 14 },
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, backgroundColor: colors.surface, maxHeight: '85%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.text, fontFamily: typography.semibold, fontSize: 24 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { color: colors.textMuted, fontFamily: typography.regular, fontSize: 14, lineHeight: 21, marginVertical: 12 },
  note: { color: colors.textMuted, fontFamily: typography.regular, fontSize: 12, lineHeight: 18, marginBottom: 16 },
  primary: { minHeight: 52, borderRadius: 16, padding: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.primaryInk, fontFamily: typography.semibold, fontSize: 15 },
  list: { flexGrow: 0, marginBottom: 16 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  copy: { flex: 1 },
  address: { color: colors.textMuted, fontFamily: typography.mono, fontSize: 11, marginTop: 8 },
  error: { color: colors.coral, fontSize: 13, marginBottom: 12 },
  disabled: { opacity: 0.5 },
});
