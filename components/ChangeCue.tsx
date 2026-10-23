// The quiet line under an exercise that changed (utils/exerciseChanges.ts):
// a small glyph, then a few words with the fact in semibold. Grey, but for a
// swap's words, in the replaced orange the Journal's "Instead of Push" uses.
//
//   Workout tab, about the last session of the day:
//     "Last session: done 1st" · "Last session: Pec Deck instead" · "Last session: skipped"
//   Journal, about that session:
//     "Planned 2nd" · "Instead of Cable Fly" · "Added" · "Skipped"
//
// One line on a card that changed, nothing on one that didn't (user decision,
// 2026-10-13: subtle, so a busy card doesn't get busier). Plain text, never a
// button (user decision, 2026-10-14: no more hidden buttons). The Workout
// tab's FINISHED session reads like the Journal (user decision, 2026-10-14),
// and so does a card moved, swapped or added in the session still under way,
// in place of its "Last session" line (user request, 2026-10-22).

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { APP_DARK, APP_LIGHT, CUE_INK, CUE_INK_DARK, FontFamily, replacedTextColor } from "../constants/theme";
import type { LastTimeCue, SessionCue } from "../utils/exerciseChanges";
import { ordinal } from "../utils/workoutSummary";

type Kind = "moved" | "swapped" | "added" | "skipped";

const GLYPH: Record<Kind, keyof typeof Ionicons.glyphMap> = {
  moved: "swap-vertical",
  swapped: "swap-horizontal",
  added: "add-circle-outline",
  skipped: "remove-circle-outline",
};

function CueLine({ kind, lead, fact, isDark, style }: {
  kind: Kind;
  /** Plain words before the fact ("Last session: "). */
  lead?: string;
  fact: string;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ink = isDark ? CUE_INK_DARK : CUE_INK;
  const factInk = kind === "swapped" ? replacedTextColor(isDark) : ink;
  return (
    <View style={[styles.row, style]}>
      <Ionicons name={GLYPH[kind]} size={13} color={factInk} />
      <Text style={[styles.text, { color: ink }]} numberOfLines={1}>
        {lead}
        <Text style={[styles.fact, { color: factInk }]}>{fact}</Text>
      </Text>
    </View>
  );
}

/** The Workout tab's line about the last session of the day: always "Last
 *  session", however long ago it was (user decision, 2026-10-14). */
export function LastTimeCueLine({ cue, isDark, style }: {
  cue: LastTimeCue;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fact =
    cue.kind === "moved" ? `done ${ordinal(cue.donePosition)}`
    : cue.kind === "swapped" ? `${cue.to} instead`
    : "skipped";
  return <CueLine kind={cue.kind} lead="Last session: " fact={fact} isDark={isDark} style={style} />;
}

/** The Journal's line about what a session did with one of its exercises. */
export function SessionCueLine({ cue, isDark, style }: {
  cue: SessionCue | { kind: "skipped" };
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fact =
    cue.kind === "moved" ? `Planned ${ordinal(cue.plannedPosition)}`
    : cue.kind === "swapped" ? `Instead of ${cue.from}`
    : cue.kind === "added" ? "Added"
    : "Skipped";
  return <CueLine kind={cue.kind} fact={fact} isDark={isDark} style={style} />;
}

/** A planned exercise the session left out, in its planned place: a dashed
 *  outline where its card would be, its name greyed, "Skipped" under it. Drawn
 *  by the Journal's workout page and the Workout tab's finished session; the
 *  caller gives it the gap its cards keep. */
export function SkippedRow({ name, isDark, style }: {
  name: string;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={[styles.skippedRow, { borderColor: t.div }, style]} accessibilityLabel={`${name}, skipped`}>
      <Text style={[styles.skippedName, { color: t.ts }]} numberOfLines={1}>{name}</Text>
      <SessionCueLine cue={{ kind: "skipped" }} isDark={isDark} />
    </View>
  );
}

/** A session's changes summed up, under its date on a Journal card. */
export function ChangesSummaryLine({ summary, isDark, style }: {
  summary: string;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ink = isDark ? CUE_INK_DARK : CUE_INK;
  return (
    <View style={[styles.row, style]}>
      <Ionicons name="swap-horizontal" size={12} color={ink} />
      <Text style={[styles.summary, { color: ink }]} numberOfLines={1}>{summary}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 5 },
  text:    { flexShrink: 1, fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  fact:    { fontFamily: FontFamily.semibold },
  summary: { flexShrink: 1, fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16 },
  skippedRow:  { borderRadius: 20, borderWidth: 1.5, borderStyle: "dashed", paddingHorizontal: 18, paddingVertical: 14, gap: 4 },
  skippedName: { fontFamily: FontFamily.bold, fontSize: 17 },
});
