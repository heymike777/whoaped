import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type ThemeColors, typography } from '../theme';
import { useThemedStyles } from '../themeContext';
import { SolscanButton } from './SolscanButton';
import { recordActivityRenderError } from '../lib/crashReporting';

type Props = {
  activityId: string;
  children: ReactNode;
  onOpenSolscan: () => void;
};

type State = { hasError: boolean };

/** One malformed historical activity must not take down the whole feed. */
export class ActivityRenderBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    recordActivityRenderError(error);
    console.error('Could not render activity card', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ActivityRenderFallback onOpenSolscan={this.props.onOpenSolscan} />;
  }
}

function ActivityRenderFallback({ onOpenSolscan }: { onOpenSolscan: () => void }) {
  const { styles } = useThemedStyles(createStyles);
  return <View style={styles.fallback}>
      <Text style={styles.title}>Transaction couldn’t be displayed</Text>
      <Text style={styles.body}>Other activity is still available.</Text>
      <View style={styles.link}><Text style={styles.linkText}>Open transaction</Text><SolscanButton onPress={onOpenSolscan} /></View>
    </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  fallback: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  title: { color: colors.text, fontFamily: typography.semibold, fontSize: 15 },
  body: { marginTop: 4, color: colors.textMuted, fontSize: 12 },
  link: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 8 },
  linkText: { color: colors.textMuted, fontSize: 12 },
});
