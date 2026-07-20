import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Modal, Animated, Easing, useWindowDimensions,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from "react-native";
import Reanimated, { useSharedValue, useAnimatedScrollHandler } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import PagerDots from "./onboarding/PagerDots";
import Confetti from "./onboarding/Confetti";
import MedalIcon from "./icons/MedalIcon";
import { APP_LIGHT, APP_DARK, ACCT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { getJSON } from "../utils/storage";
import { WORKOUT_HISTORY_KEY, type CompletedWorkout } from "../constants/programs";
import { CUSTOM_KEY, type CustomExercise, type SelectableMuscle } from "../constants/exercises";
import type { MuscleGroupStat } from "../constants/progress";
import { computeWorkoutTonnage, computeMuscleGroupStats } from "../utils/progressStats";
import { RADAR_GROUPS } from "../utils/muscleGroups";
import { computeSessionRecords, ordinal, type SessionRecord } from "../utils/workoutSummary";
import { fmtDuration } from "../utils/dates";
import { toDisplayWeight, trimNumber } from "../utils/units";
import { notifyAchievement } from "../utils/notificationScheduler";

// ─── WorkoutSummarySheet ─────────────────────────────────────────────────────
// Full-screen celebratory summary shown right after a workout is finished on
// the Workout tab: a swipeable carousel of stat cards (overview / exercises /
// records / muscle split) over the locked completed view, with an always-
// visible Done button. Stats only — deliberately no sharing, usernames, or
// branding.

const RECORD_LABELS: Record<SessionRecord["kind"], string> = {
  heaviest: "Heaviest Weight",
  oneRepMax: "Best One Rep Max",
  bestSetVolume: "Best Set Volume",
};

const MAX_EXERCISE_ROWS = 8;
const MAX_RECORD_ROWS = 6;

type SummaryData = {
  workoutNumber: number;
  records: SessionRecord[];
  muscleStats: Record<SelectableMuscle, MuscleGroupStat>;
};

export default function WorkoutSummarySheet({
  visible, workout, onDone,
}: {
  visible: boolean;
  workout: CompletedWorkout;
  onDone: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isKg } = useUnit();
  const unit = isKg ? "kg" : "lbs";
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [data, setData] = useState<SummaryData | null>(null);
  // Which workout id the PR notification already fired for (see below).
  const prFiredFor = useRef<string | null>(null);

  // Records / muscle split need history + custom exercises from storage. The
  // just-finished workout may or may not have been persisted yet (the write
  // runs in the background), so filter it out by id either way.
  useEffect(() => {
    let alive = true;
    (async () => {
      const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
      const customs = await getJSON<CustomExercise[]>(CUSTOM_KEY, []);
      if (!alive) return;
      const prior = history.filter(w => w.id !== workout.id);
      const records = computeSessionRecords(workout, prior);
      setData({
        workoutNumber: prior.length + 1,
        records,
        muscleStats: computeMuscleGroupStats([workout], customs),
      });
      // PR achievement notification (gated by the achievements toggle inside
      // notifyAchievement). One consolidated banner per session, headlining
      // the heaviest-weight record; it also lands in the notification center
      // as a keepsake. Guarded per workout id — the effect re-runs on a unit
      // flip (isKg/unit deps) and must not fire twice.
      if (records.length > 0 && prFiredFor.current !== workout.id) {
        prFiredFor.current = workout.id;
        const top = records.find(r => r.kind === "heaviest") ?? records[0];
        const disp = toDisplayWeight(top.valueKg, isKg);
        const val = top.kind === "heaviest" ? `${trimNumber(disp, 1)} ${unit}` : `${Math.round(disp)} ${unit}`;
        const what = top.kind === "oneRepMax" ? "estimated 1RM" : top.kind === "bestSetVolume" ? "set volume" : "top set";
        notifyAchievement(
          records.length === 1 ? "New personal record!" : `${records.length} new personal records!`,
          records.length === 1
            ? `${top.exerciseName}: ${what} of ${val}.`
            : `${top.exerciseName} hit ${val}, plus more. Strong session.`,
        );
      }
    })();
    return () => { alive = false; };
  }, [workout, isKg, unit]);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  // Confetti celebrates the finish, then gets out of the way: fade it out
  // after 5s and unmount (the shared Confetti component itself loops forever).
  const [confettiVisible, setConfettiVisible] = useState(true);
  const confettiOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(confettiOpacity, { toValue: 0, duration: 500, useNativeDriver: true })
        .start(() => setConfettiVisible(false));
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // Enter: fade + slight rise. Exit: fade, then hand control back to the parent.
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterY = useRef(new Animated.Value(24)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(enterOpacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(enterY, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  const closing = useRef(false);
  const handleDone = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(enterOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => onDone());
  };

  // ── pager ──────────────────────────────────────────────────────────────────
  const scrollX = useSharedValue(0);
  const [page, setPage] = useState(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => { scrollX.value = e.contentOffset.x; },
  });
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  };

  // ── derived stats (session-local, no storage needed) ───────────────────────
  const tonnage = useMemo(() => computeWorkoutTonnage(workout), [workout]);

  const exerciseRows = useMemo(
    () =>
      workout.exercises
        .map(ex => ({ name: ex.name, count: ex.sets.filter(s => s.type === "working" && s.done).length }))
        .filter(r => r.count > 0),
    [workout],
  );

  const muscleRows = useMemo(() => {
    if (!data) return [];
    return RADAR_GROUPS
      .map(g => ({ group: g, sets: data.muscleStats[g].sets }))
      .filter(r => r.sets > 0)
      .sort((a, b) => b.sets - a.sets);
  }, [data]);

  const fmtRecordValue = (r: SessionRecord): string => {
    const disp = toDisplayWeight(r.valueKg, isKg);
    if (r.kind === "oneRepMax") return `${Math.round(disp)} ${unit}`;
    if (r.kind === "bestSetVolume") return `${Math.round(disp).toLocaleString()} ${unit}`;
    return `${trimNumber(disp, 1)} ${unit}`;
  };

  const tileBg = t.bg;

  const renderOverview = () => (
    <View style={styles.cardInner}>
      <View style={styles.checkCircle}>
        <Ionicons name="checkmark" size={22} color="#fff" />
      </View>
      <Text style={[styles.workoutName, { color: t.tp }]} numberOfLines={2}>
        {workout.workoutName}
      </Text>
      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <View style={[styles.tile, { backgroundColor: tileBg }]}>
            <Text style={[styles.tileLabel, { color: t.ts }]}>Duration</Text>
            <Text style={[styles.tileValue, { color: t.tp }]} numberOfLines={1}>
              {fmtDuration(workout.durationSeconds)}
            </Text>
          </View>
          <View style={[styles.tile, { backgroundColor: tileBg }]}>
            <Text style={[styles.tileLabel, { color: t.ts }]}>Volume</Text>
            <Text style={[styles.tileValue, { color: t.tp }]} numberOfLines={1}>
              {Math.round(toDisplayWeight(tonnage, isKg)).toLocaleString()} {unit}
            </Text>
          </View>
        </View>
        <View style={styles.gridRow}>
          <View style={[styles.tile, { backgroundColor: tileBg }]}>
            <Text style={[styles.tileLabel, { color: t.ts }]}>Exercises</Text>
            <Text style={[styles.tileValue, { color: t.tp }]} numberOfLines={1}>
              {exerciseRows.length}
            </Text>
          </View>
          <View style={[styles.tile, { backgroundColor: tileBg }]}>
            <Text style={[styles.tileLabel, { color: t.ts }]}>Records</Text>
            <View style={styles.tileValueRow}>
              <Text style={[styles.tileValue, { color: t.tp }]} numberOfLines={1}>
                {data ? data.records.length : 0}
              </Text>
              {/* Nudged down: the artwork's disc sits high in its box (the
                  ribbons fill the bottom), so dead-center reads as floating. */}
              <View style={styles.tileMedal}>
                <MedalIcon size={18} />
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );

  const renderExercises = () => (
    <View style={styles.cardInner}>
      <Text style={[styles.cardTitle, { color: t.tp }]}>Exercises</Text>
      <View style={styles.rowList}>
        {exerciseRows.slice(0, MAX_EXERCISE_ROWS).map((r, i) => (
          <View key={`${r.name}-${i}`} style={styles.exerciseRow}>
            <Text style={styles.exerciseCount}>{r.count}×</Text>
            <Text style={[styles.exerciseName, { color: t.tp }]} numberOfLines={1}>{r.name}</Text>
          </View>
        ))}
        {exerciseRows.length > MAX_EXERCISE_ROWS && (
          <Text style={[styles.moreText, { color: t.ts }]}>
            +{exerciseRows.length - MAX_EXERCISE_ROWS} more
          </Text>
        )}
      </View>
    </View>
  );

  const renderRecords = (records: SessionRecord[]) => (
    <View style={styles.cardInner}>
      <View style={styles.recordsTitleRow}>
        <MedalIcon size={20} />
        <Text style={[styles.cardTitle, { color: t.tp, marginBottom: 0 }]}>Records</Text>
      </View>
      <View style={styles.rowList}>
        {records.slice(0, MAX_RECORD_ROWS).map((r, i) => (
          <View key={`${r.exerciseName}-${r.kind}-${i}`} style={styles.recordRow}>
            <View style={styles.recordLeft}>
              <Text style={[styles.recordName, { color: t.tp }]} numberOfLines={1}>{r.exerciseName}</Text>
              <Text style={[styles.recordKind, { color: t.ts }]} numberOfLines={1}>
                {RECORD_LABELS[r.kind]}
              </Text>
            </View>
            <Text style={styles.recordValue} numberOfLines={1}>{fmtRecordValue(r)}</Text>
          </View>
        ))}
        {records.length > MAX_RECORD_ROWS && (
          <Text style={[styles.moreText, { color: t.ts }]}>
            +{records.length - MAX_RECORD_ROWS} more
          </Text>
        )}
      </View>
    </View>
  );

  const renderMuscles = () => {
    const maxSets = muscleRows.reduce((m, r) => Math.max(m, r.sets), 0);
    return (
      <View style={styles.cardInner}>
        <Text style={[styles.cardTitle, { color: t.tp }]}>Muscle Split</Text>
        <View style={styles.rowList}>
          {muscleRows.map(r => {
            const n = Math.round(r.sets);
            return (
              <View key={r.group} style={styles.muscleRow}>
                <Text style={[styles.muscleName, { color: t.tp }]} numberOfLines={1}>{r.group}</Text>
                <View style={[styles.muscleTrack, { backgroundColor: tileBg }]}>
                  <View style={[styles.muscleFill, { width: `${(r.sets / maxSets) * 100}%` }]} />
                </View>
                <Text style={[styles.muscleSets, { color: t.ts }]} numberOfLines={1}>
                  {n} {n === 1 ? "set" : "sets"}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  // Page list — empty sections drop out (a workout with no records shouldn't
  // page through a blank card).
  const pages: React.ReactNode[] = [];
  if (data) {
    pages.push(renderOverview());
    if (exerciseRows.length > 0) pages.push(renderExercises());
    if (data.records.length > 0) pages.push(renderRecords(data.records));
    if (muscleRows.length > 0) pages.push(renderMuscles());
  }

  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent animationType="none" onRequestClose={handleDone}>
      <Animated.View
        style={[
          styles.root,
          {
            backgroundColor: t.bg,
            opacity: enterOpacity,
            transform: [{ translateY: enterY }],
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 20,
          },
        ]}
      >
        {confettiVisible && (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: confettiOpacity }]}>
            <Confetti />
          </Animated.View>
        )}

        <View style={styles.header}>
          <Text style={[styles.title, { color: t.tp }]}>Nice work!</Text>
          <Text style={[styles.subtitle, { color: t.ts }]}>
            {data ? `Your ${ordinal(data.workoutNumber)} workout` : " "}
          </Text>
        </View>

        <Reanimated.ScrollView
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onScroll={scrollHandler}
          onMomentumScrollEnd={onMomentumEnd}
          scrollEventThrottle={16}
          style={styles.scroll}
        >
          {pages.map((content, i) => (
            <View key={i} style={[styles.page, { width }]}>
              <NeuCard dark={isDark} radius={24}>{content}</NeuCard>
            </View>
          ))}
        </Reanimated.ScrollView>

        <View style={styles.footer}>
          <PagerDots count={Math.max(pages.length, 1)} width={width} scrollX={scrollX} dark={isDark} />
          <BounceButton onPress={handleDone} accessibilityRole="button" accessibilityLabel="Done">
            <View style={styles.doneBtn}>
              <Text style={styles.doneText}>Done</Text>
            </View>
          </BounceButton>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { alignItems: "center", paddingHorizontal: 24, paddingTop: 20, gap: 4 },
  title: { fontFamily: FontFamily.bold, fontSize: 26 },
  subtitle: { fontFamily: FontFamily.semibold, fontSize: 15 },

  scroll: { flex: 1, marginTop: 8 },
  page: { justifyContent: "center", paddingHorizontal: 24 },
  cardInner: { padding: 20 },

  // Overview
  checkCircle: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: ACCT,
    alignItems: "center", justifyContent: "center", alignSelf: "center",
    shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
  },
  workoutName: { fontFamily: FontFamily.bold, fontSize: 21, textAlign: "center", marginTop: 12 },
  grid: { marginTop: 18, gap: 10 },
  gridRow: { flexDirection: "row", gap: 10 },
  tile: { flex: 1, borderRadius: 14, padding: 12 },
  tileLabel: { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.5 },
  tileValue: { fontFamily: FontFamily.bold, fontSize: 18, marginTop: 4 },
  tileValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tileMedal: { marginTop: 3 },

  // Shared card bits
  cardTitle: { fontFamily: FontFamily.bold, fontSize: 18, marginBottom: 14 },
  rowList: { gap: 12 },
  moreText: { fontFamily: FontFamily.semibold, fontSize: 13 },

  // Exercises
  exerciseRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  exerciseCount: { fontFamily: FontFamily.bold, fontSize: 15, color: ACCT, minWidth: 30 },
  exerciseName: { fontFamily: FontFamily.semibold, fontSize: 15, flex: 1 },

  // Records
  recordsTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  recordRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  recordLeft: { flex: 1 },
  recordName: { fontFamily: FontFamily.bold, fontSize: 15 },
  recordKind: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  recordValue: { fontFamily: FontFamily.bold, fontSize: 16, color: ACCT },

  // Muscle split
  muscleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  muscleName: { fontFamily: FontFamily.semibold, fontSize: 14, width: 82 },
  muscleTrack: { flex: 1, height: 10, borderRadius: 5, overflow: "hidden" },
  muscleFill: { height: "100%", borderRadius: 5, backgroundColor: ACCT },
  muscleSets: { fontFamily: FontFamily.semibold, fontSize: 12, width: 48, textAlign: "right" },

  footer: { paddingHorizontal: 28, paddingTop: 16, gap: 20 },
  doneBtn: {
    borderRadius: 28, paddingVertical: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: ACCT,
    shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 8, elevation: 8,
  },
  doneText: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3, color: "#fff" },
});
