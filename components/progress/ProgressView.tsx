// Body of the Progress page, with data passed in as props so it can render
// either the current user's data (from AsyncStorage) or a PT-viewed client's
// data (from the mock trainerStore) using identical visuals.

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { View, Text, StyleSheet, Animated, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import ProgramScopePicker from "../ProgramScopePicker";
import VolumeBarChart from "../VolumeBarChart";
import DayExerciseList from "../DayExerciseList";
import ExerciseProgressionChart from "../ExerciseProgressionChart";
import DumbbellIcon from "../DumbbellIcon";

import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import { type CompletedWorkout, type SavedProgram } from "../../constants/programs";
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

export interface ProgressViewProps {
  history: CompletedWorkout[];
  programs: SavedProgram[];
  loaded: boolean;
  title?: string;
  /** Wrap content in a FadeScreen with the theme bg. Default true (tab use); false when embedding inside another route. */
  asScreen?: boolean;
  /** Add safe-area top padding. Default true. */
  withTopInset?: boolean;
  /** Bottom padding override (defaults to 140 to clear the tab bar). */
  bottomPadding?: number;
}

export default function ProgressView({
  history,
  programs,
  loaded,
  title = "Progress",
  asScreen = true,
  withTopInset = true,
  bottomPadding,
}: ProgressViewProps) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { isKg } = useUnit();
  const unit = isKg ? "kg" : "lbs";

  const [scope, setScope] = useState<ProgramScope>({ kind: "current" });
  const [range, setRange] = useState<RangeKey>("thisWeek");
  const [metric, setMetric] = useState<MetricKey>("volume");
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [scopeFallbackNote, setScopeFallbackNote] = useState<string | null>(null);

  const scrollRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const exerciseSectionY = useRef(0);

  // Reconcile scope when the upstream programs list changes (e.g. switching client).
  useEffect(() => {
    setScope(prev => {
      if (prev.kind !== "program") return prev;
      const stillExists = programs.some(pp => pp.id === prev.programId);
      if (stillExists) return prev;
      setScopeFallbackNote("Selected program was removed — showing all programs.");
      return { kind: "all" };
    });
  }, [programs]);

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

  const buckets = useMemo(() => {
    const aggregate =
      metric === "volume" ? computeWorkoutTonnage :
      metric === "reps" ? computeWorkoutReps :
      computeWorkoutDurationMinutes;
    const rangeOpt = getRangeOption(range);
    const { startYMD, endYMD } = rangeWindow(range, new Date());
    switch (rangeOpt.bucket) {
      case "day":          return bucketMetricByDay(scopedWorkouts, startYMD, endYMD, aggregate);
      case "rollingWeeks": return bucketMetricByRollingWeeks(scopedWorkouts, startYMD, endYMD, aggregate);
      case "month":        return bucketMetricByMonth(scopedWorkouts, startYMD, endYMD, aggregate);
    }
  }, [scopedWorkouts, range, metric]);

  const volumeSlotsCount = useMemo(() => {
    switch (range) {
      case "thisWeek":
      case "lastWeek":    return 7;
      case "thisMonth":   return 4;
      case "last3Months": return 3;
      case "year":        return 12;
    }
  }, [range]);

  const volumeRangeText = useMemo(() => {
    switch (range) {
      case "thisWeek":    return "this week";
      case "lastWeek":    return "last week";
      case "thisMonth":   return "in the last month";
      case "last3Months": return "in the last 3 months";
      case "year":        return "in the last year";
    }
  }, [range]);

  const daysInScope = useMemo(() => uniqueDaysInScope(scope, programs), [scope, programs]);

  const { exerciseHistory, prs } = useMemo(() => {
    if (!selectedExercise) return { exerciseHistory: [], prs: null };
    const eh = collectExerciseHistory(scopedWorkouts, selectedExercise);
    const p = computePRs(eh, scopedWorkouts, selectedExercise);
    return { exerciseHistory: eh, prs: p };
  }, [scopedWorkouts, selectedExercise]);

  useEffect(() => {
    if (!selectedExercise) return;
    const id = requestAnimationFrame(() => {
      if (exerciseSectionY.current > 0) {
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
  const topPad = withTopInset ? insets.top + 50 : 16;
  const botPad = bottomPadding ?? (insets.bottom + 140);

  const Wrapper: any = asScreen ? FadeScreen : View;
  const wrapperProps = asScreen ? { style: { backgroundColor: t.bg } } : { style: { flex: 1, backgroundColor: t.bg } };

  return (
    <Wrapper {...wrapperProps}>
      {asScreen && withTopInset && (
        <Animated.View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
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
      )}

      <Animated.ScrollView
        ref={scrollRef as any}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: botPad }]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        {title !== "" && (
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
          </View>
        )}

        <View style={{ marginTop: 18 }}>
          <ProgramScopePicker
            scope={scope}
            programs={programs}
            onChange={s => { setScope(s); setScopeFallbackNote(null); }}
          />
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
              buckets={buckets}
              unit={unit}
              slotsCount={volumeSlotsCount}
              rangeText={volumeRangeText}
              metric={metric}
              onMetricChange={setMetric}
              range={range}
              onRangeChange={setRange}
            />
            <DayExerciseList
              days={daysInScope}
              workouts={scopedWorkouts}
              selectedExercise={selectedExercise}
              onSelectExercise={onSelectExercise}
            />
          </>
        )}

        {selectedExercise && prs ? (
          <View onLayout={e => { exerciseSectionY.current = e.nativeEvent.layout.y; }}>
            <ExerciseProgressionChart
              exerciseName={selectedExercise}
              history={exerciseHistory}
              prs={prs}
              unit={unit}
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
  title: { fontFamily: FontFamily.bold, fontSize: 32 },
  note: { fontFamily: FontFamily.semibold, fontSize: 12 },
  hintInner: { padding: 16, alignItems: "center", gap: 8 },
  hintText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
});
