import { RotateCw, X } from 'lucide-react-native';
import { useRef, type ComponentType, type RefAttributes } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { AndroidWebViewProps, IOSWebViewProps } from 'react-native-webview/lib/WebViewTypes';

import { solscanTransactionUrl } from '../lib/solscan';
import { colors, typography } from '../theme';
import { SolscanMark } from './SolscanMark';

type WebViewHandle = { reload: () => void };
type EmbeddedWebViewProps = Omit<IOSWebViewProps & AndroidWebViewProps, 'nativeConfig'> &
  RefAttributes<WebViewHandle>;

// The package's public type intersects incompatible platform-specific nativeConfig props.
// Runtime platform resolution is correct; omitting that unused escape hatch keeps the shared API typed.
const EmbeddedWebView = WebView as unknown as ComponentType<EmbeddedWebViewProps>;

export function SolscanWebView({
  signature,
  onClose,
}: {
  signature: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const webView = useRef<WebViewHandle>(null);
  const url = signature ? solscanTransactionUrl(signature) : null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={url != null}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Close Solscan"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <X color={colors.text} size={21} strokeWidth={2.2} />
          </Pressable>
          <View style={styles.titleGroup}>
            <SolscanMark size={20} />
            <View>
              <Text style={styles.title}>Transaction</Text>
              <Text style={styles.subtitle}>Source: Solscan</Text>
            </View>
          </View>
          <Pressable
            accessibilityLabel="Reload Solscan"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => webView.current?.reload()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <RotateCw color={colors.text} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        {url && (
          <EmbeddedWebView
            ref={webView}
            allowsBackForwardNavigationGestures
            javaScriptEnabled
            originWhitelist={['https://*']}
            renderError={() => (
              <View style={styles.errorState}>
                <Text style={styles.errorTitle}>Solscan couldn’t load</Text>
                <Text style={styles.errorBody}>Check your connection, then tap reload.</Text>
              </View>
            )}
            renderLoading={() => (
              <View style={styles.loadingState}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
            setSupportMultipleWindows={false}
            sharedCookiesEnabled={false}
            source={{ uri: url }}
            startInLoadingState
            style={styles.webView}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    height: 60,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  pressed: { opacity: 0.5, backgroundColor: colors.surfaceRaised },
  titleGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  title: { color: colors.text, fontFamily: typography.semibold, fontSize: 14 },
  subtitle: { marginTop: 1, color: colors.textFaint, fontFamily: typography.regular, fontSize: 9 },
  webView: { flex: 1, backgroundColor: colors.background },
  loadingState: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  errorTitle: { color: colors.text, fontFamily: typography.semibold, fontSize: 19 },
  errorBody: { marginTop: 8, color: colors.textMuted, fontFamily: typography.regular, fontSize: 14 },
});
