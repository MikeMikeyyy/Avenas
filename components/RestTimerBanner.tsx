// The rest between sets as a pill of its own: on the Workout page, where
// there's no workout bar to hold it, and above the keyboard on any page while
// it's up. Everywhere else a rest shows inside the workout bar
// (components/WorkoutActiveBar.tsx), which grows to hold it. Both draw the
// same countdown and buttons (components/RestControls.tsx), and the pill is
// the workout bar's own shape, surface and size (constants/floatingBars.ts).

import React from "react";
import { View, StyleSheet } from "react-native";
import Reanimated, { useAnimatedStyle, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useRestTimer } from "../contexts/RestTimerContext";
import { useTheme } from "../contexts/ThemeContext";
import { useFloatingBars } from "../hooks/useFloatingBars";
import { RestActions, RestLine, RestTime, useRestProgress } from "./RestControls";
import { APP_LIGHT, APP_DARK } from "../constants/theme";
import { ABOVE_KEYBOARD_TOOLS, BAR_INSET_X, BAR_SHADOW, REST_PILL_H } from "../constants/floatingBars";

export default function RestTimerBanner() {
  const { restDisplay, restBannerActive } = useRestTimer();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const progress = useRestProgress();

  // Where it sits (constants/floatingBars.ts): straight above the tab bar on
  // the Workout page. With the keyboard up it rides above the keyboard's own
  // tools (the down key, and the Workout page's ‹ ›), moving with the keyboard
  // on the UI thread. Its buttons never take focus from a text field, so Skip
  // and ±15s answer with the keyboard up and leave it there.
  //
  // `bottom` is the page's own, never animated, and the keyboard's lift is a
  // transform on top of it. The slide-in moves the pill's frame to where it
  // sat as it mounted, and nothing moves that frame while it runs: with a
  // `bottom` that sprang between pages, a pill coming back to the Workout page
  // mounted while its `bottom` was still on the way down from the other page's
  // place (above the workout bar), and the slide-in left it up there.
  const { restBottom, restPillShown } = useFloatingBars();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const liftStyle = useAnimatedStyle(() => {
    const keyboard = -keyboardHeight.value; // 0 closed, the keyboard's height open
    return { transform: [{ translateY: keyboard > 0 ? -Math.max(0, keyboard + ABOVE_KEYBOARD_TOOLS - restBottom) : 0 }] };
  });

  // There only while a rest runs and it's the pill's to show, sliding in and
  // out as it comes and goes. It used to stay mounted and slide off screen,
  // with whether it took taps set apart from where it sat: two things that had
  // to agree. Mounted only while a rest runs, a pill on screen is always the
  // live one, its time moving and Skip and ±15s answering. Inside the workout
  // bar, or on a chat (useFloatingBars), it stands aside, the rest still
  // counting.
  if (!restBannerActive || !restPillShown) return null;

  return (
    <Reanimated.View
      style={[styles.outer, { bottom: restBottom }, liftStyle]}
      entering={SlideInDown.springify().damping(32).stiffness(280).overshootClamping(1)}
      exiting={SlideOutDown.duration(250)}
      pointerEvents="box-none"
    >
      <View style={[styles.pill, BAR_SHADOW, { backgroundColor: t.nav, borderColor: t.navEdge }]}>
        {/* The countdown round the pill's top and through both its ends, its
            glow clipped to the pill. Its own layer: iOS drops a shadow on a
            view that clips. */}
        <View style={styles.clip} pointerEvents="none">
          <RestLine progress={progress} isDark={isDark} holder="pill" />
        </View>
        <RestTime seconds={restDisplay} size={18} isDark={isDark} />
        <RestActions isDark={isDark} />
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  outer: { position: "absolute", left: BAR_INSET_X, right: BAR_INSET_X },
  pill:  {
    height: REST_PILL_H, borderRadius: REST_PILL_H / 2, borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 18, paddingRight: 10,
  },
  clip:  { ...StyleSheet.absoluteFill, borderRadius: REST_PILL_H / 2, overflow: "hidden" },
});
