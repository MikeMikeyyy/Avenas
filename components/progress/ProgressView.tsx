// Body of the Progress page, with data passed in as props so it can render
// either the current user's data (from AsyncStorage) or a PT-viewed client's
// data (their cloud backup, via trainerStore.loadClientData) using identical
// visuals.

import { useState, useCallback, useMemo, useRef, useEffect, type ReactElement } from "react";
import { View, Text, StyleSheet, Animated, type RefreshControlProps } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import ProgramScopePicker from "../ProgramScopePicker";
import DropdownPicker from "../DropdownPicker";
import VolumeBarChart from "../VolumeBarChart";
import StrengthRadarChart from "../StrengthRadarChart";
import DayExerciseList from "../DayExerciseList";
import ExerciseProgressionChart from "../ExerciseProgressionChart";
import DumbbellIcon from "../DumbbellIcon";

import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import { type CompletedWorkout, type ProgramDayRef, type SavedProgram } from "../../constants/programs";
import { type CustomExercise, type SelectableMuscle } from "../../constants/exercises";
import type { MuscleGroupStat, RangeKey } from "../../constants/progress";
import { RANGE_OPTIONS } from "../../constants/progress";
import { progressSessionKey } from "../../utils/progressSession";
import { useProgressSelection } from "../../hooks/useProgressSelection";
import {
  bucketMetricByDay,
  bucketMetricByMonth,
  bucketMetricByRollingWeeks,
  collectExerciseHistory,
  computeMuscleGroupStats,
  computePRs,
  computeWorkoutDurationMinutes,
  computeWorkoutReps,
  computeWorkoutTonnage,
  filterByDateWindow,
  filterByProgramScope,
  getRangeOption,
  previousComparableWindow,
  rangeWindow,
  yearBarCount,
  scopedProgramDays,
  windowLengthDays,
} from "../../utils/progressStats";
import { toDisplayWeight } from "../../utils/units";
import { carriedExercises, knownCustomExercises } from "../../utils/customExerciseDetails";

// kg → display-unit lens for the radar stats: volume is the only weight-valued
// field, sessions/sets pass through. Unit-invariant consumers (the load set
// counts, the trend ratios) are unaffected by conversion, so it's safe to
// convert always.
function convertMuscleVolumes(
  stats: Record<SelectableMuscle, MuscleGroupStat>,
  isKg: boolean,
): Record<SelectableMuscle, MuscleGroupStat> {
  const out = { ...stats };
  for (const k of Object.keys(out) as (keyof typeof out)[]) {
    out[k] = { ...out[k], volume: toDisplayWeight(out[k].volume, isKg) };
  }
  return out;
}

export interface ProgressViewProps {
  history: CompletedWorkout[];
  programs: SavedProgram[];
  /** The viewer's (or the viewed client's) own custom exercises, used to
   *  resolve muscle groups for the Strength radar, together with the custom
   *  exercises `programs` carry (a trainer's, utils/customExerciseDetails.ts). */
  customExercises?: CustomExercise[];
  loaded: boolean;
  title?: string;
  /** Wrap content in a FadeScreen with the theme bg. Default true (tab use); false when embedding inside another route. */
  asScreen?: boolean;
  /** Add safe-area top padding. Default true. */
  withTopInset?: boolean;
  /** Bottom padding override (defaults to 140 to clear the tab bar). */
  bottomPadding?: number;
  /** Pull to refresh, when the screen embedding this owns a reload (a
   *  trainer's client page). */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** A trainer viewing a client: the exercise chart's history page and PR
   *  tiles then open that client's copy, read-only. */
  clientId?: string;
}

const NO_CUSTOM: CustomExercise[] = [];

/**
 * Keyed by whose page it is, so each person's selections (remembered for the
 * app's run, utils/progressSession.ts) are read into a fresh body rather than
 * carried from one client's page into the next.
 */
export default function ProgressView(props: ProgressViewProps) {
  const sessionKey = progressSessionKey(props.clientId);
  return <ProgressBody key={sessionKey} sessionKey={sessionKey} {...props} />;
}

function ProgressBody({
  history,
  programs,
  customExercises = NO_CUSTOM,
  loaded,
  title = "Progress",
  asScreen = true,
  withTopInset = true,
  bottomPadding,
  refreshControl,
  clientId,
  sessionKey,
}: ProgressViewProps & { sessionKey: string }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { isKg } = useUnit();
  const unit = isKg ? "kg" : "lbs";

  // Every selection on the page survives it unmounting (another tab, a pushed
  // screen, a trainer's client page closed and reopened) until the app closes.
  const [scope, setScope] = useProgressSelection(sessionKey, "scope");
  const [range, setRange] = useProgressSelection(sessionKey, "range");
  const [metric, setMetric] = useProgressSelection(sessionKey, "metric");
  const [strengthMetric, setStrengthMetric] = useProgressSelection(sessionKey, "strengthMetric");
  // Day-qualified: the same exercise on two days (lateral raises on Push and
  // on Arms) is two separate selections with separate progress data. The day is
  // held as an identified ref, so two days that share a NAME are two selections
  // too.
  const [selectedExercise, setSelectedExercise] = useProgressSelection(sessionKey, "selectedExercise");
  const [expandedProgram, setExpandedProgram] = useProgressSelection(sessionKey, "expandedProgram");
  const [expandedDay, setExpandedDay] = useProgressSelection(sessionKey, "expandedDay");
  const [exerciseMetric, setExerciseMetric] = useProgressSelection(sessionKey, "exerciseMetric");
  const [scopeFallbackNote, setScopeFallbackNote] = useState<string | null>(null);

  const scrollRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const exerciseSectionY = useRef(0);
  const exerciseSectionH = useRef(0);
  const viewportH = useRef(0);
  // The selection the page opened with. Coming back to it isn't a tap, so it
  // doesn't scroll the page down to its chart (see the scroll effect below).
  const restoredSelection = useRef(selectedExercise);

  // Reconcile scope when the upstream programs list changes (e.g. switching
  // client). Only once the data is in: a remembered program scope would
  // otherwise meet the empty list a screen starts with and fall back to "All
  // programs" before that program had a chance to load.
  useEffect(() => {
    if (!loaded) return;
    setScope(prev => {
      if (prev.kind !== "program") return prev;
      const stillExists = programs.some(pp => pp.id === prev.programId);
      if (stillExists) return prev;
      setScopeFallbackNote("Selected program was removed. Showing all programs.");
      return { kind: "all" };
    });
  }, [programs, loaded]);

  useEffect(() => {
    if (!scopeFallbackNote) return;
    const id = setTimeout(() => setScopeFallbackNote(null), 4000);
    return () => clearTimeout(id);
  }, [scopeFallbackNote]);

  const activeProgram = useMemo(() => programs.find(p => p.status === "active") ?? null, [programs]);
  const hasActiveProgram = activeProgram !== null;

  const scopedWorkouts = useMemo(
    () => filterByProgramScope(history, scope, programs),
    [history, scope, programs],
  );

  /** First day there's a session for, in the CURRENT scope — switching to one
   *  program shortens the year chart to that program's own history, same as
   *  every other number on this page. */
  const earliestWorkoutYMD = useMemo(() => {
    let min: string | null = null;
    // "YYYY-MM-DD" sorts lexicographically as a date, so no parsing needed.
    for (const w of scopedWorkouts) if (min === null || w.date < min) min = w.date;
    return min;
  }, [scopedWorkouts]);

  // The page's time range, picked beside the program, sets the window for BOTH
  // charts: the Volume bars and the Strength radar read the same dates, so the
  // two cards always describe the same stretch of training. It reads today's
  // date, so it's recomputed whenever the sessions are (every focus reloads
  // them), not only on a range change: a page left open past midnight would
  // otherwise keep showing yesterday's week.
  const dateWindow = useMemo(
    () => rangeWindow(range, new Date(), earliestWorkoutYMD),
    [range, earliestWorkoutYMD, scopedWorkouts],
  );
  const rangeOpt = getRangeOption(range);

  const buckets = useMemo(() => {
    const aggregate =
      metric === "volume" ? computeWorkoutTonnage :
      metric === "reps" ? computeWorkoutReps :
      computeWorkoutDurationMinutes;
    // chartEndYMD, not endYMD: a week in progress still draws Monday through
    // Sunday. The days ahead bucket to zero and read as rest days, which beats
    // the unlabelled blank slots the chart padded them out to before.
    const { startYMD, chartEndYMD } = dateWindow;
    switch (getRangeOption(range).bucket) {
      case "day":          return bucketMetricByDay(scopedWorkouts, startYMD, chartEndYMD, aggregate);
      case "rollingWeeks": return bucketMetricByRollingWeeks(scopedWorkouts, startYMD, chartEndYMD, aggregate);
      case "month":        return bucketMetricByMonth(scopedWorkouts, startYMD, chartEndYMD, aggregate);
    }
  }, [scopedWorkouts, range, metric, dateWindow]);

  // Strength radar: the range's window against the same-length, weekday-aligned
  // window before it, which feeds the muted polygon + ▲/▼ arrows. endYMD, not
  // chartEndYMD: a week in progress (Mon to Wed) must compare against last Mon
  // to Wed, or every arrow points down until Sunday. A long range doesn't
  // inflate the chart: its full-scale benchmarks are per week, scaled by the
  // window's length (radarWindowDays), so a month expects about 4 weeks' work.
  // A trainer's custom exercise counts toward the muscles the trainer gave it,
  // which the programs carry: it isn't in the client's own list.
  const knownCustoms = useMemo(
    () => knownCustomExercises(customExercises, carriedExercises(programs)),
    [customExercises, programs],
  );
  const { muscleStats, prevMuscleStats, radarWindowDays } = useMemo(() => {
    const { startYMD, endYMD } = dateWindow;
    const prev = previousComparableWindow(startYMD, endYMD);
    return {
      muscleStats: computeMuscleGroupStats(
        filterByDateWindow(scopedWorkouts, startYMD, endYMD), knownCustoms),
      prevMuscleStats: computeMuscleGroupStats(
        filterByDateWindow(scopedWorkouts, prev.startYMD, prev.endYMD), knownCustoms),
      radarWindowDays: windowLengthDays(startYMD, endYMD),
    };
  }, [scopedWorkouts, knownCustoms, dateWindow]);

  // The slot grid the chart lays out against. Fixed for the ranges whose shape
  // is fixed; for the year it's whatever the window produced, because that one
  // grows from 3 bars to 12 as history accumulates. Reserving 12 regardless
  // would put the growth back as empty space.
  const volumeSlotsCount = useMemo(() => {
    switch (range) {
      case "thisWeek":
      case "lastWeek":    return 7;
      case "thisMonth":   return 4;
      case "last3Months": return 3;
      case "year":        return yearBarCount(new Date(), earliestWorkoutYMD);
    }
  }, [range, earliestWorkoutYMD]);

  const volumeRangeText = useMemo(() => {
    switch (range) {
      case "thisWeek":    return "this week";
      case "lastWeek":    return "last week";
      case "thisMonth":   return "in the last month";
      case "last3Months": return "in the last 3 months";
      case "year":        return "in the last year";
    }
  }, [range]);

  // Scoped sessions are passed in so days that have LEFT the program (deleted,
  // or renamed + rebuilt into a new day) still appear, reconstructed from the
  // sessions logged against them.
  const daysInScope = useMemo(
    () => scopedProgramDays(scope, programs, scopedWorkouts),
    [scope, programs, scopedWorkouts],
  );

  // The live ref behind the selection. Derived rather than stored, so a scope
  // switch or a program edit can't leave a stale day pinned: a renamed day
  // keeps its chart (the key is the id, not the label) and a day that left the
  // scope resolves to null, which hides the section.
  const selectedDay = useMemo(
    () => (selectedExercise ? daysInScope.find(d => d.key === selectedExercise.dayKey) ?? null : null),
    [daysInScope, selectedExercise],
  );

  const { exerciseHistory, prs } = useMemo(() => {
    if (!selectedExercise || !selectedDay) return { exerciseHistory: [], prs: null };
    // Day-scoped: only sessions of the selected day row feed the chart + PRs.
    const eh = collectExerciseHistory(scopedWorkouts, selectedExercise.name, selectedDay);
    const p = computePRs(eh, scopedWorkouts, selectedExercise.name, selectedDay);
    return { exerciseHistory: eh, prs: p };
  }, [scopedWorkouts, selectedExercise, selectedDay]);

  // ── kg → display-unit conversion for the charts ──────────────────────────────
  // All stats are computed in canonical kg; convert the weight/volume-valued
  // outputs to the active unit before plotting. Reps/duration/frequency are not
  // weights and pass through. (Muscle stats go through convertMuscleVolumes;
  // the radar's frequency and set-count load metrics never read the converted
  // volume, so converting unconditionally is harmless.)
  const dw = (n: number) => toDisplayWeight(n, isKg);
  const displayBuckets = useMemo(
    () => (metric === "volume" ? buckets.map((b) => ({ ...b, total: dw(b.total) })) : buckets),
    [buckets, metric, isKg],
  );
  const displayMuscleStats = useMemo(
    () => convertMuscleVolumes(muscleStats, isKg),
    [muscleStats, isKg],
  );
  const displayPrevMuscleStats = useMemo(
    () => convertMuscleVolumes(prevMuscleStats, isKg),
    [prevMuscleStats, isKg],
  );
  const displayExerciseHistory = useMemo(
    () => exerciseHistory.map((p) => ({
      ...p,
      topWeight: dw(p.topWeight),
      bestSetVolume: dw(p.bestSetVolume),
      bestSetWeight: dw(p.bestSetWeight),
      e1rm: dw(p.e1rm),
      e1rmWeight: dw(p.e1rmWeight),
      sessionVolume: dw(p.sessionVolume),
    })),
    [exerciseHistory, isKg],
  );
  const displayPrs = useMemo(() => {
    if (!prs) return null;
    const c = <T extends { value: number; weight?: number } | null>(pr: T): T =>
      pr ? ({ ...pr, value: dw(pr.value), ...(pr.weight != null ? { weight: dw(pr.weight) } : {}) }) : pr;
    return {
      heaviest: c(prs.heaviest),
      bestSetVolume: c(prs.bestSetVolume),
      bestSessionVolume: c(prs.bestSessionVolume),
      oneRepMax: c(prs.oneRepMax),
    };
  }, [prs, isKg]);

  useEffect(() => {
    if (!selectedExercise) return;
    // Remembered from the last visit: the page comes back as it was left,
    // rather than jumping down to the chart as it does for a tap.
    if (selectedExercise === restoredSelection.current) return;
    const id = requestAnimationFrame(() => {
      const secY = exerciseSectionY.current;
      const secH = exerciseSectionH.current;
      const viewH = viewportH.current;
      if (secY <= 0) return;
      const node: any = scrollRef.current;
      if (secH > 0 && viewH > 0) {
        // Bottom-anchored: scroll the LEAST amount that still leaves the
        // section's bottom (the "See Exercise History" CTA) clear of the
        // floating tab bar (~49pt + bottom inset, plus a breathing gap).
        // This keeps as much of the day list above visible as possible.
        // Capped so the section's top never disappears under the header
        // gradient — on screens too short for both, the top wins (the tab
        // bar is translucent glass, so a grazed CTA stays legible).
        const needed = secY + secH - (viewH - (insets.bottom + 72));
        const cap = secY - (insets.top + 24);
        node?.scrollTo?.({ y: Math.max(0, Math.min(needed, cap)), animated: true });
      } else {
        // Measurements not in yet (first-ever selection this mount) — fall
        // back to pinning the section top near the viewport top.
        node?.scrollTo?.({ y: Math.max(0, secY - 40), animated: true });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [selectedExercise, insets.top, insets.bottom]);

  const onSelectExercise = useCallback((day: ProgramDayRef, name: string) => {
    // Keep the previous object identity on a same-pair reselect so the
    // scroll-into-view effect (keyed on the selection) doesn't refire.
    setSelectedExercise(prev =>
      prev &&
      prev.dayKey === day.key &&
      prev.name.trim().toLowerCase() === name.trim().toLowerCase()
        ? prev
        : { dayKey: day.key, name },
    );
  }, []);

  const showNoActiveProgramHint = scope.kind === "current" && !hasActiveProgram;
  const topPad = withTopInset ? insets.top + 50 : 16;
  const botPad = bottomPadding ?? (insets.bottom + 140);

  const Wrapper: any = asScreen ? FadeScreen : View;
  const wrapperProps = asScreen ? { style: { backgroundColor: t.bg } } : { style: { flex: 1, backgroundColor: t.bg } };

  return (
    <Wrapper {...wrapperProps}>
      {asScreen && withTopInset && (
        <Animated.View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
                locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          </MaskedView>
        </Animated.View>
      )}

      <Animated.ScrollView
        ref={scrollRef as any}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        onLayout={e => { viewportH.current = e.nativeEvent.layout.height; }}
        contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: botPad }]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={refreshControl}
      >
        {title !== "" && (
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
          </View>
        )}

        <View style={{ marginTop: 18 }}>
          {/* The page's two filters: which program, and over what dates. Both
              apply to the Volume and Strength cards alike. */}
          <View style={styles.filterRow}>
            <ProgramScopePicker
              scope={scope}
              programs={programs}
              onChange={s => { setScope(s); setScopeFallbackNote(null); }}
              style={{ flex: 1 }}
            />
            <DropdownPicker<RangeKey>
              value={range}
              options={RANGE_OPTIONS}
              onChange={setRange}
              sheetTitle="Time range"
              size="bar"
              leadingIcon="calendar-outline"
            />
          </View>
          {scopeFallbackNote ? (
            <View style={{ marginHorizontal: 20, marginTop: 8 }}>
              <Text style={[styles.note, { color: ACCT }]}>{scopeFallbackNote}</Text>
            </View>
          ) : null}
        </View>

        {showNoActiveProgramHint && loaded ? (
          <NeuCard dark={isDark} radius={16} style={{ marginHorizontal: 20, marginTop: 16 }}>
            <View style={styles.hintInner}>
              <DumbbellIcon size={26} color={t.ts} />
              <Text style={[styles.hintText, { color: t.ts }]}>
                Set an active program to see this view, or switch to “All programs”.
              </Text>
            </View>
          </NeuCard>
        ) : (
          <>
            <VolumeBarChart
              buckets={displayBuckets}
              unit={unit}
              slotsCount={volumeSlotsCount}
              rangeText={volumeRangeText}
              metric={metric}
              onMetricChange={setMetric}
            />
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionHeader, { color: t.tp }]}>Strength</Text>
            </View>
            <StrengthRadarChart
              stats={displayMuscleStats}
              prevStats={displayPrevMuscleStats}
              unit={unit}
              windowDays={radarWindowDays}
              rangeLabel={rangeOpt.label}
              currentLegend={rangeOpt.currentLegend}
              previousLegend={rangeOpt.previousLegend}
              metric={strengthMetric}
              onMetricChange={setStrengthMetric}
            />
            <DayExerciseList
              days={daysInScope}
              workouts={scopedWorkouts}
              selectedExercise={selectedExercise}
              onSelectExercise={onSelectExercise}
              expandedDay={expandedDay}
              onExpandedDayChange={setExpandedDay}
              groupByProgram={scope.kind === "all"}
              programs={programs}
              expandedProgram={expandedProgram}
              onExpandedProgramChange={setExpandedProgram}
            />
          </>
        )}

        {selectedExercise && selectedDay && displayPrs ? (
          <View
            onLayout={e => {
              exerciseSectionY.current = e.nativeEvent.layout.y;
              exerciseSectionH.current = e.nativeEvent.layout.height;
            }}
          >
            <ExerciseProgressionChart
              exerciseName={selectedExercise.name}
              dayName={selectedDay.label}
              dayId={selectedDay.dayId}
              programId={selectedDay.programId}
              history={displayExerciseHistory}
              prs={displayPrs}
              unit={unit}
              clientId={clientId}
              metric={exerciseMetric}
              onMetricChange={setExerciseMetric}
            />
          </View>
        ) : null}
      </Animated.ScrollView>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll: { paddingTop: 0 },
  titleRow: { paddingHorizontal: 24, marginBottom: 8 },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 20 },
  title: { fontFamily: FontFamily.bold, fontSize: 32 },
  sectionHeaderRow: { paddingHorizontal: 24, marginTop: 28 },
  sectionHeader: { fontFamily: FontFamily.bold, fontSize: 24 },
  note: { fontFamily: FontFamily.semibold, fontSize: 12 },
  hintInner: { padding: 16, alignItems: "center", gap: 8 },
  hintText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
});
