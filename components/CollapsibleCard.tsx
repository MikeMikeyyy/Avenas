import { useEffect, useRef } from "react";
import { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from "react-native-reanimated";
import Reanimated from "react-native-reanimated";

interface CollapsibleCardProps {
  isCollapsing: boolean;
  onCollapsed: () => void;
  expanding?: boolean;
  naturalHeight?: number;
  children: React.ReactNode;
}

export default function CollapsibleCard({ isCollapsing, onCollapsed, expanding = false, naturalHeight, children }: CollapsibleCardProps) {
  const height = useSharedValue(expanding ? 0 : -1);
  const opacity = useSharedValue(expanding ? 0 : 1);
  const started = useRef(false);
  const collapseStarted = useSharedValue(expanding);
  const onCollapsedRef = useRef(onCollapsed);
  onCollapsedRef.current = onCollapsed;

  const animatedStyle = useAnimatedStyle(() => {
    if (!collapseStarted.value) return {};
    return { height: height.value < 0 ? undefined : height.value, opacity: opacity.value, overflow: "hidden" };
  });

  // Expand on mount when expanding=true and naturalHeight is known
  useEffect(() => {
    if (expanding && naturalHeight && naturalHeight > 0) {
      height.value = withTiming(naturalHeight, { duration: 260 });
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, []);

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
        if (!expanding && height.value < 0 && h > 0) height.value = h;
      }}
    >
      {children}
    </Reanimated.View>
  );
}
