// The mark beside a set's number once it's a new PR: the gold trophy for a
// weight PR (utils/achievements.ts prTrophySets; user decision, 2026-10-22, the
// PR Trophy canvas, option A2), or the records medal, a size down, for a rep PR
// (utils/repPrs.ts; user request, 2026-11-14), each one per exercise a session.
// A set never wears both. On the Workout tab, log-workout, the Journal's
// workout page and Exercise History.
//
// It hangs off the number's left, a clear gap away, so the number never moves:
// put it inside a View that holds just the number's Text, and it measures from
// that box, the same gap beside "3" as beside "10". Always mounted, so a card
// drawn with a PR already in it (a restored session, a saved one) shows it
// still; it pops in with the tick's bounce when a tick makes the record, and
// shrinks away on an untick, or when a later set takes the record.

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Image } from "expo-image";

import MedalIcon from "./icons/MedalIcon";
import { TROPHY_ICON } from "../constants/icons";

/** What a set's number wears: a weight PR's trophy, a rep PR's medal (a
 *  hold's, said as a hold), or nothing. */
export type PrMark = "weight" | "reps" | "hold" | null;

/** The trophy's size, and the gap between it and the number. */
const PR_TROPHY = 16;
const PR_TROPHY_GAP = 6;
/** The medal's height: a size down from the trophy, the lesser record. */
const REP_MEDAL = 14;

const LABEL = { weight: "New PR", reps: "Rep PR", hold: "Hold PR" } as const;

export default function PrTrophy({ mark }: { mark: PrMark }) {
  const show = mark !== null;
  // What it last showed, kept while it shrinks away. The trophy until a rep PR
  // first shows, so a row that never has one never draws the medal.
  const [drawn, setDrawn] = useState<Exclude<PrMark, null>>(mark ?? "weight");
  if (mark !== null && mark !== drawn) setDrawn(mark);

  const scale = useSharedValue(show ? 1 : 0);
  useEffect(() => {
    scale.value = show ? withSpring(1, { damping: 9, stiffness: 260 }) : withTiming(0, { duration: 150 });
  }, [show, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    // Placed by a plain box, scaled inside it, so the pop never moves it.
    <View
      pointerEvents="none"
      style={styles.box}
      accessible={show}
      accessibilityLabel={mark !== null ? LABEL[mark] : undefined}
      accessibilityElementsHidden={!show}
      importantForAccessibility={show ? "yes" : "no-hide-descendants"}
    >
      <Reanimated.View style={[styles.mark, style]}>
        {drawn === "weight"
          ? <Image source={TROPHY_ICON} style={styles.img} contentFit="contain" />
          : <MedalIcon size={REP_MEDAL} tight />}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Off the number's left edge: its right edge on the number's left, the
  // padding the gap, as tall as the number and centred on it. Placed in points
  // from the number's left, never `right: "100%"`: React Native's layout
  // (Yoga's AbsolutePercentAgainstInnerSize errata, on by default) measures an
  // absolute child's percentage against the room its parent was GIVEN, the
  // whole set column, not the number, which put the trophy about 28pt further
  // left, off the card (user report, 2026-10-23).
  box: { position: "absolute", left: -(PR_TROPHY + PR_TROPHY_GAP), top: 0, bottom: 0, width: PR_TROPHY + PR_TROPHY_GAP, paddingRight: PR_TROPHY_GAP, justifyContent: "center" },
  // As wide as what it holds, against the gap, so the medal (narrower than the
  // trophy) keeps the same gap from the number and pops from its own centre.
  mark: { alignSelf: "flex-end" },
  img: { width: PR_TROPHY, height: PR_TROPHY },
});
