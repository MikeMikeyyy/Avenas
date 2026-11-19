// The Journal's Your Training card (user pick, 2026-11-19, option E of the
// Journal Training Card canvas, with option A's hours, PRs and programs
// finished under the sentence): the workouts so far, the last 26 weeks as
// bars, a line on how many of them were trained, the quiet facts, and then and
// now, a lift from months back against the last time it was done, which opens
// that old session. Every number comes from utils/trainingTotals.ts.
//
// Drawn by the user's own Journal (between Active Program and Recent Activity)
// and a trainer's view of a client's (ClientJournalView, between the calendar
// and Recent Activity), from that person's history, so the two read the same.
// Nothing until the first workout.
//
// The bars are laid out by flex, one column a week, never measured: right on
// the first frame at any width. A label or a week's still-to-come part is
// placed in points inside its own column.

import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, accentTextColor, trainingStripInk } from "../../constants/theme";
import { glowOpacity } from "../../constants/buttons";
import { PROGRAM_DONE_ICON, TROPHY_ICON } from "../../constants/icons";
import type { CompletedWorkout, SavedProgram } from "../../constants/programs";
import { useUnit } from "../../contexts/UnitContext";
import {
  groupDigits, memoryWhen, sinceText, stripMonths, stripSentence, topSetText, trainingFacts, trainingTotals,
  type TrainingFact,
} from "../../utils/trainingTotals";

/** The bars' height: the tallest week, or this week's plan, reaches it. */
const STRIP_H = 52;
/** A week off's stub. */
const OFF_H = 4;
/** The height scale never squashes below this many workouts a week. */
const MIN_SCALE = 4;

/** The facts' marks. PRs wears the PR trophy (TROPHY_ICON), the one a PR
 *  set wears (user request, 2026-11-19), and programs finished the finished
 *  program's own clipboard (PROGRAM_DONE_ICON), as every finished program
 *  does; only time is a glyph. */
const FACT_ART: Partial<Record<TrainingFact["key"], number>> = {
  prs: TROPHY_ICON,
  programs: PROGRAM_DONE_ICON,
};

function JournalTrainingCard({ history, programs, today, plannedThisWeek, isDark, onOpenWorkout }: {
  history: CompletedWorkout[];
  programs: SavedProgram[];
  /** The training day the app is on (getEffectiveToday). */
  today: string;
  /** Workouts this week holds (utils/trainingTotals.ts plannedThisWeek), null
   *  with no program: past what's done, the rest of this week's bar is pale. */
  plannedThisWeek: number | null;
  isDark: boolean;
  onOpenWorkout: (workoutId: string) => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const ink = trainingStripInk(isDark);
  const { isKg } = useUnit();
  const totals = useMemo(() => trainingTotals({ history, programs, today }), [history, programs, today]);
  const months = useMemo(() => stripMonths(totals.weeks), [totals.weeks]);
  if (totals.workouts === 0 || !totals.firstDate) return null;

  const weeks = totals.weeks;
  const last = weeks.length - 1;
  const doneThisWeek = weeks[last].workouts ?? 0;
  const ahead = plannedThisWeek !== null && plannedThisWeek > doneThisWeek ? plannedThisWeek : 0;
  const tallest = Math.max(MIN_SCALE, ahead, ...weeks.map(w => w.workouts ?? 0));
  const unit = STRIP_H / tallest;
  const say = stripSentence(totals);
  const facts = trainingFacts(totals);
  const memory = totals.memory;
  const accent = accentTextColor(isDark);
  const barGlow = {
    shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: glowOpacity(0.35, isDark), shadowRadius: 3,
  };

  return (
    <View>
      <View style={styles.headingRow}>
        <Text style={[styles.heading, { color: t.tp }]}>Your Training</Text>
      </View>
      <NeuCard dark={isDark} style={styles.card}>
        <View style={styles.inner}>
          <View style={styles.totalRow}>
            <Text style={[styles.total, { color: t.tp }]}>{groupDigits(totals.workouts)}</Text>
            <Text style={[styles.totalWord, { color: t.ts }]}>{totals.workouts === 1 ? "workout" : "workouts"}</Text>
          </View>
          <Text style={[styles.since, { color: t.ts }]}>{sinceText(totals.firstDate, today)}</Text>

          {/* A column a week: its bar on the line, a week off a stub, before
              the first workout nothing. This week's still to come is pale. */}
          <View
            style={styles.strip}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Workouts each week. ${say.lead}${say.strong}${say.tail}`}
          >
            {weeks.map((w, i) => (
              <View key={w.start} style={styles.col}>
                {i === last && ahead > 0 && (
                  <View style={[styles.ahead, { height: ahead * unit, backgroundColor: ink.ahead, borderColor: ink.aheadEdge }]} />
                )}
                {w.workouts !== null && (w.workouts > 0
                  ? <View style={[styles.bar, barGlow, { height: w.workouts * unit }]} />
                  : <View style={[styles.off, { backgroundColor: ink.off }]} />)}
              </View>
            ))}
          </View>
          <View style={[styles.baseline, { backgroundColor: t.div }]} />
          <View style={styles.months} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {weeks.map((w, i) => {
              const month = months.find(m => m.col === i);
              return (
                <View key={w.start} style={styles.col}>
                  {month && (
                    <Text
                      numberOfLines={1}
                      style={[styles.month, i >= last - 1 ? styles.monthEnd : styles.monthStart, { color: t.ts }]}
                    >
                      {month.label}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          <Text style={[styles.sentence, { color: t.tp }]}>
            {say.lead}<Text style={[styles.sentenceStrong, { color: accent }]}>{say.strong}</Text>{say.tail}
          </Text>

          {/* The facts under a line of their own, as then and now's below
              (user request, 2026-11-19). */}
          {facts.length > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
          {facts.length > 0 && (
            <View style={[styles.facts, facts.length === 3 ? styles.factsSpread : null]}>
              {facts.map(f => (
                <View key={f.key} style={styles.fact}>
                  {FACT_ART[f.key] !== undefined
                    ? <Image source={FACT_ART[f.key]} style={styles.factArt} contentFit="contain" />
                    : <Ionicons name="time-outline" size={15} color={t.ts} />}
                  <Text style={[styles.factText, { color: t.ts }]}>
                    <Text style={[styles.factNum, { color: t.tp }]}>{f.num}</Text> {f.word}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {memory && (
            <>
              <View style={[styles.divider, { backgroundColor: t.div }]} />
              <BounceButton
                onPress={() => onOpenWorkout(memory.workoutId)}
                accessibilityRole="button"
                accessibilityLabel={`${memoryWhen(memory, today)}: ${memory.exerciseName}, ${topSetText(memory.then, isKg)}, now ${topSetText(memory.now, isKg)}. Open that workout`}
              >
                <View style={styles.memRow}>
                  {/* The badge colour alone at ~15% for the wash, as the
                      achievement cards' badges are. */}
                  <View style={[styles.memBadge, { backgroundColor: `${ACCT}26` }]}>
                    <Ionicons name="trending-up" size={19} color={ACCT} />
                  </View>
                  <View style={styles.memText}>
                    <Text style={[styles.memWhen, { color: t.ts }]}>{memoryWhen(memory, today)}</Text>
                    <Text style={[styles.memLift, { color: t.tp }]}>{memory.exerciseName}</Text>
                    <View style={styles.memSets}>
                      <Text style={[styles.memThen, { color: t.ts }]}>{topSetText(memory.then, isKg)}</Text>
                      <Ionicons name="arrow-forward" size={13} color={t.ts} />
                      <Text style={[styles.memNow, { color: accent }]}>{topSetText(memory.now, isKg)} now</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={t.ts} />
                </View>
              </BounceButton>
            </>
          )}
        </View>
      </NeuCard>
    </View>
  );
}

export default memo(JournalTrainingCard);

const styles = StyleSheet.create({
  // Recent Activity's heading's height and gaps (components/journal/SessionFilter.tsx).
  headingRow:     { flexDirection: "row", alignItems: "center", height: 36, marginTop: 18, marginBottom: 6 },
  heading:        { fontFamily: FontFamily.bold, fontSize: 18 },
  card:           { borderRadius: 20, marginBottom: 4 },
  inner:          { padding: 18 },

  totalRow:       { flexDirection: "row", alignItems: "baseline", gap: 7 },
  total:          { fontFamily: FontFamily.bold, fontSize: 40, lineHeight: 46 },
  totalWord:      { fontFamily: FontFamily.semibold, fontSize: 16 },
  since:          { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 1 },

  strip:          { flexDirection: "row", gap: 4, height: STRIP_H, marginTop: 20 },
  // As tall as its row (stretched, never a percentage), its bar at the foot.
  col:            { flex: 1, alignSelf: "stretch", justifyContent: "flex-end" },
  bar:            { borderRadius: 4, backgroundColor: ACCT },
  off:            { height: OFF_H, borderRadius: OFF_H / 2 },
  ahead:          { position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 4, borderWidth: 1 },
  baseline:       { height: 1 },
  months:         { flexDirection: "row", gap: 4, height: 14, marginTop: 6 },
  // In points inside its column, wider than the column: the first week of a
  // month carries its name, the last two weeks' end at the column's edge so
  // they stay on the card.
  month:          { position: "absolute", top: 0, width: 40, fontFamily: FontFamily.bold, fontSize: 10.5, lineHeight: 14 },
  monthStart:     { left: 0, textAlign: "left" },
  monthEnd:       { right: 0, textAlign: "right" },

  sentence:       { fontFamily: FontFamily.semibold, fontSize: 14, lineHeight: 20, marginTop: 14 },
  sentenceStrong: { fontFamily: FontFamily.bold },

  // No top margin: the line above them gives the room, its own.
  facts:          { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 18, rowGap: 8 },
  factsSpread:    { justifyContent: "space-between" },
  fact:           { flexDirection: "row", alignItems: "center", gap: 6 },
  // Full-colour artwork fills its square, so a point over the 15pt glyphs.
  factArt:        { width: 16, height: 16 },
  factText:       { fontFamily: FontFamily.semibold, fontSize: 12.5 },
  factNum:        { fontFamily: FontFamily.bold },

  divider:        { height: 1, marginTop: 16, marginBottom: 14 },
  memRow:         { flexDirection: "row", alignItems: "center", gap: 12 },
  memBadge:       { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  memText:        { flex: 1, gap: 1 },
  memWhen:        { fontFamily: FontFamily.semibold, fontSize: 12.5, lineHeight: 17 },
  memLift:        { fontFamily: FontFamily.bold, fontSize: 14, lineHeight: 20 },
  memSets:        { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  memThen:        { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
  memNow:         { fontFamily: FontFamily.bold, fontSize: 13, lineHeight: 18 },
});
