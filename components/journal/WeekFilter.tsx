// The program page's week filter (app/program-history-detail.tsx; user request,
// 2026-10-22): a round funnel button pinned over the page at the top right,
// mirroring the back button across the screen (same BACK_TOP, BACK_LEFT in from
// the right edge, same circle), so it can be reached wherever the page is
// scrolled to. It opens a sheet listing every week, newest first, any number of
// them on at once, and the page keeps only the picked weeks' cards.
//
// A sheet rather than the Journal's chip row (SessionFilter): a chip row would
// open at the top of the page, out of sight of a button that floats over
// wherever you've scrolled. Each week is just its number, in a pill the size of
// All weeks, so more fit (user decision, 2026-10-22: the first version had a
// line of dates and sessions under each). A tap turns a week on or off and the
// page follows at once, so the sheet closes with Done rather than Cancel. While
// any week is picked the button is green (green glass on iOS 26), like a
// picked chip, so the page never hides weeks with nothing on screen to say
// why. "All weeks" clears the picks.

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GlassButton from "../GlassButton";
import { BACK_LEFT, BACK_SIZE, BACK_TOP } from "../BackButton";
import SheetPill from "../SheetPill";
import SimpleSheet from "../trainer/SimpleSheet";
import FunnelIcon from "../icons/FunnelIcon";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { haloGlow } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import type { ProgramWeek } from "../../utils/programHistory";

/** The floating button. Green while any week is picked. */
export function WeekFilterButton({ picked, onPress }: {
  /** How many weeks are picked; 0 shows them all. */
  picked: number;
  onPress: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const active = picked > 0;
  return (
    <GlassButton
      onPress={onPress}
      size={BACK_SIZE}
      tint={active ? ACCT : undefined}
      style={[styles.floating, { top: insets.top + BACK_TOP }]}
      // Matches the back button it faces, which has no shadow; picked, the
      // glow of a picked chip.
      solidStyle={active ? styles.pickedGlow : undefined}
      accessibilityLabel={active ? `Filter by week, ${picked} ${picked === 1 ? "week" : "weeks"} showing` : "Filter by week"}
    >
      <FunnelIcon size={18} color={active ? "#fff" : t.tp} />
    </GlassButton>
  );
}

/** The sheet the button opens: All weeks, then each week, newest first. */
export default function WeekFilterSheet({ visible, weeks, selected, onToggle, onClear, onClose }: {
  visible: boolean;
  /** Newest first, as the page lists them. */
  weeks: ProgramWeek[];
  /** The picked weeks' `startYMD`s; empty for all of them. */
  selected: ReadonlySet<string>;
  onToggle: (startYMD: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const all = selected.size === 0;

  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]}>Filter by week</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <SheetPill label="All weeks" selected={all} onPress={onClear} accessibilityState={{ selected: all }} />
        {weeks.map(w => {
          const on = selected.has(w.startYMD);
          return (
            <SheetPill
              key={w.startYMD}
              label={`Week ${w.number}`}
              selected={on}
              onPress={() => onToggle(w.startYMD)}
              accessibilityState={{ selected: on }}
            />
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <SheetPill label="Done" variant="primary" onPress={onClose} />
      </View>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", right: BACK_LEFT, zIndex: 10 },
  pickedGlow: haloGlow(ACCT),
  header: { paddingHorizontal: 24, paddingBottom: 12 },
  title: { fontFamily: FontFamily.bold, fontSize: 20 },
  scroll: { maxHeight: 420 },
  // Room round the pills for their shadows and the picked ones' rings.
  list: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8, gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
});
