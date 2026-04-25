import { useState, useEffect, useRef } from "react";
import { View } from "react-native";
import { useSharedValue, useAnimatedStyle, useAnimatedReaction, withTiming, runOnJS } from "react-native-reanimated";
import Reanimated from "react-native-reanimated";

interface CollapsibleCardProps {
  isCollapsing: boolean;
  onCollapsed: () => void;
  expanding?: boolean;
  naturalHeight?: number;
  children: React.ReactNode;
}

// height.value >= 0  → constrained to that height (animating or collapsing)
// height.value  < 0  → unconstrained, view sizes to content
export default function CollapsibleCard({ isCollapsing, onCollapsed, expanding = false, naturalHeight, children }: CollapsibleCardProps) {
  const height = useSharedValue(expanding ? 0 : -1);
  const opacity = useSharedValue(expanding ? 0 : 1);
  const savedHeight = useRef(0);
  const started = useRef(false);
  const expandDone = useRef(false);
  const onCollapsedRef = useRef(onCollapsed);
  onCollapsedRef.current = onCollapsed;

  // On New Architecture, Reanimated claims ownership of height/opacity/overflow so a
  // plain-style fallback on Reanimated.View is stripped before the worklet binds.
  // Wrapping in a plain View means React applies height:0 before Reanimated exists.
  // We only flip to "live" once the worklet has actually started driving the inner
  // height — otherwise lifting the outer height:0 before Reanimated has bound causes
  // a 1-frame flash of the children at full natural height.
  const [phase, setPhase] = useState<"hidden" | "live">(expanding ? "hidden" : "live");

  const animatedStyle = useAnimatedStyle(() => {
    if (height.value < 0) return {};
    return { height: height.value, opacity: opacity.value, overflow: "hidden" };
  });

  useAnimatedReaction(
    () => height.value > 0,
    (animating, prev) => {
      if (animating && !prev) runOnJS(setPhase)("live");
    },
  );

  useEffect(() => {
    if (expanding && naturalHeight != null && naturalHeight > 0 && !expandDone.current) {
      expandDone.current = true;
      savedHeight.current = naturalHeight;
      opacity.value = withTiming(1, { duration: 200 });
      height.value = withTiming(naturalHeight, { duration: 280 }, finished => {
        if (finished) height.value = -1;
      });
    }
  }, [naturalHeight]);

  useEffect(() => {
    if (isCollapsing && !started.current) {
      started.current = true;
      const h = savedHeight.current;
      if (h > 0) {
        height.value = h;
        opacity.value = withTiming(0, { duration: 200 });
        height.value = withTiming(0, { duration: 280 }, finished => {
          if (finished) runOnJS(onCollapsedRef.current)();
        });
      } else {
        runOnJS(onCollapsedRef.current)();
      }
    }
  }, [isCollapsing]);

  return (
    <View style={phase === "hidden" ? { height: 0, overflow: "hidden" } : undefined}>
      <Reanimated.View
        style={animatedStyle}
        onLayout={e => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && height.value < 0) savedHeight.current = h;
        }}
      >
        {children}
      </Reanimated.View>
    </View>
  );
}
