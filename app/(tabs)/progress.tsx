import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { View, Text, StyleSheet, Animated, StyleProp, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import FadeScreen from "../../components/FadeScreen";
import NeuCard from "../../components/NeuCard";
import ProgramScopePicker from "../../components/ProgramScopePicker";
import VolumeBarChart from "../../components/VolumeBarChart";
import DayExerciseList from "../../components/DayExerciseList";
import ExerciseProgressionChart from "../../components/ExerciseProgressionChart";
import DumbbellIcon from "../../components/DumbbellIcon";

import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import { getJSON } from "../../utils/storage";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  type CompletedWorkout,
  type SavedProgram,
} from "../../constants/programs";
import type { MetricKey, ProgramScope, RangeKey } from "../../constants/progress";
import {
  bucketMetricByDay,
  bucketMetricByMonth,
  bucketMetricByRollingWeeks,
  collectExerciseHistory,
  computePRs,
  computeWorkoutDurationMinutes,
  computeWorkoutReps,
  computeWorkoutTonnage,
  filterByProgramScope,
  getRangeOption,
  rangeWindow,
  uniqueDaysInScope,
} from "../../utils/progressStats";

export default function ProgressScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { isKg } = useUnit();
  const unit = isKg ? "kg" : "lbs";

  // Raw storage state (re-read on every focus so edits/deletes propagate).
  const [history, setHistory] = useState<CompletedWorkout[]>([]);
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [loaded, setLoaded] = useState(false);

  // UI state.
  const [scope, setScope] = useState<ProgramScope>({ kind: "current" });
  const [range, setRange] = useState<RangeKey>("thisWeek");
  const [metric, setMetric] = useState<MetricKey>("volume");
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [scopeFallbackNote, setScopeFallbackNote] = useState<string | null>(null);

  // Scroll machinery: header blur + scroll-to-exercise on select.
  const scrollRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const exerciseSectionY = useRef(0);

  // Load on every focus. If the selected program is gone, fall back to "all".
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [h, p] = await Promise.all([
          getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
          getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
        ]);
        if (cancelled) return;
        setHistory(Array.isArray(h) ? h : []);
        setPrograms(Array.isArray(p) ? p : []);
        setLoaded(true);

        // Scope reconciliation. If the user previously picked a program that
        // has since been deleted, fall back to "all" and surface a one-line note.
        setScope(prev => {
          if (prev.kind !== "program") return prev;
          const stillExists = (p as SavedProgram[]).some(pp => pp.id === prev.programId);
          if (stillExists) return prev;
          setScopeFallbackNote("Selected program was removed — showing all programs.");
          return { kind: "all" };
        });
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Auto-clear the fallback note after a few seconds.
  useEffect(() => {
    if (!scopeFallbackNote) return;
    const id = setTimeout(() => setScopeFallbackNote(null), 4000);
    return () => clearTimeout(id);
  }, [scopeFallbackNote]);

  // If scope=current but no active program, show empty state.
  const activeProgram = useMemo(() => programs.find(p => p.status === "active") ?? null, [programs]);
  const hasActiveProgram = activeProgram !== null;

  // Filtered set used by every section below.
  const scopedWorkouts = useMemo(
    () => filterByProgramScope(history, scope, programs),
    [history, scope, programs],
  );

  // Metric buckets for the active range + selected metric.
  const buckets = useMemo(() => {
    const aggregate =
      metric === "volume" ? computeWorkoutTonnage :
      metric === "reps" ? computeWorkoutReps :
      computeWorkoutDurationMinutes;
    const rangeOpt = getRangeOption(range);
    const { startYMD, endYMD } = rangeWindow(range, new Date());
    switch (rangeOpt.bucket) {
      case "day":
        return bucketMetricByDay(scopedWorkouts, startYMD, endYMD, aggregate);
      case "rollingWeeks":
        return bucketMetricByRollingWeeks(scopedWorkouts, startYMD, endYMD, aggregate);
      case "month":
        return bucketMetricByMonth(scopedWorkouts, startYMD, endYMD, aggregate);
    }
  }, [scopedWorkouts, range, metric]);

  // The "natural" slot count for the active range — used by VolumeBarChart to
  // lay bars out at their proper week/month positions even when the window
  // hasn't filled all of them yet (e.g. only 2 of 4 weeks this month).
  const volumeSlotsCount = useMemo(() => {
    switch (range) {
      case "thisWeek":
      case "lastWeek":
        return 7;
      case "thisMonth":
        return 4;
      case "last3Months":
        return 3;
      case "year":
        return 12;
    }
  }, [range]);

  // Human phrasing of the active range, slotted into the chart's empty state.
  const volumeRangeText = useMemo(() => {
    switch (range) {
      case "thisWeek":    return "this week";
      case "lastWeek":    return "last week";
      case "thisMonth":   return "in the last month";
      case "last3Months": return "in the last 3 months";
      case "year":        return "in the last year";
    }
  }, [range]);

  // Days from the in-scope program(s) to render in the drill-down.
  const daysInScope = useMemo(() => uniqueDaysInScope(scope, programs), [scope, programs]);

  // Per-exercise history & PRs (only when the user has selected an exercise).
  const { exerciseHistory, prs } = useMemo(() => {
    if (!selectedExercise) return { exerciseHistory: [], prs: null };
    const eh = collectExerciseHistory(scopedWorkouts, selectedExercise);
    const p = computePRs(eh, scopedWorkouts, selectedExercise);
    return { exerciseHistory: eh, prs: p };
  }, [scopedWorkouts, selectedExercise]);

  // When the user selects an exercise, scroll down to the progression chart.
  // We capture the chart's y position via onLayout and use scrollRef.scrollTo.
  useEffect(() => {
    if (!selectedExercise) return;
    const id = requestAnimationFrame(() => {
      if (exerciseSectionY.current > 0) {
        // Animated.ScrollView exposes scrollTo via getNode (RN 0.62+) or directly.
        const node: any = scrollRef.current;
        node?.scrollTo?.({ y: Math.max(0, exerciseSectionY.current - 40), animated: true });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [selectedExercise]);

  const onSelectExercise = useCallback((name: string) => {
    setSelectedExercise(prev => (prev?.trim().toLowerCase() === name.trim().toLowerCase() ? prev : name));
  }, []);

  const showNoActiveProgramHint = scope.kind === "current" && !hasActiveProgram;

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Gradient blur header — mirrors home.tsx */}
      <Animated.View
        pointerEvents="none"
        style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}
      >
        <MaskedView
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
              locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </Animated.View>

      <Animated.ScrollView
        ref={scrollRef as any}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 50, paddingBottom: insets.bottom + 140 }]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        {/* Title row */}
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: t.tp }]}>Progress</Text>
        </View>

        {/* Scope picker */}
        <View style={{ marginTop: 18 }}>
          <ProgramScopePicker
            scope={scope}
            programs={programs}
            onChange={s => {
              setScope(s);
              setScopeFallbackNote(null);
              // Selected exercise might not exist outside the new scope — leave
              // it; collectExerciseHistory will simply return [] and the chart
              // renders an empty state with the option to pick a new one.
            }}
          />
          {scopeFallbackNote ? (
            <View style={{ marginHorizontal: 20, marginTop: 8 }}>
              <Text style={[styles.note, { color: ACCT }]}>{scopeFallbackNote}</Text>
            </View>
          ) : null}
        </View>

        {/* Optional "no active program" hint */}
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
            {/* Metric bar chart (Volume / Reps / Duration) */}
            <VolumeBarChart
              buckets={buckets}
              unit={unit}
              slotsCount={volumeSlotsCount}
              rangeText={volumeRangeText}
              metric={metric}
              onMetricChange={setMetric}
              range={range}
              onRangeChange={setRange}
            />

            {/* Workout days drill-down */}
            <DayExerciseList
              days={daysInScope}
              workouts={scopedWorkouts}
              selectedExercise={selectedExercise}
              onSelectExercise={onSelectExercise}
            />
          </>
        )}

        {/* Exercise progression — only when an exercise is selected */}
        {selectedExercise && prs ? (
          <View
            onLayout={e => {
              exerciseSectionY.current = e.nativeEvent.layout.y;
            }}
          >
            <ExerciseProgressionChart
              exerciseName={selectedExercise}
              history={exerciseHistory}
              prs={prs}
              unit={unit}
            />
          </View>
        ) : null}
      </Animated.ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll: { paddingTop: 0 },

  titleRow: {
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 32,
  },
  note: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
  },

  hintInner: {
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  hintText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    textAlign: "center",
  },
});
