import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withRepeat, withDelay, Easing as ReEasing, interpolateColor } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  Alert, Animated, AppState, Keyboard, Modal,
  PanResponder, Easing, Switch, useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import NeuCard, { NEU_BG, NEU_BG_DARK } from "../../components/NeuCard";
import CollapsibleCard from "../../components/CollapsibleCard";
import FadeScreen from "../../components/FadeScreen";
import BounceButton from "../../components/BounceButton";
import ExercisePicker from "../../components/ExercisePicker";
import TrashIcon from "../../components/TrashIcon";
import DumbbellIcon from "../../components/DumbbellIcon";
import TimeEditSheet from "../../components/TimeEditSheet";
import WorkoutSummarySheet from "../../components/WorkoutSummarySheet";
import { computeDurationMins, completedAtISO } from "../../components/TimeWheelPicker";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import { PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, WORKOUT_DAY_OVERRIDE_KEY, WORKOUT_DRAFT_KEY, WORKOUT_VIEW_MODE_KEY, WORKOUT_AUTOFILL_KEY, LIVE_ACTIVITY_KEY, type SavedProgram, type Exercise, type ProgramSet, type CompletedWorkout, normaliseSets, getCurrentWeek } from "../../constants/programs";
import { useWorkoutLiveActivity } from "../../hooks/useWorkoutLiveActivity";
import { buildLiveActivityPayload } from "../../utils/liveActivity";
import type { LiveActivityTickAction } from "../../modules/avenas-live-activity";
import { CUSTOM_KEY, type CustomExercise } from "../../constants/exercises";
import { todayYMD } from "../../utils/dates";
import { getEffectiveToday, resolveWorkoutForDate, buildPrevByName, normalizeExerciseName, type DayOverride } from "../../utils/workout";
import { formatWeightForDisplay, parseWeightToKg, formatPrevHint, reinterpretWeightUnit } from "../../utils/units";
import { scheduleCloudPush } from "../../lib/syncManager";
import { useDayRollover } from "../../hooks/useDayRollover";
import IntervalTimerModal from "../../components/IntervalTimerModal";
import { useWorkoutTimer } from "../../contexts/WorkoutTimerContext";
import { useRestTimer } from "../../contexts/RestTimerContext";

// ─── Constants ─────────────────────────────────────────────────────────────────

const WARMUP_ORANGE = "#ffbf0f";

// Dev-only warning helper. Compiled out of release builds via `__DEV__`.
function warnStorage(op: string, key: string, err: unknown) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn("[avenas]", op, key, err);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(secs: number): string {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

// ─── Log types ─────────────────────────────────────────────────────────────────

type SetLog = { weight: string; reps: string; done: boolean; fillKey: number; originWorkingIdx?: number };
type ExerciseLog = { warmup: SetLog[]; working: SetLog[]; notes: string };
type WorkoutLog = Record<string, ExerciseLog>;

function makeSet(): SetLog {
  return { weight: "", reps: "", done: false, fillKey: 0 };
}

function initLog(exercises: Exercise[]): WorkoutLog {
  const log: WorkoutLog = {};
  for (const ex of exercises) {
    const sets = normaliseSets(ex);
    log[ex.id] = {
      warmup: sets.filter(s => s.type === "warmup").map(makeSet),
      working: sets.filter(s => s.type === "working").map(makeSet),
      notes: "",
    };
  }
  return log;
}

function hasWorkoutProgress(log: WorkoutLog): boolean {
  return Object.values(log).some(exLog =>
    [...exLog.warmup, ...exLog.working].some(s => s.done || !!s.weight.trim() || !!s.reps.trim())
  );
}

// ─── SetRow ────────────────────────────────────────────────────────────────────

function SetRow({ isActive, children }: { isActive: boolean; children: React.ReactNode }) {
  const glow = useSharedValue(isActive ? 1 : 0);
  useEffect(() => {
    glow.value = withSpring(isActive ? 1 : 0, { damping: 20, stiffness: 200, mass: 0.5 });
  }, [isActive]);

  const containerStyle = useAnimatedStyle(() => ({
    borderRadius: 14,
    backgroundColor: interpolateColor(glow.value, [0, 1], ["rgba(0,0,0,0)", `${ACCT}33`]),
  }));
  const borderStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Reanimated.View style={containerStyle}>
      {children}
      <Reanimated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { borderWidth: 1, borderColor: ACCT, borderRadius: 14 }, borderStyle]}
      />
    </Reanimated.View>
  );
}

// ─── AnimatedProgressBar ───────────────────────────────────────────────────────

function AnimatedProgressBar({ pct, trackColor }: { pct: number; trackColor: string }) {
  const progress = useSharedValue(pct);
  useEffect(() => {
    progress.value = withTiming(pct, { duration: 450, easing: ReEasing.out(ReEasing.cubic) });
  }, [pct]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value}%` }));
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: trackColor }}>
      <Reanimated.View
        style={[
          { height: "100%", borderRadius: 2, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 3, elevation: 2 },
          fillStyle,
        ]}
      />
    </View>
  );
}

// ─── KeyboardDismissIcon ───────────────────────────────────────────────────────

function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4"/>
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

// ─── DragHandleIcon ────────────────────────────────────────────────────────────

function DragHandleIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={12} viewBox="0 0 16 12" fill="none">
      <Path d="M1 1.5h14M1 6h14M1 10.5h14" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

// ─── WorkoutDraggableList ──────────────────────────────────────────────────────

interface WorkoutDraggableListProps {
  exercises: Exercise[];
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  onReorderExercises: (exercises: Exercise[]) => void;
  onRemoveExercise: (id: string) => void;
  onEditExercise: (id: string) => void;
}

function WorkoutDraggableList({ exercises, isDark, t, onReorderExercises, onRemoveExercise, onEditExercise }: WorkoutDraggableListProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const activeIdxRef = useRef<number | null>(null);
  const hoverIdxRef = useRef<number | null>(null);
  const rowHeightRef = useRef(50);

  const rowAnimsMap = useRef(new Map<string, Animated.Value>());
  exercises.forEach(ex => {
    if (!rowAnimsMap.current.has(ex.id)) rowAnimsMap.current.set(ex.id, new Animated.Value(0));
  });

  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const onReorderRef = useRef(onReorderExercises);
  onReorderRef.current = onReorderExercises;

  useLayoutEffect(() => {
    rowAnimsMap.current.forEach(a => a.setValue(0));
  }, [exercises]);

  const panResponders = useMemo(() =>
    exercises.map((ex, idx) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          activeIdxRef.current = idx;
          hoverIdxRef.current = idx;
          rowAnimsMap.current.forEach(a => a.setValue(0));
          setActiveIdx(idx);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
        onPanResponderMove: (_, gs) => {
          rowAnimsMap.current.get(ex.id)?.setValue(gs.dy);
          const rh = rowHeightRef.current;
          const exList = exercisesRef.current;
          const newHover = Math.max(0, Math.min(exList.length - 1, Math.round(idx + gs.dy / rh)));
          if (newHover !== hoverIdxRef.current) {
            hoverIdxRef.current = newHover;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            exList.forEach((item, i) => {
              if (i === idx) return;
              let toVal = 0;
              if (newHover > idx && i > idx && i <= newHover) toVal = -rh;
              else if (newHover < idx && i < idx && i >= newHover) toVal = rh;
              Animated.spring(rowAnimsMap.current.get(item.id)!, {
                toValue: toVal, useNativeDriver: false, damping: 20, stiffness: 280,
              }).start();
            });
          }
        },
        onPanResponderRelease: () => {
          const from = activeIdxRef.current!;
          const to = hoverIdxRef.current ?? from;
          if (to !== from) {
            const arr = [...exercisesRef.current];
            const [moved] = arr.splice(from, 1);
            arr.splice(to, 0, moved);
            onReorderRef.current(arr);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } else {
            rowAnimsMap.current.forEach(a => a.setValue(0));
          }
          activeIdxRef.current = null;
          hoverIdxRef.current = null;
          setActiveIdx(null);
        },
        onPanResponderTerminate: () => {
          rowAnimsMap.current.forEach(a => a.setValue(0));
          activeIdxRef.current = null;
          hoverIdxRef.current = null;
          setActiveIdx(null);
        },
      })
    ),
  [exercises]);

  const divider = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";

  return (
    <>
      {exercises.map((ex, i) => {
        const isActive = activeIdx === i;
        const anim = rowAnimsMap.current.get(ex.id)!;
        return (
          <Animated.View
            key={ex.id}
            style={[
              styles.woDragRow,
              i < exercises.length - 1 && { borderBottomWidth: 1, borderBottomColor: isActive ? "transparent" : divider },
              { transform: [{ translateY: anim }], zIndex: isActive ? 10 : 1 },
              isActive && {
                backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)",
                borderRadius: 8,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.2,
                shadowRadius: 8,
              },
            ]}
            onLayout={i === 0 ? (e) => { rowHeightRef.current = e.nativeEvent.layout.height; } : undefined}
          >
            <View {...panResponders[i].panHandlers} style={styles.woDragHandle}>
              <DragHandleIcon color={t.ts} />
            </View>
            <View style={[styles.woDragNumChip, { backgroundColor: ACCT + "18" }]}>
              <Text style={[styles.woDragNum, { color: ACCT }]}>{i + 1}</Text>
            </View>
            <TouchableOpacity
              style={styles.woDragNameBtn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onEditExercise(ex.id); }}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Text style={[styles.woDragName, { color: t.tp }]} numberOfLines={1}>{ex.name}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert("Remove Exercise", `Remove "${ex.name}"?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => onRemoveExercise(ex.id) },
                ]);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <TrashIcon size={18} color="#ef4444" />
            </TouchableOpacity>
          </Animated.View>
        );
      })}
    </>
  );
}

// ─── WorkoutReorderSheet ───────────────────────────────────────────────────────

interface WorkoutReorderSheetProps {
  visible: boolean;
  workoutName: string;
  exercises: Exercise[];
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  onReorderExercises: (exercises: Exercise[]) => void;
  onRemoveExercise: (id: string) => void;
  onEditExercise: (id: string) => void;
  onClose: () => void;
}

function WorkoutReorderSheet({ visible, workoutName, exercises, isDark, t, onReorderExercises, onRemoveExercise, onEditExercise, onClose }: WorkoutReorderSheetProps) {
  const slideY = useRef(new Animated.Value(500)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          slideY.setValue(g.dy);
          backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.parallel([
            Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); onClose(); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      slideY.setValue(500);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const closeSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); onClose(); });
  }, [slideY, backdropOpacity, onClose]);

  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;

  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent animationType="none" onRequestClose={closeSheet}>
      <View style={styles.woReorderBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.woReorderOverlay, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />
        <Animated.View style={[styles.woReorderSheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers} style={styles.woReorderHandleArea}>
            <View style={styles.woReorderHandle} />
          </View>
          <View style={[styles.woReorderHeader, { borderBottomColor: divider }]}>
            <Text style={[styles.woReorderTitle, { color: t.tp }]}>Reorder Exercises</Text>
            <Text style={[styles.woReorderSubtitle, { color: t.ts }]}>{workoutName}</Text>
          </View>
          <View style={styles.woReorderListWrap}>
            <WorkoutDraggableList
              exercises={exercises}
              isDark={isDark}
              t={t}
              onReorderExercises={onReorderExercises}
              onRemoveExercise={onRemoveExercise}
              onEditExercise={onEditExercise}
            />
          </View>
          <View style={styles.woReorderDoneRow}>
            <BounceButton
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); closeSheet(); }}
              accessibilityLabel="Done"
              accessibilityRole="button"
            >
              <View style={styles.woReorderDoneWrap}>
                <View style={styles.woReorderDoneBtn}>
                  <Text style={styles.woReorderDone}>Done</Text>
                </View>
              </View>
            </BounceButton>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── WorkoutOptionsSheet ───────────────────────────────────────────────────────

function WorkoutOptionsSheet({ visible, isDark, t, onStartCustom, onChangeDay, onClose, focusMode, onToggleFocusMode }: {
  visible: boolean; isDark: boolean; t: typeof APP_LIGHT | typeof APP_DARK;
  onStartCustom: () => void; onChangeDay: () => void; onClose: () => void;
  focusMode: boolean; onToggleFocusMode: (next: boolean) => void;
}) {
  const slideY = useRef(new Animated.Value(500)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300)); }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.parallel([
            Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); onClose(); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      slideY.setValue(500);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const closeSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); onClose(); });
  }, [slideY, backdropOpacity, onClose]);

  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent animationType="none" onRequestClose={closeSheet}>
      <View style={styles.woReorderBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.woReorderOverlay, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />
        <Animated.View style={[styles.woReorderSheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers} style={styles.woReorderHandleArea}>
            <View style={styles.woReorderHandle} />
          </View>
          <Text style={[styles.woPickerTitle, { color: t.tp }]}>Workout Options</Text>
          <View style={styles.woPickerContent}>
            <BounceButton style={{ marginBottom: 16 }} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChangeDay(); }}>
              <NeuCard dark={isDark} radius={14}>
                <View style={styles.woPickerOptionInner}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={t.tp} />
                  <Text style={[styles.woPickerOptionText, { color: t.tp }]}>Change Workout Day</Text>
                  <Ionicons name="chevron-forward" size={16} color={t.ts} />
                </View>
              </NeuCard>
            </BounceButton>
            <BounceButton style={{ marginBottom: 16 }} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onStartCustom(); }}>
              <NeuCard dark={isDark} radius={14}>
                <View style={styles.woPickerOptionInner}>
                  <Ionicons name="pencil-outline" size={18} color={t.tp} />
                  <Text style={[styles.woPickerOptionText, { color: t.tp }]}>Custom Workout</Text>
                  <Ionicons name="chevron-forward" size={16} color={t.ts} />
                </View>
              </NeuCard>
            </BounceButton>
            <NeuCard dark={isDark} radius={14} style={{ marginBottom: 16 }}>
              <View style={styles.woPickerOptionInner}>
                <Ionicons name="eye-outline" size={18} color={t.tp} />
                <Text style={[styles.woPickerOptionText, { color: t.tp, flex: 1 }]}>Focus Mode</Text>
                <Switch
                  value={focusMode}
                  onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggleFocusMode(v); }}
                  trackColor={{ false: t.div, true: ACCT }}
                  thumbColor="#fff"
                  style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }], marginVertical: -6 }}
                />
              </View>
            </NeuCard>
            <BounceButton onPress={closeSheet}>
              <View style={[styles.woPickerCancelBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
                <Text style={[styles.woPickerCancelText, { color: t.tp }]}>Cancel</Text>
              </View>
            </BounceButton>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── ChangeDaySheet ────────────────────────────────────────────────────────────

function ChangeDaySheet({ visible, isDark, t, activeProgram, programs, currentWorkoutName, onSelectDay, onClose, onDismiss }: {
  visible: boolean; isDark: boolean; t: typeof APP_LIGHT | typeof APP_DARK;
  activeProgram: SavedProgram; programs: SavedProgram[]; currentWorkoutName: string;
  onSelectDay: (dayName: string, fromProgram?: SavedProgram) => void;
  onClose: () => void; onDismiss: () => void;
}) {
  const slideY = useRef(new Animated.Value(500)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState<"menu" | "others" | "program">("menu");
  const [focusedProgram, setFocusedProgram] = useState<SavedProgram | null>(null);

  const animateOut = useCallback((cb: () => void) => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); cb(); });
  }, [slideY, backdropOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300)); }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.parallel([
            Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); onDismiss(); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      setStep("menu");
      setFocusedProgram(null);
      slideY.setValue(500);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const workoutDays = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const name of activeProgram.cyclePattern) {
      if (name && name !== "Rest" && !seen.has(name)) { seen.add(name); result.push(name); }
    }
    return result;
  }, [activeProgram]);

  const otherPrograms = useMemo(() => programs.filter(p => p.id !== activeProgram.id), [programs, activeProgram]);

  const headerTitle = step === "menu" ? "Change Workout Day" : step === "others" ? "Other Programs" : (focusedProgram?.name ?? "");
  const headerSubtitle = step === "menu" ? activeProgram.name : null;
  const handleBack = () => {
    if (step === "menu") { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); animateOut(onClose); }
    else if (step === "others") setStep("menu");
    else setStep("others");
  };

  const renderOptionCard = (key: string, label: string, icon: React.ReactNode, isActive: boolean, onPress: () => void) => (
    <BounceButton key={key} style={{ marginBottom: 16 }} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); animateOut(onPress); }}>
      <NeuCard dark={isDark} radius={14}>
        <View style={styles.woPickerOptionInner}>
          {icon}
          <Text style={[styles.woPickerOptionText, { color: isActive ? ACCT : t.tp }]}>{label}</Text>
          {isActive ? (
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: ACCT, alignItems: "center", justifyContent: "center", shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 6 }}>
              <Ionicons name="checkmark" size={14} color="#fff" />
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={16} color={t.ts} />
          )}
        </View>
      </NeuCard>
    </BounceButton>
  );

  const renderDayCard = (dayName: string, prog: SavedProgram) => {
    const isActive = prog.id === activeProgram.id && dayName === currentWorkoutName;
    return renderOptionCard(
      dayName, dayName,
      <DumbbellIcon size={18} color={isActive ? ACCT : t.tp} />,
      isActive,
      () => onSelectDay(dayName, prog.id !== activeProgram.id ? prog : undefined),
    );
  };

  // Rest is program-independent: one option that overrides today onto recovery.
  const renderRestCard = () => {
    const isActive = currentWorkoutName === "Rest";
    return renderOptionCard(
      "Rest", "Rest Day",
      <Ionicons name="moon-outline" size={18} color={isActive ? ACCT : t.tp} />,
      isActive,
      () => onSelectDay("Rest"),
    );
  };

  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent animationType="none" onRequestClose={() => animateOut(onDismiss)}>
      <View style={styles.woReorderBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.woReorderOverlay, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => animateOut(onDismiss)} />
        <Animated.View style={[styles.woReorderSheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers} style={styles.woReorderHandleArea}>
            <View style={styles.woReorderHandle} />
          </View>
          <View style={styles.woStepHeader}>
            <TouchableOpacity onPress={handleBack} style={styles.woStepBackBtn} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={20} color={t.tp} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={[styles.woReorderTitle, { color: t.tp }]}>{headerTitle}</Text>
              {headerSubtitle && <Text style={[styles.woReorderSubtitle, { color: t.ts }]}>{headerSubtitle}</Text>}
            </View>
            <View style={styles.woStepBackBtn} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.woPickerContent}>
            {step === "menu" && (
              <>
                {workoutDays.map(dayName => renderDayCard(dayName, activeProgram))}
                {renderRestCard()}
                {otherPrograms.length > 0 && (
                  <BounceButton style={{ marginBottom: 16 }} onPress={() => setStep("others")}>
                    <NeuCard dark={isDark} radius={14}>
                      <View style={styles.woPickerOptionInner}>
                        <Ionicons name="albums-outline" size={18} color={t.tp} />
                        <Text style={[styles.woPickerOptionText, { color: t.tp }]}>Other Programs</Text>
                        <Ionicons name="chevron-forward" size={16} color={t.ts} />
                      </View>
                    </NeuCard>
                  </BounceButton>
                )}
              </>
            )}
            {step === "others" && otherPrograms.map(prog => (
              <BounceButton key={prog.id} style={{ marginBottom: 16 }} onPress={() => { setFocusedProgram(prog); setStep("program"); }}>
                <NeuCard dark={isDark} radius={14}>
                  <View style={styles.woPickerOptionInner}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.woPickerOptionText, { color: t.tp }]}>{prog.name}</Text>
                      <Text style={[styles.woPickerOptionSub, { color: t.ts }]}>
                        {[...new Set(prog.cyclePattern.filter(n => n && n !== "Rest"))].join(" · ")}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={t.ts} />
                  </View>
                </NeuCard>
              </BounceButton>
            ))}
            {step === "program" && focusedProgram && (
              <>
                {[...new Set(focusedProgram.cyclePattern.filter(n => n && n !== "Rest"))].map(dayName =>
                  renderDayCard(dayName, focusedProgram)
                )}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── CustomWorkoutNameSheet ────────────────────────────────────────────────────

function CustomWorkoutNameSheet({ visible, isDark, t, activeProgram, onStart, onClose, onBack }: {
  visible: boolean; isDark: boolean; t: typeof APP_LIGHT | typeof APP_DARK;
  activeProgram: SavedProgram | null;
  onStart: (name: string, addToProgram: boolean) => void;
  onClose: () => void;
  onBack?: () => void;
}) {
  const [nameInput, setNameInput] = useState("Custom Workout");
  const [addToProgram, setAddToProgram] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const slideY = useRef(new Animated.Value(500)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setNameInput("Custom Workout");
      setAddToProgram(false);
      slideY.setValue(500);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start(() => setTimeout(() => inputRef.current?.focus(), 50));
    }
  }, [visible]);

  const animateOut = useCallback((cb: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); cb(); });
  }, [slideY, backdropOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300)); }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          animateOut(onClose);
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  const canStart = nameInput.trim().length > 0;
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;

  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent animationType="none" onRequestClose={() => animateOut(onClose)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.woReorderBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.woReorderOverlay, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => animateOut(onClose)} />
        <Animated.View style={[styles.woReorderSheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers} style={styles.woReorderHandleArea}>
            <View style={styles.woReorderHandle} />
          </View>
          <View style={styles.woStepHeader}>
            {onBack ? (
              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); animateOut(onBack); }} style={styles.woStepBackBtn} activeOpacity={0.7}>
                <Ionicons name="chevron-back" size={20} color={t.tp} />
              </TouchableOpacity>
            ) : <View style={styles.woStepBackBtn} />}
            <Text style={[styles.woStepTitle, { color: t.tp }]}>Name Your Workout</Text>
            <View style={styles.woStepBackBtn} />
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <View style={[styles.cnNameInputWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]}>
              <TextInput
                ref={inputRef}
                style={[styles.cnNameInput, { color: t.tp }]}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="e.g. Arms Day"
                placeholderTextColor={t.ts}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={() => { if (canStart) { animateOut(() => onStart(nameInput.trim(), addToProgram)); } }}
                selectTextOnFocus
              />
            </View>
          </View>

          {activeProgram && (
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddToProgram(v => !v); }}
              style={[styles.cnToggleRow, { borderTopColor: divider, borderBottomColor: divider }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.cnToggleTitle, { color: t.tp }]}>Add to {activeProgram.name}</Text>
                <Text style={[styles.cnToggleSub, { color: t.ts }]}>Saves stats under this program in your journal</Text>
              </View>
              <View style={[styles.cnToggle, addToProgram
                ? { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }
                : { backgroundColor: "transparent", borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)" }
              ]}>
                {addToProgram && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
            </TouchableOpacity>
          )}

          <View style={[styles.woReorderDoneRow, { opacity: canStart ? 1 : 0.35 }]}>
            <BounceButton
              onPress={() => { if (canStart) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); animateOut(() => onStart(nameInput.trim(), addToProgram)); } }}
              accessibilityLabel="Start workout"
              accessibilityRole="button"
            >
              <View style={styles.woReorderDoneWrap}>
                <View style={styles.woReorderDoneBtn}>
                  <Text style={styles.woReorderDone}>Custom Workout</Text>
                </View>
              </View>
            </BounceButton>
          </View>
          <View style={{ height: 12 }} />
        </Animated.View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── ExpandablePanel ───────────────────────────────────────────────────────────

function ExpandablePanel({ expanded, children, duration = 280, clip = false }: { expanded: boolean; children: React.ReactNode; duration?: number; clip?: boolean }) {
  const height = useSharedValue(0);
  const opacity = useSharedValue(0);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    if (measuredHeight === null) return;
    if (expanded) {
      height.value = withTiming(measuredHeight, { duration, easing: ReEasing.out(ReEasing.cubic) });
      if (!clip) opacity.value = withTiming(1, { duration: duration * 0.8, easing: ReEasing.out(ReEasing.cubic) });
    } else {
      if (!clip) opacity.value = withTiming(0, { duration: duration * 0.5 });
      height.value = withTiming(0, { duration, easing: ReEasing.out(ReEasing.cubic) });
    }
  }, [expanded, measuredHeight]);

  // clip mode: overflow:hidden reveals content with height — no separate fade-in.
  //   Shadows are progressively revealed as the clip boundary passes each button.
  // default mode: opacity hides absolutely-positioned content while height animates.
  const animStyle = useAnimatedStyle(() =>
    clip
      ? { height: height.value, overflow: "hidden" }
      : { height: height.value, opacity: opacity.value }
  );

  // In clip mode, negative horizontal margin extends the clip boundary beyond the
  // content area so left/right neumorphic shadows aren't cropped. Matching
  // paddingHorizontal + paddingBottom on the wrapper keeps content visually aligned
  // and gives bottom shadows room. The measurement view mirrors the same wrapper so
  // measuredHeight includes the bottom buffer.
  const clipWrap: object | null = clip ? { paddingHorizontal: 12, paddingBottom: 14 } : null;

  return (
    <View>
      {measuredHeight === null && (
        <View
          style={{ position: "absolute", left: clip ? -12 : 0, right: clip ? -12 : 0, top: 0, opacity: 0 }}
          pointerEvents="none"
          onLayout={e => { const h = e.nativeEvent?.layout?.height; if (h != null && h > 0) setMeasuredHeight(h); }}
        >
          {clip ? <View style={clipWrap!}>{children}</View> : children}
        </View>
      )}
      <Reanimated.View style={[animStyle, clip && { marginHorizontal: -12 }]}>
        {clip ? (
          <View style={clipWrap!}>{children}</View>
        ) : (
          <View
            style={{ position: "absolute", left: 0, right: 0, top: 0 }}
            onLayout={e => {
              const h = e.nativeEvent?.layout?.height;
              if (h == null || h <= 0 || measuredHeight === null || h === measuredHeight) return;
              setMeasuredHeight(h);
              if (expanded) height.value = withTiming(h, { duration: 200, easing: ReEasing.out(ReEasing.cubic) });
            }}
          >
            {children}
          </View>
        )}
      </Reanimated.View>
    </View>
  );
}

// ─── CheckboxCell ──────────────────────────────────────────────────────────────

function CheckboxCell({ done, isDark, isActive, onToggle }: { done: boolean; isDark: boolean; isActive?: boolean; onToggle: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const wasDone = useRef(done);

  useEffect(() => {
    if (done && !wasDone.current) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 0.70, useNativeDriver: true, speed: 60, bounciness: 0 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 16 }),
      ]).start();
    }
    wasDone.current = done;
  }, [done]);

  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(done ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
        onToggle();
      }}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Animated.View style={[styles.checkCircle, done ? {
        backgroundColor: ACCT,
        shadowColor: ACCT,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 6,
        borderWidth: 0,
      } : {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.75)" : APP_LIGHT.ts,
      }, { transform: [{ scale }] }]}>
        {done && <Ionicons name="checkmark" size={14} color="#fff" />}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── ExerciseCard ──────────────────────────────────────────────────────────────

// Stable empty fallback for `prevSets` — a fresh [] per render would defeat the
// React.memo below (every card would re-render on every parent keystroke).
const EMPTY_PREV: string[] = [];

// All callbacks are exId-FIRST so the parent can pass the same stable function
// references to every card; the card supplies its own exercise.id at the call
// site. Combined with React.memo (below), typing in one card's input no longer
// re-renders every other card on the screen.
interface ExerciseCardProps {
  exercise: Exercise;
  exIndex: number;
  totalExercises: number;
  exLog: ExerciseLog;
  isDark: boolean;
  /** `cascade` marks typed input, which may auto-fill the sets below (Settings toggle). */
  onUpdateSet: (exId: string, type: "warmup" | "working", idx: number, field: "weight" | "reps", value: string, cascade?: boolean) => void;
  onToggleDone: (exId: string, type: "warmup" | "working", idx: number) => void;
  onAutoTick: (exId: string, type: "warmup" | "working", idx: number) => void;
  onUpdateNotes: (exId: string, notes: string) => void;
  exNotes: string;
  onAddSet: (exId: string) => void;
  onRemoveSet: (exId: string) => void;
  onOpenReorder: () => void;
  onChangeExercise: (exId: string) => void;
  onRemoveExercise: (exId: string) => void;
  isIsometric: boolean;
  onToggleIsometric: (exId: string) => void;
  onToggleSetType: (exId: string, type: "warmup" | "working", localIdx: number) => void;
  onInputFocus: (nextFn: (() => void) | null, prevFn: (() => void) | null) => void;
  activeSetFlatIdx: number | null;
  isLocked?: boolean;
  prevSets?: string[];
  hideIndexLabel?: boolean;
  numberBadge?: number;
}

function ExerciseCard({ exercise, exIndex, totalExercises, exLog, isDark, onUpdateSet, onToggleDone, onAutoTick, onUpdateNotes, exNotes, onAddSet, onRemoveSet, onOpenReorder, onChangeExercise, onRemoveExercise, isIsometric, onToggleIsometric, onToggleSetType, onInputFocus, activeSetFlatIdx, isLocked = false, prevSets, hideIndexLabel = false, numberBadge }: ExerciseCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isKg } = useUnit();
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;
  const [editing, setEditing] = useState(false);
  const weightRefs = useRef<(TextInput | null)[]>([]);
  const repsRefs = useRef<(TextInput | null)[]>([]);
  useEffect(() => { if (isLocked && editing) setEditing(false); }, [isLocked]);

  // Flatten all sets: warmup first, then working
  const programSets = normaliseSets(exercise);
  const programWarmup = programSets.filter(s => s.type === "warmup");
  const programWorking = programSets.filter(s => s.type === "working");
  const allSets = [
    ...exLog.warmup.map((s, i) => ({ ...s, type: "warmup" as const, localIdx: i, isWarmup: true, programSet: programWarmup[i] as ProgramSet | undefined })),
    ...exLog.working.map((s, i) => ({ ...s, type: "working" as const, localIdx: i, isWarmup: false, programSet: programWorking[i] as ProgramSet | undefined })),
  ];
  const workingCounter = { count: 0 };

  const [collapsingSetIdx, setCollapsingSetIdx] = useState<number | null>(null);
  const prevSetCount = useRef(allSets.length);
  const newlyAddedIdx = allSets.length > prevSetCount.current ? allSets.length - 1 : null;
  const setRowHeight = useRef(0);
  useEffect(() => { prevSetCount.current = allSets.length; }, [allSets.length]);

  return (
    <NeuCard dark={isDark} style={styles.exCard}>
      <View style={styles.exCardInner}>

        {/* ── Header ── */}
        <View style={styles.exHeader}>
          {numberBadge != null && (
            <NeuCard dark={isDark} radius={16} style={styles.exNumBadge} innerStyle={styles.exNumInner}>
              <Text style={[styles.exNumText, { color: ACCT }]}>{numberBadge}</Text>
            </NeuCard>
          )}
          <View style={styles.exTitleBlock}>
            {!hideIndexLabel && (
              <Text style={[styles.exNumLabel, { color: t.ts }]}>EXERCISE {exIndex + 1} OF {totalExercises}</Text>
            )}
            <Text style={[styles.exName, { color: t.tp }]}>{exercise.name}</Text>
          </View>
          {!isLocked && (
            <TouchableOpacity
              onPress={() => setEditing(e => !e)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {editing ? (
                <View style={{
                  width: 22, height: 22, borderRadius: 11, backgroundColor: ACCT,
                  alignItems: "center", justifyContent: "center",
                  shadowColor: ACCT, shadowOffset: { width: 1, height: 1 }, shadowOpacity: 0.5, shadowRadius: 3,
                }}>
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
              ) : (
                <Ionicons name="ellipsis-horizontal" size={22} color={t.ts} />
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* ── Program notes ── */}
        {exercise.programNotes ? (
          <Text style={{ fontFamily: FontFamily.regular, fontSize: 13, color: t.ts, lineHeight: 19, paddingHorizontal: 2, paddingBottom: 10 }}>
            {exercise.programNotes}
          </Text>
        ) : null}

        {/* ── Column headers ── */}
        <View style={styles.colHeaderRow}>
          <Text style={[styles.colHeaderText, styles.setCol, { color: t.ts }]}>SET</Text>
          <View style={styles.prevCol}>
            <Text style={[styles.colHeaderText, { color: t.ts }]}>PREV</Text>
          </View>
          <View style={styles.inputHeaderCol}>
            <Text style={[styles.colHeaderText, { color: t.ts }]} numberOfLines={1}>WEIGHT</Text>
          </View>
          <View style={styles.inputHeaderCol}>
            <Text style={[styles.colHeaderText, { color: t.ts }]}>{isIsometric ? "HOLD" : "REPS"}</Text>
          </View>
          <View style={styles.checkCol} />
        </View>

        {/* ── Divider ── */}
        <View style={[styles.headerDivider, { backgroundColor: divider }]} />

        {/* ── Set rows ── */}
        <View>
        {allSets.map((set, flatIdx) => {
          if (!set.isWarmup) workingCounter.count += 1;
          const setLabel = set.isWarmup ? "W" : workingCounter.count;
          const isLast = flatIdx === allSets.length - 1;
          const rowIsActive = !editing && flatIdx === activeSetFlatIdx;

          return (
            <CollapsibleCard
              key={`${set.type}-${set.localIdx}`}
              isCollapsing={flatIdx === collapsingSetIdx}
              onCollapsed={() => { setCollapsingSetIdx(null); onRemoveSet(exercise.id); }}
              expanding={flatIdx === newlyAddedIdx}
              naturalHeight={flatIdx === newlyAddedIdx ? setRowHeight.current : undefined}
            >
            <SetRow isActive={rowIsActive}>
            <View
              style={styles.dataRow}
              onLayout={(flatIdx !== newlyAddedIdx && flatIdx !== collapsingSetIdx) ? e => { const h = e.nativeEvent?.layout?.height; if (h != null && h > 0) setRowHeight.current = h; } : undefined}
            >
              {/* SET label */}
              {editing ? (
                <View style={[
                  styles.setCol,
                  { alignItems: "center", justifyContent: "center" },
                ]}>
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onToggleSetType(exercise.id, set.type, set.localIdx);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.6}
                  >
                    <View style={[
                      styles.setEditBadge,
                      { borderColor: set.isWarmup ? WARMUP_ORANGE : divider },
                    ]}>
                      <Text style={[styles.setText, { color: set.isWarmup ? WARMUP_ORANGE : t.tp }]}>
                        {setLabel}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[
                  styles.setText,
                  styles.setCol,
                  { color: set.isWarmup ? WARMUP_ORANGE : t.tp },
                ]}>
                  {setLabel}
                </Text>
              )}

              {/* PREV */}
              <View style={styles.prevCol}>
                <Text style={[styles.prevText, { color: `${t.tp}66` }]} numberOfLines={1}>
                  {prevSets?.[flatIdx] ?? "—"}
                </Text>
              </View>

              {/* WEIGHT input */}
              <View style={styles.inputCell}>
                <View style={[styles.inputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderWidth: 1, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                  <TextInput
                    key={`w-${set.type}-${set.localIdx}-${set.fillKey}`}
                    ref={r => { weightRefs.current[flatIdx] = r; }}
                    style={[styles.inputBoxText, { color: isDark ? "#ffffff" : t.tp }]}
                    keyboardType="decimal-pad"
                    placeholder={set.programSet?.weightKg ? formatWeightForDisplay(set.programSet.weightKg, isKg) : "—"}
                    placeholderTextColor={`${t.tp}66`}
                    value={set.weight}
                    editable={!isLocked}
                    onFocus={() => onInputFocus(
                      () => repsRefs.current[flatIdx]?.focus(),
                      flatIdx > 0 ? () => repsRefs.current[flatIdx - 1]?.focus() : null,
                    )}
                    onChangeText={v => onUpdateSet(exercise.id, set.type, set.localIdx, "weight", v, true)}
                    onEndEditing={() => onAutoTick(exercise.id, set.type, set.localIdx)}
                    selectTextOnFocus
                  />
                </View>
              </View>

              {/* REPS input */}
              <View style={styles.inputCell}>
                <View style={[styles.inputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderWidth: 1, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                  <TextInput
                    key={`r-${set.type}-${set.localIdx}-${set.fillKey}`}
                    ref={r => { repsRefs.current[flatIdx] = r; }}
                    style={[styles.inputBoxText, { color: isDark ? "#ffffff" : t.tp }]}
                    keyboardType="decimal-pad"
                    placeholder={(() => {
                      const ps = set.programSet;
                      if (!ps) return "—";
                      if (ps.repMode === "range") {
                        const { repsMin: mn, repsMax: mx } = ps;
                        if (!mn && !mx) return "—";
                        if (mn && mx) return `${mn}–${mx}`;
                        return mn || mx || "—";
                      }
                      return ps.reps || "—";
                    })()}
                    placeholderTextColor={`${t.tp}66`}
                    value={set.reps}
                    editable={!isLocked}
                    onFocus={() => {
                      const prevFn = () => weightRefs.current[flatIdx]?.focus();
                      if (flatIdx < allSets.length - 1) {
                        onInputFocus(() => weightRefs.current[flatIdx + 1]?.focus(), prevFn);
                      } else {
                        onInputFocus(null, prevFn);
                      }
                    }}
                    onChangeText={v => onUpdateSet(exercise.id, set.type, set.localIdx, "reps", v, true)}
                    onEndEditing={() => onAutoTick(exercise.id, set.type, set.localIdx)}
                    selectTextOnFocus
                  />
                </View>
              </View>

              {/* Checkbox or remove-set button */}
              <View style={styles.checkCol}>
                {editing && isLast && allSets.length > 1 ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (collapsingSetIdx !== null || allSets.length <= 1) return;
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setCollapsingSetIdx(allSets.length - 1);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <View style={styles.removeSetBtn}>
                      <Ionicons name="remove" size={13} color="#fff" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <CheckboxCell
                    done={set.done}
                    isDark={isDark}
                    isActive={rowIsActive}
                    onToggle={isLocked ? () => {} : () => {
                      if (!set.done && !set.weight.trim() && !set.reps.trim()) {
                        const prev = prevSets?.[flatIdx];
                        if (prev && prev !== "—") {
                          const parts = prev.split("×");
                          onUpdateSet(exercise.id, set.type, set.localIdx, "weight", parts[0] ?? "");
                          onUpdateSet(exercise.id, set.type, set.localIdx, "reps", parts[1] ?? "");
                        }
                      }
                      onToggleDone(exercise.id, set.type, set.localIdx);
                    }}
                  />
                )}
              </View>
            </View>
            </SetRow>
            </CollapsibleCard>
          );
        })}
        </View>

        {/* ── Edit mode controls ── */}
        <ExpandablePanel expanded={editing} duration={500} clip>
          <>
            {/* Move row */}
            <View style={[styles.editMoveRow, { borderTopColor: divider }]}>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenReorder(); }}
                activeOpacity={0.7}
                style={styles.exReorderBtn}
                accessibilityLabel="Reorder exercises"
                accessibilityRole="button"
              >
                <DragHandleIcon color={t.ts} />
              </TouchableOpacity>
              <Text style={[styles.editMoveLabel, { color: t.ts, flex: 1 }]}>Move exercise</Text>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onAddSet(exercise.id); }}
                activeOpacity={0.8}
                style={{
                  borderRadius: 10, backgroundColor: ACCT,
                  shadowColor: ACCT, shadowOffset: { width: 2, height: 2 },
                  shadowOpacity: 0.35, shadowRadius: 4,
                  paddingVertical: 7, paddingHorizontal: 14,
                  flexDirection: "row", alignItems: "center", gap: 5,
                }}
              >
                <Ionicons name="add" size={13} color="#fff" />
                <Text style={[styles.editChipText, { color: "#fff" }]}>Add Set</Text>
              </TouchableOpacity>
            </View>

            {/* Three chip buttons */}
            <View style={styles.editChipsRow}>
              {[
                {
                  onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggleIsometric(exercise.id); },
                  icon: <Ionicons name="timer-outline" size={13} color={isIsometric ? ACCT : t.ts} />,
                  label: isIsometric ? "Hold" : "Reps",
                  color: isIsometric ? ACCT : t.ts,
                },
                {
                  onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChangeExercise(exercise.id); },
                  icon: <Ionicons name="swap-horizontal" size={13} color={t.ts} />,
                  label: "Change",
                  color: t.ts,
                },
                {
                  onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Alert.alert(
                    "Remove Exercise",
                    `Remove "${exercise.name}" from today's workout?`,
                    [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => onRemoveExercise(exercise.id) }]
                  ); },
                  icon: <TrashIcon size={13} color="#FF4D4F" />,
                  label: "Remove",
                  color: "#FF4D4F",
                },
              ].map(({ onPress, icon, label, color }) => {
                const bg = isDark ? NEU_BG_DARK : NEU_BG;
                return (
                  <TouchableOpacity key={label} onPress={onPress} activeOpacity={0.8} style={{ flex: 1 }}>
                    <View style={{
                      borderRadius: 12, backgroundColor: bg,
                      shadowColor: isDark ? "#000" : "#a3afc0",
                      shadowOffset: { width: isDark ? 0 : 4, height: isDark ? 2 : 4 },
                      shadowOpacity: isDark ? 0.35 : 0.5,
                      shadowRadius: 8,
                    }}>
                      <View style={{
                        borderRadius: 12, backgroundColor: bg,
                        shadowColor: isDark ? "transparent" : "#FFFFFF",
                        shadowOffset: { width: -3, height: -3 },
                        shadowOpacity: isDark ? 0 : 1,
                        shadowRadius: 3,
                      }}>
                        <View style={{
                          borderRadius: 12, backgroundColor: bg, overflow: "hidden",
                          paddingVertical: 10, flexDirection: "row",
                          alignItems: "center", justifyContent: "center", gap: 5,
                        }}>
                          {icon}
                          <Text style={[styles.editChipText, { color }]}>{label}</Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        </ExpandablePanel>

        {/* ── Exercise notes ── */}
        <View style={[styles.exNotesRow, { borderTopColor: divider }]}>
          <Text style={{ fontFamily: FontFamily.semibold, fontSize: 13, color: t.tp, marginBottom: 6 }}>Notes</Text>
          <TextInput
            style={[styles.exNotesInput, { color: t.tp }]}
            placeholder="Add exercise notes..."
            placeholderTextColor={t.ts}
            value={exNotes}
            editable={!isLocked}
            onChangeText={v => onUpdateNotes(exercise.id, v)}
            onFocus={() => onInputFocus(null, null)}
            multiline
            textAlignVertical="top"
          />
        </View>

      </View>
    </NeuCard>
  );
}

// Re-render a card only when ITS data changes. The parent re-renders on every
// keystroke (log state lives there), and without this every card — dozens of
// TextInputs and animated views — re-rendered per character, which is exactly
// the typing lag this fixes. Props are memo-friendly by construction: exId-first
// stable callbacks, per-exercise exLog identity, memoized prevSets arrays.
const MemoExerciseCard = React.memo(ExerciseCard);

function getActiveSetFlatIdx(exId: string, exercises: Exercise[], log: WorkoutLog): number | null {
  for (const ex of exercises) {
    const exLog = log[ex.id];
    if (!exLog) continue;
    const allDone = [...exLog.warmup, ...exLog.working].map(s => s.done);
    const firstUndone = allDone.findIndex(d => !d);
    if (firstUndone !== -1) {
      return ex.id === exId ? firstUndone : null;
    }
  }
  return null;
}

// Speech-bubble hint that floats above the round "+" add button when a workout
// has no exercises yet. Animates up + fades in on mount, then bobs gently to draw
// the eye. Purely decorative (pointerEvents none) — the + button stays tappable.
function AddExerciseHint() {
  const rise = useSharedValue(10);
  const op = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    op.value = withTiming(1, { duration: 260, easing: ReEasing.out(ReEasing.cubic) });
    rise.value = withSpring(0, { damping: 12, stiffness: 150 });
    // Seamless ping-pong bob: reverse=true plays the timing forward then backward,
    // so it eases smoothly up and down forever with no jump/reset at the loop point.
    // sin easing makes it a natural, continuous hover.
    bob.value = withDelay(
      360,
      withRepeat(
        withTiming(-5, { duration: 1100, easing: ReEasing.inOut(ReEasing.sin) }),
        -1,
        true,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateY: rise.value + bob.value }],
  }));

  return (
    <Reanimated.View style={[styles.addHintWrap, style]} pointerEvents="none">
      <View style={styles.addHintBubble}>
        <Text style={styles.addHintText} numberOfLines={1}>Add Exercises</Text>
      </View>
      <View style={styles.addHintTail} />
    </Reanimated.View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function WorkoutScreen() {
  const insets = useSafeAreaInsets();
  // Latch the bottom inset to its stable max. It never legitimately shrinks in
  // portrait, but react-native-safe-area-context can momentarily re-emit a smaller
  // value while a modal (the exercise picker) presents/dismisses — which would make
  // the pinned bottom UI (cluster, notes card, nav) jump. Latching keeps them put.
  const safeBottomRef = useRef(insets.bottom);
  if (insets.bottom > safeBottomRef.current) safeBottomRef.current = insets.bottom;
  const safeBottom = safeBottomRef.current;
  const { height: winH } = useWindowDimensions();
  const router = useRouter();
  const { isDark } = useTheme();
  const { isKg } = useUnit();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isRunning, isPaused, elapsedSeconds, startEpochMs, discardCount, startTimer, startTimerAt, pauseTimer, resumeTimer, stopTimer } = useWorkoutTimer();
  const { startRestTimer, dismissRestTimer, restEndsAt, restTotal } = useRestTimer();

  const [activeProgram, setActiveProgram] = useState<SavedProgram | null>(null);
  const [allPrograms, setAllPrograms] = useState<SavedProgram[]>([]);
  // The training day this screen is showing. Usually the calendar date, but the
  // late-night grace window (getEffectiveToday) can keep it on the previous day
  // until the early hours. Everything day-scoped here — the completed-workout
  // lookup, the scheduled template, the override/draft keys, and the date a new
  // session is stamped with — keys off this, not raw todayYMD(), so the screen
  // rolls over consistently with Home and late sessions attribute correctly.
  const [effectiveToday, setEffectiveToday] = useState<string>(() => todayYMD());
  const effectiveTodayRef = useRef(effectiveToday);
  // `programId` rides along on workoutInfo so it survives the exercise-mutation
  // setters (all spread prev) and is persisted/restored with the draft. It's the
  // program whose day this session is; undefined for a free workout not added to
  // a program → stamped as "" on the CompletedWorkout (definitively no program).
  const [workoutInfo, setWorkoutInfo] = useState<{ name: string; exercises: Exercise[]; programId?: string } | null>(null);
  const [log, setLog] = useState<WorkoutLog>({});
  // Latest committed log for reads inside the stable set-handlers below. Updated
  // in an effect (post-commit), so handlers fired from user events always see
  // fresh state without needing `log` in their deps — which would re-create
  // them every keystroke and defeat MemoExerciseCard.
  const logRef = useRef(log);
  useEffect(() => { logRef.current = log; }, [log]);
  // Which unit the live `log` weight strings are currently expressed in. The log
  // holds DISPLAY-unit strings (converted to canonical kg only at finish), so if
  // the unit toggle changes mid-session we must re-express every string in the
  // new unit — otherwise finishing would parse them in the wrong unit and
  // silently rewrite the stored kg. Seeded from the restored draft's unit; kept
  // in sync by the effect below. See [[unit-toggle-should-convert]].
  const logUnitRef = useRef(isKg);
  // Re-express the live log's weight strings when the unit toggle flips while a
  // session is in progress, keeping every load constant. logUnitRef always
  // tracks the unit the strings are in (seeded from the draft on restore), so
  // this only converts on a genuine change — never on the async unit load at
  // launch, and never double-converts a restored draft.
  useEffect(() => {
    if (logUnitRef.current === isKg) return;
    const from = logUnitRef.current;
    logUnitRef.current = isKg;
    setLog(prev => {
      let changed = false;
      const convert = (sets: SetLog[]) => sets.map(s => {
        const w = reinterpretWeightUnit(s.weight, from, isKg);
        if (w === s.weight) return s;
        changed = true;
        return { ...s, weight: w };
      });
      const next: WorkoutLog = {};
      for (const [exId, exLog] of Object.entries(prev)) {
        next[exId] = { ...exLog, warmup: convert(exLog.warmup), working: convert(exLog.working) };
      }
      return changed ? next : prev;
    });
  }, [isKg]);
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [changingExId, setChangingExId] = useState<string | null>(null);
  const [addingExercise, setAddingExercise] = useState(false);
  const [isometricExIds, setIsometricExIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  // Mount the full-screen notes overlay only while it's open (kept briefly for the
  // close animation). Leaving an always-mounted absoluteFill overlay in the tree
  // makes the bottom UI recomposite/stutter when other modals (the exercise picker)
  // dismiss over it.
  const [notesMounted, setNotesMounted] = useState(false);
  const [todaysCompletedWorkout, setTodaysCompletedWorkout] = useState<CompletedWorkout | null>(null);
  const [isFreeWorkout, setIsFreeWorkout] = useState(false);
  const [freeWorkoutAddToProgram, setFreeWorkoutAddToProgram] = useState(false);
  const [workoutOptionsOpen, setWorkoutOptionsOpen] = useState(false);
  const [changeDayOpen, setChangeDayOpen] = useState(false);
  const [customWorkoutNamingOpen, setCustomWorkoutNamingOpen] = useState(false);
  // Workout-complete confirmation sheet (replaces the native finish alert).
  // `pendingComplete` is the in-memory CompletedWorkout captured at Finish; the
  // sheet lets the user adjust its start/end times before it's persisted.
  const [completeSheetOpen, setCompleteSheetOpen] = useState(false);
  const [pendingComplete, setPendingComplete] = useState<CompletedWorkout | null>(null);
  // Post-finish celebratory stats carousel, shown over the locked completed
  // view. Transient — not persisted, so it only appears right after Finish.
  const [summaryWorkout, setSummaryWorkout] = useState<CompletedWorkout | null>(null);
  const [focusMode, setFocusModeState] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  // Auto-fill sets (Settings toggle): typing a value fills the not-yet-done
  // sets below it. Re-read on focus alongside the view mode.
  const [autofillSets, setAutofillSets] = useState(false);
  // Lock-screen Live Activity (Settings toggle, ON by default — any stored
  // value other than "0" counts as enabled). Re-read on focus like the above.
  const [liveActivityEnabled, setLiveActivityEnabled] = useState(true);
  const setFocusMode = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setFocusModeState(prev => {
      const v = typeof next === "function" ? (next as (p: boolean) => boolean)(prev) : next;
      AsyncStorage.setItem(WORKOUT_VIEW_MODE_KEY, v ? "focus" : "list")
        .catch((e) => warnStorage("setItem", WORKOUT_VIEW_MODE_KEY, e));
      return v;
    });
  }, []);
  const scrollRef = useRef<ScrollView>(null);
  const sessionNotesInputRef = useRef<TextInput | null>(null);

  const lockedData = useMemo(() => {
    if (!todaysCompletedWorkout) return null;
    const exercises = todaysCompletedWorkout.exercises.map((ex, i) => ({
      id: `locked_${i}`,
      name: ex.name,
      sets: [] as ProgramSet[],
    }));
    const lockedLog: WorkoutLog = {};
    // Stored weights are canonical kg → show them in the user's unit.
    todaysCompletedWorkout.exercises.forEach((ex, i) => {
      lockedLog[`locked_${i}`] = {
        warmup: ex.sets.filter(s => s.type === "warmup").map(s => ({ weight: formatWeightForDisplay(s.weight, isKg), reps: s.reps, done: s.done, fillKey: 0 })),
        working: ex.sets.filter(s => s.type === "working").map(s => ({ weight: formatWeightForDisplay(s.weight, isKg), reps: s.reps, done: s.done, fillKey: 0 })),
        notes: ex.notes,
      };
    });
    return { exercises, log: lockedLog };
  }, [todaysCompletedWorkout, isKg]);

  // ── Timer modal ──────────────────────────────────────────────────────────────
  // The interval Timer / Stopwatch and all its state live in <IntervalTimerModal/>;
  // this screen only owns whether it's open.
  const [showTimerModal, setShowTimerModal] = useState(false);
  // Floating Session Notes card animation (0 = hidden/in-button, 1 = shown), driven
  // by showNotes. The card scales from its bottom-left corner (transformOrigin set in
  // styles.notesFloatCard) while sliding down toward the Session Notes button, so it
  // looks pulled out of / sucked back into that button. `notesKbShift` lifts the card
  // above the keyboard as a separate animated offset (so closing never jumps).
  const notesAnim = useSharedValue(0);
  const notesKbShift = useSharedValue(0);
  const notesCardStyle = useAnimatedStyle(() => {
    const v = notesAnim.value;
    return {
      opacity: Math.min(1, v * 1.6),
      transform: [
        { translateY: notesKbShift.value + (1 - v) * 48 },
        { scale: 0.3 + v * 0.7 },
      ],
    };
  });
  const notesBackdropStyle = useAnimatedStyle(() => ({ opacity: notesAnim.value * 0.5 }));

  const pendingChangingExId = useRef<string | null>(null);
  const isWorkoutActiveRef = useRef(false);
  // Draft persistence — survives full app exit so sets/notes/exercise edits aren't lost.
  // Held in a ref so it can short-circuit loadData's reset even when log is still empty
  // (e.g. user reordered or added an exercise but hasn't ticked any sets yet).
  const draftLockedRef = useRef(false);
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    isWorkoutActiveRef.current = draftLockedRef.current || isRunning || hasWorkoutProgress(log);
  }, [isRunning, log]);

  const loadData = useCallback((forceReload = false) => {
    // Program, history and override are read together so the effective training
    // day (which depends on all three) is computed from one consistent snapshot.
    Promise.all([
      AsyncStorage.getItem(PROGRAMS_KEY),
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY),
      AsyncStorage.getItem(WORKOUT_DAY_OVERRIDE_KEY),
    ]).then(([progRaw, histRaw, overrideRaw]) => {
      const programs: SavedProgram[] = progRaw ? JSON.parse(progRaw) : [];
      const found = programs.find(p => p.status === "active") ?? null;
      const history: CompletedWorkout[] = histRaw ? JSON.parse(histRaw) : [];
      const override = overrideRaw ? (JSON.parse(overrideRaw) as DayOverride) : null;

      const effective = getEffectiveToday(found, history);
      effectiveTodayRef.current = effective;
      setEffectiveToday(effective);
      setActiveProgram(found);
      setAllPrograms(programs);

      // Completed-workout lookup always refreshes (this is what was going stale
      // across midnight): a session counts as "today's" only if it's dated the
      // current effective day.
      setTodaysCompletedWorkout(history.find(w => w.date === effective) ?? null);
      setPrevHistory(history);

      // Re-resolve the scheduled template unless a live session is in progress
      // (don't clobber a workout the user is mid-way through). A just-finished
      // session is no longer "in progress" — finalizeComplete clears the log —
      // so this correctly advances to the new day after a completion.
      if (found && (!isWorkoutActiveRef.current || forceReload)) {
        // Pass the full program list so a change-day override that picked a day
        // from a NON-active program re-resolves to that program's exercises.
        const workout = resolveWorkoutForDate(found, override, effective, programs);
        setWorkoutInfo(workout ? { name: workout.name, exercises: workout.exercises, programId: workout.programId } : null);
        if (workout) {
          setIsometricExIds(new Set(workout.exercises.filter(e => e.isIsometric).map(e => e.id)));
          setLog(initLog(workout.exercises));
        }
      }
    }).catch((e) => warnStorage("getItem", PROGRAMS_KEY, e));

    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setCustomExercises(parsed as CustomExercise[]);
    }).catch((e) => warnStorage("getItem", CUSTOM_KEY, e));
  }, []);

  // Restore an in-progress workout draft (if any) before loadData runs, so the
  // template loader doesn't clobber a workout the user was mid-way through.
  useEffect(() => {
    // Program + history are read alongside the draft so the draft's day can be
    // matched against the *effective* training day, not the raw calendar date —
    // otherwise an in-progress late-night session's draft would be discarded the
    // moment the clock ticks past midnight.
    Promise.all([
      AsyncStorage.getItem(WORKOUT_DRAFT_KEY),
      AsyncStorage.getItem(PROGRAMS_KEY),
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY),
    ]).then(([raw, progRaw, histRaw]) => {
      if (raw) {
        try {
          const draft = JSON.parse(raw);
          const programs: SavedProgram[] = progRaw ? JSON.parse(progRaw) : [];
          const found = programs.find(p => p.status === "active") ?? null;
          const history: CompletedWorkout[] = histRaw ? JSON.parse(histRaw) : [];
          const effective = getEffectiveToday(found, history);
          effectiveTodayRef.current = effective;
          if (draft?.date === effective && draft.workoutInfo && draft.log) {
            setWorkoutInfo(draft.workoutInfo);
            // The draft's weight strings are in the unit that was active when it
            // was saved; record it so a later unit toggle converts correctly.
            // Legacy drafts (pre-unitIsKg) are same-day and predate this — leave
            // the ref at its mount value (current unit), matching an untoggled user.
            if (typeof draft.unitIsKg === "boolean") logUnitRef.current = draft.unitIsKg;
            setLog(draft.log);
            setIsometricExIds(new Set(draft.isometricExIds ?? []));
            setNotes(draft.notes ?? "");
            // Note: the card's open/closed state (showNotes) is intentionally NOT
            // restored — a session always starts with the card closed (button
            // visible). Only the text is restored; re-opening the card re-arms it
            // for the journal, consistent with "saved only if the card is kept".
            setIsFreeWorkout(!!draft.isFreeWorkout);
            setFreeWorkoutAddToProgram(!!draft.freeWorkoutAddToProgram);
            draftLockedRef.current = true;
            isWorkoutActiveRef.current = true;
          } else {
            // Stale draft from a previous day — discard
            AsyncStorage.removeItem(WORKOUT_DRAFT_KEY).catch((e) => warnStorage("removeItem", WORKOUT_DRAFT_KEY, e));
          }
        } catch (e) {
          warnStorage("parse", WORKOUT_DRAFT_KEY, e);
          AsyncStorage.removeItem(WORKOUT_DRAFT_KEY).catch((err) => warnStorage("removeItem", WORKOUT_DRAFT_KEY, err));
        }
      }
      setDraftRestored(true);
    }).catch((e) => { warnStorage("getItem", WORKOUT_DRAFT_KEY, e); setDraftRestored(true); });
  }, []);

  // Pre-load on mount so data is ready before user navigates here
  useEffect(() => { if (draftRestored) loadData(); }, [draftRestored, loadData]);

  // React to discard triggered from the global WorkoutActiveBar (another tab)
  const prevDiscardCount = useRef(0);
  useEffect(() => {
    if (discardCount > 0 && discardCount !== prevDiscardCount.current) {
      prevDiscardCount.current = discardCount;
      dismissRestTimer();
      setIsFreeWorkout(false);
      setFreeWorkoutAddToProgram(false);
      draftLockedRef.current = false;
      loadData(true);
    }
  }, [discardCount, dismissRestTimer, loadData]);

  useFocusEffect(useCallback(() => {
    if (draftRestored) loadData();

    // Re-read the workout view-mode preference so a change made in Settings (the
    // tab stays mounted, so the one-time mount load below won't pick it up).
    AsyncStorage.getItem(WORKOUT_VIEW_MODE_KEY)
      .then(v => setFocusModeState(v === "focus"))
      .catch((e) => warnStorage("getItem", WORKOUT_VIEW_MODE_KEY, e));

    // Same for the auto-fill-sets preference (Settings toggle, off by default).
    AsyncStorage.getItem(WORKOUT_AUTOFILL_KEY)
      .then(v => setAutofillSets(v === "1"))
      .catch((e) => warnStorage("getItem", WORKOUT_AUTOFILL_KEY, e));

    // And the lock-screen Live Activity preference (Settings toggle, ON by default).
    AsyncStorage.getItem(LIVE_ACTIVITY_KEY)
      .then(v => setLiveActivityEnabled(v !== "0"))
      .catch((e) => warnStorage("getItem", LIVE_ACTIVITY_KEY, e));

    if (pendingChangingExId.current) {
      setChangingExId(pendingChangingExId.current);
      pendingChangingExId.current = null;
    }
  }, [loadData, draftRestored]));

  // Re-resolve when the training day rolls over while this screen is mounted
  // (midnight / 3am grace cutoff) or when the app returns from the background —
  // neither fires useFocusEffect, so without this the completed-workout view and
  // scheduled day stay frozen on yesterday.
  useDayRollover(useCallback(() => { if (draftRestored) loadData(); }, [loadData, draftRestored]));

  // Debounced draft writer. The autosave effect below runs on every keystroke;
  // stringifying + writing the whole draft each time was measurable typing lag,
  // so state lands in pendingDraftRef immediately and the expensive
  // JSON.stringify + AsyncStorage.setItem coalesces to one write ~400ms after
  // the last change. flushDraft() runs the pending write NOW — called when the
  // app backgrounds so a swipe-kill can't lose more than the debounce window.
  const pendingDraftRef = useRef<object | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDraft = useCallback(() => {
    if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null; }
    const payload = pendingDraftRef.current;
    if (!payload) return;
    pendingDraftRef.current = null;
    AsyncStorage.setItem(WORKOUT_DRAFT_KEY, JSON.stringify(payload))
      .catch((e) => warnStorage("setItem", WORKOUT_DRAFT_KEY, e));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") flushDraft();
    });
    return () => { sub.remove(); flushDraft(); };
  }, [flushDraft]);

  // Autosave draft on any change after restoration. Skip while a completed workout
  // is shown (nothing to save), and skip the empty pre-start baseline (saving only
  // when the user has actually engaged: running timer, real progress, or notes).
  useEffect(() => {
    if (!draftRestored) return;
    if (!workoutInfo) return;
    if (todaysCompletedWorkout) return;
    const hasContent =
      isRunning || hasWorkoutProgress(log) || notes.trim().length > 0 || isFreeWorkout;
    if (!hasContent && !draftLockedRef.current) return;
    draftLockedRef.current = true;
    isWorkoutActiveRef.current = true;
    pendingDraftRef.current = {
      date: effectiveTodayRef.current,
      workoutInfo,
      log,
      // The unit `log`'s weight strings are in, so a restore after a unit toggle
      // (or on another day) re-expresses them correctly instead of reinterpreting.
      unitIsKg: logUnitRef.current,
      isometricExIds: Array.from(isometricExIds),
      notes,
      isFreeWorkout,
      freeWorkoutAddToProgram,
    };
    if (!draftTimerRef.current) {
      draftTimerRef.current = setTimeout(() => { draftTimerRef.current = null; flushDraft(); }, 400);
    }
  }, [draftRestored, todaysCompletedWorkout, isRunning, workoutInfo, log, isometricExIds, notes, isFreeWorkout, freeWorkoutAddToProgram, isKg, flushDraft]);

  const clearDraft = useCallback(() => {
    draftLockedRef.current = false;
    // Drop any queued write too — a debounced save landing AFTER the clear
    // would resurrect the draft the user just finished/discarded.
    if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null; }
    pendingDraftRef.current = null;
    AsyncStorage.removeItem(WORKOUT_DRAFT_KEY).catch((e) => warnStorage("removeItem", WORKOUT_DRAFT_KEY, e));
  }, []);

  // `cascade` is true only for TYPED input (onChangeText). Programmatic fills
  // (the checkbox's copy-from-prev) stay single-set, or ticking one empty set
  // would overwrite the sets below with that set's prev values.
  const updateSet = useCallback((exId: string, type: "warmup" | "working", idx: number, field: "weight" | "reps", value: string, cascade = false) => {
    const fillDown = cascade && autofillSets;
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      if (!fillDown) {
        const sets = [...exLog[type]];
        sets[idx] = { ...sets[idx], [field]: value };
        return { ...prev, [exId]: { ...exLog, [type]: sets } };
      }
      // Auto-fill: the typed value applies to this set and every set below it
      // in the flat warmup→working order (a warmup entry fills the working
      // sets too, matching the builder and log-workout). Unlike those bulk
      // flows, sets already ticked done hold real logged performance, so they
      // are never overwritten — and filled sets are NOT auto-ticked; each set
      // still completes via its own checkbox / blur auto-tick.
      const fillFrom = (sets: SetLog[], from: number) =>
        sets.map((s, i) => (i === from || (i > from && !s.done)) ? { ...s, [field]: value } : s);
      const fillAll = (sets: SetLog[]) =>
        sets.map(s => s.done ? s : { ...s, [field]: value });
      if (type === "warmup") {
        return { ...prev, [exId]: { ...exLog, warmup: fillFrom(exLog.warmup, idx), working: fillAll(exLog.working) } };
      }
      return { ...prev, [exId]: { ...exLog, working: fillFrom(exLog.working, idx) } };
    });
  }, [autofillSets]);

  // True if marking this one set done would complete the whole workout (every
  // set of every exercise done). Used to suppress the post-set rest timer on the
  // final set — the workout is over, so there's nothing left to rest for.
  const wouldCompleteWorkout = useCallback((exId: string, type: "warmup" | "working", idx: number): boolean => {
    const log = logRef.current;
    if (!workoutInfo || workoutInfo.exercises.length === 0) return false;
    return workoutInfo.exercises.every((ex: Exercise) => {
      const exLog = log[ex.id];
      if (!exLog) return false;
      const warmupDone = exLog.warmup.every((s, i) => (ex.id === exId && type === "warmup" && i === idx) || s.done);
      const workingDone = exLog.working.every((s, i) => (ex.id === exId && type === "working" && i === idx) || s.done);
      return warmupDone && workingDone;
    });
  }, [workoutInfo]);

  // Start the rest timer after completing a set — unless that set completed the
  // whole workout, in which case clear any running timer instead.
  const startRestAfterSet = useCallback((exId: string, type: "warmup" | "working", idx: number) => {
    if (wouldCompleteWorkout(exId, type, idx)) {
      dismissRestTimer();
      return;
    }
    startRestTimer(workoutInfo?.exercises.find(e => e.id === exId)?.restSeconds ?? 0);
  }, [wouldCompleteWorkout, dismissRestTimer, startRestTimer, workoutInfo]);

  const autoTickIfComplete = useCallback((exId: string, type: "warmup" | "working", idx: number) => {
    const cur = logRef.current[exId]?.[type]?.[idx];
    const willTick = !!cur && !cur.done && !!cur.weight.trim() && !!cur.reps.trim();
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      const set = exLog[type][idx];
      if (!set.done && set.weight.trim() && set.reps.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const sets = [...exLog[type]];
        sets[idx] = { ...set, done: true };
        return { ...prev, [exId]: { ...exLog, [type]: sets } };
      }
      return prev;
    });
    if (willTick) {
      startTimer();
      startRestAfterSet(exId, type, idx);
    }
  }, [startTimer, startRestAfterSet]);

  const toggleDone = useCallback((exId: string, type: "warmup" | "working", idx: number) => {
    const becomingDone = !logRef.current[exId]?.[type]?.[idx]?.done;
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      const sets = [...exLog[type]];
      sets[idx] = { ...sets[idx], done: !sets[idx].done };
      return { ...prev, [exId]: { ...exLog, [type]: sets } };
    });
    startTimer();
    if (becomingDone) startRestAfterSet(exId, type, idx);
  }, [startTimer, startRestAfterSet]);

  const addSet = useCallback((exId: string) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      return { ...prev, [exId]: { ...exLog, working: [...exLog.working, makeSet()] } };
    });
  }, []);

  const toggleSetType = useCallback((exId: string, type: "warmup" | "working", localIdx: number) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      if (type === "warmup") {
        // Warmup → working: restore to original position (clamped to current working length)
        const set = exLog.warmup[localIdx];
        const insertAt = Math.min(set.originWorkingIdx ?? 0, exLog.working.length);
        const newWorking = [...exLog.working];
        newWorking.splice(insertAt, 0, { ...set, originWorkingIdx: undefined });
        return { ...prev, [exId]: {
          ...exLog,
          warmup: exLog.warmup.filter((_, i) => i !== localIdx),
          working: newWorking,
        }};
      } else {
        // Working → warmup: store original position, append to end of warmup
        if (exLog.working.length <= 1) return prev;
        const set = exLog.working[localIdx];
        return { ...prev, [exId]: {
          ...exLog,
          working: exLog.working.filter((_, i) => i !== localIdx),
          warmup: [...exLog.warmup, { ...set, originWorkingIdx: localIdx }],
        }};
      }
    });
  }, []);

  const removeSet = useCallback((exId: string) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      // Remove last working set; if none, remove last warmup set
      if (exLog.working.length > 0) {
        return { ...prev, [exId]: { ...exLog, working: exLog.working.slice(0, -1) } };
      }
      if (exLog.warmup.length > 1) {
        return { ...prev, [exId]: { ...exLog, warmup: exLog.warmup.slice(0, -1) } };
      }
      return prev;
    });
  }, []);

  const updateExNotes = useCallback((exId: string, notes: string) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      return { ...prev, [exId]: { ...exLog, notes } };
    });
  }, []);

  const changeExercise = (exId: string, newName: string) => {
    setWorkoutInfo(prev => prev ? {
      ...prev,
      exercises: prev.exercises.map(e => e.id === exId ? { ...e, name: newName } : e),
    } : prev);
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      return { ...prev, [exId]: { warmup: exLog.warmup.map(() => makeSet()), working: exLog.working.map(() => makeSet()), notes: "" } };
    });
  };

  const removeExercise = (exId: string) => {
    setWorkoutInfo(prev => prev ? { ...prev, exercises: prev.exercises.filter(e => e.id !== exId) } : prev);
    setLog(prev => { const next = { ...prev }; delete next[exId]; return next; });
    setCollapsingIds(prev => { const next = new Set(prev); next.delete(exId); return next; });
  };

  const [collapsingIds, setCollapsingIds] = useState<Set<string>>(new Set());
  const startCollapse = useCallback((exId: string) => setCollapsingIds(prev => new Set(prev).add(exId)), []);
  // Stable card-callback identities for MemoExerciseCard (inline closures at the
  // render site would re-create per keystroke and defeat the memo).
  const openReorder = useCallback(() => setReorderOpen(true), []);
  const openChangeExercise = useCallback((exId: string) => setChangingExId(exId), []);
  const toggleIsometricEx = useCallback((exId: string) => setIsometricExIds(prev => {
    const next = new Set(prev);
    if (next.has(exId)) next.delete(exId);
    else next.add(exId);
    return next;
  }), []);

  const [reorderOpen, setReorderOpen] = useState(false);
  const reorderExercises = useCallback((exercises: Exercise[]) => {
    setWorkoutInfo(prev => prev ? { ...prev, exercises } : prev);
  }, []);

  const openCustomWorkoutNaming = () => {
    setCustomWorkoutNamingOpen(true);
    setWorkoutOptionsOpen(false);
  };

  const confirmCustomWorkout = (name: string, addToProgram: boolean) => {
    setFreeWorkoutAddToProgram(addToProgram);
    setIsFreeWorkout(true);
    // A free workout only belongs to a program when the user opts to add it.
    setWorkoutInfo({ name, exercises: [], programId: addToProgram ? activeProgram?.id : undefined });
    // Clean slate: a custom workout always starts with no exercises so the user
    // adds their own. Also wipe any leftover log / isometric flags / notes / draft
    // from a just-finished workout or a program session we're switching away from,
    // so nothing carries over into the fresh session.
    setLog({});
    setIsometricExIds(new Set());
    setNotes("");
    clearDraft();
    AsyncStorage.setItem(WORKOUT_DAY_OVERRIDE_KEY, JSON.stringify({ date: effectiveTodayRef.current, workoutName: name }))
      .catch((e) => warnStorage("setItem", WORKOUT_DAY_OVERRIDE_KEY, e));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCustomWorkoutNamingOpen(false);
  };

  // Change-day picker selection (shared by the rest-day and active-workout
  // renders). A "Rest" selection clears the workout so the rest screen shows;
  // resolveWorkoutForDate maps the stored "Rest" override back to null on reload.
  const handleSelectDay = useCallback((dayName: string, fromProgram?: SavedProgram) => {
    setIsFreeWorkout(false);
    setFreeWorkoutAddToProgram(false);
    let override: DayOverride = { date: effectiveTodayRef.current, workoutName: dayName };
    if (dayName === "Rest") {
      setWorkoutInfo(null);
      setLog({});
    } else {
      const src = fromProgram ?? activeProgram;
      const dayIndex = src?.cyclePattern.indexOf(dayName) ?? -1;
      const exercises = src?.workouts[`${dayIndex}:${dayName}`] ?? [];
      setWorkoutInfo({ name: dayName, exercises, programId: src?.id });
      setLog(initLog(exercises));
      // Record the source program so re-resolution (tab refocus / relaunch)
      // restores THIS program's exercises, not the active program's.
      override = { ...override, programId: src?.id };
    }
    AsyncStorage.setItem(WORKOUT_DAY_OVERRIDE_KEY, JSON.stringify(override))
      .catch((e) => warnStorage("setItem", WORKOUT_DAY_OVERRIDE_KEY, e));
    setChangeDayOpen(false);
  }, [activeProgram]);

  const addExercise = (name: string, idOffset = 0) => {
    const id = `session_${Date.now() + idOffset}`;
    const ex: Exercise = { id, name, sets: Array.from({ length: 3 }, () => ({ type: "working" as const })) };
    setWorkoutInfo(prev => prev ? { ...prev, exercises: [...prev.exercises, ex] } : prev);
    setLog(prev => ({ ...prev, [id]: { warmup: [], working: [makeSet(), makeSet(), makeSet()], notes: "" } }));
    setAddingExercise(false);
  };

  const allDone = !!workoutInfo && workoutInfo.exercises.length > 0 &&
    workoutInfo.exercises.every((ex: Exercise) => {
      const exLog = log[ex.id];
      if (!exLog) return false;
      return [...exLog.warmup, ...exLog.working].every(s => s.done);
    });

  // Build the in-memory CompletedWorkout from current state. Pure — no I/O.
  const buildCompletedWorkout = (): CompletedWorkout | null => {
    if (!workoutInfo) return null;
    const d = new Date();
    // Stamp the effective training day, not the raw calendar date, so a session
    // finished in the small hours attributes to the day it belongs to (and stays
    // consistent with the schedule the user was shown).
    const ds = effectiveTodayRef.current;
    const trimmedNotes = notes.trim();
    return {
      id: `workout_${Date.now()}`,
      date: ds,
      completedAt: d.toISOString(),
      workoutName: workoutInfo.name,
      // "" (not undefined) marks a definitive "no program" so the Progress page
      // never treats a free workout as a legacy record to attribute by name.
      programId: workoutInfo.programId ?? "",
      durationSeconds: elapsedSeconds,
      // sessionNotes always saves whatever text was written — opening, leaving
      // open, or ticking the notes card all persist it. It's only dropped when
      // the text is cleared (the card's open/closed state no longer gates this).
      sessionNotes: trimmedNotes ? notes : undefined,
      exercises: workoutInfo.exercises.map(ex => {
        const exLog = log[ex.id];
        return {
          name: ex.name,
          // Live log holds the user's typed display units → store canonical kg.
          sets: [
            ...(exLog?.warmup  ?? []).map(s => ({ type: "warmup"  as const, weight: parseWeightToKg(s.weight, isKg), reps: s.reps, done: s.done })),
            ...(exLog?.working ?? []).map(s => ({ type: "working" as const, weight: parseWeightToKg(s.weight, isKg), reps: s.reps, done: s.done })),
          ],
          notes: exLog?.notes ?? "",
        };
      }),
    };
  };

  // Persist a completed workout to AsyncStorage with sequential awaits so
  // rapid back-to-back finishes (or any concurrent writer) can't interleave
  // the read→write pair and lose data. Also refreshes prevByName from the
  // newly-written history.
  const persistCompletedWorkout = async (completed: CompletedWorkout) => {
    try {
      const datesRaw = await AsyncStorage.getItem(WORKOUT_DATES_KEY);
      const dates: string[] = datesRaw ? JSON.parse(datesRaw) : [];
      if (!dates.includes(completed.date)) {
        await AsyncStorage.setItem(WORKOUT_DATES_KEY, JSON.stringify([...dates, completed.date]));
      }
      const histRaw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
      const history: CompletedWorkout[] = histRaw ? JSON.parse(histRaw) : [];
      const newHistory = [completed, ...history];
      await AsyncStorage.setItem(WORKOUT_HISTORY_KEY, JSON.stringify(newHistory));
      // Keep prev-set suggestions correct for any same-session discard → restart.
      setPrevHistory(newHistory);
      scheduleCloudPush();
    } catch (e) {
      warnStorage("persistCompletedWorkout", WORKOUT_HISTORY_KEY, e);
    }
  };

  // Commit a (time-adjusted) completed workout: flip to the locked view, persist
  // in the background, optionally attach a free workout to the active program,
  // then tear down the live session. Mirrors the old finish-alert "Done" path.
  const finalizeComplete = (completed: CompletedWorkout) => {
    // Show the locked completed view synchronously so the UI flips on the same
    // tick — persistence runs in the background.
    setTodaysCompletedWorkout(completed);
    setSummaryWorkout(completed);
    void persistCompletedWorkout(completed);
    if (isFreeWorkout && freeWorkoutAddToProgram && activeProgram && workoutInfo) {
      AsyncStorage.getItem(PROGRAMS_KEY).then(raw => {
        const progs: SavedProgram[] = raw ? JSON.parse(raw) : [];
        const updated = progs.map(p => {
          if (p.id !== activeProgram.id) return p;
          const extras = p.extraWorkouts ?? [];
          if (extras.includes(workoutInfo.name)) return p;
          return { ...p, extraWorkouts: [...extras, workoutInfo.name] };
        });
        AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated))
          .catch((e) => warnStorage("setItem", PROGRAMS_KEY, e));
      }).catch((e) => warnStorage("getItem", PROGRAMS_KEY, e));
    }
    if (isFreeWorkout) {
      // A finished custom workout shouldn't leave its name as a day-override —
      // otherwise the page could resurface that (now empty) custom day instead of
      // the program's scheduled workout. The completed view renders from history,
      // and the next custom workout starts fresh via confirmCustomWorkout.
      AsyncStorage.removeItem(WORKOUT_DAY_OVERRIDE_KEY).catch((e) => warnStorage("removeItem", WORKOUT_DAY_OVERRIDE_KEY, e));
    }
    stopTimer();
    // A rest countdown started before Finish (e.g. "Finish Anyway" mid-rest)
    // must not keep running over the locked completed view.
    dismissRestTimer();
    setIsFreeWorkout(false);
    setFreeWorkoutAddToProgram(false);
    // Tear down the live session so it's no longer counted as "in progress"
    // (the locked view renders from todaysCompletedWorkout, not from `log`).
    // Without this the leftover log keeps isWorkoutActiveRef true, which would
    // stop loadData from advancing to the next day after the date rolls over.
    setLog({});
    setNotes("");
    setIsometricExIds(new Set());
    isWorkoutActiveRef.current = false;
    clearDraft();
  };

  const handleFinish = () => {
    // Capture the session in memory (end = now, duration = live timer) and open
    // our completion sheet so the user can confirm / adjust the times.
    const doFinish = () => {
      const c = buildCompletedWorkout();
      if (!c) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPendingComplete(c);
      setCompleteSheetOpen(true);
    };

    if (!allDone) {
      Alert.alert(
        "Incomplete Sets",
        "You haven't ticked off all your sets. Finish anyway?",
        [
          { text: "Go Back", style: "cancel" },
          { text: "Finish Anyway", onPress: doFinish },
        ]
      );
    } else {
      doFinish();
    }
  };

  const handleDiscard = () => {
    Alert.alert("Discard Workout", "All progress will be lost. Are you sure?", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard", style: "destructive",
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          stopTimer();
          dismissRestTimer();
          setIsFreeWorkout(false);
          setFreeWorkoutAddToProgram(false);
          clearDraft();
          loadData(true);
        },
      },
    ]);
  };

  const handleDiscardCompleted = () => {
    Alert.alert(
      "Discard Workout",
      "Today's logged workout will be deleted. You can start fresh.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete & Redo", style: "destructive",
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            const targetId = todaysCompletedWorkout?.id;
            // Clean up workout_dates for the deleted session's own day, not for
            // "now" — they can differ for a late-night session.
            const targetDate = todaysCompletedWorkout?.date ?? effectiveTodayRef.current;
            // Serialize the read→write pairs with sequential awaits (the contract
            // for mutating shared keys — mirrors persistCompletedWorkout and the
            // workout-detail delete). The UI teardown below stays synchronous so
            // the view flips instantly while this commits in the background.
            void (async () => {
              try {
                const raw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
                const history: CompletedWorkout[] = raw ? JSON.parse(raw) : [];
                const updated = history.filter(w => w.id !== targetId);
                await AsyncStorage.setItem(WORKOUT_HISTORY_KEY, JSON.stringify(updated));
                if (!updated.some(w => w.date === targetDate)) {
                  const raw2 = await AsyncStorage.getItem(WORKOUT_DATES_KEY);
                  const dates: string[] = raw2 ? JSON.parse(raw2) : [];
                  await AsyncStorage.setItem(WORKOUT_DATES_KEY, JSON.stringify(dates.filter(d => d !== targetDate)));
                }
                // Rebuild prev-set suggestions from the post-delete history so the
                // fresh log doesn't keep surfacing the deleted session's numbers as
                // "previous" (persistCompletedWorkout had set them on finish).
                setPrevHistory(updated);
                scheduleCloudPush();
              } catch (e) {
                warnStorage("handleDiscardCompleted", WORKOUT_HISTORY_KEY, e);
              }
            })();
            setTodaysCompletedWorkout(null);
            if (workoutInfo) setLog(initLog(workoutInfo.exercises));
            stopTimer();
            clearDraft();
          },
        },
      ]
    );
  };

  const deleteCustomExercise = (exName: string) => {
    const next = customExercises.filter(e => e.name !== exName);
    setCustomExercises(next);
    AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
      .then(() => scheduleCloudPush())
      .catch((e) => warnStorage("setItem", CUSTOM_KEY, e));
  };

  // Previous-set suggestions derive from history + the CURRENT day name, so an
  // exercise programmed on two days (e.g. Lateral Raise on Push and on Arms)
  // suggests that day's last numbers, not wherever it last appeared. Deriving
  // (rather than storing the built map) keeps it correct when the day changes
  // mid-screen — change-day override, free workout, day rollover.
  const [prevHistory, setPrevHistory] = useState<CompletedWorkout[]>([]);
  const prevByName = useMemo(
    () => buildPrevByName(prevHistory, undefined, workoutInfo?.name),
    [prevHistory, workoutInfo],
  );
  // Pre-formatted "prev" hint strings per normalized exercise name. Memoized so
  // each card's `prevSets` prop keeps its identity across keystrokes (a fresh
  // .map() per render would re-render every MemoExerciseCard every character).
  const prevHintsByName = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [name, sets] of Object.entries(prevByName)) {
      out[name] = sets.map(p => formatPrevHint(p, isKg));
    }
    return out;
  }, [prevByName, isKg]);
  const [kbHeight, setKbHeight] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const nextFnRef = useRef<(() => void) | null>(null);
  const prevFnRef = useRef<(() => void) | null>(null);
  const handleInputFocus = useCallback((fn: (() => void) | null, prevFn: (() => void) | null = null) => {
    nextFnRef.current = fn;
    prevFnRef.current = prevFn;
    setHasNext(fn !== null);
    setHasPrev(prevFn !== null);
  }, []);

  // ── Lock-screen Live Activity ─────────────────────────────────────────────
  // Same gate as the draft autosave: once the user has engaged with today's
  // session, project it onto the iOS lock screen / Dynamic Island (dev and
  // production builds only — silently inert in Expo Go). Lock-screen ticks and
  // rest changes made while the app was backgrounded replay into the log and
  // timers on foreground via the two appliers below.
  const sessionActiveForActivity =
    !!workoutInfo && !todaysCompletedWorkout &&
    (isRunning || isPaused || hasWorkoutProgress(log) || isFreeWorkout || notes.trim().length > 0);

  const liveActivityPayload = useMemo(() => {
    if (!workoutInfo || todaysCompletedWorkout) return null;
    return buildLiveActivityPayload({
      workoutName: workoutInfo.name,
      exercises: workoutInfo.exercises.map(e => ({ id: e.id, name: e.name, restSeconds: e.restSeconds })),
      log,
      // Exactly the prevSets lookup ExerciseCard feeds its checkboxes.
      prevHintsFor: name => prevHintsByName[normalizeExerciseName(name)] ?? EMPTY_PREV,
      isKg,
      timerStartMs: startEpochMs,
      pausedElapsedSec: isPaused ? elapsedSeconds : 0,
      restEndsAt,
      restTotalSec: restTotal,
    });
  }, [workoutInfo, todaysCompletedWorkout, log, prevHintsByName, isKg, startEpochMs, isPaused, elapsedSeconds, restEndsAt, restTotal]);

  const applyLockScreenTicks = useCallback((actions: LiveActivityTickAction[]) => {
    setLog(prev => {
      let next = prev;
      for (const a of actions) {
        const exLog = next[a.exId];
        const sets = exLog?.[a.setType];
        const set = sets?.[a.setIdx];
        if (!exLog || !sets || !set || set.done) continue;
        const updated = [...sets];
        // Tick only — unlike the in-app checkbox, a lock-screen tick never
        // writes numbers. Whatever the user typed before locking stays; an
        // empty set comes back ticked-but-empty for them to fill in after
        // unlocking (the card's weight×reps preview is guidance only).
        updated[a.setIdx] = { ...set, done: true };
        next = { ...next, [a.exId]: { ...exLog, [a.setType]: updated } };
      }
      return next;
    });
    // In-app ticks start the workout timer; anchor to when the first
    // lock-screen tick actually happened, not to this reconciliation moment.
    if (actions.length > 0 && !isRunning && !isPaused) startTimerAt(actions[0].ts);
  }, [isRunning, isPaused, startTimerAt]);

  const applyLockScreenRest = useCallback((endMs: number) => {
    if (endMs > Date.now() + 1000) {
      startRestTimer(Math.max(1, Math.round((endMs - Date.now()) / 1000)));
    } else {
      dismissRestTimer();
    }
  }, [startRestTimer, dismissRestTimer]);

  useWorkoutLiveActivity({
    enabled: liveActivityEnabled,
    ready: draftRestored,
    active: sessionActiveForActivity,
    payload: sessionActiveForActivity ? liveActivityPayload : null,
    restEndsAt,
    onRemoteTicks: applyLockScreenTicks,
    onRemoteRest: applyLockScreenRest,
  });

  // Open the floating notes card and focus the input. The note text always
  // persists in `notes` state (it saves on Finish), so opening/closing never
  // discards anything — closing just dismisses the card.
  const openNotes = () => {
    setShowNotes(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Focus shortly after the card starts emerging so the keyboard rises with it.
    setTimeout(() => sessionNotesInputRef.current?.focus(), 70);
  };
  const closeNotes = () => {
    Keyboard.dismiss();
    setShowNotes(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  // Cap the notes input so the card never grows past ~3/4 of the screen — and,
  // while the keyboard is up (the card is lifted to sit just above it), never
  // past the top safe area. The tick button lives at the top of the card, so an
  // uncapped card pushes it off-screen on long notes. A bounded multiline
  // TextInput scrolls its overflow natively.
  // 74 = card padding (16×2) + header row (32) + header margin (10).
  const notesCardBottom = Math.max(safeBottom + 162, kbHeight > 0 ? kbHeight + 12 : 0);
  const notesInputMaxH = Math.max(
    72,
    Math.min(winH * 0.78, winH - notesCardBottom - insets.top - 8) - 74,
  );
  useEffect(() => {
    // Open: decelerate as it grows out (ease-out). Close: accelerate as it gets
    // sucked into the button (ease-in) — a true reverse of the opening motion.
    notesAnim.value = withTiming(showNotes ? 1 : 0, {
      duration: showNotes ? 320 : 240,
      easing: showNotes ? ReEasing.out(ReEasing.cubic) : ReEasing.in(ReEasing.cubic),
    });
  }, [showNotes]);
  useEffect(() => {
    if (showNotes) { setNotesMounted(true); return; }
    const id = setTimeout(() => setNotesMounted(false), 300);
    return () => clearTimeout(id);
  }, [showNotes]);

  // Bottom-left action cluster: [Session Notes button] [round green + Add Exercise].
  // Rendered in-scroll below the card in focus mode, and pinned above the nav bar
  // in list mode (see the two call sites). Identical in both for consistency.
  const renderActionCluster = () => (
    <View style={styles.actionCluster}>
      <BounceButton onPress={openNotes} accessibilityLabel="Session notes">
        <View style={styles.notesToggleBtn}>
          <NeuCard dark={isDark} radius={20} style={{ width: 40, height: 40 }} innerStyle={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="document-text-outline" size={20} color={t.tp} />
          </NeuCard>
          <View style={styles.notesTogglePlus}>
            <Text style={styles.notesTogglePlusText}>+</Text>
          </View>
        </View>
      </BounceButton>
      <View style={styles.addBtnAnchor}>
        {/* Speech-bubble hint: only while the workout has no exercises yet, nudging
            the user toward the + to start adding. Unmounts once the first is added. */}
        {(workoutInfo?.exercises.length ?? 0) === 0 && <AddExerciseHint />}
        <BounceButton
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddingExercise(true); }}
          accessibilityLabel="Add exercise"
        >
          <View style={styles.addRoundWrap}>
            <View style={styles.addRoundBtn}>
              <Ionicons name="add" size={22} color="#fff" />
            </View>
          </View>
        </BounceButton>
      </View>
    </View>
  );
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => {
      setKbHeight(e.endCoordinates.height);
      // Lift the floating notes card above the keyboard as an animated offset so
      // opening/closing with the keyboard up stays smooth (no layout jump).
      const base = safeBottom + 162;
      notesKbShift.value = withTiming(Math.min(0, base - (e.endCoordinates.height + 12)), { duration: e.duration || 250, easing: ReEasing.out(ReEasing.cubic) });
    });
    const hide = Keyboard.addListener("keyboardWillHide", e => {
      setKbHeight(0); setHasNext(false); setHasPrev(false); nextFnRef.current = null; prevFnRef.current = null;
      notesKbShift.value = withTiming(0, { duration: (e && e.duration) || 250, easing: ReEasing.out(ReEasing.cubic) });
    });
    return () => { show.remove(); hide.remove(); };
  }, [safeBottom]);

  // Load persisted view mode preference once.
  useEffect(() => {
    AsyncStorage.getItem(WORKOUT_VIEW_MODE_KEY)
      .then(v => { if (v === "focus") setFocusModeState(true); })
      .catch((e) => warnStorage("getItem", WORKOUT_VIEW_MODE_KEY, e));
  }, []);

  // Clamp focus index when exercises change (e.g., user removes the currently-shown exercise).
  useEffect(() => {
    const n = workoutInfo?.exercises.length ?? 0;
    if (n === 0) { if (focusIndex !== 0) setFocusIndex(0); return; }
    if (focusIndex > n - 1) setFocusIndex(n - 1);
  }, [workoutInfo?.exercises.length, focusIndex]);

  // Reset the focus index (but not the persisted view mode) when switching workouts.
  useEffect(() => { setFocusIndex(0); }, [workoutInfo?.name]);

  // ─── No active program ──────────────────────────────────────────────────────
  // Skip this empty state when today's workout is already logged (e.g. a custom
  // workout with no program): the completed/locked view in the main return must
  // win so "View Today's Workout" shows the finished session, not this screen.
  if (!activeProgram && !isFreeWorkout && !todaysCompletedWorkout) {
    return (
      <FadeScreen style={{ backgroundColor: t.bg }}>
        <View style={[styles.emptyWrap, { paddingTop: insets.top + 60 }]}>
          <NeuCard dark={isDark} radius={40} style={styles.emptyIconCard}>
            <View style={styles.emptyIconInner}><DumbbellIcon size={34} color={t.ts} /></View>
          </NeuCard>
          <Text style={[styles.emptyTitle, { color: t.tp }]}>No Active Program</Text>
          <Text style={[styles.emptySub, { color: t.ts }]}>
            Start a custom workout to log exercises without a program.
          </Text>
          <BounceButton onPress={openCustomWorkoutNaming} style={{ marginTop: 8 }}>
            <View style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>Custom Workout</Text>
            </View>
          </BounceButton>
        </View>

        <CustomWorkoutNameSheet
          visible={customWorkoutNamingOpen}
          isDark={isDark}
          t={t}
          activeProgram={activeProgram}
          onStart={confirmCustomWorkout}
          onClose={() => setCustomWorkoutNamingOpen(false)}
        />
      </FadeScreen>
    );
  }

  // ─── Rest day ───────────────────────────────────────────────────────────────
  // A logged workout for the effective day takes precedence over the rest-day
  // screen even when there's no scheduled template (workoutInfo is null) — the
  // main return renders the locked summary from todaysCompletedWorkout.
  if (!workoutInfo && !todaysCompletedWorkout) {
    return (
      <FadeScreen style={{ backgroundColor: t.bg }}>
        <View style={[styles.emptyWrap, { paddingTop: insets.top + 60 }]}>
          <NeuCard dark={isDark} radius={40} style={styles.emptyIconCard}>
            <View style={styles.emptyIconInner}>
              <Ionicons name="moon-outline" size={34} color={t.ts} />
            </View>
          </NeuCard>
          <Text style={[styles.emptyTitle, { color: t.tp }]}>Rest Day</Text>
          <Text style={[styles.emptySub, { color: t.ts }]}>
            Recovery is where the gains are made. Enjoy the rest.
          </Text>
        </View>

        {activeProgram && (
          <View style={[styles.topBar, { top: insets.top }]}>
            <View style={styles.topBarLeft}>
              <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWorkoutOptionsOpen(true); }}>
                <View style={[styles.topIconBtn, { backgroundColor: isDark ? t.div : "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                  <Ionicons name="add" size={22} color={t.tp} />
                </View>
              </BounceButton>
            </View>
            {/* Rest days keep the timer/stopwatch available (top-right), same as an active workout. */}
            <TouchableOpacity onPress={() => setShowTimerModal(true)} activeOpacity={0.8}>
              <View style={[styles.topIconBtn, { backgroundColor: isDark ? t.div : "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                <Ionicons name="timer-outline" size={22} color={t.tp} />
              </View>
            </TouchableOpacity>
          </View>
        )}

        <IntervalTimerModal visible={showTimerModal} onClose={() => setShowTimerModal(false)} isDark={isDark} t={t} />

        <WorkoutOptionsSheet
          visible={workoutOptionsOpen}
          isDark={isDark}
          t={t}
          onStartCustom={openCustomWorkoutNaming}
          onChangeDay={() => { setChangeDayOpen(true); setWorkoutOptionsOpen(false); }}
          onClose={() => setWorkoutOptionsOpen(false)}
          focusMode={focusMode}
          onToggleFocusMode={(v) => { setFocusMode(v); if (v) setFocusIndex(0); }}
        />

        {activeProgram && (
          <ChangeDaySheet
            visible={changeDayOpen}
            isDark={isDark}
            t={t}
            activeProgram={activeProgram}
            programs={allPrograms}
            currentWorkoutName="Rest"
            onSelectDay={handleSelectDay}
            onClose={() => { setChangeDayOpen(false); setWorkoutOptionsOpen(true); }}
            onDismiss={() => setChangeDayOpen(false)}
          />
        )}

        <CustomWorkoutNameSheet
          visible={customWorkoutNamingOpen}
          isDark={isDark}
          t={t}
          activeProgram={activeProgram}
          onStart={confirmCustomWorkout}
          onClose={() => setCustomWorkoutNamingOpen(false)}
          onBack={activeProgram ? () => { setCustomWorkoutNamingOpen(false); setWorkoutOptionsOpen(true); } : undefined}
        />
      </FadeScreen>
    );
  }

  // The program named under the header. This is the program the SESSION belongs
  // to, not blindly the active one: change-day can put a non-active program's
  // day on screen, and the locked view carries its own programId ("" = free
  // workout with no program → no line; undefined = legacy record → active).
  const headerProgram = (() => {
    const pid = todaysCompletedWorkout ? todaysCompletedWorkout.programId : workoutInfo?.programId;
    if (pid === "") return null;
    if (pid) return allPrograms.find(p => p.id === pid) ?? null;
    if (!todaysCompletedWorkout && isFreeWorkout && !freeWorkoutAddToProgram) return null;
    return activeProgram;
  })();

  // ─── Workout ────────────────────────────────────────────────────────────────
  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View
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
      </View>
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 50, paddingBottom: !todaysCompletedWorkout && workoutInfo ? safeBottom + 150 : 92 }]}
      >
        {/* Header scrolls with content */}
        <View style={styles.header}>
          <Text style={[styles.headerName, { color: t.tp }]}>
            {(todaysCompletedWorkout?.workoutName ?? workoutInfo?.name ?? "").toUpperCase()}
          </Text>
          {headerProgram && (
            <Text style={[styles.headerSub, { color: t.ts }]}>
              {headerProgram.name} · Week {getCurrentWeek(headerProgram)} of {headerProgram.totalWeeks}
            </Text>
          )}
        </View>

        {/* Focus mode: inline progress under header */}
        {focusMode && !todaysCompletedWorkout && workoutInfo && workoutInfo.exercises.length > 0 && (() => {
          const total = workoutInfo.exercises.length;
          const idx = Math.min(focusIndex, total - 1);
          const pct = ((idx + 1) / total) * 100;
          return (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontFamily: FontFamily.semibold, fontSize: 13, color: t.tp, marginBottom: 8 }}>
                Exercise {idx + 1} of {total}
              </Text>
              <AnimatedProgressBar pct={pct} trackColor={t.div} />
            </View>
          );
        })()}

        {todaysCompletedWorkout && lockedData ? (
          <>
            {/* Completed banner */}
            <View style={[styles.completedBanner, { backgroundColor: isDark ? "rgba(29,236,160,0.08)" : "rgba(29,236,160,0.07)", borderColor: `${ACCT}40` }]}>
              <Ionicons name="checkmark-circle" size={16} color={ACCT} />
              <Text style={[styles.completedBannerText, { color: t.tp }]}>
                {(() => {
                  if (todaysCompletedWorkout.durationSeconds > 0) {
                    const end = new Date(todaysCompletedWorkout.completedAt);
                    const start = new Date(end.getTime() - todaysCompletedWorkout.durationSeconds * 1000);
                    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
                    return `Logged · ${fmt(start)} – ${fmt(end)}`;
                  }
                  return "Logged";
                })()}
              </Text>
            </View>

            {/* Edit in Journal + Discard row */}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10, marginBottom: 16 }}>
              <BounceButton onPress={() => router.navigate({ pathname: "/workout-detail", params: { id: todaysCompletedWorkout.id } })} style={{ flex: 1 }}>
                <View style={[styles.finishWrap, styles.finishWrapActive, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
                  <View style={[styles.finishBtn, styles.finishBtnActive, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}>
                    <Ionicons name="create-outline" size={18} color={isDark ? APP_DARK.bg : "#fff"} />
                    <Text style={[styles.finishBtnText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Edit Workout</Text>
                  </View>
                </View>
              </BounceButton>
              <BounceButton onPress={handleDiscardCompleted} style={{ flex: 1 }}>
                <View style={[styles.finishWrap, { backgroundColor: isDark ? NEU_BG_DARK : NEU_BG, shadowColor: isDark ? "#000" : "#a3afc0", shadowOpacity: isDark ? 0.35 : 0.5 }]}>
                  <View style={[styles.finishBtn, { backgroundColor: isDark ? NEU_BG_DARK : NEU_BG, borderWidth: 1, borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.85)", shadowColor: isDark ? "transparent" : "#FFFFFF", shadowOffset: { width: -3, height: -3 }, shadowOpacity: 1, shadowRadius: 4, paddingVertical: 15 }]}>
                    <TrashIcon size={16} color="#ef4444" />
                    <Text style={[styles.finishBtnText, { color: "#ef4444" }]}>Discard Workout</Text>
                  </View>
                </View>
              </BounceButton>
            </View>

            {/* Locked exercise cards */}
            {lockedData.exercises.map((exercise, i) => (
              <ExerciseCard
                key={exercise.id}
                exercise={exercise as Exercise}
                exIndex={i}
                totalExercises={lockedData.exercises.length}
                exLog={lockedData.log[exercise.id] ?? { warmup: [], working: [], notes: "" }}
                isDark={isDark}
                isLocked
                hideIndexLabel
                numberBadge={i + 1}
                onUpdateSet={() => {}} onToggleDone={() => {}} onAutoTick={() => {}}
                exNotes={lockedData.log[exercise.id]?.notes ?? ""}
                onUpdateNotes={() => {}} onAddSet={() => {}} onRemoveSet={() => {}}
                onOpenReorder={() => {}} onChangeExercise={() => {}}
                onRemoveExercise={() => {}} isIsometric={false} onToggleIsometric={() => {}}
                onToggleSetType={() => {}} onInputFocus={() => {}} activeSetFlatIdx={null}
              />
            ))}

          </>
        ) : !workoutInfo ? null : workoutInfo.exercises.length === 0 ? (
          <NeuCard dark={isDark} style={{ borderRadius: 20, marginBottom: 16 }}>
            <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
              <Text style={[styles.emptyTitle, { color: t.tp, fontSize: 16 }]}>No exercises added</Text>
              <Text style={[styles.emptySub, { color: t.ts, fontSize: 13 }]}>
                Edit your program to add exercises to {workoutInfo.name}.
              </Text>
            </View>
          </NeuCard>
        ) : (
          (focusMode
            ? workoutInfo.exercises.slice(
                Math.min(focusIndex, workoutInfo.exercises.length - 1),
                Math.min(focusIndex, workoutInfo.exercises.length - 1) + 1,
              )
            : workoutInfo.exercises
          ).map((exercise: Exercise, localI: number) => {
            const i = focusMode ? Math.min(focusIndex, workoutInfo.exercises.length - 1) : localI;
            const exLog = log[exercise.id] ?? { warmup: [], working: [] };
            return (
              <CollapsibleCard
                key={exercise.id}
                isCollapsing={collapsingIds.has(exercise.id)}
                onCollapsed={() => removeExercise(exercise.id)}
              >
                <MemoExerciseCard
                  exercise={exercise}
                  exIndex={i}
                  totalExercises={workoutInfo.exercises.length}
                  exLog={exLog}
                  isDark={isDark}
                  onUpdateSet={updateSet}
                  onToggleDone={toggleDone}
                  onAutoTick={autoTickIfComplete}
                  exNotes={log[exercise.id]?.notes ?? ""}
                  onUpdateNotes={updateExNotes}
                  onAddSet={addSet}
                  onRemoveSet={removeSet}
                  onOpenReorder={openReorder}
                  onChangeExercise={openChangeExercise}
                  onRemoveExercise={startCollapse}
                  onToggleSetType={toggleSetType}
                  onInputFocus={handleInputFocus}
                  isIsometric={isometricExIds.has(exercise.id)}
                  activeSetFlatIdx={getActiveSetFlatIdx(exercise.id, workoutInfo.exercises, log)}
                  prevSets={prevHintsByName[normalizeExerciseName(exercise.name)] ?? EMPTY_PREV}
                  hideIndexLabel
                  numberBadge={focusMode ? undefined : i + 1}
                  onToggleIsometric={toggleIsometricEx}
                />
              </CollapsibleCard>
            );
          })
        )}

        {/* Focus mode: bottom-left action cluster below the exercise / empty card.
            (In list mode the cluster is pinned instead — see below the ScrollView.)
            The scroll's bottom padding keeps it clear of the pinned controls. */}
        {focusMode && !todaysCompletedWorkout && workoutInfo && (
          <View style={{ marginTop: 4, marginBottom: 8 }}>
            {renderActionCluster()}
          </View>
        )}

        {/* Complete Workout button — inline at bottom of scroll, only while running (hidden in focus mode) */}
        {isRunning && !todaysCompletedWorkout && !focusMode && workoutInfo && workoutInfo.exercises.length > 0 && (
          <BounceButton onPress={handleFinish} style={{ marginHorizontal: 0, marginTop: 12, marginBottom: 16 }}>
            <View style={[styles.finishWrap, styles.finishWrapActive, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
              <View style={[styles.finishBtn, styles.finishBtnActive, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}>
                <Ionicons name="checkmark-circle" size={18} color={isDark ? APP_DARK.bg : "#fff"} />
                <Text style={[styles.finishBtnText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Complete Workout</Text>
              </View>
            </View>
          </BounceButton>
        )}

      </ScrollView>

      {/* List mode: bottom-left action cluster pinned just above the nav bar. Always
          available while a workout is active (even with 0 exercises) so notes /
          extra exercises can be added without scrolling. The nav bar is fixed at
          bottom:28 + height 64 (top ≈ 92 from the screen bottom, device-independent),
          so pin the cluster to that fixed top rather than the safe-area inset —
          otherwise notched devices leave a big gap and non-notch phones nearly touch. */}
      {!focusMode && !todaysCompletedWorkout && workoutInfo && (
        <View style={{ position: "absolute", left: 20, bottom: 100, zIndex: 6 }}>
          {renderActionCluster()}
        </View>
      )}

      {/* Floating Session Notes card (both modes). Mounted only while open (plus a
          brief close-animation window) so no full-screen overlay lingers in the tree.
          The tick saves-and-closes; tapping the backdrop does the same. Notes always
          persist in `notes` state (committed on Finish). */}
      {notesMounted && !todaysCompletedWorkout && workoutInfo && (
        <>
          <Reanimated.View
            pointerEvents={showNotes ? "auto" : "none"}
            style={[StyleSheet.absoluteFill, { backgroundColor: "#000", zIndex: 20 }, notesBackdropStyle]}
          >
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeNotes} />
          </Reanimated.View>
          <Reanimated.View
            pointerEvents={showNotes ? "auto" : "none"}
            style={[
              styles.notesFloatCard,
              {
                bottom: safeBottom + 162,
                backgroundColor: isDark ? NEU_BG_DARK : NEU_BG,
                shadowColor: isDark ? "#000" : "#a3afc0",
              },
              notesCardStyle,
            ]}
          >
            <View style={styles.notesHeader}>
              <Text style={{ fontFamily: FontFamily.bold, fontSize: 16, color: t.tp }}>Session Notes</Text>
              <BounceButton onPress={closeNotes} accessibilityLabel="Save notes">
                <View style={styles.notesTickBtn}>
                  <Ionicons name="checkmark" size={18} color="#fff" />
                </View>
              </BounceButton>
            </View>
            <TextInput
              ref={r => { sessionNotesInputRef.current = r; }}
              style={[styles.notesInput, { color: t.tp, maxHeight: notesInputMaxH }]}
              placeholder="How's the session going? Anything to note..."
              placeholderTextColor={t.ts}
              multiline
              value={notes}
              onChangeText={setNotes}
              onFocus={() => { handleInputFocus(null, null); }}
              textAlignVertical="top"
            />
          </Reanimated.View>
        </>
      )}

      {/* Focus mode: pinned Prev / Next or Complete Workout above the tab bar */}
      {focusMode && !todaysCompletedWorkout && workoutInfo && workoutInfo.exercises.length > 0 && (() => {
        const total = workoutInfo.exercises.length;
        const idx = Math.min(focusIndex, total - 1);
        const isFirst = idx === 0;
        const isLast = idx === total - 1;
        const goPrev = () => {
          if (isFirst) return;
          setFocusIndex(idx - 1);
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        };
        const goNext = () => {
          setFocusIndex(idx + 1);
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        };
        return (
          <View pointerEvents="box-none" style={{ position: "absolute", left: 20, right: 20, bottom: safeBottom + 80, zIndex: 5 }}>
            <View style={{ flexDirection: "row", gap: 16, alignItems: "center", justifyContent: isLast ? "flex-start" : "center" }}>
              <BounceButton onPress={isFirst ? undefined : goPrev} accessibilityLabel="Previous exercise">
                <View style={[styles.focusBackWrap, { backgroundColor: isDark ? NEU_BG_DARK : NEU_BG, shadowColor: isDark ? "#000" : "#a3afc0", shadowOpacity: isDark ? 0.35 : 0.5, opacity: isFirst ? 0.4 : 1 }]}>
                  <View style={[styles.focusBackBtn, { backgroundColor: isDark ? NEU_BG_DARK : NEU_BG, borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.85)", shadowColor: isDark ? "transparent" : "#FFFFFF" }]}>
                    <Ionicons name="chevron-back" size={22} color={t.tp} />
                  </View>
                </View>
              </BounceButton>
              {isLast ? (
                <BounceButton onPress={handleFinish} style={{ flex: 1 }}>
                  <View style={[styles.finishWrap, styles.finishWrapActive, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                    <View style={[styles.finishBtn, styles.finishBtnActive, { backgroundColor: ACCT }]}>
                      <Ionicons name="checkmark-circle" size={18} color="#fff" />
                      <Text style={[styles.finishBtnText, { color: "#fff" }]}>Complete Workout</Text>
                    </View>
                  </View>
                </BounceButton>
              ) : (
                <BounceButton onPress={goNext} accessibilityLabel="Next exercise">
                  <View style={[styles.focusBackWrap, { backgroundColor: ACCT, shadowColor: ACCT, shadowOpacity: 0.5 }]}>
                    <View style={[styles.focusBackBtn, { backgroundColor: ACCT, borderColor: "rgba(255,255,255,0.3)", shadowColor: "transparent" }]}>
                      <Ionicons name="chevron-forward" size={22} color="#fff" />
                    </View>
                  </View>
                </BounceButton>
              )}
            </View>
          </View>
        );
      })()}

      {/* Fixed top bar — workout timer + discard + rest timer */}
      <View style={[styles.topBar, { top: insets.top }]}>
        <View style={styles.topBarLeft}>
          {todaysCompletedWorkout ? (
            <View style={[styles.workoutTimerPill, { backgroundColor: isDark ? t.div : "#fff" }]}>
              <Ionicons name="checkmark-circle" size={14} color={ACCT} />
              <Text style={[styles.workoutTimerText, { color: t.tp }]}>
                {todaysCompletedWorkout.durationSeconds > 0 ? fmtTime(todaysCompletedWorkout.durationSeconds) : "Done"}
              </Text>
            </View>
          ) : (isRunning || isPaused) ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[styles.workoutTimerPill, { backgroundColor: isDark ? t.div : "#fff" }]}>
                <View style={[styles.timerActiveDot, isPaused && styles.timerActiveDotPaused]} />
                <Text style={[styles.workoutTimerText, { color: t.tp }]}>{fmtTime(elapsedSeconds)}</Text>
              </View>
              <BounceButton onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isPaused) resumeTimer();
                else pauseTimer();
              }}>
                <View style={[styles.topIconBtn, { backgroundColor: isDark ? t.div : "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                  <Ionicons name={isPaused ? "play" : "pause"} size={16} color={t.tp} />
                </View>
              </BounceButton>
              <BounceButton onPress={handleDiscard}>
                <View style={[styles.topIconBtn, { backgroundColor: isDark ? t.div : "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                  <TrashIcon size={18} color={t.ts} />
                </View>
              </BounceButton>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); startTimer(); }}>
                <View style={[styles.workoutTimerPill, { backgroundColor: isDark ? t.div : "#fff" }]}>
                  <Text style={[styles.workoutTimerText, { color: t.tp }]}>Start</Text>
                </View>
              </BounceButton>
              {activeProgram && (
                <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWorkoutOptionsOpen(true); }}>
                  <View style={[styles.topIconBtn, { backgroundColor: isDark ? t.div : "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                    <Ionicons name="add" size={22} color={t.tp} />
                  </View>
                </BounceButton>
              )}
            </View>
          )}
        </View>
        <TouchableOpacity onPress={() => setShowTimerModal(true)} activeOpacity={0.8}>
          <View style={[styles.topIconBtn, { backgroundColor: isDark ? t.div : "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
            <Ionicons name="timer-outline" size={22} color={t.tp} />
          </View>
        </TouchableOpacity>
      </View>

      {/* ── Timer / Stopwatch Modal ── */}
      <IntervalTimerModal visible={showTimerModal} onClose={() => setShowTimerModal(false)} isDark={isDark} t={t} />


      {/* Exercise picker — change exercise for current session */}
      {changingExId !== null && (
        <ExercisePicker
          visible
          subtitle="CHANGE EXERCISE"
          customExercises={customExercises}
          onSelectMultiple={names => { changeExercise(changingExId, names[0]); setChangingExId(null); }}
          onDeleteCustom={deleteCustomExercise}
          onCreateCustom={() => {
            pendingChangingExId.current = changingExId;
            setChangingExId(null);
            router.navigate("/create-custom-exercise");
          }}
          onEditCustom={name => {
            pendingChangingExId.current = changingExId;
            setChangingExId(null);
            router.navigate({ pathname: "/create-custom-exercise", params: { edit: name } });
          }}
          onClose={() => setChangingExId(null)}
          isDark={isDark}
        />
      )}

      {addingExercise && (
        <ExercisePicker
          visible
          subtitle="ADD EXERCISE"
          customExercises={customExercises}
          onSelectMultiple={names => {
            // Append the new exercises and stay on the exercise the user is
            // currently viewing. New exercises append to the end, so the current
            // focusIndex keeps pointing at the same exercise (no jump in focus mode).
            names.forEach((name, i) => addExercise(name, i));
            setAddingExercise(false);
          }}
          onDeleteCustom={deleteCustomExercise}
          onCreateCustom={() => {
            setAddingExercise(false);
            router.navigate("/create-custom-exercise");
          }}
          onEditCustom={name => {
            setAddingExercise(false);
            router.navigate({ pathname: "/create-custom-exercise", params: { edit: name } });
          }}
          onClose={() => setAddingExercise(false)}
          isDark={isDark}
        />
      )}

      <WorkoutReorderSheet
        visible={reorderOpen}
        workoutName={workoutInfo?.name ?? ""}
        exercises={workoutInfo?.exercises ?? []}
        isDark={isDark}
        t={t}
        onReorderExercises={reorderExercises}
        onRemoveExercise={id => { startCollapse(id); setReorderOpen(false); }}
        onEditExercise={id => { setChangingExId(id); setReorderOpen(false); }}
        onClose={() => setReorderOpen(false)}
      />

      <WorkoutOptionsSheet
        visible={workoutOptionsOpen}
        isDark={isDark}
        t={t}
        onStartCustom={openCustomWorkoutNaming}
        onChangeDay={() => { setChangeDayOpen(true); setWorkoutOptionsOpen(false); }}
        onClose={() => setWorkoutOptionsOpen(false)}
        focusMode={focusMode}
        onToggleFocusMode={(v) => { setFocusMode(v); if (v) setFocusIndex(0); }}
      />

      {activeProgram && (
        <ChangeDaySheet
          visible={changeDayOpen}
          isDark={isDark}
          t={t}
          activeProgram={activeProgram}
          programs={allPrograms}
          currentWorkoutName={workoutInfo?.name ?? ""}
          onSelectDay={handleSelectDay}
          onClose={() => { setChangeDayOpen(false); setWorkoutOptionsOpen(true); }}
          onDismiss={() => setChangeDayOpen(false)}
        />
      )}

      <CustomWorkoutNameSheet
        visible={customWorkoutNamingOpen}
        isDark={isDark}
        t={t}
        activeProgram={activeProgram}
        onStart={confirmCustomWorkout}
        onClose={() => setCustomWorkoutNamingOpen(false)}
        onBack={activeProgram ? () => { setCustomWorkoutNamingOpen(false); setWorkoutOptionsOpen(true); } : undefined}
      />

      {pendingComplete && (
        <TimeEditSheet
          visible={completeSheetOpen}
          isDark={isDark}
          title={pendingComplete.workoutName}
          subtitle="Completed"
          withCheck
          confirmLabel="Complete Workout"
          startDate={new Date(new Date(pendingComplete.completedAt).getTime() - pendingComplete.durationSeconds * 1000)}
          endDate={new Date(pendingComplete.completedAt)}
          onConfirm={(start, end) => {
            const completedAt = completedAtISO(pendingComplete.date, end);
            const durationSeconds = computeDurationMins(start, end) * 60;
            finalizeComplete({ ...pendingComplete, completedAt, durationSeconds });
            setCompleteSheetOpen(false);
            setPendingComplete(null);
          }}
          onClose={() => { setCompleteSheetOpen(false); setPendingComplete(null); }}
        />
      )}

      {summaryWorkout && (
        <WorkoutSummarySheet
          visible
          workout={summaryWorkout}
          onDone={() => {
            setSummaryWorkout(null);
            // Land on Home after the celebration — it picks the finished
            // workout up on focus. navigate (not push) just switches tabs.
            router.navigate("/home");
          }}
        />
      )}
    </KeyboardAvoidingView>
    {kbHeight > 0 && Platform.OS === "ios" && (
      <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, flexDirection: "row", gap: 8, zIndex: 999 }}>
        <TouchableOpacity
            onPress={() => prevFnRef.current?.()}
            activeOpacity={hasPrev ? 0.75 : 1}
            disabled={!hasPrev}
            style={[styles.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff", opacity: hasPrev ? 1 : 0.35 }]}
          >
            <Ionicons name="chevron-back" size={24} color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => nextFnRef.current?.()}
            activeOpacity={hasNext ? 0.75 : 1}
            disabled={!hasNext}
            style={[styles.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff", opacity: hasNext ? 1 : 0.35 }]}
          >
            <Ionicons name="chevron-forward" size={24} color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          activeOpacity={0.75}
          style={[styles.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}
        >
          <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
        </TouchableOpacity>
      </View>
    )}

    </FadeScreen>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },

  // Completed / locked banner
  completedBanner:     { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  completedBannerText: { fontFamily: FontFamily.semibold, fontSize: 14 },

  // Header
  header:       { paddingBottom: 14, gap: 2, marginBottom: 4 },
  headerName:   { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 0.3, marginTop: 2 },
  headerSub:        { fontFamily: FontFamily.regular, fontSize: 14 },
  topBar:           { position: "absolute", left: 20, right: 20, zIndex: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topBarLeft:       { flexDirection: "row", alignItems: "center", gap: 10 },
  topIconBtn:       { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  workoutTimerPill: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 100, paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  workoutTimerText: { fontFamily: FontFamily.bold, fontSize: 15, letterSpacing: 0.5 },
  timerActiveDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCT },
  timerActiveDotPaused: { backgroundColor: "#F59E0B" },

  scroll: { paddingHorizontal: 20 },

  // Exercise card
  exCard:       { marginBottom: 20, borderRadius: 20 },
  exCardInner:  { padding: 16, gap: 10 },
  exHeader:     { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 },
  exNumBadge:   { width: 32, height: 32 },
  exNumInner:   { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  exNumText:    { fontFamily: FontFamily.bold, fontSize: 13 },
  exTitleBlock: { flex: 1, justifyContent: "center", gap: 6 },
  exNumLabel:   { fontFamily: FontFamily.semibold, fontSize: 13 },
  exName:       { fontFamily: FontFamily.bold, fontSize: 22, flex: 1 },
  exNotesRow:    { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  exNotesInput:  { fontFamily: FontFamily.regular, fontSize: 13, minHeight: 36, lineHeight: 20 },

  // Column headers
  colHeaderRow:   { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 4, paddingBottom: 4 },
  colHeaderText:  { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: "center" },
  headerDivider:  { height: 1, marginBottom: 4, opacity: 0.6 },

  // Column widths — match old app exactly
  setCol:        { width: 36, textAlign: "center" },
  prevCol:       { width: 72, alignItems: "center", justifyContent: "center" },
  inputHeaderCol:{ flex: 1, alignItems: "center", justifyContent: "flex-end", marginHorizontal: 4 },
  inputCell:     { flex: 1, marginHorizontal: 4, alignItems: "center" },
  checkCol:      { width: 32, alignItems: "center", justifyContent: "center" },

  // Data rows
  dataRow:       { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 4 },
  setText:       { fontFamily: FontFamily.semibold, fontSize: 15, textAlign: "center" },
  prevText:      { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
  setEditBadge:  { width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  // Inputs
  inputBox:      { width: "100%", height: 40, borderRadius: 10, justifyContent: "center" },
  inputBoxText:  { fontFamily: FontFamily.bold, fontSize: 15, textAlign: "center", flex: 1, paddingVertical: 0 },

  // Remove set
  removeSetBtn:  { width: 24, height: 24, borderRadius: 13, backgroundColor: "#FF4D4F", alignItems: "center", justifyContent: "center", shadowColor: "#FF4D4F", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },

  // Edit actions
  editMoveRow:   { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 10 },
  editMoveLabel: { fontFamily: FontFamily.regular, fontSize: 12, marginLeft: 2 },
  editChipsRow:  { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 6 },
  editChipText:  { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Session Notes — floating card + tick button
  notesInput:     { fontFamily: FontFamily.regular, fontSize: 14, minHeight: 72, lineHeight: 22 },
  notesHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  notesFloatCard: { position: "absolute", left: 20, right: 20, borderRadius: 16, padding: 16, zIndex: 21, transformOrigin: "left bottom", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 18 },
  notesTickBtn:   { width: 32, height: 32, borderRadius: 16, backgroundColor: ACCT, alignItems: "center", justifyContent: "center", shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },

  // Bottom-left action cluster: Session Notes button + round green + Add Exercise
  actionCluster:      { flexDirection: "row", alignItems: "center", gap: 14 },
  notesToggleBtn:     { width: 40, height: 40 },
  notesTogglePlus:    { position: "absolute", top: -4, right: -6, backgroundColor: ACCT, borderRadius: 7, width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  notesTogglePlusText: { color: "#fff", fontSize: 10, fontFamily: FontFamily.bold, lineHeight: 14 },
  addRoundWrap:       { borderRadius: 20, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  addRoundBtn:        { width: 40, height: 40, borderRadius: 20, backgroundColor: ACCT, alignItems: "center", justifyContent: "center" },
  addBtnAnchor:       { position: "relative" },
  // Equal negative left/right keeps the wrap symmetric (so it stays centered over
  // the 44px button) while giving the bubble ~160px to lay its text out on one
  // line; alignItems:center centers the bubble + tail. bottom clears the button.
  addHintWrap:        { position: "absolute", bottom: 52, left: -60, right: -60, alignItems: "center" },
  addHintBubble:      { backgroundColor: ACCT, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.45, shadowRadius: 8 },
  addHintText:        { color: "#fff", fontFamily: FontFamily.semibold, fontSize: 13 },
  addHintTail:        { width: 0, height: 0, marginTop: -0.5, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7, borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: ACCT },

  // Finish button
  finishWrap:       { borderRadius: 16, backgroundColor: "#8896A7", shadowColor: "#4a5568", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.45, shadowRadius: 8 },
  finishWrapActive: { backgroundColor: ACCT, shadowColor: "#1a9e68" },
  finishBtn:        { borderRadius: 16, backgroundColor: "#8896A7", paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  finishBtnActive:  { backgroundColor: ACCT },
  finishBtnText:    { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff", letterSpacing: 0.3 },

  // Focus mode compact Back button (icon-only circle, matches finish button height)
  focusBackWrap:    { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowRadius: 8 },
  focusBackBtn:     { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 1, shadowOffset: { width: -3, height: -3 }, shadowOpacity: 1, shadowRadius: 4 },

  checkCircle:      { width: 24, height: 24, borderRadius: 13, alignItems: "center", justifyContent: "center" },

  // Keyboard floating dismiss button
  kbFloatBtn: { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },

  // Reorder button in exercise edit panel
  exReorderBtn:   { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  // Workout reorder sheet
  woReorderBackdrop:  { flex: 1, justifyContent: "flex-end" },
  woReorderOverlay:   { backgroundColor: "rgba(0,0,0,0.45)" },
  woReorderSheet:     { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 },
  woReorderHandleArea:{ paddingVertical: 12, alignItems: "center" },
  woReorderHandle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  woReorderHeader:    { alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  woReorderTitle:     { fontFamily: FontFamily.bold, fontSize: 16 },
  woReorderSubtitle:  { fontFamily: FontFamily.regular, fontSize: 14, marginTop: 2 },
  woReorderListWrap:  { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 },
  woReorderDoneRow:   { alignItems: "center", paddingTop: 16, paddingBottom: 4 },
  woReorderDoneWrap:  { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10 },
  woReorderDoneBtn:   { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 13, paddingHorizontal: 40 },
  woReorderDone:      { fontFamily: FontFamily.semibold, fontSize: 16, color: "#FFFFFF" },

  // Shared step-header (matches journal pickerStepHeader style)
  woStepHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  woStepBackBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  woStepTitle:   { fontFamily: FontFamily.bold, fontSize: 17, textAlign: "center", flex: 1 },

  // WorkoutOptionsSheet card-style picker
  woPickerTitle:       { fontFamily: FontFamily.bold, fontSize: 20, textAlign: "center", paddingHorizontal: 24, paddingTop: 4, paddingBottom: 16 },
  woPickerContent:     { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  woPickerOptionInner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  woPickerOptionText:  { fontFamily: FontFamily.semibold, fontSize: 15, flex: 1 },
  woPickerOptionSub:   { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  woPickerCancelBtn:   { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  woPickerCancelText:  { fontFamily: FontFamily.bold, fontSize: 16 },

  // Custom workout naming sheet
  cnNameInputWrap: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 4 },
  cnNameInput:     { fontFamily: FontFamily.semibold, fontSize: 18, paddingVertical: 12 },
  cnToggleRow:     { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 16, marginTop: 12, borderTopWidth: 1, borderBottomWidth: 1 },
  cnToggleTitle:   { fontFamily: FontFamily.semibold, fontSize: 15 },
  cnToggleSub:     { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },
  cnToggle:        { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },

  // Draggable list rows
  woDragRow:      { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12 },
  woDragHandle:   { paddingHorizontal: 4, paddingVertical: 4, justifyContent: "center", alignItems: "center" },
  woDragNumChip:  { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  woDragNum:      { fontFamily: FontFamily.bold, fontSize: 13 },
  woDragNameBtn:  { flex: 1, flexDirection: "row", alignItems: "center" },
  woDragName:     { fontFamily: FontFamily.regular, fontSize: 15, flex: 1 },

  // Empty states
  emptyWrap:      { flex: 1, alignItems: "center", paddingHorizontal: 40, gap: 14 },
  emptyIconCard:  { marginBottom: 6 },
  emptyIconInner: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  emptyTitle:     { fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center" },
  emptySub:       { fontFamily: FontFamily.regular, fontSize: 15, textAlign: "center", lineHeight: 22 },
  emptyBtn:       { borderRadius: 14, backgroundColor: ACCT, paddingVertical: 14, paddingHorizontal: 28, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  emptyBtnText:   { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  // Interval Timer / Stopwatch modal styles now live in components/IntervalTimerModal.tsx.
});
