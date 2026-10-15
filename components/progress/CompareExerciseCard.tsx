// components/progress/CompareExerciseCard.tsx
//
// One exercise, both programs: its chart lined up by sessions (the Nth time it
// came round in each program, a missed one keeping its place,
// components/progress/CompareChartPlot.tsx), how many of them each did ("4 of
// 5 sessions"), each program's change since its 1st session in the header, how
// green stands against blue at the same point ("5th session: 5 kg ahead of
// Upper Lower"), the same Strength / Sets / Volume tabs, and Personal Records
// side by side, Estimated 1RM included as on the exercise chart (user
// decision, 2026-10-14). Each record opens its workout.

import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";
import NeuCard from "../NeuCard";
import SegmentedControl from "../SegmentedControl";
import DumbbellIcon from "../DumbbellIcon";
import CompareChartPlot from "./CompareChartPlot";
import {
  ACCT, APP_DARK, APP_LIGHT, CUE_INK, CUE_INK_DARK, FontFamily, compareBlue, compareBlueText,
} from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { EXERCISE_METRIC_OPTIONS, type ExerciseMetricKey, type PRSet, type PRs } from "../../constants/progress";
import { chartChange, drawsOn, fmtChange } from "../../utils/exerciseChartLayout";
import { aheadAtSamePoint, type CompareLift, type LiftSlot } from "../../utils/programCompare";
import { missedBarValue } from "../../utils/compareChartLayout";
import { MONTH_NAMES } from "../../utils/dates";
import { trimNumber } from "../../utils/units";
import { ordinal } from "../../utils/workoutSummary";

interface Props {
  /** In the unit shown. */
  lift: CompareLift;
  /** Each program's row of it, sessions and misses (liftSlots), in the unit shown. */
  slots: { green: LiftSlot[]; blue: LiftSlot[] };
  names: { green: string; blue: string };
  /** Each program's records of it, in the unit shown. */
  prs: { green: PRs | null; blue: PRs | null };
  metric: ExerciseMetricKey;
  onMetricChange: (m: ExerciseMetricKey) => void;
  unit: string;
  /** A trainer viewing a client: a record opens that client's workout. */
  clientId?: string;
  seriesKey: string;
}

function fmtShortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return ymd;
  return `${d} ${MONTH_NAMES[(m - 1) % 12]}`;
}

const fmtTotal = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString() : "0");

type Cell = { value: string; suffix?: string; sub: string; workoutId: string } | null;

export default function CompareExerciseCard({ lift, slots, names, prs, metric, onMetricChange, unit, clientId, seriesKey }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();
  // Green's numbers in its dot's own green (user decision, 2026-10-14).
  const gInk = ACCT;
  const bInk = compareBlueText(isDark);
  const cue = isDark ? CUE_INK_DARK : CUE_INK;
  const fmtW =(w: number) => trimNumber(w, unit === "kg" ? 2 : 1);

  const hold = [...lift.green, ...lift.blue].every(p => p.isHold);
  const changeG = chartChange(lift.green, metric);
  const changeB = chartChange(lift.blue, metric);
  const ahead = metric === "strength" ? aheadAtSamePoint(slots.green, slots.blue) : null;
  const drawsSomething = [...lift.green, ...lift.blue].some(p => drawsOn(p, metric));
  // An empty bar on Sets or Volume gets a word under the chart; Strength's
  // misses say so themselves.
  const missedBar = metric !== "strength" && [slots.green, slots.blue].some(row => row.some((s, k) => s.missed !== undefined && missedBarValue(row, k, metric) !== null));
  // "4 of 5 sessions": the ones done, of the times it came round.
  const sessions = (row: LiftSlot[]) => {
    const done = row.filter(s => s.point).length;
    return done < row.length ? `${done} of ${row.length} sessions` : `${done} ${done === 1 ? "session" : "sessions"}`;
  };

  const open = (workoutId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/workout-detail", params: { id: workoutId, ...(clientId ? { clientId } : {}) } });
  };

  const change = (c: { pct: number } | null, ink: string, side: "green" | "blue") => {
    if (!c) return null;
    const f = fmtChange(c.pct);
    return (
      <View style={styles.changeRow}>
        {side === "green" ? <View style={[styles.dot, { backgroundColor: ACCT }]} /> : <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />}
        <Text style={[styles.changeValue, { color: f.dir === "up" ? ink : t.ts }]}>
          {`${f.dir === "up" ? "▲ " : f.dir === "down" ? "▼ " : ""}${f.text}`}
        </Text>
      </View>
    );
  };

  const aheadLine = (() => {
    if (!ahead) return null;
    const abs = Math.abs(ahead.diff);
    const amount = ahead.by === "weight" ? `${fmtW(abs)} ${unit}` : `${abs} ${abs === 1 ? "rep" : "reps"}`;
    const phrase = abs < 1e-6 ? "level with" : ahead.diff > 0 ? `${amount} ahead of` : `${amount} behind`;
    const lead = `${ordinal(ahead.session)} session: `;
    return (
      <View style={[styles.ahead, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(118,118,128,0.08)" }]}>
        <Ionicons name={ahead.diff >= 0 ? "trending-up" : "trending-down"} size={16} color={ahead.diff > 0 ? gInk : cue} />
        <Text style={[styles.aheadText, { color: t.tp }]}>
          {lead}
          <Text style={{ fontFamily: FontFamily.bold, color: ahead.diff > 0 ? gInk : t.tp }}>{phrase}</Text>
          {` ${names.blue}`}
        </Text>
      </View>
    );
  })();

  // The records, a cell for each program.
  const cell = (pr: PRSet | null, kind: "heaviest" | "reps" | "volume" | "e1rm"): Cell => {
    if (!pr) return null;
    if (kind === "heaviest") {
      return { value: `${fmtW(pr.value)} ${unit}`, suffix: pr.reps ? (hold ? ` for ${pr.reps}s` : ` × ${pr.reps}`) : undefined, sub: fmtShortDate(pr.date), workoutId: pr.workoutId };
    }
    if (kind === "reps") {
      const at = (pr.weight ?? 0) > 0 ? `at ${fmtW(pr.weight ?? 0)} ${unit} · ` : "";
      return { value: pr.hold ? `${pr.value}s` : `${pr.value} ${pr.value === 1 ? "rep" : "reps"}`, sub: `${at}${fmtShortDate(pr.date)}`, workoutId: pr.workoutId };
    }
    if (kind === "volume") return { value: `${fmtTotal(pr.value)} ${unit}`, sub: fmtShortDate(pr.date), workoutId: pr.workoutId };
    return { value: `${fmtW(Math.round(pr.value))} ${unit}`, sub: `from ${fmtW(pr.weight ?? 0)} × ${pr.reps ?? 0}`, workoutId: pr.workoutId };
  };
  const recordRows: { key: string; label: string; g: Cell; b: Cell }[] = [
    { key: "heaviest", label: "Heaviest", g: cell(prs.green?.heaviest ?? null, "heaviest"), b: cell(prs.blue?.heaviest ?? null, "heaviest") },
    {
      key: "reps",
      label: prs.green?.mostReps?.hold || prs.blue?.mostReps?.hold ? "Longest hold" : "Most reps",
      g: cell(prs.green?.mostReps ?? null, "reps"),
      b: cell(prs.blue?.mostReps ?? null, "reps"),
    },
    { key: "volume", label: "Most volume", g: cell(prs.green?.bestSessionVolume ?? null, "volume"), b: cell(prs.blue?.bestSessionVolume ?? null, "volume") },
    { key: "e1rm", label: "Estimated 1RM", g: cell(prs.green?.oneRepMax ?? null, "e1rm"), b: cell(prs.blue?.oneRepMax ?? null, "e1rm") },
  ].filter(r => r.g || r.b);

  const recordCell = (c: Cell, ink: string, programName: string, label: string) => (
    c ? (
      <TouchableOpacity
        activeOpacity={0.6}
        onPress={() => open(c.workoutId)}
        style={styles.cell}
        accessibilityRole="button"
        accessibilityLabel={`${programName} ${label}: ${c.value}${c.suffix ?? ""}, ${c.sub}. Opens the workout.`}
      >
        <Text style={[styles.cellValue, { color: ink }]} numberOfLines={1}>
          {c.value}
          {c.suffix ? <Text style={[styles.cellSuffix, { color: cue }]}>{c.suffix}</Text> : null}
        </Text>
        <Text style={[styles.cellSub, { color: t.ts }]} numberOfLines={2}>{c.sub}</Text>
      </TouchableOpacity>
    ) : (
      <View style={styles.cell}>
        <Text style={[styles.cellValue, { color: t.ts }]}>—</Text>
      </View>
    )
  );

  return (
    <>
      <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
        <View style={styles.inner}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>{lift.name}</Text>
              <View style={styles.countRow}>
                {lift.green.length ? (
                  <View style={styles.countItem}>
                    <View style={[styles.dot, { backgroundColor: ACCT }]} />
                    <Text style={[styles.count, { color: t.ts }]}>{sessions(slots.green)}</Text>
                  </View>
                ) : null}
                {lift.blue.length ? (
                  <View style={styles.countItem}>
                    <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />
                    <Text style={[styles.count, { color: t.ts }]}>{sessions(slots.blue)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            {changeG || changeB ? (
              <View style={styles.changeBlock}>
                {change(changeG, gInk, "green")}
                {change(changeB, bInk, "blue")}
                <Text style={[styles.since, { color: t.ts }]}>since the 1st session</Text>
              </View>
            ) : null}
          </View>

          {aheadLine}

          {drawsSomething ? (
            <View style={{ marginTop: 12, alignSelf: "stretch" }}>
              <CompareChartPlot
                exerciseName={lift.name}
                green={slots.green}
                blue={slots.blue}
                metric={metric}
                unit={unit}
                seriesKey={seriesKey}
              />
              <View style={styles.captionRow}>
                <Text style={[styles.caption, { color: t.ts }]}>Sessions in each program</Text>
                {missedBar ? (
                  // What an empty bar is: a session missed.
                  <View style={styles.key} accessible accessibilityLabel="An empty bar is a session missed">
                    <Svg width={9} height={12}>
                      <Defs>
                        <Pattern id="cmpKeyHatch" patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
                          <Line x1={0} y1={0} x2={0} y2={4} stroke={t.ts} strokeWidth={1.2} strokeOpacity={0.7} />
                        </Pattern>
                      </Defs>
                      <Rect x={0.6} y={0.6} width={7.8} height={10.8} rx={1.5} fill="url(#cmpKeyHatch)" stroke={t.ts} strokeWidth={1} strokeDasharray={[2, 1.5]} />
                    </Svg>
                    <Text style={[styles.caption, { color: t.ts }]}>Missed</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.empty}>
              <DumbbellIcon size={28} color={t.ts} />
              <Text style={[styles.emptyText, { color: t.ts }]}>
                {metric === "volume"
                  ? (hold ? "A hold moves no volume. Sets shows the seconds held." : "Done at bodyweight so far, so there's no volume. Sets shows your reps.")
                  : (hold ? "Held at bodyweight so far. Sets shows the seconds held." : "Done at bodyweight so far. Sets shows your reps.")}
              </Text>
            </View>
          )}

          <SegmentedControl<ExerciseMetricKey>
            options={EXERCISE_METRIC_OPTIONS}
            value={metric}
            onChange={onMetricChange}
            style={{ marginTop: 16 }}
          />
        </View>
      </NeuCard>

      {recordRows.length ? (
        <>
          <Text style={[styles.prHeader, { color: t.tp }]}>Personal Records</Text>
          <NeuCard dark={isDark} radius={16} style={{ marginHorizontal: 20 }}>
            <View style={styles.recordsInner}>
              {/* Each program's whole name over its column, as on At a
                  glance: wrapping, never cut short, a gap between the two. */}
              <View style={styles.recordHeads}>
                <View style={{ flex: 1 }} />
                <View style={styles.recordHead}>
                  <View style={[styles.dot, { backgroundColor: ACCT }]} />
                  <Text style={[styles.recordHeadText, { color: t.tp }]}>{names.green}</Text>
                </View>
                <View style={styles.recordHead}>
                  <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />
                  <Text style={[styles.recordHeadText, { color: t.tp }]}>{names.blue}</Text>
                </View>
              </View>
              {recordRows.map(r => (
                <View key={r.key} style={[styles.recordRow, { borderTopColor: t.div }]}>
                  <Text style={[styles.recordLabel, { color: t.tp }]} numberOfLines={2}>{r.label}</Text>
                  {recordCell(r.g, gInk, names.green, r.label)}
                  {recordCell(r.b, bInk, names.blue, r.label)}
                </View>
              ))}
            </View>
          </NeuCard>
        </>
      ) : null}
    </>
  );
}

/** A program's column, and the space before it. */
const COL = 104;
const GAP = 10;

const styles = StyleSheet.create({
  inner: { padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "flex-start" },
  title: { fontFamily: FontFamily.bold, fontSize: 18 },
  // "4 of 5 sessions" for each program, wrapping onto a line each when both
  // are long.
  countRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 1, marginTop: 2 },
  countItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { fontFamily: FontFamily.semibold, fontSize: 13 },
  changeBlock: { alignItems: "flex-end", marginLeft: 12 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  changeValue: { fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 21 },
  since: { fontFamily: FontFamily.regular, fontSize: 11, marginTop: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  ahead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14 },
  aheadText: { flex: 1, fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  captionRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 2 },
  caption: { fontFamily: FontFamily.regular, fontSize: 11, lineHeight: 15, textAlign: "center" },
  key: { flexDirection: "row", alignItems: "center", gap: 4 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 32, gap: 8 },
  emptyText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
  prHeader: { fontFamily: FontFamily.bold, fontSize: 18, marginHorizontal: 20, marginTop: 36, marginBottom: 12 },
  recordsInner: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 },
  // As on At a glance: each dot centred on its name, and a shorter name
  // centred on a longer one that wraps, so the two dots sit level.
  recordHeads: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  recordHead: { width: COL, marginLeft: GAP, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  recordHeadText: { flexShrink: 1, fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16 },
  recordRow: { flexDirection: "row", alignItems: "center", minHeight: 62, borderTopWidth: 1 },
  recordLabel: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 20 },
  cell: { width: COL, marginLeft: GAP, alignItems: "flex-end", paddingVertical: 8 },
  cellValue: { fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 21 },
  cellSuffix: { fontFamily: FontFamily.semibold, fontSize: 12 },
  cellSub: { fontFamily: FontFamily.regular, fontSize: 11, lineHeight: 15 },
});
