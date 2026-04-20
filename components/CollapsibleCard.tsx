import { useEffect, useRef } from "react";
import { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from "react-native-reanimated";
import Reanimated from "react-native-reanimated";

interface CollapsibleCardProps {
  isCollapsing: boolean;
  onCollapsed: () => void;
  // ADD: pass naturalHeight so the card can expand from 0 to that height
  expanding?: boolean;
  naturalHeight?: number;
  children: React.ReactNode;
}

export default function CollapsibleCard({ isCollapsing, onCollapsed, expanding = false, naturalHeight, children }: CollapsibleCardProps) {
  const height = useSharedValue(expanding ? 0 : -1);
  const opacity = useSharedValue(expanding ? 0 : 1);
  const constrained = useSharedValue(expanding); // true = height constraint applied
  const started = useRef(false);
  const expandDone = useRef(false);
  const onCollapsedRef = useRef(onCollapsed);
  onCollapsedRef.current = onCollapsed;

  const animatedStyle = useAnimatedStyle(() => {
    if (!constrained.value) return {};
    return { height: height.value < 0 ? undefined : height.value, opacity: opacity.value, overflow: "hidden" };
  });

  // Expand: animate from 0 to naturalHeight when provided
  useEffect(() => {
    if (expanding && naturalHeight && naturalHeight > 0 && !expandDone.current) {
      expandDone.current = true;
      opacity.value = withTiming(1, { duration: 200 });
      height.value = withTiming(naturalHeight, { duration: 280 }, finished => {
        // Release height constraint so content can flex freely after animation
        if (finished) constrained.value = false;
      });
    }
  }, [naturalHeight]);

  // Collapse: animate from current height to 0, then fire callback
  useEffect(() => {
    if (isCollapsing && !started.current && height.value > 0) {
      started.current = true;
      constrained.value = true;
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
        // Capture current height for collapse — keep updating so content size changes are tracked
        if (!constrained.value && h > 0) height.value = h;
      }}
    >
      {children}
    </Reanimated.View>
  );
}
