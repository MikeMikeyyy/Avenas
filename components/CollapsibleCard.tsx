import { useEffect, useRef } from "react";
import { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from "react-native-reanimated";
import Reanimated from "react-native-reanimated";

interface CollapsibleCardProps {
  isCollapsing: boolean;
  onCollapsed: () => void;
  children: React.ReactNode;
}

export default function CollapsibleCard({ isCollapsing, onCollapsed, children }: CollapsibleCardProps) {
  const height = useSharedValue(-1);
  const opacity = useSharedValue(1);
  const started = useRef(false);
  // Shared value so useAnimatedStyle can react to it on the UI thread
  const collapseStarted = useSharedValue(false);
  const onCollapsedRef = useRef(onCollapsed);
  onCollapsedRef.current = onCollapsed;

  // No height/overflow constraint until collapse begins — preserves shadows
  const animatedStyle = useAnimatedStyle(() => {
    if (!collapseStarted.value) return {};
    return { height: height.value, opacity: opacity.value, overflow: "hidden" };
  });

  useEffect(() => {
    if (isCollapsing && !started.current && height.value > 0) {
      started.current = true;
      collapseStarted.value = true;
      opacity.value = withTiming(0, { duration: 200 });
      height.value = withTiming(0, { duration: 280 }, finished => {
        if (finished) runOnJS(onCollapsedRef.current)();
      });
    }
  }, [isCollapsing]);

  return (
    <Reanimated.View
      style={animatedStyle}
      onLayout={e => {
        const h = e.nativeEvent.layout.height;
        if (height.value < 0 && h > 0) height.value = h;
      }}
    >
      {children}
    </Reanimated.View>
  );
}
