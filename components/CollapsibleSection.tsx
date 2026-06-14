import { useRef, useLayoutEffect } from "react";
import { View, StyleSheet, type LayoutChangeEvent } from "react-native";
import { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from "react-native-reanimated";
import Reanimated from "react-native-reanimated";

interface CollapsibleSectionProps {
  /** Drives the animation. When this flips, the body animates between its two
   *  natural heights. The caller is responsible for swapping `children` to the
   *  matching subtree on the same render. */
  collapsed: boolean;
  duration?: number;
  children: React.ReactNode;
}

// Breathing room on every side so the inner cards' neumorphic shadows and
// rounded corners (which spill ~7-12px past each card edge) aren't sliced by the
// rectangular clip box while the section animates. The padding lives on the
// measured inner view and the outer wrapper is pulled back out by the same amount
// via negative margins, so the section still occupies exactly the content height
// in layout — only the clip rect grows, 16px outside every card edge. Idle,
// there's no clip, so this is invisible. The wrappers are `box-none` so the
// transparent bleed (which overlaps the heading card above) never steals taps.
const SHADOW_PAD = 16;

// A height animator for content that toggles between two *arbitrary* natural
// heights (e.g. a day's collapsed summary vs. its expanded exercise list).
//
// Why not `layout={LinearTransition}`? A view with a layout animation only
// re-flows on commit-driven layout changes — it freezes during a descendant's
// UI-thread height animation (our set/exercise CollapsibleCards). That freeze
// makes growing content overflow into the card below. This component instead
// drives height on the UI thread and sits at `auto` (-1) whenever it isn't
// mid-toggle, so descendant animations reflow live, in one smooth phase.
//
// The animation is started in the layout effect — i.e. *after* the toggle's
// render has committed and the new subtree is mounted — on purpose. The height
// change is what slides the sibling cards below; starting it earlier (e.g.
// imperatively on tap) makes those siblings move and settle before the heavy
// content has mounted, so you'd see a two-phase "siblings move, then the card
// fills in". Waiting for the commit costs a short delay after the tap, but the
// height animation and the content's fade-in then play together as one motion.
// Each state's natural height is cached as it's measured while idle, so once both
// are known the animation can start immediately within that effect.
export default function CollapsibleSection({ collapsed, duration = 300, children }: CollapsibleSectionProps) {
  const height = useSharedValue(-1);   // -1 → unconstrained (auto, reflows live)
  const collapsedH = useRef(0);        // last known natural height while collapsed
  const expandedH = useRef(0);         // last known natural height while expanded
  const target = useRef(-1);           // height currently being animated to (-1 = idle)
  const animating = useRef(false);     // a height animation is in flight
  const pending = useRef(false);       // awaiting the new content's measure (target unknown)
  const prevCollapsed = useRef(collapsed);

  const bucket = (c: boolean) => (c ? collapsedH : expandedH);

  const onAnimDone = () => { animating.current = false; target.current = -1; };

  const animateTo = (h: number) => {
    animating.current = true;
    target.current = h;
    height.value = withTiming(h, { duration }, (finished) => {
      if (finished) {
        height.value = -1;            // release back to auto so descendants reflow live
        runOnJS(onAnimDone)();
      }
    });
  };

  // Detect the toggle in the layout effect (commit phase, after the new subtree
  // has rendered but before paint). Freeze to the height we're leaving so there's
  // no jump, then — if the target height is already cached — animate to it; the
  // content is mounted by now, so its fade-in and the height change play together.
  useLayoutEffect(() => {
    if (prevCollapsed.current === collapsed) return;
    const fromH = bucket(!collapsed).current;
    const toH = bucket(collapsed).current;
    prevCollapsed.current = collapsed;
    if (fromH <= 0) return;           // old state never measured (shouldn't happen) — let it swap untouched
    height.value = fromH;             // freeze at the old height
    if (toH > 0) {
      pending.current = false;
      animateTo(toH);
    } else {
      pending.current = true;         // first toggle this direction → animate once measured
    }
  });

  const animatedStyle = useAnimatedStyle(() =>
    height.value < 0 ? {} : { height: height.value, overflow: "hidden" },
  );

  const onInnerLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent?.layout?.height;
    if (h == null || h <= 0) return;
    // The mounted subtree matches prevCollapsed.current; keep its bucket fresh
    // (also tracks growth when a set/exercise expands inside us while idle).
    bucket(prevCollapsed.current).current = h;
    if (pending.current) {
      pending.current = false;
      animateTo(h);
    } else if (animating.current && Math.abs(target.current - h) > 0.5) {
      // We optimistically animated to a cached height that turned out stale
      // (e.g. an exercise was added in the other state) — retarget smoothly.
      animateTo(h);
    }
    // Otherwise idle: height stays auto (-1); the bucket update above is enough.
  };

  return (
    <Reanimated.View style={[styles.bleed, animatedStyle]} pointerEvents="box-none">
      <View style={styles.pad} onLayout={onInnerLayout} pointerEvents="box-none">
        {children}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  // Outer pulls back out by SHADOW_PAD on every side (net-zero in layout); inner
  // pads the content in by the same amount. The clip rect (on the outer, while
  // animating) thus sits SHADOW_PAD outside every card edge — shadows/corners
  // survive. onLayout measures the padded inner view, so the height target it
  // reports already includes the padding (no extra arithmetic needed).
  bleed: { margin: -SHADOW_PAD },
  pad: { padding: SHADOW_PAD },
});
