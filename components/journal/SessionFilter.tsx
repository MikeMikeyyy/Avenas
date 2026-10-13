// Recent Activity's session filter: "All", then a chip for each session number
// the person's history holds ("1st", "2nd", …), any number of them on at once.
// The user's own Journal and a trainer's view of a client's journal both draw
// it, over that person's history, with the session numbers their cards read
// (`useJournalWorkoutInfo`), so a "3rd" chip finds exactly the cards that say
// "3rd session". The list itself is utils/journalFeed.ts `sessionFeed`.
//
// The chips look like the exercise picker's muscle chips: the same kind of
// multi-select filter, so it reads the same way.

import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import * as Haptics from "expo-haptics";

import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { PILL_RADIUS } from "../../constants/buttons";
import type { CompletedWorkout } from "../../constants/programs";
import { sessionFeed, sessionNumbers, type SessionOf } from "../../utils/journalFeed";
import { ordinal } from "../../utils/workoutSummary";

/** The filter's state for one person's history. `groups` is null while
 *  nothing is picked, which means "show the ordinary feed". */
export function useSessionFilter(workouts: CompletedWorkout[], sessionOf: SessionOf) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  const numbers = useMemo(() => sessionNumbers(workouts, sessionOf), [workouts, sessionOf]);
  // A pick whose sessions have all been deleted is no longer offered, so it
  // stops counting rather than leaving an empty list with no chip to undo it.
  const selected = useMemo(
    () => new Set([...picked].filter(n => numbers.includes(n))),
    [picked, numbers],
  );
  const groups = useMemo(
    () => (selected.size > 0 ? sessionFeed({ workouts, sessionOf, selected }) : null),
    [workouts, sessionOf, selected],
  );
  const toggle = useCallback((n: number) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);
  const clear = useCallback(() => setPicked(new Set()), []);
  return { numbers, selected, groups, toggle, clear };
}

export default function SessionFilter({ numbers, selected, onToggle, onClear, isDark }: {
  numbers: number[];
  selected: ReadonlySet<number>;
  onToggle: (n: number) => void;
  onClear: () => void;
  isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const all = selected.size === 0;

  const chip = (key: string, label: string, active: boolean, onPress: () => void, a11y: string) => (
    <TouchableOpacity
      key={key}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active }}
      style={[styles.chip, active ? [styles.chipOn, { backgroundColor: ACCT, shadowColor: ACCT }] : { backgroundColor: t.div }]}
    >
      <Text style={[styles.chipText, { color: active ? "#fff" : t.ts }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.caption, { color: t.ts }]}>SESSION</Text>
      {chip("all", "All", all, onClear, "All activity")}
      {numbers.map(n => chip(String(n), ordinal(n), selected.has(n), () => onToggle(n), `${ordinal(n)} session`))}
    </ScrollView>
  );
}

/** Over each number's group while more than one is picked. */
export function SessionGroupHeading({ session, isDark }: { session: number; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return <Text style={[styles.groupHeading, { color: t.ts }]}>{ordinal(session).toUpperCase()} SESSION</Text>;
}

const styles = StyleSheet.create({
  // Bleeds to the page's edges (both pages pad 20) so the chips scroll under
  // them rather than stopping short. The padding under them is room for the
  // active chip's glow, which the scroll view would otherwise clip.
  scroll:       { flexGrow: 0, marginHorizontal: -20, marginTop: -4, marginBottom: 4 },
  content:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  caption:      { fontFamily: FontFamily.bold, fontSize: 11, letterSpacing: 0.8, marginRight: 2 },
  chip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: PILL_RADIUS, alignItems: "center", justifyContent: "center" },
  chipOn:       { shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 8 },
  chipText:     { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
  groupHeading: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.8, marginTop: 4, marginBottom: 8 },
});
