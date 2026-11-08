import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import { useTheme } from '../themeContext';

const ShimmerContext = createContext<Animated.AnimatedInterpolation<number> | null>(null);

export function ShimmerGroup({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || reduceMotion) {
      progress.stopAnimation();
      return;
    }
    progress.setValue(0);
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: 1450,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(350),
    ]));
    animation.start();
    return () => animation.stop();
  }, [enabled, progress, reduceMotion]);

  const travel = Math.max(width, 440) + 180;
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-180, travel] });
  return <ShimmerContext.Provider value={enabled && !reduceMotion ? translateX : null}>{children}</ShimmerContext.Provider>;
}

export function ShimmerBlock({ style }: { style: StyleProp<ViewStyle> }) {
  const { colors, isDark } = useTheme();
  const translateX = useContext(ShimmerContext);
  const highlight = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.75)';
  return (
    <View accessible={false} style={[styles.block, { backgroundColor: colors.surfaceRaised }, style]}>
      {translateX && <Animated.View style={[styles.sweep, { transform: [{ translateX }] }]}>
        <LinearGradient
          colors={['rgba(255, 255, 255, 0)', highlight, 'rgba(255, 255, 255, 0)']}
          end={{ x: 1, y: 0 }}
          start={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { overflow: 'hidden', borderRadius: 6 },
  sweep: { position: 'absolute', top: 0, bottom: 0, width: 180 },
});
