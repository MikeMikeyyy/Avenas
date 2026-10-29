// hooks/useSheetDrag.ts
//
// A bottom sheet held by its top and dragged down to close, the sheet going
// with the finger (user report, 2026-10-29: Exercise History's filter didn't
// move with the hand, and closed only on a swipe that began on the dimmed page
// above it, as a tap there). Spread what it returns on the sheet's handle and
// title, never the whole sheet: a list or a field inside takes its own drags.
//
// The sheet's own `slideY` follows the finger down (never up past where it
// opened) and its backdrop fades as it goes. Let go past CLOSE_DRAG, or with a
// flick, and the sheet's own close takes it the rest of the way down; short of
// that it springs back. The numbers are the ones the PanResponder sheets use
// (SimpleSheet, TimeEditSheet, the pages' own), so every sheet feels the same;
// this reads the view's own responder props instead, since a PanResponder is
// made during render, which the React hooks lint flags for the refs its
// handlers read.

import { useRef } from "react";
import { Animated, type GestureResponderEvent } from "react-native";

/** How far down a sheet has to be when let go to close. */
const CLOSE_DRAG = 120;
/** A flick down at least this fast (points per millisecond) closes it from anywhere. */
const CLOSE_FLICK = 0.8;
/** The drag that fades the backdrop out. */
const FADE_DRAG = 300;
/** How far a finger that came down on a button in the title row (a Clear) has
 *  to go, more down than across, before the drag takes over from the button. */
const TAKE_OVER = 6;

export function useSheetDrag({ slideY, backdrop, onClose }: {
  /** The sheet's translateY: 0 open, rising as it goes down. Kept in state
   *  (`useState(() => new Animated.Value(…))`) like the backdrop: passed in
   *  from a ref's `.current`, the hooks lint flags this call. */
  slideY: Animated.Value;
  backdrop?: Animated.Value;
  /** The sheet's own close: slides it the rest of the way down, then shuts it. */
  onClose: () => void;
}) {
  // Where the finger came down and where the drag began, and its latest place
  // and speed down.
  const touch = useRef({ x0: 0, y0: 0, from: 0, y: 0, t: 0, vy: 0 });

  const grab = (e: GestureResponderEvent) => {
    const { pageY, timestamp } = e.nativeEvent;
    // From where the finger is now, so a drag that took over from a button
    // doesn't jump the sheet by the distance it took to take over.
    touch.current = { ...touch.current, from: pageY, y: pageY, t: timestamp, vy: 0 };
  };

  const follow = (e: GestureResponderEvent) => {
    const { pageY, timestamp } = e.nativeEvent;
    const d = touch.current;
    const dt = timestamp - d.t;
    if (dt > 0) d.vy = 0.8 * ((pageY - d.y) / dt) + 0.2 * d.vy;
    d.y = pageY;
    d.t = timestamp;
    const dy = Math.max(0, pageY - d.from);
    slideY.setValue(dy);
    backdrop?.setValue(Math.max(0, 1 - dy / FADE_DRAG));
  };

  const springBack = () => {
    Animated.parallel([
      Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
      ...(backdrop ? [Animated.timing(backdrop, { toValue: 1, duration: 180, useNativeDriver: true })] : []),
    ]).start();
  };

  const letGo = () => {
    const d = touch.current;
    if (d.y - d.from > CLOSE_DRAG || d.vy > CLOSE_FLICK) onClose();
    else springBack();
  };

  return {
    onTouchStart: (e: GestureResponderEvent) => {
      touch.current.x0 = e.nativeEvent.pageX;
      touch.current.y0 = e.nativeEvent.pageY;
    },
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: (e: GestureResponderEvent) => {
      const dy = e.nativeEvent.pageY - touch.current.y0;
      return dy > TAKE_OVER && dy > Math.abs(e.nativeEvent.pageX - touch.current.x0);
    },
    onResponderTerminationRequest: () => false,
    onResponderGrant: grab,
    onResponderMove: follow,
    onResponderRelease: letGo,
    onResponderTerminate: springBack,
  };
}
