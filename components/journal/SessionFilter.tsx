// Recent Activity's session filter: "All", then a chip for each session number
// the person's history holds ("1st", "2nd", …), any number of them on at once.
// The user's own Journal and a trainer's view of a client's journal both draw
// it, over that person's history, with the session numbers their cards read
// (`useJournalWorkoutInfo`), so a "3rd" chip finds exactly the cards that say
// "3rd session". The list itself is utils/journalFeed.ts `sessionFeed`.
//
// The chips stay tucked away until the round funnel button on the heading's
// row opens them (`RecentActivityHeading`). Open, the button is a close X, like
// the search buttons on Program History and a group page, and closing it
// clears the picks the same way closing a search clears its text, so nothing
// is ever filtered out of sight.
//
// The chips are the exercise picker's muscle chips (components/FilterChip.tsx):
// the same kind of multi-select filter, so it reads the same way. On iOS 26
// they're glass, a picked one green glass (user request, 2026-10-23: they read
// as greyed out), so the row opens by its height alone, without the fade
// (glass draws wrongly under a fading parent).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import GlassButton from "../GlassButton";
import FilterChip from "../FilterChip";
import ExpandReveal, { useReveal } from "../ExpandReveal";
import FunnelIcon from "../icons/FunnelIcon";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { PILL_SHADOW } from "../../constants/buttons";
import type { CompletedWorkout } from "../../constants/programs";
import { sessionFeed, sessionNumbers, type SessionOf } from "../../utils/journalFeed";
import { ordinal } from "../../utils/workoutSummary";

/** The filter's button: PTHome's section buttons' size (Groups' +), glass on
 *  iOS 26 (components/GlassButton.tsx). */
const BUTTON_SIZE = 36;

/** The filter's state for one person's history. `groups` is null while
 *  nothing is picked, which means "show the ordinary feed". */
export function useSessionFilter(workouts: CompletedWorkout[], sessionOf: SessionOf) {
  const [open, setOpen] = useState(false);
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
  // Closing puts the whole feed back: picks left on behind a closed filter
  // would hide activity with nothing on screen to say why.
  const toggleOpen = useCallback(() => {
    if (open) setPicked(new Set());
    setOpen(!open);
  }, [open]);
  return { numbers, selected, groups, toggle, clear, open, toggleOpen };
}

/** Recent Activity's heading, with the filter's button on its right while
 *  there's a session number to filter to. Drawn by both pages so the two
 *  headings stay the same. */
export function RecentActivityHeading({ filterable, open, onToggleOpen, isDark }: {
  filterable: boolean;
  open: boolean;
  onToggleOpen: () => void;
  isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.headingRow}>
      <Text style={[styles.heading, { color: t.tp }]}>Recent Activity</Text>
      {filterable && (
        <GlassButton
          onPress={onToggleOpen}
          size={BUTTON_SIZE}
          solidStyle={PILL_SHADOW}
          accessibilityLabel={open ? "Close session filter" : "Filter by session"}
          accessibilityState={{ expanded: open }}
        >
          {open
            ? <Ionicons name="close" size={20} color={t.tp} />
            : <FunnelIcon size={17} color={t.tp} />}
        </GlassButton>
      )}
    </View>
  );
}

export default function SessionFilter({ open, numbers, selected, onToggle, onClear, isDark }: {
  open: boolean;
  numbers: number[];
  selected: ReadonlySet<number>;
  onToggle: (n: number) => void;
  onClear: () => void;
  isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const all = selected.size === 0;
  const reveal = useReveal();
  useEffect(() => reveal.setOpen(open), [open, reveal]);

  return (
    // The bleed widens the clip to the page's edges (both pages pad 20), so
    // the chips scroll out under them rather than being cut at the gutter. No
    // fade: the chips are glass.
    <ExpandReveal progress={reveal.progress} open={open} pullTop={4} bleed={20}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.caption, { color: t.ts }]}>SESSION</Text>
        <FilterChip label="All" picked={all} onPress={onClear} accessibilityLabel="All activity" />
        {numbers.map(n => (
          <FilterChip
            key={n}
            label={ordinal(n)}
            picked={selected.has(n)}
            onPress={() => onToggle(n)}
            accessibilityLabel={`${ordinal(n)} session`}
          />
        ))}
      </ScrollView>
    </ExpandReveal>
  );
}

/** Over each number's group while more than one is picked. */
export function SessionGroupHeading({ session, isDark }: { session: number; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return <Text style={[styles.groupHeading, { color: t.ts }]}>{ordinal(session).toUpperCase()} SESSION</Text>;
}

const styles = StyleSheet.create({
  // As tall as the button, so the heading sits where it did as a bare line
  // (24 above, 12 below) whether or not the button is there.
  headingRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: BUTTON_SIZE, marginTop: 18, marginBottom: 6 },
  heading:      { fontFamily: FontFamily.bold, fontSize: 18 },
  // Back out across the reveal's bleed to the page's edges. The padding under
  // the chips is room for the active chip's glow, which the scroll view would
  // otherwise clip.
  scroll:       { flexGrow: 0, marginHorizontal: -20, marginBottom: 4 },
  content:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  caption:      { fontFamily: FontFamily.bold, fontSize: 11, letterSpacing: 0.8, marginRight: 2 },
  groupHeading: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.8, marginTop: 4, marginBottom: 8 },
});
