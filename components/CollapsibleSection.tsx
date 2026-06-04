import { useRef, useLayoutEffect } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import Reanimated from "react-native-reanimated";

interface CollapsibleSectionProps {
  /** Drives the animation. When this flips, the body animates between its two
   *  natural heights. The caller is responsible for swapping `children` to the
   *  matching subtree on the same render. */
  collapsed: boolean;
  duration?: number;
  children: React.ReactNode;
}

// A height animator for content that toggles between two *arbitrary* natural
// heights (e.g. a day's collapsed summary vs. its expanded exercise list).
//
// Why not `layout={LinearTransition}`? A view with a layout animation only
// re-flows on commit-driven layout changes — it freezes during a descendant's
// UI-thread height animation (our set/exercise CollapsibleCards). That freeze
// makes growing content overflow into the card below. This component instead
// drives height on the UI thread and sits at `auto` (-1) whenever it isn't
// mid-toggle, so descendant animations reflow live, in one smooth phase.
export default function CollapsibleSection({ collapsed, duration = 300, children }: CollapsibleSectionProps) {
  const height = useSharedValue(-1);   // -1 → unconstrained (auto, reflows live)
  const natural = useRef(0);           // last known natural height while idle
  const pending = useRef(false);       // awaiting the new content's measure to animate to it
  const prevCollapsed = useRef(collapsed);

  // Detect the toggle in the layout effect (commit phase, before native onLayout
  // fires for the swapped-in subtree and before paint). At this point
  // `natural.current` is still the OLD height, so we can freeze to it; the new
  // content's onLayout then supplies the target. Doing the detection + ref
  // mutation here (not during render) keeps it correct under StrictMode.
  useLayoutEffect(() => {
    if (prevCollapsed.current === collapsed) return;
    prevCollapsed.current = collapsed;
    if (natural.current > 0) {
      height.value = natural.current;  // freeze at the old height
      pending.current = true;          // next inner measure becomes the animation target
    }
  });

  const animatedStyle = useAnimatedStyle(() =>
    height.value < 0 ? {} : { height: height.value, overflow: "hidden" },
  );

  const onInnerLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent?.layout?.height;
    if (h == null || h <= 0) return;
    if (pending.current) {
      pending.current = false;
      natural.current = h;
      height.value = withTiming(h, { duration }, finished => {
        if (finished) height.value = -1;  // release back to auto so descendants reflow live
      });
    } else if (height.value < 0) {
      // Idle: track natural height for the next toggle. Height stays auto, so a
      // set/exercise expanding inside us pushes our siblings live.
      natural.current = h;
    }
  };

  return (
    <Reanimated.View style={animatedStyle}>
      <View onLayout={onInnerLayout}>{children}</View>
    </Reanimated.View>
  );
}
