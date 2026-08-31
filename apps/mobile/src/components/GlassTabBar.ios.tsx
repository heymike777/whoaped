import { requireNativeComponent, StyleSheet, View } from 'react-native';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type TabKey = 'activity' | 'wallets' | 'settings';

type Props = {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
};

type NativeProps = ViewProps & {
  selectedIndex: number;
  onTabSelected: (event: NativeSyntheticEvent<{ index: number }>) => void;
};

const tabOrder: TabKey[] = ['activity', 'wallets', 'settings'];
const NativeLiquidGlassTabBar = requireNativeComponent<NativeProps>('WhoApedTabBar');

export function GlassTabBar({ activeTab, onChange }: Props) {
  const insets = useSafeAreaInsets();
  const selectedIndex = tabOrder.indexOf(activeTab);

  const handleTabSelected = (event: NativeSyntheticEvent<{ index: number }>) => {
    const tab = tabOrder[event.nativeEvent.index];
    if (tab && tab !== activeTab) {
      onChange(tab);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.positioner, { height: 49 + insets.bottom }]}
    >
      <NativeLiquidGlassTabBar
        onTabSelected={handleTabSelected}
        selectedIndex={selectedIndex}
        style={styles.tabBar}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  positioner: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
  },
  tabBar: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
