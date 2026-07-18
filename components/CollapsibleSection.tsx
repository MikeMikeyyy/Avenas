import { useRef, useLayoutEffect, useEffect, useState } from "react";
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
// makes growing content overflow into the card below.
//
// The crucial rule here: a constrained (animated) height is applied ONLY for the
// brief collapse/expand tween. At rest the wrapper is a genuinely PLAIN,
// auto-sizing View — and that plain/animated switch is made at the React level
// (the `active` flag below), NOT by having the worklet return an empty style.
// On Fabric / the New Architecture a Reanimated.View that has been animating
// `height` does NOT reliably fall back to auto-sizing just because the worklet
// stops returning a height: it keeps its last committed height and won't grow.
// So when the expanded content later grew (adding a set, whose row expands via
// its own UI-thread animation that never re-fires our onLayout), the section
// stayed pinned to its toggle-time height and the new content spilled past it,
// overlapping the next day's card. Dropping the animated style entirely while
// idle means React lays the wrapper out as a normal auto-height view, so it
// always reflows to its real content — live growth included.
//
// The tween itself is started in the layout effect — i.e. *after* the toggle's
// render has committed and the new subtree is mounted — so the height change and
// the content's fade-in play together as one motion. Each state's natural height
// is cached as it's measured while idle, so once both are known the tween can
// start immediately within that effect.
export default function CollapsibleSection({ collapsed, duration = 300, children }: CollapsibleSectionProps) {
  const height = useSharedValue(0);    // only read while `active`; always a concrete px value
  const collapsedH = useRef(0);        // last known natural height while collapsed
  const expandedH = useRef(0);         // last known natural height while expanded
  const target = useRef(0);            // height currently being animated to
  const animating = useRef(false);     // a height animation is in flight
  const pending = useRef(false);       // awaiting the new content's measure (target unknown)
  const prevCollapsed = useRef(collapsed);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // While false, the wrapper is a plain auto-sizing View (no Reanimated height).
  // Flipped true only for the duration of a collapse/expand tween.
  const [active, setActive] = useState(false);

  const bucket = (c: boolean) => (c ? collapsedH : expandedH);

  // Return to the plain, auto-sizing resting state.
  const stop = () => {
    animating.current = false;
    pending.current = false;
    target.current = 0;
    setActive(false);
  };

  // Guaranteed return-to-rest a fixed time after any toggle, in case the tween's
  // completion callback is dropped (a fast re-toggle cancels withTiming without
  // a `finished` call) or the measure we were waiting on never lands. Rescheduled
  // on every animation start, so it never fires mid-tween.
  const scheduleRelease = () => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => { releaseTimer.current = null; stop(); }, duration + 150);
  };

  useEffect(() => () => { if (releaseTimer.current) clearTimeout(releaseTimer.current); }, []);

  const animateTo = (h: number) => {
    animating.current = true;
    target.current = h;
    scheduleRelease();
    height.value = withTiming(h, { duration }, (finished) => {
      // Only release on a clean finish; an interrupted tween (cancelled by the
      // next toggle's freeze) leaves the newer animation to release instead.
      if (finished) runOnJS(stop)();
    });
  };

  // Detect the toggle in the layout effect (commit phase, after the new subtree
  // has rendered but before paint). Switch to the constrained mode and freeze to
  // the height we're leaving so there's no jump, then — if the target height is
  // already cached — tween to it; the content is mounted by now, so its fade-in
  // and the height change play together.
  useLayoutEffect(() => {
    if (prevCollapsed.current === collapsed) return;
    const fromH = bucket(!collapsed).current;
    const toH = bucket(collapsed).current;
    prevCollapsed.current = collapsed;
    if (fromH <= 0) return;           // old state never measured — let it swap untouched (plain, instant)
    setActive(true);                  // apply the constrained height for the tween
    height.value = fromH;             // freeze at the old height
    if (toH > 0) {
      pending.current = false;
      animateTo(toH);
    } else {
      pending.current = true;         // first toggle this direction → tween once measured
      scheduleRelease();              // ...but never stay frozen if that measure never lands
    }
  });

  const animatedStyle = useAnimatedStyle(() => ({ height: height.value, overflow: "hidden" }));

  const onInnerLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent?.layout?.height;
    if (h == null || h <= 0) return;
    // The mounted subtree matches prevCollapsed.current; keep its bucket fresh
    // (also tracks growth while idle, so the next toggle starts from a true height).
    bucket(prevCollapsed.current).current = h;
    if (pending.current) {
      pending.current = false;
      animateTo(h);
    } else if (animating.current && Math.abs(target.current - h) > 0.5) {
      // We optimistically tweened to a cached height that turned out stale
      // (e.g. an exercise was added in the other state) — retarget smoothly.
      animateTo(h);
    }
    // Otherwise idle: the wrapper is plain auto (active === false); the bucket
    // update above is all that's needed.
  };

  return (
    <Reanimated.View style={active ? [styles.bleed, animatedStyle] : styles.bleed} pointerEvents="box-none">
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
