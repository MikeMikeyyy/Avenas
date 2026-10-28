// Body of the Progress page, with data passed in as props so it can render
// either the current user's data (from AsyncStorage) or a PT-viewed client's
// data (their cloud backup, via trainerStore.loadClientData) using identical
// visuals.

import { useState, useCallback, useMemo, useRef, useEffect, useEffectEvent, type ReactElement } from "react";
import {
  View, Text, StyleSheet, Animated, type NativeScrollEvent, type NativeSyntheticEvent, type RefreshControlProps,
  type ViewInstance,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "../MaskedView";
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
import KeyboardDismissButton from "../KeyboardDismissButton";
import AllExercisesList from "./AllExercisesList";
import CompareButton from "./CompareButton";
import CompareHeader from "./CompareHeader";
import CompareSheet, { type CompareSheetSide } from "./CompareSheet";
import CompareGlanceCard from "./CompareGlanceCard";
import CompareWeeksChart from "./CompareWeeksChart";
import CompareLiftList from "./CompareLiftList";
import CompareExerciseCard from "./CompareExerciseCard";
import { RevealOnScrollContext, type RevealWatcher } from "./revealOnScroll";

import { APP_DARK, APP_LIGHT, FontFamily, accentTextColor } from "../../constants/theme";
import { PILL_H_XS } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import { useFloatingBarsReach } from "../../hooks/useFloatingBars";
import { SCROLL_CLEAR_GAP, scrollEndPadding } from "../../constants/floatingBars";
import { type CompletedWorkout, type ProgramDayRef, type SavedProgram } from "../../constants/programs";
import { sameExercise, type ExerciseRef } from "../../utils/exerciseNames";
import { type CustomExercise, type SelectableMuscle } from "../../constants/exercises";
import type { ExerciseDataPoint, LoggedExerciseRow, MuscleGroupStat, PRs, RangeKey } from "../../constants/progress";
import { RANGE_OPTIONS } from "../../constants/progress";
import { progressSessionKey, type AllProgressRequest } from "../../utils/progressSession";
import { muscleCardOf } from "../../utils/allExercises";
import { useProgressSelection } from "../../hooks/useProgressSelection";
import { useSectionSearch } from "../../hooks/useSectionSearch";
import {
  bucketMetricByDay,
  bucketMetricByMonth,
  bucketMetricByRollingWeeks,
  collectExerciseHistory,
  collectLoggedExercises,
  computeMuscleGroupStats,
  computePRs,
  computeWorkoutDurationMinutes,
  computeWorkoutReps,
  computeWorkoutTonnage,
  filterByDateWindow,
  filterByProgramScope,
  getRangeOption,
  isCustomSession,
  previousComparableWindow,
  rangeWindow,
  yearBarCount,
  scopedProgramDays,
  windowLengthDays,
  workoutBelongsToProgram,
} from "../../utils/progressStats";
import { buildSessionTracks } from "../../utils/sessionTrack";
import { toDisplayWeight } from "../../utils/units";
import { carriedExercises, knownCustomExercises } from "../../utils/customExerciseDetails";
import { getEffectiveToday } from "../../utils/workout";
import { exerciseDateSlots, exerciseDaySlots } from "../../utils/exerciseDaySlots";
import { findRunView, programRunViews, sameRun, type ProgramRunView, type RunRef } from "../../utils/programRuns";
import {
  compareCandidates, compareFirstPicks, compareLifts, compareReadiness, compareStartGreen, glanceStats, liftSlots, missedDates, muscleStatsPerWeek, runDates, runName, runStatus,
  sharedStrength, spanCaption, spanDays, weekOfDay, weeklyTotals,
} from "../../utils/programCompare";

/** A view waiting to be scrolled into sight, and where it sits in the page's
 *  content once measured. */
type Watched = { view: ViewInstance; onReveal: () => void; y?: number; h?: number };
/** How far into the screen a view comes before it counts as seen. */
const REVEAL_INSET = 24;

/** A session's numbers in the unit shown (stats are kept in kg). */
function displayPoints(points: ExerciseDataPoint[], isKg: boolean): ExerciseDataPoint[] {
  const dw = (n: number) => toDisplayWeight(n, isKg);
  return points.map(p => ({
    ...p,
    topWeight: dw(p.topWeight),
    bestSetVolume: dw(p.bestSetVolume),
    bestSetWeight: dw(p.bestSetWeight),
    e1rm: dw(p.e1rm),
    e1rmWeight: dw(p.e1rmWeight),
    sessionVolume: dw(p.sessionVolume),
    sets: p.sets.map(s => ({ ...s, weight: dw(s.weight) })),
  }));
}

/** An exercise's records in the unit shown. */
function displayRecords(prs: PRs, isKg: boolean): PRs {
  const dw = (n: number) => toDisplayWeight(n, isKg);
  const c = <T extends { value: number; weight?: number } | null>(pr: T): T =>
    pr ? ({ ...pr, value: dw(pr.value), ...(pr.weight != null ? { weight: dw(pr.weight) } : {}) }) : pr;
  return {
    heaviest: c(prs.heaviest),
    bestSetVolume: c(prs.bestSetVolume),
    bestSessionVolume: c(prs.bestSessionVolume),
    oneRepMax: c(prs.oneRepMax),
    // Its value is reps (a hold's seconds): only the set's weight converts.
    mostReps: prs.mostReps && { ...prs.mostReps, ...(prs.mostReps.weight != null ? { weight: dw(prs.mostReps.weight) } : {}) },
  };
}

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
  /** "See All Progress" from Exercise History (utils/progressSession.ts): All
   *  programs, with this exercise charted. */
  show?: AllProgressRequest | null;
}

const NO_CUSTOM: CustomExercise[] = [];
const NO_DAYS: ProgramDayRef[] = [];
const NO_ROWS: LoggedExerciseRow[] = [];

/** How long after the scroll to the chart it's measured again, in case it was
 *  still moving: a day panel's open tween (DayExerciseList) is 280ms. */
const CHART_SETTLE_MS = 350;

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
  show,
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
  // Under All programs: an exercise from any program or day, and the muscle
  // group open in the list.
  const [allExercise, setAllExercise] = useProgressSelection(sessionKey, "allExercise");
  const [expandedMuscle, setExpandedMuscle] = useProgressSelection(sessionKey, "expandedMuscle");
  const [expandedDay, setExpandedDay] = useProgressSelection(sessionKey, "expandedDay");
  const [exerciseMetric, setExerciseMetric] = useProgressSelection(sessionKey, "exerciseMetric");
  const [compare, setCompare] = useProgressSelection(sessionKey, "compare");
  const [compareSpan, setCompareSpan] = useProgressSelection(sessionKey, "compareSpan");
  const [compareLift, setCompareLift] = useProgressSelection(sessionKey, "compareLift");
  const [allProgressAt, setAllProgressAt] = useProgressSelection(sessionKey, "allProgressAt");
  const [scopeFallbackNote, setScopeFallbackNote] = useState<string | null>(null);

  const scrollRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const exerciseSectionRef = useRef<ViewInstance>(null);
  const exerciseSectionY = useRef(0);
  const exerciseSectionH = useRef(0);
  const viewportH = useRef(0);
  // Bumped by every tap on an exercise, the one already chosen included: what
  // takes the page down to its chart (see the scroll effect below). A
  // selection remembered from the last visit never bumps it, so the page comes
  // back as it was left.
  const [chartScrollRequest, setChartScrollRequest] = useState(0);

  // What covers the foot of the page: the tab bar, and above it, while a
  // workout's on, the workout bar (taller with a rest inside it). Read as the
  // one number the bar reports, so the page doesn't re-render every second
  // with the workout clock as it did reading the bars themselves.
  const barsReach = useFloatingBarsReach();
  const coveredBottom = Math.max(insets.bottom + 72, barsReach > 0 ? barsReach + SCROLL_CLEAR_GAP : 0);

  // Any session in no program: what offers Custom workouts at the top.
  const hasCustom = useMemo(() => history.some(w => isCustomSession(w, programs)), [history, programs]);

  // Reconcile scope when the upstream programs list changes (e.g. switching
  // client). Only once the data is in: a remembered program scope would
  // otherwise meet the empty list a screen starts with and fall back to "All
  // programs" before that program had a chance to load. Custom workouts go
  // the same way once there are none (an import undone).
  useEffect(() => {
    if (!loaded) return;
    setScope(prev => {
      if (prev.kind === "custom") {
        if (hasCustom) return prev;
        setScopeFallbackNote("No custom workouts left. Showing all programs.");
        return { kind: "all" };
      }
      if (prev.kind !== "program") return prev;
      const stillExists = programs.some(pp => pp.id === prev.programId);
      if (stillExists) return prev;
      setScopeFallbackNote("Selected program was removed. Showing all programs.");
      return { kind: "all" };
    });
  }, [programs, loaded, hasCustom]);

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

  // Exercise History's "See All Progress" (user request, 2026-10-26): All
  // programs with that exercise charted, its muscle group open, a comparison
  // put away, and the page taken down to the chart. Each request once (a new
  // `at` every tap), and only once the sessions are in, so the chart is there
  // to go to. Adjusted while rendering, as React has state follow a prop,
  // rather than in an effect.
  if (show && loaded && show.at !== allProgressAt) {
    setAllProgressAt(show.at);
    setScope({ kind: "all" });
    setCompare(null);
    setCompareLift(null);
    setAllExercise(show.customId ? { name: show.name, customId: show.customId } : { name: show.name });
    setExpandedMuscle(muscleCardOf(show, knownCustoms));
    setChartScrollRequest(n => n + 1);
  }
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
  // sessions logged against them. Under All programs the list is every
  // exercise instead (allRows), so there are no days.
  const daysInScope = useMemo(
    () => (scope.kind === "all" ? NO_DAYS : scopedProgramDays(scope, programs, scopedWorkouts)),
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
    // By identity, so a deleted custom exercise and a new one later given its
    // name chart apart.
    const eh = collectExerciseHistory(scopedWorkouts, selectedExercise, selectedDay);
    const p = computePRs(eh, scopedWorkouts, selectedExercise, selectedDay);
    return { exerciseHistory: eh, prs: p };
  }, [scopedWorkouts, selectedExercise, selectedDay]);

  // ── All programs: every exercise logged, each charted across every session
  // of it from any program, day or custom workout, by date (user request,
  // 2026-10-26). ───────────────────────────────────────────────────────────
  const allRows = useMemo(
    () => (scope.kind === "all" ? collectLoggedExercises(scopedWorkouts) : NO_ROWS),
    [scope.kind, scopedWorkouts],
  );
  // The live row behind the pick, as selectedDay is for a day's: once every
  // session of it is deleted, the chart goes.
  const allSelected = useMemo(
    () => (allExercise ? allRows.find(r => sameExercise(r, allExercise)) ?? null : null),
    [allRows, allExercise],
  );
  const allChart = useMemo(() => {
    if (!allSelected) return null;
    const kg = collectExerciseHistory(scopedWorkouts, allSelected);
    const points = displayPoints(kg, isKg);
    return {
      points,
      slots: exerciseDateSlots(points, history, programs),
      prs: displayRecords(computePRs(kg, scopedWorkouts, allSelected), isKg),
    };
  }, [allSelected, scopedWorkouts, history, programs, isKg]);

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
  const displayExerciseHistory = useMemo(() => displayPoints(exerciseHistory, isKg), [exerciseHistory, isKg]);
  const displayPrs = useMemo(() => (prs ? displayRecords(prs, isKg) : null), [prs, isKg]);

  // ── Comparing two programs ───────────────────────────────────────────────
  // A comparison starts in two picks (user request, 2026-10-16): the first is
  // green (the program on the go, or a finished one), the one it's compared
  // with blue (a finished one), either changed since from its row
  // (utils/programCompare.ts). The day things are read up to is the one the
  // Workout tab is on.
  const todayYMD = useMemo(() => getEffectiveToday(activeProgram, history), [activeProgram, history]);

  // The exercise chart's places: every time the selected day came round, a
  // session or a miss, numbered off the workout cards' own tracks.
  const charting = !!selectedExercise && !!selectedDay;
  const sessionTracks = useMemo(
    () => (charting ? buildSessionTracks(history, programs, todayYMD) : null),
    [charting, history, programs, todayYMD],
  );
  const exerciseSlots = useMemo(() => {
    if (!selectedExercise || !selectedDay || !sessionTracks) return [];
    const exercise = { name: selectedExercise.name, customId: selectedExercise.customId };
    const program = programs.find(p => p.id === selectedDay.programId);
    return exerciseDaySlots({
      exercise,
      points: displayExerciseHistory,
      // The program's every session of it: done on the day in another of
      // them, it wasn't missed.
      programPoints: program ? collectExerciseHistory(history.filter(w => workoutBelongsToProgram(w, program)), exercise) : [],
      history,
      tracks: sessionTracks,
      todayYMD,
    });
  }, [selectedExercise, selectedDay, programs, displayExerciseHistory, history, sessionTracks, todayYMD]);
  const startGreen = useMemo(() => compareStartGreen(scope, programs, history), [scope, programs, history]);
  const firstPicks = useMemo(() => compareFirstPicks(scope, programs, history), [scope, programs, history]);
  const greenView = useMemo(() => (compare ? findRunView(compare.green, programs, history) : null), [compare, programs, history]);
  const blueView = useMemo(() => (compare ? findRunView(compare.blue, programs, history) : null), [compare, programs, history]);
  const comparing = !!(greenView && blueView);

  // ── The search over every exercise, under All programs (user request,
  // 2026-10-26): the round button on the Exercise Progress heading opens it
  // (hooks/useSectionSearch.ts, which keeps it clear of the keyboard). It
  // closes when the list goes: another scope picked, a comparison started. ─
  const allList = scope.kind === "all" && !comparing;
  const exerciseHeadingRef = useRef<ViewInstance>(null);
  const {
    open: searchOpen, query, setQuery, toggle: toggleSearch, close: closeSearch, onKeyboardDown, picked: pickedFromSearch,
    inputRef: searchInputRef, extraPadding: searchPadding,
  } = useSectionSearch({ scrollRef, headingRef: exerciseHeadingRef, topInset: withTopInset ? insets.top : 0, shown: allList });
  const onSelectAllExercise = useCallback((ex: ExerciseRef) => {
    // Picked from the search: the page goes on down to the chart.
    pickedFromSearch();
    setAllExercise(prev =>
      prev && sameExercise(prev, ex) ? prev : { name: ex.name, ...(ex.customId ? { customId: ex.customId } : {}) },
    );
    setChartScrollRequest(n => n + 1);
  }, [pickedFromSearch]);

  // The sheet: up or not, and its step, which outlasts it closing so its list
  // holds still as it slides away. The first pick waits here for the second.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetStep, setSheetStep] = useState<CompareSheetSide>("first");
  const [firstPick, setFirstPick] = useState<RunRef | null>(null);
  const firstPickView = useMemo(() => (firstPick ? findRunView(firstPick, programs, history) : null), [firstPick, programs, history]);
  // What blue is set beside: green while comparing, else the first pick.
  const blueAgainst = comparing ? greenView : firstPickView ?? startGreen;
  const blueCandidates = useMemo(
    () => compareCandidates(programs, history, blueAgainst?.ref ?? null),
    [programs, history, blueAgainst],
  );
  // Green can be the program on the go, or any finished one but blue.
  const greenCandidates = useMemo(() => {
    const out: ProgramRunView[] = [];
    const active = programs.find(p => p.status === "active");
    const current = active ? programRunViews(active, history).find(v => v.ref.run === "latest") : undefined;
    if (current) out.push(current);
    for (const v of compareCandidates(programs, history, blueView?.ref ?? null)) {
      if (!out.some(o => sameRun(o.ref, v.ref))) out.push(v);
    }
    return out;
  }, [programs, history, blueView]);
  // The button is always there; until there's something to compare, it opens
  // the sheet locked, saying what comparing needs (user request, 2026-10-15).
  const canCompare = firstPicks.length > 0;
  const readiness = useMemo(() => compareReadiness(programs, history), [programs, history]);

  // A program in the comparison that's since been deleted ends it.
  useEffect(() => {
    if (loaded && compare && !comparing) setCompare(null);
  }, [loaded, compare, comparing]);

  const cmp = useMemo(() => {
    if (!greenView || !blueView) return null;
    const span = spanDays(greenView, blueView, compareSpan, todayYMD);
    const whole = spanDays(greenView, blueView, "whole", todayYMD);
    const lifts = compareLifts(greenView, blueView);
    // The days each program missed each lift on: each keeps its place in the
    // lift's row (liftSlots).
    const missed: Record<string, { green: string[]; blue: string[] }> = {};
    for (const l of [...lifts.both, ...lifts.onlyGreen, ...lifts.onlyBlue]) {
      missed[l.key] = {
        green: missedDates(greenView, l, l.green, todayYMD),
        blue: missedDates(blueView, l, l.blue, todayYMD),
      };
    }
    return {
      span,
      whole,
      glance: { green: glanceStats(greenView, span.green, history, todayYMD), blue: glanceStats(blueView, span.blue, history, todayYMD) },
      strength: sharedStrength(lifts.both, compareSpan),
      lifts,
      missed,
    };
  }, [greenView, blueView, compareSpan, todayYMD, history]);

  const cmpNames = useMemo(
    () => (greenView && blueView ? { green: runName(greenView), blue: runName(blueView) } : { green: "", blue: "" }),
    [greenView, blueView],
  );

  const cmpWeeks = useMemo(() => {
    if (!cmp || !greenView || !blueView) return null;
    const conv = (n: number) => (metric === "volume" ? toDisplayWeight(n, isKg) : n);
    const avg = (view: ProgramRunView, days: number) =>
      conv(weeklyTotals(view, days, metric).reduce((s, v) => s + v, 0) / Math.max(1, days / 7));
    return {
      green: weeklyTotals(greenView, cmp.whole.green, metric).map(conv),
      blue: weeklyTotals(blueView, cmp.whole.blue, metric).map(conv),
      averages: { green: avg(greenView, cmp.span.green), blue: avg(blueView, cmp.span.blue) },
    };
  }, [cmp, greenView, blueView, metric, isKg]);

  const cmpRadar = useMemo(() => {
    if (!cmp || !greenView || !blueView) return null;
    return {
      green: convertMuscleVolumes(muscleStatsPerWeek(greenView, cmp.span.green, knownCustoms), isKg),
      blue: convertMuscleVolumes(muscleStatsPerWeek(blueView, cmp.span.blue, knownCustoms), isKg),
    };
  }, [cmp, greenView, blueView, knownCustoms, isKg]);

  const cmpGlance = useMemo(() => {
    if (!cmp) return null;
    const conv = (g: typeof cmp.glance.green) => ({ ...g, volumePerWeekKg: toDisplayWeight(g.volumePerWeekKg, isKg) });
    return { green: conv(cmp.glance.green), blue: conv(cmp.glance.blue) };
  }, [cmp, isKg]);

  // What At a glance covers, in words, both programs named.
  const glanceCaption = useMemo(
    () => (greenView && blueView ? spanCaption(greenView, blueView, compareSpan, todayYMD) : ""),
    [greenView, blueView, compareSpan, todayYMD],
  );

  const selectedLift = useMemo(() => {
    if (!cmp || !compareLift) return null;
    return [...cmp.lifts.both, ...cmp.lifts.onlyGreen, ...cmp.lifts.onlyBlue].find(l => l.key === compareLift) ?? null;
  }, [cmp, compareLift]);
  const selectedLiftView = useMemo(() => {
    if (!cmp || !selectedLift || !greenView || !blueView) return null;
    const green = displayPoints(selectedLift.green, isKg);
    const blue = displayPoints(selectedLift.blue, isKg);
    const missed = cmp.missed[selectedLift.key] ?? { green: [], blue: [] };
    return {
      lift: { ...selectedLift, green, blue },
      // Every time it came round in each, its sessions in the unit shown.
      slots: { green: liftSlots(green, missed.green), blue: liftSlots(blue, missed.blue) },
      prs: {
        green: selectedLift.green.length ? displayRecords(computePRs(selectedLift.green, greenView.sessions, selectedLift), isKg) : null,
        blue: selectedLift.blue.length ? displayRecords(computePRs(selectedLift.blue, blueView.sessions, selectedLift), isKg) : null,
      },
    };
  }, [cmp, selectedLift, greenView, blueView, isKg]);

  const openSheet = (step: CompareSheetSide) => {
    setSheetStep(step);
    setSheetOpen(true);
  };
  // The compare button: the first pick, unless only one program can be green,
  // when the sheet opens on the second with that one green already.
  const startComparing = () => {
    closeSearch();
    if (firstPicks.length === 1) {
      setFirstPick(firstPicks[0].ref);
      openSheet("blue");
    } else {
      setFirstPick(null);
      openSheet("first");
    }
  };
  const onPickRun = (ref: RunRef) => {
    if (sheetStep === "first") {
      setFirstPick(ref);
      setSheetStep("blue");
      return;
    }
    if (sheetStep === "green") {
      setCompare(prev => (prev ? { ...prev, green: ref } : prev));
      return;
    }
    const green = firstPick ?? startGreen?.ref ?? null;
    setCompare(prev => (prev ? { ...prev, blue: ref } : green ? { green, blue: ref } : prev));
  };
  const stopComparing = useCallback(() => {
    setCompare(null);
    setCompareLift(null);
  }, []);
  const onSelectLift = useCallback((key: string) => {
    setCompareLift(key);
    setChartScrollRequest(n => n + 1);
  }, []);

  // ── What comes in the first time it's scrolled into sight
  // (revealOnScroll.ts): the comparison's little exercise charts. Each is
  // measured in the page's content once, again when the content changes size,
  // and checked where the page comes to rest (a drag let go, a fling's end),
  // so it draws out where it can be watched rather than flying past. ─────
  const watched = useRef(new Set<Watched>());
  const scrollTop = useRef(0);
  const checkReveals = useCallback(() => {
    const top = scrollTop.current;
    const bottom = top + viewportH.current;
    if (bottom <= top) return;
    for (const w of [...watched.current]) {
      if (w.y === undefined || w.h === undefined) continue;
      if (w.y < bottom - REVEAL_INSET && w.y + w.h > top) {
        watched.current.delete(w);
        w.onReveal();
      }
    }
  }, []);
  const measureWatched = useCallback((w: Watched) => {
    const content = scrollRef.current?.getInnerViewRef?.();
    if (!content || typeof w.view.measureLayout !== "function") return;
    w.view.measureLayout(content, (_x, y, _w, h) => {
      w.y = y;
      w.h = h;
      checkReveals();
    }, () => {});
  }, [checkReveals]);
  const revealWatcher = useMemo<RevealWatcher>(() => ({
    watch: (view, onReveal) => {
      const w: Watched = { view, onReveal };
      watched.current.add(w);
      measureWatched(w);
      return () => {
        watched.current.delete(w);
      };
    },
  }), [measureWatched]);
  const onScrollStop = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollTop.current = e.nativeEvent.contentOffset.y;
    if (watched.current.size > 0) checkReveals();
  }, [checkReveals]);

  /** Where the chart's section sits in the page's content, read from the
   *  layout as it stands NOW. Its last onLayout isn't enough: a section that
   *  has just appeared may not have reported one yet, and a day opening above
   *  it (a UI-thread height tween) moves it without ever re-firing it, so the
   *  page used to stay put, or stop short of the chart (user report,
   *  2026-10-12). The last onLayout is only the fallback. */
  const measureChart = useEffectEvent((then: (y: number, h: number) => void) => {
    const section = exerciseSectionRef.current;
    if (!section) return; // no chart showing: nowhere to go
    const fallback = () => then(exerciseSectionY.current, exerciseSectionH.current);
    const content = scrollRef.current?.getInnerViewRef?.();
    if (!content || typeof section.measureLayout !== "function") return fallback();
    section.measureLayout(content, (_x, y, _w, h) => then(y, h), fallback);
  });

  /** Scrolls to the chart's section, at `y` and `h` tall in the content. */
  const frameChart = useEffectEvent((y: number, h: number) => {
    const node: any = scrollRef.current;
    const viewH = viewportH.current;
    if (h > 0 && viewH > 0) {
      // Bottom-anchored: scroll the LEAST amount that still leaves the
      // section's bottom (the "See Exercise History" CTA) clear of what covers
      // the foot of the page (the tab bar, and the workout bar during a
      // workout), plus a breathing gap. This keeps as much of the day list
      // above visible as possible. Capped so the section's top never
      // disappears under the header gradient: on screens too short for both,
      // the top wins (the bars are translucent, so a grazed CTA stays legible).
      const needed = y + h - (viewH - coveredBottom);
      const cap = y - (insets.top + 24);
      node?.scrollTo?.({ y: Math.max(0, Math.min(needed, cap)), animated: true });
    } else {
      // No size to go by: pin the section's top near the top of the screen.
      node?.scrollTo?.({ y: Math.max(0, y - 40), animated: true });
    }
  });

  // A tap on an exercise takes the page down to its chart, once the chart is
  // in the layout (the frame after the tap's render), and then once more if
  // it has moved since: a day still opening above it, or the chart's own
  // first layout. Only a tap asks, never a remembered selection.
  useEffect(() => {
    if (!chartScrollRequest) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      measureChart((y, h) => {
        if (y <= 0) return;
        frameChart(y, h);
        settle = setTimeout(() => {
          measureChart((y2, h2) => {
            if (y2 > 0 && (Math.abs(y2 - y) > 4 || Math.abs(h2 - h) > 4)) frameChart(y2, h2);
          });
        }, CHART_SETTLE_MS);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (settle) clearTimeout(settle);
    };
  }, [chartScrollRequest]);

  const onSelectExercise = useCallback((day: ProgramDayRef, ex: ExerciseRef) => {
    // A same-pair reselect keeps the previous object, so the chart's data
    // isn't worked out again; the page still scrolls down to it, which is what
    // tapping an exercise does whether or not it was chosen already.
    setSelectedExercise(prev =>
      prev && prev.dayKey === day.key && sameExercise(prev, ex)
        ? prev
        : { dayKey: day.key, name: ex.name, ...(ex.customId ? { customId: ex.customId } : {}) },
    );
    setChartScrollRequest(n => n + 1);
  }, []);

  const showNoActiveProgramHint = scope.kind === "current" && !hasActiveProgram;
  const topPad = withTopInset ? insets.top + 50 : 16;
  // Clear of the workout bar too while it shows (constants/floatingBars.ts).
  const botPad = scrollEndPadding(bottomPadding ?? (insets.bottom + 140), barsReach);

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

      <RevealOnScrollContext.Provider value={revealWatcher}>
      <Animated.ScrollView
        ref={scrollRef as any}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        onLayout={e => {
          viewportH.current = e.nativeEvent.layout.height;
          checkReveals();
        }}
        onContentSizeChange={() => watched.current.forEach(measureWatched)}
        // Without it the keyboard takes the first tap on a search match.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: botPad + searchPadding }]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        onScrollEndDrag={onScrollStop}
        onMomentumScrollEnd={onScrollStop}
        scrollEventThrottle={16}
        refreshControl={refreshControl}
      >
        {title !== "" && (
          <View style={[styles.titleRow, styles.titleRowSplit]}>
            <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
            {!comparing ? <CompareButton onPress={startComparing} /> : null}
          </View>
        )}

        {/* Comparing under the page title, the header is pulled up: its label
            row is as tall as the ✕'s 44pt touch area, which left "Comparing"
            well below the title (user report, 2026-10-28). Not on a client's
            page, which has no title above it. */}
        <View style={{ marginTop: comparing ? (title !== "" ? -4 : 10) : 18 }}>
          {comparing && greenView && blueView ? (
            // Comparing: the two programs in place of the filters. Each
            // program is read whole, so there's no time range. A finished
            // program says when it ran, which tells two of one name apart;
            // the one going says where it's up to.
            <CompareHeader
              green={{ name: cmpNames.green, status: greenView.finished ? runDates(greenView, todayYMD) : runStatus(greenView, todayYMD) }}
              blue={{ name: cmpNames.blue, status: runDates(blueView, todayYMD) }}
              onChangeGreen={() => openSheet("green")}
              onChangeBlue={() => openSheet("blue")}
              onStop={stopComparing}
            />
          ) : (
            // The page's two filters: which program, and over what dates. Both
            // apply to the Volume and Strength cards alike.
            <View style={styles.filterRow}>
              <ProgramScopePicker
                scope={scope}
                programs={programs}
                onChange={s => { setScope(s); setScopeFallbackNote(null); closeSearch(); }}
                hasCustom={hasCustom}
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
              {/* No title on a trainer's client page: the button sits here, the
                  filters' height (PILL_H_XS). */}
              {title === "" ? <CompareButton onPress={startComparing} size={PILL_H_XS} /> : null}
            </View>
          )}
          {scopeFallbackNote && !comparing ? (
            <View style={{ marginHorizontal: 20, marginTop: 8 }}>
              <Text style={[styles.note, { color: accentTextColor(isDark) }]}>{scopeFallbackNote}</Text>
            </View>
          ) : null}
        </View>

        {comparing && cmp && cmpGlance && cmpWeeks && cmpRadar && greenView ? (
          <>
            <CompareGlanceCard
              names={cmpNames}
              green={cmpGlance.green}
              blue={cmpGlance.blue}
              strength={cmp.strength}
              span={compareSpan}
              onSpanChange={setCompareSpan}
              caption={glanceCaption}
              unit={unit}
            />
            <CompareWeeksChart
              green={cmpWeeks.green}
              blue={cmpWeeks.blue}
              averages={cmpWeeks.averages}
              greenCurrentWeek={greenView.finished ? null : weekOfDay(cmp.whole.green)}
              names={cmpNames}
              metric={metric}
              onMetricChange={setMetric}
              unit={unit}
            />
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionHeader, { color: t.tp }]}>Strength</Text>
            </View>
            <StrengthRadarChart
              stats={cmpRadar.green}
              unit={unit}
              windowDays={7}
              rangeLabel=""
              currentLegend=""
              previousLegend=""
              metric={strengthMetric}
              onMetricChange={setStrengthMetric}
              compare={{ stats: cmpRadar.blue, greenName: cmpNames.green, blueName: cmpNames.blue }}
            />
            <CompareLiftList
              // Another pair of programs: its little charts draw out afresh.
              key={`${greenView.ref.programId}|${greenView.ref.run}|${blueView?.ref.programId}|${blueView?.ref.run}`}
              lifts={cmp.lifts}
              missed={cmp.missed}
              names={cmpNames}
              selected={compareLift}
              onSelect={onSelectLift}
              customExercises={knownCustoms}
            />
          </>
        ) : showNoActiveProgramHint && loaded ? (
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
            {scope.kind === "all" ? (
              <AllExercisesList
                rows={allRows}
                customExercises={knownCustoms}
                selected={allExercise}
                onSelect={onSelectAllExercise}
                expandedMuscle={expandedMuscle}
                onExpandedMuscleChange={setExpandedMuscle}
                searchOpen={searchOpen}
                query={query}
                onQueryChange={setQuery}
                onToggleSearch={toggleSearch}
                searchInputRef={searchInputRef}
                headingRef={exerciseHeadingRef}
              />
            ) : (
              <DayExerciseList
                days={daysInScope}
                workouts={scopedWorkouts}
                selectedExercise={selectedExercise}
                onSelectExercise={onSelectExercise}
                customExercises={knownCustoms}
                expandedDay={expandedDay}
                onExpandedDayChange={setExpandedDay}
              />
            )}
          </>
        )}

        {comparing && cmp && selectedLiftView && compare ? (
          <View
            ref={exerciseSectionRef}
            onLayout={e => {
              exerciseSectionY.current = e.nativeEvent.layout.y;
              exerciseSectionH.current = e.nativeEvent.layout.height;
            }}
          >
            <CompareExerciseCard
              lift={selectedLiftView.lift}
              slots={selectedLiftView.slots}
              names={cmpNames}
              prs={selectedLiftView.prs}
              metric={exerciseMetric}
              onMetricChange={setExerciseMetric}
              unit={unit}
              clientId={clientId}
              seriesKey={`${compare.green.programId}|${compare.green.run}|${compare.blue.programId}|${compare.blue.run}|${selectedLiftView.lift.key}`}
            />
          </View>
        ) : allList && allSelected && allChart ? (
          <View
            ref={exerciseSectionRef}
            onLayout={e => {
              exerciseSectionY.current = e.nativeEvent.layout.y;
              exerciseSectionH.current = e.nativeEvent.layout.height;
            }}
          >
            <ExerciseProgressionChart
              exerciseName={allSelected.name}
              customId={allSelected.customId}
              allPrograms
              history={allChart.points}
              slots={allChart.slots}
              prs={allChart.prs}
              unit={unit}
              clientId={clientId}
              metric={exerciseMetric}
              onMetricChange={setExerciseMetric}
            />
          </View>
        ) : !comparing && selectedExercise && selectedDay && displayPrs ? (
          <View
            ref={exerciseSectionRef}
            onLayout={e => {
              exerciseSectionY.current = e.nativeEvent.layout.y;
              exerciseSectionH.current = e.nativeEvent.layout.height;
            }}
          >
            <ExerciseProgressionChart
              exerciseName={selectedExercise.name}
              customId={selectedExercise.customId}
              dayName={selectedDay.label}
              dayId={selectedDay.dayId}
              programId={selectedDay.programId}
              customDay={selectedDay.custom?.key}
              history={displayExerciseHistory}
              slots={exerciseSlots}
              prs={displayPrs}
              unit={unit}
              clientId={clientId}
              metric={exerciseMetric}
              onMetricChange={setExerciseMetric}
            />
          </View>
        ) : null}
      </Animated.ScrollView>
      </RevealOnScrollContext.Provider>

      <CompareSheet
        side={sheetOpen ? sheetStep : null}
        options={sheetStep === "first" ? firstPicks : sheetStep === "green" ? greenCandidates : blueCandidates}
        selected={
          sheetStep === "first" ? firstPick ?? startGreen?.ref ?? null
            : sheetStep === "green" ? greenView?.ref ?? null
              : blueView?.ref ?? null
        }
        other={sheetStep === "green" ? blueView : sheetStep === "blue" ? blueAgainst : null}
        todayYMD={todayYMD}
        locked={!comparing && !canCompare ? readiness : null}
        forClient={!!clientId}
        onPick={onPickRun}
        onBack={() => setSheetStep("first")}
        onClose={() => setSheetOpen(false)}
      />

      {/* The keyboard's down key, for the exercise search: it closes the
          search too. Renders nothing without a keyboard. */}
      {allList ? <KeyboardDismissButton onPress={onKeyboardDown} /> : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll: { paddingTop: 0 },
  // The tab title as every tab has it, Home's greeting: 28pt bold, 20pt in,
  // level with the cards (user decision, 2026-10-21; it was 32pt at 24pt).
  titleRow: { paddingHorizontal: 20, marginBottom: 8 },
  titleRowSplit: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 16 },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 20 },
  title: { fontFamily: FontFamily.bold, fontSize: 28, marginTop: 2 },
  sectionHeaderRow: { paddingHorizontal: 20, marginTop: 28 },
  sectionHeader: { fontFamily: FontFamily.bold, fontSize: 24 },
  note: { fontFamily: FontFamily.semibold, fontSize: 12 },
  hintInner: { padding: 16, alignItems: "center", gap: 8 },
  hintText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
});
