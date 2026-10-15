import { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import SegmentedControl from "./SegmentedControl";
import DumbbellIcon from "./DumbbellIcon";
import ExerciseChartPlot, { type ChartRecords } from "./progress/ExerciseChartPlot";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, GOLD, GOLD_DARK, accentTextColor } from "../constants/theme";
import { pill, pillGlow } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import { MONTH_NAMES } from "../utils/dates";
import { trimNumber } from "../utils/units";
import { chartChange, drawsOn, fmtChange, isExerciseMetric } from "../utils/exerciseChartLayout";
import type { ExerciseDataPoint, ExerciseMetricKey, PRs } from "../constants/progress";
import { EXERCISE_METRIC_OPTIONS } from "../constants/progress";

interface Props {
  exerciseName: string;
  /** Which custom exercise it is (utils/exerciseNames.ts exerciseIdentity),
   *  forwarded so the full-history page reads that one and not another of its
   *  name. */
  customId?: string;
  /**
   * Workout-day label the `history`/`prs` are scoped to (progress is tracked
   * per (day, exercise) pair — see ExerciseSelection). Shown in the header so
   * "Lateral Raises on Push" and "Lateral Raises on Arms" read as distinct,
   * and forwarded to the full-history page so it stays on the same slice.
   */
  dayName?: string;
  /** Stable id of that day, forwarded alongside the label so the full-history
   *  page can scope to THIS day rather than to everything sharing its name. */
  dayId?: string;
  /** ...and its program, since every program's days are d0, d1…: without it
   *  the full-history page listed other programs' first days too. */
  programId?: string;
  history: ExerciseDataPoint[];
  prs: PRs;
  /** "kg" | "lbs" */
  unit: string;
  /** Set when a TRAINER is viewing a client's progress: the full history and
   *  every workout this chart opens read that client's copy, read-only. Without
   *  it they read the viewer's own storage, where a client's ids don't exist. */
  clientId?: string;
  /** Which tab the chart shows. Held by the page, which remembers it between
   *  visits (utils/progressSession.ts). */
  metric: ExerciseMetricKey;
  onMetricChange: (m: ExerciseMetricKey) => void;
}

function fmtShortDate(ymd: string): string {
  // "YYYY-MM-DD" → "3 Mar"
  const [, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return ymd;
  return `${d} ${MONTH_NAMES[(m - 1) % 12]}`;
}

// A total moved, to the kilo: "4,560", never "10053.3".
function fmtTotal(n: number): string {
  return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString() : "0";
}

// The arrow before a change: ▲ up, ▼ down, none when it rounds to nothing.
function changeArrow(dir: "up" | "down" | "flat"): string {
  return dir === "up" ? "▲ " : dir === "down" ? "▼ " : "";
}

/** What a tab with nothing to draw says: done only at bodyweight, Strength has
 *  no weight and Volume no kilos; a timed hold moves no volume. Either way the
 *  sessions are on Sets. */
function emptyTabText(metric: ExerciseMetricKey, hold: boolean): string {
  if (metric === "volume") {
    return hold
      ? "A hold moves no volume. Sets shows the seconds held."
      : "Done at bodyweight so far, so there's no volume. Sets shows your reps.";
  }
  return hold ? "Held at bodyweight so far. Sets shows the seconds held." : "Done at bodyweight so far. Sets shows your reps.";
}

type RecordRow = {
  key: string;
  label: string;
  value: string;
  /** Said after the value, quieter: the reps of the heaviest set. */
  suffix?: string;
  sub: string;
  workoutId: string;
  /** Gold: a record lifted, each the gold mark on its own tab. A ring: the
   *  estimate, which nobody lifted. */
  marker: "gold" | "ring";
};

/**
 * Per-exercise progress: the chart, its tabs, the records under it and the
 * way to its full history. One kind of chart per tab (user decision,
 * 2026-10-12; components/progress/ExerciseChartPlot.tsx draws them):
 * Strength, each session's top set with its reps on the dot; Sets, every
 * working set stacked by its reps; Volume, a bar per session.
 */
export default function ExerciseProgressionChart({
  exerciseName,
  customId,
  dayName,
  dayId,
  programId,
  history,
  prs,
  unit,
  clientId,
  metric: rawMetric,
  onMetricChange,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const gold = isDark ? GOLD_DARK : GOLD;
  const router = useRouter();
  // A tab from before the tabs were renamed, kept in memory by the page across
  // a reload in development, reads as Strength.
  const metric: ExerciseMetricKey = isExerciseMetric(rawMetric) ? rawMetric : "strength";
  const fmtW = (w: number) => trimNumber(w, unit === "kg" ? 2 : 1);
  const hold = history.length > 0 && history.every(p => p.isHold);

  // How the tab's sessions moved across the chart, its last against its
  // first: the header's "▲ 18% since 12 Sep" (utils/exerciseChartLayout.ts).
  // A tapped session says how it went against the one before, in its pop-up.
  const change = useMemo(() => chartChange(history, metric), [history, metric]);

  // The record each tab marks in gold.
  const records = useMemo<ChartRecords>(() => ({
    heaviest: prs.heaviest?.workoutId ?? null,
    mostVolume: prs.bestSessionVolume?.workoutId ?? null,
    mostReps: prs.mostReps ? { workoutId: prs.mostReps.workoutId, set: prs.mostReps.setIndex ?? 0 } : null,
  }), [prs]);

  // Day context leads the subline (e.g. "Push · Sessions logged · 4") so two
  // day-scoped charts for the same exercise name are visually distinct.
  const headerLabel = (() => {
    const day = dayName?.trim() ? `${dayName.trim()} · ` : "";
    if (history.length === 0) return `${day}No sessions yet`;
    return `${day}Sessions logged · ${history.length}`;
  })();

  const goToWorkout = (workoutId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/workout-detail", params: { id: workoutId, ...(clientId ? { clientId } : {}) } });
  };

  // The records: three lifted, each the gold mark on its own tab, and the
  // estimate, which isn't something lifted, so it wears a ring instead (user
  // decision, 2026-10-13). Four tiles of numbers and dates read as a wall of
  // figures, and Best Set, the best weight × reps, mostly repeated the
  // heaviest set or crowned a light set of many reps.
  const rows: RecordRow[] = [];
  if (prs.heaviest) {
    rows.push({
      key: "heaviest",
      label: "Heaviest",
      value: `${fmtW(prs.heaviest.value)} ${unit}`,
      suffix: prs.heaviest.reps ? (hold ? ` for ${prs.heaviest.reps}s` : ` × ${prs.heaviest.reps}`) : undefined,
      sub: fmtShortDate(prs.heaviest.date),
      workoutId: prs.heaviest.workoutId,
      marker: "gold",
    });
  }
  if (prs.mostReps) {
    const m = prs.mostReps;
    const at = (m.weight ?? 0) > 0 ? `at ${fmtW(m.weight ?? 0)} ${unit} · ` : "";
    rows.push({
      key: "reps",
      label: m.hold ? "Longest hold" : "Most reps",
      value: m.hold ? `${m.value}s` : `${m.value} ${m.value === 1 ? "rep" : "reps"}`,
      sub: `${at}${fmtShortDate(m.date)}`,
      workoutId: m.workoutId,
      marker: "gold",
    });
  }
  if (prs.bestSessionVolume) {
    rows.push({
      key: "volume",
      label: "Most volume",
      value: `${fmtTotal(prs.bestSessionVolume.value)} ${unit}`,
      sub: fmtShortDate(prs.bestSessionVolume.date),
      workoutId: prs.bestSessionVolume.workoutId,
      marker: "gold",
    });
  }
  if (prs.oneRepMax) {
    // Worked out from a set, weight × (1 + reps / 30), and called what it is:
    // never "Best 1RM" (user request, 2026-10-08).
    rows.push({
      key: "e1rm",
      label: "Estimated 1RM",
      value: `${fmtW(Math.round(prs.oneRepMax.value))} ${unit}`,
      sub: `from ${fmtW(prs.oneRepMax.weight ?? 0)} ${unit} × ${prs.oneRepMax.reps ?? 0}`,
      workoutId: prs.oneRepMax.workoutId,
      marker: "ring",
    });
  }

  return (
    <>
    <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>{exerciseName}</Text>
            <Text style={[styles.headerValue, { color: t.ts }]} numberOfLines={1}>
              {headerLabel}
            </Text>
          </View>
          {change ? (() => {
            // Up in the accent's text green, down in grey, as the Strength
            // radar's arrows: a lighter week isn't a warning.
            const c = fmtChange(change.pct);
            const since = fmtShortDate(change.sinceYMD);
            return (
              <View
                style={styles.changeBlock}
                accessible
                accessibilityLabel={c.dir === "flat" ? `No change since ${since}` : `${c.dir === "up" ? "Up" : "Down"} ${c.text} since ${since}`}
              >
                <Text style={[styles.changeValue, { color: c.dir === "up" ? accentTextColor(isDark) : t.ts }]} numberOfLines={1}>
                  {`${changeArrow(c.dir)}${c.text}`}
                </Text>
                <Text style={[styles.changeSince, { color: t.ts }]} numberOfLines={1}>{`since ${since}`}</Text>
              </View>
            );
          })() : null}
        </View>

        {history.length === 0 ? (
          <View style={styles.empty}>
            <DumbbellIcon size={28} color={t.ts} />
            <Text style={[styles.emptyText, { color: t.ts }]}>
              No working sets logged for this exercise yet.
            </Text>
          </View>
        ) : !history.some(p => drawsOn(p, metric)) ? (
          <View style={styles.empty}>
            <DumbbellIcon size={28} color={t.ts} />
            <Text style={[styles.emptyText, { color: t.ts }]}>{emptyTabText(metric, hold)}</Text>
          </View>
        ) : (
          <View style={{ marginTop: 10, alignSelf: "stretch" }}>
            <ExerciseChartPlot
              exerciseName={exerciseName}
              points={history}
              metric={metric}
              unit={unit}
              seriesKey={`${exerciseName}|${programId ?? ""}|${dayId ?? dayName ?? ""}`}
              records={records}
            />
          </View>
        )}

        {/* The tabs: an iOS-style segmented control with a sliding thumb,
            the same control as VolumeBarChart's metric row so the two charts
            feel consistent. */}
        <SegmentedControl<ExerciseMetricKey>
          options={EXERCISE_METRIC_OPTIONS}
          value={metric}
          onChange={onMetricChange}
          style={{ marginTop: 16 }}
        />
      </View>
    </NeuCard>

    {rows.length > 0 ? (
      <>
        <Text style={[styles.prHeader, { color: t.tp }]}>Personal Records</Text>
        <NeuCard dark={isDark} radius={16} style={{ marginHorizontal: 20 }}>
          <View style={styles.recordsInner}>
            {rows.map((r, i) => (
              <View key={r.key}>
                {i > 0 ? <View style={[styles.recordDivider, { backgroundColor: t.div }]} /> : null}
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={() => goToWorkout(r.workoutId)}
                  style={styles.recordRow}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.label}: ${r.value}${r.suffix ?? ""}, ${r.sub}. Opens the workout.`}
                >
                  <View
                    style={[
                      styles.marker,
                      r.marker === "gold"
                        ? { backgroundColor: gold, shadowColor: gold, shadowOpacity: isDark ? 0.45 : 0.6 }
                        : { borderWidth: 1.5, borderColor: t.ts },
                    ]}
                  />
                  <Text style={[styles.recordLabel, { color: t.tp }]} numberOfLines={1}>{r.label}</Text>
                  <View style={styles.recordValues}>
                    <Text style={[styles.recordValue, { color: t.tp }]} numberOfLines={1}>
                      {r.value}
                      {r.suffix ? <Text style={[styles.recordSuffix, { color: t.ts }]}>{r.suffix}</Text> : null}
                    </Text>
                    <Text style={[styles.recordSub, { color: t.ts }]} numberOfLines={1}>{r.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={t.ts} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </NeuCard>
      </>
    ) : null}

    {/* "See exercise history" — primary CTA. ACCT-filled with a matching
        shadow glow so it stands apart from the neutral NeuCards around it
        (per CLAUDE.md: "primary = ACCT bg + ACCT shadow glow"). */}
    <BounceButton
      style={styles.historyBtnWrap}
      onPress={() => {
        router.navigate({
          pathname: "/exercise-history",
          params: { exerciseName, ...(customId ? { customId } : {}), ...(dayName ? { dayName } : {}), ...(dayId ? { dayId } : {}), ...(programId ? { programId } : {}), ...(clientId ? { clientId } : {}) },
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={`See full history for ${exerciseName}`}
    >
      <View style={styles.historyBtn}>
        <Text style={styles.historyBtnLabel} numberOfLines={1}>
          See Exercise History
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#fff" />
      </View>
    </BounceButton>
    </>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "flex-start" },
  title: { fontFamily: FontFamily.bold, fontSize: 18 },
  headerValue: { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 2 },
  changeBlock: { alignItems: "flex-end", marginLeft: 12 },
  changeValue: { fontFamily: FontFamily.bold, fontSize: 16 },
  changeSince: { fontFamily: FontFamily.regular, fontSize: 11, marginTop: 2 },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    textAlign: "center",
  },

  // "Personal Records" section header. Same bold-18 family as
  // DayExerciseList's "Exercise Progress" header so the two section blocks
  // read as siblings.
  prHeader: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    marginHorizontal: 20,
    marginTop: 36,
    marginBottom: 12,
  },

  // The records: one card of rows, each opening the workout it was set in.
  recordsInner: { paddingHorizontal: 16 },
  recordRow: { flexDirection: "row", alignItems: "center", height: 58, gap: 10 },
  recordDivider: { height: 1 },
  marker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 3,
  },
  recordLabel: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 15 },
  recordValues: { alignItems: "flex-end" },
  recordValue: { fontFamily: FontFamily.bold, fontSize: 17, lineHeight: 22 },
  recordSuffix: { fontFamily: FontFamily.semibold, fontSize: 13 },
  recordSub: { fontFamily: FontFamily.regular, fontSize: 11, lineHeight: 15 },

  // "See exercise history" — primary ACCT-filled CTA, in the canonical pill
  // shape (constants/buttons.ts). It was a hand-rolled 20-radius box with its
  // own padding and glow, which made it the one squared-off primary button on
  // the page — and a different button from the exercise summary's own "See
  // Exercise History", which already used pill() + pillGlow. Same numbers now.
  historyBtnWrap: {
    marginTop: 14,
    marginHorizontal: 20,
  },
  historyBtn: { ...pill(), paddingHorizontal: 18, gap: 10, backgroundColor: ACCT, ...pillGlow(ACCT, 0.4), elevation: 8 },
  historyBtnLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 15,
    color: "#fff",
    flex: 1,
    textAlign: "center",
  },
});
