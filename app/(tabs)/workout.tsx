import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, Easing as ReEasing, interpolateColor } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  Alert, Animated, Keyboard, Modal, AppState, LayoutAnimation,
  PanResponder, Easing, Switch,
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
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import { PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, WORKOUT_DAY_OVERRIDE_KEY, WORKOUT_DRAFT_KEY, type SavedProgram, type Exercise, type ProgramSet, type CompletedWorkout, normaliseSets, getCurrentWeek } from "../../constants/programs";
import { CUSTOM_KEY, type CustomExercise } from "../../constants/exercises";
import { parseStoredDate, toYMD, todayYMD } from "../../utils/dates";
import { useWorkoutTimer } from "../../contexts/WorkoutTimerContext";
import { useRestTimer } from "../../contexts/RestTimerContext";

// ─── Constants ─────────────────────────────────────────────────────────────────

const WARMUP_ORANGE = "#ffbf0f";
const WORKOUT_VIEW_MODE_KEY = "@avenas/workout_view_mode";

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

function getTodaysWorkout(program: SavedProgram): { name: string; exercises: Exercise[] } | null {
  const start = parseStoredDate(program.startDate);
  if (!start) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  const daysPassed = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const dayIndex = (((daysPassed + (program.cycleOffset ?? 0)) % program.cycleDays) + program.cycleDays) % program.cycleDays;
  const dayName = program.cyclePattern[dayIndex];
  if (!dayName || dayName === "Rest") return null;
  const workoutKey = `${dayIndex}:${dayName}`;
  const exercises = program.workouts[workoutKey] ?? [];
  return { name: dayName, exercises };
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

// ─── buildPrevByName ──────────────────────────────────────────────────────────

function buildPrevByName(
  history: CompletedWorkout[],
  beforeDate?: string,
): Record<string, string[]> {
  const sorted = [...history].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
  const filtered = beforeDate ? sorted.filter(w => w.completedAt < beforeDate) : sorted;
  const result: Record<string, string[]> = {};
  for (const workout of filtered) {
    for (const ex of workout.exercises) {
      if (result[ex.name]) continue;
      result[ex.name] = ex.sets.map(s => {
        if (s.weight && s.reps) return `${s.weight}×${s.reps}`;
        return s.weight || s.reps || "—";
      });
    }
  }
  return result;
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
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeSheet}>
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
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeSheet}>
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

  const renderDayCard = (dayName: string, prog: SavedProgram) => {
    const isActive = prog.id === activeProgram.id && dayName === currentWorkoutName;
    return (
      <BounceButton key={dayName} style={{ marginBottom: 16 }} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); animateOut(() => onSelectDay(dayName, prog.id !== activeProgram.id ? prog : undefined)); }}>
        <NeuCard dark={isDark} radius={14}>
          <View style={styles.woPickerOptionInner}>
            <DumbbellIcon size={18} color={isActive ? ACCT : t.tp} />
            <Text style={[styles.woPickerOptionText, { color: isActive ? ACCT : t.tp }]}>{dayName}</Text>
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
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => animateOut(onDismiss)}>
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
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => animateOut(onClose)}>
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

interface ExerciseCardProps {
  exercise: Exercise;
  exIndex: number;
  totalExercises: number;
  exLog: ExerciseLog;
  isDark: boolean;
  onUpdateSet: (type: "warmup" | "working", idx: number, field: "weight" | "reps", value: string) => void;
  onToggleDone: (type: "warmup" | "working", idx: number) => void;
  onAutoTick: (type: "warmup" | "working", idx: number) => void;
  onUpdateNotes: (notes: string) => void;
  exNotes: string;
  onAddSet: () => void;
  onRemoveSet: () => void;
  onOpenReorder: () => void;
  onChangeExercise: () => void;
  onRemoveExercise: () => void;
  isIsometric: boolean;
  onToggleIsometric: () => void;
  onToggleSetType: (type: "warmup" | "working", localIdx: number) => void;
  onInputFocus: (nextFn: (() => void) | null, prevFn: (() => void) | null) => void;
  activeSetFlatIdx: number | null;
  isLocked?: boolean;
  prevSets?: string[];
  hideIndexLabel?: boolean;
}

function ExerciseCard({ exercise, exIndex, totalExercises, exLog, isDark, onUpdateSet, onToggleDone, onAutoTick, onUpdateNotes, exNotes, onAddSet, onRemoveSet, onOpenReorder, onChangeExercise, onRemoveExercise, isIsometric, onToggleIsometric, onToggleSetType, onInputFocus, activeSetFlatIdx, isLocked = false, prevSets, hideIndexLabel = false }: ExerciseCardProps) {
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
          <View style={styles.exTitleBlock}>
            {!hideIndexLabel && (
              <Text style={[styles.exNumLabel, { color: t.ts }]}>EXERCISE {exIndex + 1} OF {totalExercises}</Text>
            )}
            <Text style={[styles.exName, { color: t.tp }]} numberOfLines={1}>{exercise.name}</Text>
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
              onCollapsed={() => { setCollapsingSetIdx(null); onRemoveSet(); }}
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
                      onToggleSetType(set.type, set.localIdx);
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
                    placeholder={set.programSet?.weightKg || "—"}
                    placeholderTextColor={`${t.tp}66`}
                    value={set.weight}
                    editable={!isLocked}
                    onFocus={() => onInputFocus(
                      () => repsRefs.current[flatIdx]?.focus(),
                      flatIdx > 0 ? () => repsRefs.current[flatIdx - 1]?.focus() : null,
                    )}
                    onChangeText={v => onUpdateSet(set.type, set.localIdx, "weight", v)}
                    onEndEditing={() => onAutoTick(set.type, set.localIdx)}
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
                    placeholderTextColor={(() => {
                      const ps = set.programSet;
                      const hasTarget = ps?.reps || ps?.repsMin || ps?.repsMax;
                      return `${t.tp}66`;
                    })()}
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
                    onChangeText={v => onUpdateSet(set.type, set.localIdx, "reps", v)}
                    onEndEditing={() => onAutoTick(set.type, set.localIdx)}
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
                          onUpdateSet(set.type, set.localIdx, "weight", parts[0] ?? "");
                          onUpdateSet(set.type, set.localIdx, "reps", parts[1] ?? "");
                        }
                      }
                      onToggleDone(set.type, set.localIdx);
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
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onAddSet(); }}
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
                  onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggleIsometric(); },
                  icon: <Ionicons name="timer-outline" size={13} color={isIsometric ? ACCT : t.ts} />,
                  label: isIsometric ? "Hold" : "Reps",
                  color: isIsometric ? ACCT : t.ts,
                },
                {
                  onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChangeExercise(); },
                  icon: <Ionicons name="swap-horizontal" size={13} color={t.ts} />,
                  label: "Change",
                  color: t.ts,
                },
                {
                  onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Alert.alert(
                    "Remove Exercise",
                    `Remove "${exercise.name}" from today's workout?`,
                    [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: onRemoveExercise }]
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
            onChangeText={onUpdateNotes}
            onFocus={() => onInputFocus(null, null)}
            multiline
            textAlignVertical="top"
          />
        </View>

      </View>
    </NeuCard>
  );
}

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

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function WorkoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isRunning, elapsedSeconds, startTimer, stopTimer } = useWorkoutTimer();
  const { startRestTimer, dismissRestTimer } = useRestTimer();

  const [activeProgram, setActiveProgram] = useState<SavedProgram | null>(null);
  const [allPrograms, setAllPrograms] = useState<SavedProgram[]>([]);
  const [workoutInfo, setWorkoutInfo] = useState<{ name: string; exercises: Exercise[] } | null>(null);
  const [log, setLog] = useState<WorkoutLog>({});
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [changingExId, setChangingExId] = useState<string | null>(null);
  const [addingExercise, setAddingExercise] = useState(false);
  const [isometricExIds, setIsometricExIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [todaysCompletedWorkout, setTodaysCompletedWorkout] = useState<CompletedWorkout | null>(null);
  const [isFreeWorkout, setIsFreeWorkout] = useState(false);
  const [freeWorkoutAddToProgram, setFreeWorkoutAddToProgram] = useState(false);
  const [workoutOptionsOpen, setWorkoutOptionsOpen] = useState(false);
  const [changeDayOpen, setChangeDayOpen] = useState(false);
  const [customWorkoutNamingOpen, setCustomWorkoutNamingOpen] = useState(false);
  const [focusMode, setFocusModeState] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const setFocusMode = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setFocusModeState(prev => {
      const v = typeof next === "function" ? (next as (p: boolean) => boolean)(prev) : next;
      AsyncStorage.setItem(WORKOUT_VIEW_MODE_KEY, v ? "focus" : "list")
        .catch((e) => warnStorage("setItem", WORKOUT_VIEW_MODE_KEY, e));
      return v;
    });
  }, []);
  const scrollRef = useRef<ScrollView>(null);
  const notesY = useRef(0);

  const lockedData = useMemo(() => {
    if (!todaysCompletedWorkout) return null;
    const exercises = todaysCompletedWorkout.exercises.map((ex, i) => ({
      id: `locked_${i}`,
      name: ex.name,
      sets: [] as ProgramSet[],
    }));
    const lockedLog: WorkoutLog = {};
    todaysCompletedWorkout.exercises.forEach((ex, i) => {
      lockedLog[`locked_${i}`] = {
        warmup: ex.sets.filter(s => s.type === "warmup").map(s => ({ weight: s.weight, reps: s.reps, done: s.done, fillKey: 0 })),
        working: ex.sets.filter(s => s.type === "working").map(s => ({ weight: s.weight, reps: s.reps, done: s.done, fillKey: 0 })),
        notes: ex.notes,
      };
    });
    return { exercises, log: lockedLog };
  }, [todaysCompletedWorkout]);

  // ── Timer modal ──────────────────────────────────────────────────────────────
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [timerMode, setTimerMode] = useState<"timer" | "stopwatch">("timer");
  const tabOffset = useSharedValue(0); // 0 = timer, 1 = stopwatch
  const tabTrackWidth = useSharedValue(0);
  const notesBtnOpacity = useSharedValue(1);
  const notesBtnStyle   = useAnimatedStyle(() => ({ opacity: notesBtnOpacity.value }));
  const pillAnimStyle = useAnimatedStyle(() => ({
    width: tabTrackWidth.value / 2,
    transform: [{ translateX: tabOffset.value * (tabTrackWidth.value / 2) }],
  }));
  const timerLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(tabOffset.value, [0, 1], ["#ffffff", isDark ? "#8896A7" : "#8896A7"]),
  }));
  const stopwatchLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(tabOffset.value, [0, 1], [isDark ? "#8896A7" : "#8896A7", "#ffffff"]),
  }));
  // Countdown
  const [countdownDuration, setCountdownDuration] = useState(60);
  const [countdownRemaining, setCountdownRemaining] = useState(60);
  const [countdownActive, setCountdownActive] = useState(false);
  const [editingDuration, setEditingDuration] = useState(false);
  const [editMins, setEditMins] = useState("01");
  const [editSecs, setEditSecs] = useState("00");
  const countdownEndRef = useRef<number | null>(null);
  // Stopwatch
  const [swElapsed, setSwElapsed] = useState(0);
  const [swRunning, setSwRunning] = useState(false);
  const swStartRef = useRef<number | null>(null);
  const swOffsetRef = useRef(0);

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

  // Countdown — wall-clock based to avoid drift
  useEffect(() => {
    if (!countdownActive) return;
    countdownEndRef.current = Date.now() + countdownRemaining * 1000;
    const tick = () => {
      if (!countdownEndRef.current) return;
      const remaining = Math.ceil((countdownEndRef.current - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdownActive(false);
        setCountdownRemaining(0);
      } else {
        setCountdownRemaining(remaining);
      }
    };
    const id = setInterval(tick, 500);
    const sub = AppState.addEventListener("change", s => { if (s === "active") tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [countdownActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stopwatch
  useEffect(() => {
    if (!swRunning) return;
    swStartRef.current = Date.now();
    const tick = () => {
      if (swStartRef.current)
        setSwElapsed(swOffsetRef.current + Math.floor((Date.now() - swStartRef.current) / 1000));
    };
    const id = setInterval(tick, 500);
    const sub = AppState.addEventListener("change", s => { if (s === "active") tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [swRunning]);

  const loadData = useCallback((forceReload = false) => {
    AsyncStorage.getItem(PROGRAMS_KEY)
      .then(raw => {
        const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
        const found = programs.find(p => p.status === "active") ?? null;
        setActiveProgram(found);
        setAllPrograms(programs);
        // Don't overwrite exercises/log if a workout is already in progress (unless forceReload after discard)
        if (found && (!isWorkoutActiveRef.current || forceReload)) {
          const todayStr = todayYMD();
          AsyncStorage.getItem(WORKOUT_DAY_OVERRIDE_KEY).then(overrideRaw => {
            let workout = getTodaysWorkout(found);
            if (overrideRaw) {
              const override: { date: string; workoutName: string } = JSON.parse(overrideRaw);
              if (override.date === todayStr) {
                const dayIndex = found.cyclePattern.indexOf(override.workoutName);
                const workoutKey = `${dayIndex}:${override.workoutName}`;
                const exercises = found.workouts[workoutKey] ?? [];
                workout = { name: override.workoutName, exercises };
              }
            }
            setWorkoutInfo(workout);
            if (workout) {
              setIsometricExIds(new Set(workout.exercises.filter(e => e.isIsometric).map(e => e.id)));
              setLog(initLog(workout.exercises));
            }
          }).catch((e) => {
            warnStorage("getItem", WORKOUT_DAY_OVERRIDE_KEY, e);
            const workout = getTodaysWorkout(found);
            setWorkoutInfo(workout);
            if (workout) {
              setIsometricExIds(new Set(workout.exercises.filter(e => e.isIsometric).map(e => e.id)));
              setLog(initLog(workout.exercises));
            }
          });
        }
      })
      .catch((e) => warnStorage("getItem", PROGRAMS_KEY, e));

    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setCustomExercises(parsed as CustomExercise[]);
    }).catch((e) => warnStorage("getItem", CUSTOM_KEY, e));

    const todayStr = todayYMD();
    AsyncStorage.getItem(WORKOUT_HISTORY_KEY).then(raw => {
      const history: CompletedWorkout[] = raw ? JSON.parse(raw) : [];
      setTodaysCompletedWorkout(history.find(w => w.date === todayStr) ?? null);
      setPrevByName(buildPrevByName(history));
    }).catch((e) => warnStorage("getItem", WORKOUT_HISTORY_KEY, e));
  }, []);

  // Restore an in-progress workout draft (if any) before loadData runs, so the
  // template loader doesn't clobber a workout the user was mid-way through.
  useEffect(() => {
    AsyncStorage.getItem(WORKOUT_DRAFT_KEY).then(raw => {
      if (raw) {
        try {
          const draft = JSON.parse(raw);
          if (draft?.date === todayYMD() && draft.workoutInfo && draft.log) {
            setWorkoutInfo(draft.workoutInfo);
            setLog(draft.log);
            setIsometricExIds(new Set(draft.isometricExIds ?? []));
            setNotes(draft.notes ?? "");
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

  useFocusEffect(useCallback(() => {
    if (draftRestored) loadData();

    if (pendingChangingExId.current) {
      setChangingExId(pendingChangingExId.current);
      pendingChangingExId.current = null;
    }
  }, [loadData, draftRestored]));

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
    AsyncStorage.setItem(
      WORKOUT_DRAFT_KEY,
      JSON.stringify({
        date: todayYMD(),
        workoutInfo,
        log,
        isometricExIds: Array.from(isometricExIds),
        notes,
        isFreeWorkout,
        freeWorkoutAddToProgram,
      })
    ).catch((e) => warnStorage("setItem", WORKOUT_DRAFT_KEY, e));
  }, [draftRestored, todaysCompletedWorkout, isRunning, workoutInfo, log, isometricExIds, notes, isFreeWorkout, freeWorkoutAddToProgram]);

  const clearDraft = useCallback(() => {
    draftLockedRef.current = false;
    AsyncStorage.removeItem(WORKOUT_DRAFT_KEY).catch((e) => warnStorage("removeItem", WORKOUT_DRAFT_KEY, e));
  }, []);

  const updateSet = (exId: string, type: "warmup" | "working", idx: number, field: "weight" | "reps", value: string) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      const sets = [...exLog[type]];
      sets[idx] = { ...sets[idx], [field]: value };
      return { ...prev, [exId]: { ...exLog, [type]: sets } };
    });
  };

  const autoTickIfComplete = (exId: string, type: "warmup" | "working", idx: number) => {
    const cur = log[exId]?.[type]?.[idx];
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
      startRestTimer(workoutInfo?.exercises.find(e => e.id === exId)?.restSeconds ?? 0);
    }
  };

  const toggleDone = (exId: string, type: "warmup" | "working", idx: number) => {
    const becomingDone = !log[exId]?.[type]?.[idx]?.done;
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      const sets = [...exLog[type]];
      sets[idx] = { ...sets[idx], done: !sets[idx].done };
      return { ...prev, [exId]: { ...exLog, [type]: sets } };
    });
    startTimer();
    if (becomingDone) startRestTimer(workoutInfo?.exercises.find(e => e.id === exId)?.restSeconds ?? 0);
  };

  const addSet = (exId: string) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      return { ...prev, [exId]: { ...exLog, working: [...exLog.working, makeSet()] } };
    });
  };

  const toggleSetType = (exId: string, type: "warmup" | "working", localIdx: number) => {
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
  };

  const removeSet = (exId: string) => {
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
  };

  const updateExNotes = (exId: string, notes: string) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      return { ...prev, [exId]: { ...exLog, notes } };
    });
  };

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

  const moveExercise = (exId: string, dir: "up" | "down") => {
    setWorkoutInfo(prev => {
      if (!prev) return prev;
      const arr = [...prev.exercises];
      const idx = arr.findIndex(e => e.id === exId);
      const target = dir === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= arr.length) return prev;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...prev, exercises: arr };
    });
  };

  const removeExercise = (exId: string) => {
    setWorkoutInfo(prev => prev ? { ...prev, exercises: prev.exercises.filter(e => e.id !== exId) } : prev);
    setLog(prev => { const next = { ...prev }; delete next[exId]; return next; });
    setCollapsingIds(prev => { const next = new Set(prev); next.delete(exId); return next; });
  };

  const [collapsingIds, setCollapsingIds] = useState<Set<string>>(new Set());
  const startCollapse = (exId: string) => setCollapsingIds(prev => new Set(prev).add(exId));

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
    setWorkoutInfo({ name, exercises: [] });
    setLog({});
    const todayStr = todayYMD();
    AsyncStorage.setItem(WORKOUT_DAY_OVERRIDE_KEY, JSON.stringify({ date: todayStr, workoutName: name }))
      .catch((e) => warnStorage("setItem", WORKOUT_DAY_OVERRIDE_KEY, e));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCustomWorkoutNamingOpen(false);
  };

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

  const exerciseProgress = useMemo(() => {
    if (!workoutInfo) return { done: 0, total: 0 };
    const total = workoutInfo.exercises.length;
    let done = 0;
    for (const ex of workoutInfo.exercises) {
      const exLog = log[ex.id];
      if (!exLog) continue;
      const sets = [...exLog.warmup, ...exLog.working];
      if (sets.length > 0 && sets.every(s => s.done)) done++;
    }
    return { done, total };
  }, [workoutInfo, log]);

  // Build the in-memory CompletedWorkout from current state. Pure — no I/O.
  const buildCompletedWorkout = (): CompletedWorkout | null => {
    if (!workoutInfo) return null;
    const d = new Date();
    const ds = toYMD(d);
    const trimmedNotes = notes.trim();
    return {
      id: `workout_${Date.now()}`,
      date: ds,
      completedAt: d.toISOString(),
      workoutName: workoutInfo.name,
      durationSeconds: elapsedSeconds,
      // sessionNotes mirrors log-workout.tsx's behaviour. Stored only when non-empty.
      sessionNotes: trimmedNotes ? notes : undefined,
      exercises: workoutInfo.exercises.map(ex => {
        const exLog = log[ex.id];
        return {
          name: ex.name,
          sets: [
            ...(exLog?.warmup  ?? []).map(s => ({ type: "warmup"  as const, weight: s.weight, reps: s.reps, done: s.done })),
            ...(exLog?.working ?? []).map(s => ({ type: "working" as const, weight: s.weight, reps: s.reps, done: s.done })),
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
      setPrevByName(buildPrevByName(newHistory));
    } catch (e) {
      warnStorage("persistCompletedWorkout", WORKOUT_HISTORY_KEY, e);
    }
  };

  const handleFinish = () => {
    const doFinish = () => Alert.alert(
      "Workout Complete!",
      "Great session. Rest up and come back stronger.",
      [{ text: "Done", onPress: () => {
        const c = buildCompletedWorkout();
        if (c) {
          // Show the locked completed view synchronously so the UI flips on the
          // same tick — persistence runs in the background.
          setTodaysCompletedWorkout(c);
          void persistCompletedWorkout(c);
        }
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
        stopTimer();
        setIsFreeWorkout(false);
        setFreeWorkoutAddToProgram(false);
        clearDraft();
      } }]
    );

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
            const todayStr = todayYMD();
            const targetId = todaysCompletedWorkout?.id;
            AsyncStorage.getItem(WORKOUT_HISTORY_KEY).then(raw => {
              const history: CompletedWorkout[] = raw ? JSON.parse(raw) : [];
              const updated = history.filter(w => w.id !== targetId);
              AsyncStorage.setItem(WORKOUT_HISTORY_KEY, JSON.stringify(updated))
                .catch((e) => warnStorage("setItem", WORKOUT_HISTORY_KEY, e));
              if (!updated.some(w => w.date === todayStr)) {
                AsyncStorage.getItem(WORKOUT_DATES_KEY).then(raw2 => {
                  const dates: string[] = raw2 ? JSON.parse(raw2) : [];
                  AsyncStorage.setItem(WORKOUT_DATES_KEY, JSON.stringify(dates.filter(d => d !== todayStr)))
                    .catch((e) => warnStorage("setItem", WORKOUT_DATES_KEY, e));
                }).catch((e) => warnStorage("getItem", WORKOUT_DATES_KEY, e));
              }
            }).catch((e) => warnStorage("getItem", WORKOUT_HISTORY_KEY, e));
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
      .catch((e) => warnStorage("setItem", CUSTOM_KEY, e));
  };

  const [prevByName, setPrevByName] = useState<Record<string, string[]>>({});
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

  const openNotes = () => {
    notesBtnOpacity.value = withTiming(0, { duration: 180 });
    setShowNotes(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: notesY.current - 12, animated: true });
    }, 80);
  };
  const closeNotes = () => {
    setShowNotes(false);
    notesBtnOpacity.value = withTiming(1, { duration: 180 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => { setKbHeight(0); setHasNext(false); setHasPrev(false); nextFnRef.current = null; prevFnRef.current = null; });
    return () => { show.remove(); hide.remove(); };
  }, []);

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
  if (!activeProgram && !isFreeWorkout) {
    return (
      <FadeScreen style={{ backgroundColor: t.bg }}>
        <View style={[styles.emptyWrap, { paddingTop: insets.top + 60 }]}>
          <NeuCard dark={isDark} radius={40} style={styles.emptyIconCard}>
            <View style={styles.emptyIconInner}><DumbbellIcon size={34} color={t.ts} /></View>
          </NeuCard>
          <Text style={[styles.emptyTitle, { color: t.tp }]}>No Active Program</Text>
          <Text style={[styles.emptySub, { color: t.ts }]}>
            Start a custom session to log exercises without a program.
          </Text>
          <BounceButton onPress={openCustomWorkoutNaming} style={{ marginTop: 8 }}>
            <View style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>Custom Workout</Text>
            </View>
          </BounceButton>
        </View>
      </FadeScreen>
    );
  }

  // ─── Rest day ───────────────────────────────────────────────────────────────
  if (!workoutInfo) {
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
                <View style={[styles.topIconBtn, { backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                  <Ionicons name="add" size={22} color={APP_LIGHT.tp} />
                </View>
              </BounceButton>
            </View>
          </View>
        )}

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
            currentWorkoutName=""
            onSelectDay={(dayName, fromProgram) => {
              const src = fromProgram ?? activeProgram;
              const dayIndex = src.cyclePattern.indexOf(dayName);
              const workoutKey = `${dayIndex}:${dayName}`;
              const exercises = src.workouts[workoutKey] ?? [];
              setWorkoutInfo({ name: dayName, exercises });
              setLog(initLog(exercises));
              setIsFreeWorkout(false);
              setFreeWorkoutAddToProgram(false);
              const todayStr = todayYMD();
              AsyncStorage.setItem(WORKOUT_DAY_OVERRIDE_KEY, JSON.stringify({ date: todayStr, workoutName: dayName }))
                .catch((e) => warnStorage("setItem", WORKOUT_DAY_OVERRIDE_KEY, e));
              setChangeDayOpen(false);
            }}
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
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 50, paddingBottom: insets.bottom + 140 }]}
      >
        {/* Header scrolls with content */}
        <View style={styles.header}>
          <Text style={[styles.headerName, { color: t.tp }]}>
            {(todaysCompletedWorkout?.workoutName ?? workoutInfo.name).toUpperCase()}
          </Text>
          {(!isFreeWorkout || freeWorkoutAddToProgram) && activeProgram && (
            <Text style={[styles.headerSub, { color: t.ts }]}>
              {activeProgram.name} · Week {getCurrentWeek(activeProgram)} of {activeProgram.totalWeeks}
            </Text>
          )}
        </View>

        {/* Focus mode: inline progress under header */}
        {focusMode && !todaysCompletedWorkout && workoutInfo.exercises.length > 0 && (() => {
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
              <BounceButton onPress={() => router.push("/journal")} style={{ flex: 1 }}>
                <View style={[styles.finishWrap, styles.finishWrapActive, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
                  <View style={[styles.finishBtn, styles.finishBtnActive, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}>
                    <Ionicons name="book-outline" size={18} color={isDark ? APP_DARK.bg : "#fff"} />
                    <Text style={[styles.finishBtnText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Edit in Journal</Text>
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
                onUpdateSet={() => {}} onToggleDone={() => {}} onAutoTick={() => {}}
                exNotes={lockedData.log[exercise.id]?.notes ?? ""}
                onUpdateNotes={() => {}} onAddSet={() => {}} onRemoveSet={() => {}}
                onOpenReorder={() => {}} onChangeExercise={() => {}}
                onRemoveExercise={() => {}} isIsometric={false} onToggleIsometric={() => {}}
                onToggleSetType={() => {}} onInputFocus={() => {}} activeSetFlatIdx={null}
              />
            ))}

          </>
        ) : workoutInfo.exercises.length === 0 ? (
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
                <ExerciseCard
                  exercise={exercise}
                  exIndex={i}
                  totalExercises={workoutInfo.exercises.length}
                  exLog={exLog}
                  isDark={isDark}
                  onUpdateSet={(type, idx, field, value) => updateSet(exercise.id, type, idx, field, value)}
                  onToggleDone={(type, idx) => toggleDone(exercise.id, type, idx)}
                  onAutoTick={(type, idx) => autoTickIfComplete(exercise.id, type, idx)}
                  exNotes={log[exercise.id]?.notes ?? ""}
                  onUpdateNotes={notes => updateExNotes(exercise.id, notes)}
                  onAddSet={() => addSet(exercise.id)}
                  onRemoveSet={() => removeSet(exercise.id)}
                  onOpenReorder={() => setReorderOpen(true)}
                  onChangeExercise={() => setChangingExId(exercise.id)}
                  onRemoveExercise={() => startCollapse(exercise.id)}
                  onToggleSetType={(type, localIdx) => toggleSetType(exercise.id, type, localIdx)}
                  onInputFocus={handleInputFocus}
                  isIsometric={isometricExIds.has(exercise.id)}
                  activeSetFlatIdx={getActiveSetFlatIdx(exercise.id, workoutInfo.exercises, log)}
                  prevSets={prevByName[exercise.name] ?? []}
                  hideIndexLabel
                  onToggleIsometric={() => setIsometricExIds(prev => {
                    const next = new Set(prev);
                    next.has(exercise.id) ? next.delete(exercise.id) : next.add(exercise.id);
                    return next;
                  })}
                />
              </CollapsibleCard>
            );
          })
        )}

        {/* Bottom action row — only when not locked and not in focus mode */}
        {!todaysCompletedWorkout && !focusMode && (
          <View style={styles.bottomActionRow}>
            {workoutInfo.exercises.length > 0 && (
              <Reanimated.View style={[styles.notesToggleWrap, notesBtnStyle]}>
                <BounceButton onPress={openNotes}>
                  <View style={styles.notesToggleBtn}>
                    <NeuCard dark={isDark} radius={20} style={{ width: 40, height: 40 }} innerStyle={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="document-text-outline" size={20} color={t.tp} />
                    </NeuCard>
                    <View style={styles.notesTogglePlus}>
                      <Text style={styles.notesTogglePlusText}>+</Text>
                    </View>
                  </View>
                </BounceButton>
              </Reanimated.View>
            )}
            <View style={{ flex: 1, alignItems: "center" }}>
              <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddingExercise(true); }}>
                <View style={styles.addExBtnWrap}>
                  <View style={styles.addExBtn}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.addExText}>Add Exercise</Text>
                  </View>
                </View>
              </BounceButton>
            </View>
            {workoutInfo.exercises.length > 0 && <View style={styles.notesToggleWrap} />}
          </View>
        )}

        {/* Session Notes — only when not locked and not in focus mode */}
        {!todaysCompletedWorkout && !focusMode && workoutInfo.exercises.length > 0 && (
          <View onLayout={e => { notesY.current = e.nativeEvent.layout.y; }}>
          <ExpandablePanel expanded={showNotes} duration={500}>
            <NeuCard dark={isDark} style={{ marginBottom: 4, borderRadius: 16 }}>
              <View style={styles.notesInner}>
                <View style={styles.notesHeader}>
                  <Text style={{ fontFamily: FontFamily.bold, fontSize: 16, color: t.tp }}>Session Notes</Text>
                  <BounceButton onPress={closeNotes} accessibilityLabel="Close notes">
                    <Ionicons name="close" size={20} color={t.ts} />
                  </BounceButton>
                </View>
                <TextInput
                  style={[styles.notesInput, { color: t.tp }]}
                  placeholder="How's the session going? Anything to note..."
                  placeholderTextColor={t.ts}
                  multiline
                  value={notes}
                  onChangeText={setNotes}
                  onFocus={() => { handleInputFocus(null, null); }}
                  textAlignVertical="top"
                />
              </View>
            </NeuCard>
          </ExpandablePanel>
          </View>
        )}


        {/* Complete Workout button — inline at bottom of scroll, only while running (hidden in focus mode) */}
        {isRunning && !todaysCompletedWorkout && !focusMode && workoutInfo.exercises.length > 0 && (
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

      {/* List mode: pinned progress card just above the nav bar */}
      {!focusMode && !todaysCompletedWorkout && workoutInfo && workoutInfo.exercises.length > 0 && (() => {
        const pct = exerciseProgress.total === 0 ? 0 : (exerciseProgress.done / exerciseProgress.total) * 100;
        return (
          <View pointerEvents="none" style={{ position: "absolute", left: 20, right: 20, bottom: insets.bottom + 80, zIndex: 9 }}>
            <View style={{ backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }}>
              <Text style={{ fontFamily: FontFamily.semibold, fontSize: 13, color: APP_LIGHT.tp, marginBottom: 8 }}>
                {exerciseProgress.done} of {exerciseProgress.total} Exercises Complete
              </Text>
              <AnimatedProgressBar pct={pct} trackColor={APP_LIGHT.div} />
            </View>
          </View>
        );
      })()}

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
          <View pointerEvents="box-none" style={{ position: "absolute", left: 20, right: 20, bottom: insets.bottom + 80, zIndex: 5 }}>
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
            <View style={styles.workoutTimerPill}>
              <Ionicons name="checkmark-circle" size={14} color={ACCT} />
              <Text style={[styles.workoutTimerText, { color: APP_LIGHT.tp }]}>
                {todaysCompletedWorkout.durationSeconds > 0 ? fmtTime(todaysCompletedWorkout.durationSeconds) : "Done"}
              </Text>
            </View>
          ) : isRunning ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={styles.workoutTimerPill}>
                <Ionicons name="time-outline" size={14} color={APP_LIGHT.tp} />
                <Text style={[styles.workoutTimerText, { color: APP_LIGHT.tp }]}>{fmtTime(elapsedSeconds)}</Text>
              </View>
              <BounceButton onPress={handleDiscard}>
                <View style={[styles.topIconBtn, { backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                  <TrashIcon size={18} color={t.ts} />
                </View>
              </BounceButton>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); startTimer(); }}>
                <View style={styles.workoutTimerPill}>
                  <Text style={[styles.workoutTimerText, { color: APP_LIGHT.tp }]}>Start</Text>
                </View>
              </BounceButton>
              {activeProgram && (
                <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWorkoutOptionsOpen(true); }}>
                  <View style={[styles.topIconBtn, { backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                    <Ionicons name="add" size={22} color={APP_LIGHT.tp} />
                  </View>
                </BounceButton>
              )}
            </View>
          )}
        </View>
        <TouchableOpacity onPress={() => setShowTimerModal(true)} activeOpacity={0.8}>
          <View style={[styles.topIconBtn, { backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
            <Ionicons name="timer-outline" size={22} color={APP_LIGHT.tp} />
          </View>
        </TouchableOpacity>
      </View>

      {/* ── Timer Modal ── */}
      <Modal visible={showTimerModal} transparent animationType="fade" onRequestClose={() => setShowTimerModal(false)}>
        <TouchableOpacity style={styles.timerBackdrop} activeOpacity={1} onPress={() => { Keyboard.dismiss(); setShowTimerModal(false); }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: "100%" }}>
            <View style={[styles.timerCard, {
              backgroundColor: isDark ? "#1B1E2C" : "#e8ecf3",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: isDark ? 0.35 : 0.1,
              shadowRadius: 8,
              elevation: 4,
            }]}>

              {/* Header */}
              <View style={[styles.timerCardHeader, { justifyContent: "flex-end" }]}>
                <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowTimerModal(false); }}>
                  <View style={{ padding: 10 }}>
                    <Ionicons name="close" size={22} color={t.ts} />
                  </View>
                </BounceButton>
              </View>

              {/* Tabs */}
              <View
                style={[styles.timerTabs, { backgroundColor: t.div }]}
                onLayout={e => { const w = e.nativeEvent?.layout?.width; if (w != null) tabTrackWidth.value = w - 6; }}
              >
                {/* Sliding pill */}
                <Reanimated.View style={[styles.timerPill, pillAnimStyle]} />
                {/* Timer label */}
                <TouchableOpacity
                  style={styles.timerTab}
                  activeOpacity={0.8}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTimerMode("timer");
                    tabOffset.value = withSpring(0, { damping: 22, stiffness: 300, mass: 0.9 });
                  }}
                >
                  <Reanimated.Text style={[styles.timerTabText, timerLabelColor]}>Timer</Reanimated.Text>
                </TouchableOpacity>
                {/* Stopwatch label */}
                <TouchableOpacity
                  style={styles.timerTab}
                  activeOpacity={0.8}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTimerMode("stopwatch");
                    tabOffset.value = withSpring(1, { damping: 22, stiffness: 300, mass: 0.9 });
                  }}
                >
                  <Reanimated.Text style={[styles.timerTabText, stopwatchLabelColor]}>Stopwatch</Reanimated.Text>
                </TouchableOpacity>
              </View>

              {/* Display */}
              <View style={styles.timerDisplay}>
                {/* Single persistent wrapper — prevents layout shift when toggling edit mode */}
                <View style={{ alignItems: "center", alignSelf: "stretch" }}>
                {timerMode === "timer" && editingDuration && !countdownActive ? (
                  <>
                    <View style={styles.timerEditRow}>
                      <View style={{ width: 36 }} />
                      <TextInput
                        style={[styles.timerEditInput, { color: t.tp, backgroundColor: t.div }]}
                        value={editMins}
                        onChangeText={v => setEditMins(v.replace(/[^0-9]/g, "").slice(0, 2))}
                        keyboardType="number-pad" maxLength={2} selectTextOnFocus
                      />
                      <Text style={[styles.timerTime, { color: t.tp, fontSize: 36 }]}>:</Text>
                      <TextInput
                        style={[styles.timerEditInput, { color: t.tp, backgroundColor: t.div }]}
                        value={editSecs}
                        onChangeText={v => setEditSecs(v.replace(/[^0-9]/g, "").slice(0, 2))}
                        keyboardType="number-pad" maxLength={2} selectTextOnFocus
                      />
                      <TouchableOpacity
                        style={styles.timerEditConfirm}
                        activeOpacity={0.8}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          const m = Math.min(99, Math.max(0, parseInt(editMins) || 0));
                          const s = Math.min(59, Math.max(0, parseInt(editSecs) || 0));
                          const total = Math.max(5, m * 60 + s);
                          setCountdownDuration(total); setCountdownRemaining(total);
                          setEditMins(String(Math.floor(total / 60)).padStart(2, "0"));
                          setEditSecs(String(total % 60).padStart(2, "0"));
                          setEditingDuration(false); Keyboard.dismiss();
                        }}
                      >
                        <Ionicons name="checkmark" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    <View style={{ height: 24 }} />
                  </>
                ) : (
                  <>
                    {/* Time row — buttons always rendered (opacity 0 when hidden) so time never shifts */}
                    {(() => {
                      const showAdj = timerMode === "timer" && !countdownActive && countdownRemaining === countdownDuration;
                      return (
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 }}>
                          <BounceButton
                            style={[styles.timerAdjust, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div, opacity: showAdj ? 1 : 0 }]}
                            onPress={showAdj ? () => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              const v = Math.max(5, countdownDuration - 15);
                              setCountdownDuration(v); setCountdownRemaining(v);
                              setEditMins(String(Math.floor(v / 60)).padStart(2, "0"));
                              setEditSecs(String(v % 60).padStart(2, "0"));
                            } : () => {}}
                          >
                            <Text style={[styles.timerAdjustText, { color: t.ts }]}>-15s</Text>
                          </BounceButton>

                          <BounceButton
                            onPress={() => {
                              if (showAdj) {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setEditMins(String(Math.floor(countdownRemaining / 60)).padStart(2, "0"));
                                setEditSecs(String(countdownRemaining % 60).padStart(2, "0"));
                                setEditingDuration(true);
                              }
                            }}
                          >
                            <Text style={[styles.timerTime, { color: isDark ? "#FFFFFF" : "#1C2030" }]}>
                              {timerMode === "timer" ? fmtTime(countdownRemaining) : fmtTime(swElapsed)}
                            </Text>
                          </BounceButton>

                          <BounceButton
                            style={[styles.timerAdjust, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div, opacity: showAdj ? 1 : 0 }]}
                            onPress={showAdj ? () => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              const v = countdownDuration + 15;
                              setCountdownDuration(v); setCountdownRemaining(v);
                              setEditMins(String(Math.floor(v / 60)).padStart(2, "0"));
                              setEditSecs(String(v % 60).padStart(2, "0"));
                            } : () => {}}
                          >
                            <Text style={[styles.timerAdjustText, { color: t.ts }]}>+15s</Text>
                          </BounceButton>
                        </View>
                      );
                    })()}

                    {/* Hint row — always rendered, fades with same condition as ±15s buttons */}
                    <View style={{ height: 20, justifyContent: "center", alignItems: "center", marginTop: 4 }}>
                      <View style={[styles.timerEditHint, { opacity: timerMode === "timer" && !countdownActive && countdownRemaining === countdownDuration ? 1 : 0 }]}>
                        <Ionicons name="create-outline" size={11} color={t.ts} />
                        <Text style={[styles.timerEditHintText, { color: t.ts }]}>tap to edit</Text>
                      </View>
                    </View>
                  </>
                )}
                </View>
              </View>

              {/* Action buttons */}
              {timerMode === "timer" ? (
                countdownRemaining === 0 ? (
                  <View style={[styles.timerActionGlow, { marginHorizontal: 20, marginBottom: 20 }]}>
                    <BounceButton style={[styles.timerAction, { backgroundColor: ACCT }]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setCountdownRemaining(countdownDuration); }}>
                      <View style={styles.timerActionInner}>
                        <Ionicons name="refresh" size={20} color="#fff" />
                        <Text style={[styles.timerActionText, { color: "#fff" }]}>Reset</Text>
                      </View>
                    </BounceButton>
                  </View>
                ) : countdownActive ? (
                  <BounceButton style={[styles.timerAction, { backgroundColor: t.div, marginHorizontal: 20, marginBottom: 20 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCountdownActive(false); }}>
                    <View style={styles.timerActionInner}>
                      <Ionicons name="pause" size={20} color={t.tp} />
                      <Text style={[styles.timerActionText, { color: t.tp }]}>Pause</Text>
                    </View>
                  </BounceButton>
                ) : countdownRemaining < countdownDuration ? (
                  <View style={styles.timerButtonRow}>
                    <BounceButton style={[styles.timerAction, { backgroundColor: t.div, flex: 1 }]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCountdownRemaining(countdownDuration); }}>
                      <View style={styles.timerActionInner}>
                        <Ionicons name="refresh" size={20} color={t.tp} />
                        <Text style={[styles.timerActionText, { color: t.tp }]}>Reset</Text>
                      </View>
                    </BounceButton>
                    <View style={[styles.timerActionGlow, { flex: 1, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
                      <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setCountdownActive(true); setEditingDuration(false); Keyboard.dismiss(); }}>
                        <View style={styles.timerActionInner}>
                          <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                          <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Continue</Text>
                        </View>
                      </BounceButton>
                    </View>
                  </View>
                ) : (
                  <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE, marginHorizontal: 20, marginBottom: 20, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 8 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setCountdownActive(true); setEditingDuration(false); Keyboard.dismiss(); }}>
                    <View style={styles.timerActionInner}>
                      <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                      <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Start</Text>
                    </View>
                  </BounceButton>
                )
              ) : (
                swRunning ? (
                  <BounceButton style={[styles.timerAction, { backgroundColor: t.div, marginHorizontal: 20, marginBottom: 20 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); swOffsetRef.current = swElapsed; setSwRunning(false); }}>
                    <View style={styles.timerActionInner}>
                      <Ionicons name="stop" size={20} color={t.tp} />
                      <Text style={[styles.timerActionText, { color: t.tp }]}>Stop</Text>
                    </View>
                  </BounceButton>
                ) : swElapsed === 0 ? (
                  <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE, marginHorizontal: 20, marginBottom: 20, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 8 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSwRunning(true); }}>
                    <View style={styles.timerActionInner}>
                      <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                      <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Start</Text>
                    </View>
                  </BounceButton>
                ) : (
                  <View style={styles.timerButtonRow}>
                    <BounceButton style={[styles.timerAction, { backgroundColor: t.div, flex: 1 }]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSwElapsed(0); swOffsetRef.current = 0; swStartRef.current = null; }}>
                      <View style={styles.timerActionInner}>
                        <Ionicons name="refresh" size={20} color={t.tp} />
                        <Text style={[styles.timerActionText, { color: t.tp }]}>Reset</Text>
                      </View>
                    </BounceButton>
                    <View style={[styles.timerActionGlow, { flex: 1, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
                      <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSwRunning(true); }}>
                        <View style={styles.timerActionInner}>
                          <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                          <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Continue</Text>
                        </View>
                      </BounceButton>
                    </View>
                  </View>
                )
              )}

            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>


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
            router.push("/create-custom-exercise");
          }}
          onEditCustom={name => {
            pendingChangingExId.current = changingExId;
            setChangingExId(null);
            router.push({ pathname: "/create-custom-exercise", params: { edit: name } });
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
          onSelectMultiple={names => { names.forEach((name, i) => addExercise(name, i)); setAddingExercise(false); }}
          onDeleteCustom={deleteCustomExercise}
          onCreateCustom={() => {
            setAddingExercise(false);
            router.push("/create-custom-exercise");
          }}
          onEditCustom={name => {
            setAddingExercise(false);
            router.push({ pathname: "/create-custom-exercise", params: { edit: name } });
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
          onSelectDay={(dayName, fromProgram) => {
            const src = fromProgram ?? activeProgram;
            const dayIndex = src.cyclePattern.indexOf(dayName);
            const workoutKey = `${dayIndex}:${dayName}`;
            const exercises = src.workouts[workoutKey] ?? [];
            setWorkoutInfo({ name: dayName, exercises });
            setLog(initLog(exercises));
            setIsFreeWorkout(false);
            setFreeWorkoutAddToProgram(false);
            const todayStr = todayYMD();
            AsyncStorage.setItem(WORKOUT_DAY_OVERRIDE_KEY, JSON.stringify({ date: todayStr, workoutName: dayName }))
              .catch((e) => warnStorage("setItem", WORKOUT_DAY_OVERRIDE_KEY, e));
            setChangeDayOpen(false);
          }}
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
  headerLabel:  { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.4 },
  headerName:   { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 0.3, marginTop: 2 },
  headerSub:        { fontFamily: FontFamily.regular, fontSize: 14 },
  topBar:           { position: "absolute", left: 20, right: 20, zIndex: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topBarLeft:       { flexDirection: "row", alignItems: "center", gap: 10 },
  topIconBtn:       { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  workoutTimerPill: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 100, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  workoutTimerText: { fontFamily: FontFamily.bold, fontSize: 15, letterSpacing: 0.5 },

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
  exNotesHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  exNotesDone:   { fontFamily: FontFamily.semibold, fontSize: 13 },
  exNotesInput:  { fontFamily: FontFamily.regular, fontSize: 13, minHeight: 36, lineHeight: 20 },
  exDoneChip:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  exDoneText:   { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Column headers
  colHeaderRow:   { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 4, paddingBottom: 4 },
  colHeaderText:  { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: "center" },
  repRangeHeader: { fontFamily: FontFamily.bold, fontSize: 10, letterSpacing: 0.5, textAlign: "center", marginBottom: 1 },
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

  // Checkbox

  // Add / remove set
  addSetBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 6, marginTop: 2, borderRadius: 8, borderWidth: 1, borderStyle: "dashed" },
  addSetText:    { fontFamily: FontFamily.semibold, fontSize: 12 },
  removeSetBtn:  { width: 24, height: 24, borderRadius: 13, backgroundColor: "#FF4D4F", alignItems: "center", justifyContent: "center", shadowColor: "#FF4D4F", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },

  // Edit actions
  editMoveRow:   { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 10 },
  editMoveLabel: { fontFamily: FontFamily.regular, fontSize: 12, marginLeft: 2 },
  editChipsRow:  { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 6 },
  editChipWrap:  { alignSelf: "center", borderRadius: 12, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.28, shadowRadius: 5 },
  editChip:      { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  editChipText:  { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Notes
  notesInner:  { padding: 16 },
  notesInput:  { fontFamily: FontFamily.regular, fontSize: 14, minHeight: 72, lineHeight: 22 },
  notesHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },

  // Notes toggle button
  bottomActionRow:    { flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 20 },
  notesToggleWrap:    { width: 44, alignItems: "center", justifyContent: "center" },
  notesToggleBtn:     { width: 40, height: 40 },
  notesTogglePlus:    { position: "absolute", top: -4, right: -6, backgroundColor: ACCT, borderRadius: 7, width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  notesTogglePlusText: { color: "#fff", fontSize: 10, fontFamily: FontFamily.bold, lineHeight: 14 },

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
  addExBtnWrap:     { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  addExBtn:         { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 10, paddingHorizontal: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  addExText:        { fontFamily: FontFamily.semibold, fontSize: 14, color: "#FFFFFF" },

  // Keyboard floating dismiss button
  kbFloatRow: { flexDirection: "row", justifyContent: "flex-end", paddingRight: 10, paddingTop: 8, paddingBottom: 4 },
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

  // Options sheet rows (used by ChangeDaySheet)
  woOptionRow:   { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  woOptionIcon:  { width: 36, alignItems: "center" },
  woOptionTitle: { fontFamily: FontFamily.semibold, fontSize: 15 },
  woOptionSub:   { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },

  // Shared step-header (matches journal pickerStepHeader style)
  woStepHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  woStepBackBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  woStepTitle:   { fontFamily: FontFamily.bold, fontSize: 17, textAlign: "center", flex: 1 },

  // WorkoutOptionsSheet card-style picker
  woPickerTitle:       { fontFamily: FontFamily.bold, fontSize: 20, textAlign: "center", paddingHorizontal: 24, paddingTop: 4, paddingBottom: 16 },
  woPickerContent:     { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  woPickerSection:     { fontFamily: FontFamily.bold, fontSize: 13, letterSpacing: 0.8, marginTop: 8, marginBottom: 12 },
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
  emptyBtn:       { borderRadius: 14, backgroundColor: ACCT, paddingVertical: 14, paddingHorizontal: 28, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  emptyBtnText:   { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },

  // Timer modal
  timerBackdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 24 },
  timerCard:        { borderRadius: 24, width: "100%" },
  timerCardHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 },
  timerCardTitle:   { fontFamily: FontFamily.bold, fontSize: 18 },
  timerTabs:        { flexDirection: "row", borderRadius: 12, marginHorizontal: 20, marginBottom: 20, padding: 3, alignSelf: "stretch" },
  timerPill:        { position: "absolute", top: 3, left: 3, bottom: 3, borderRadius: 10, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6 },
  timerTab:         { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  timerTabText:     { fontFamily: FontFamily.semibold, fontSize: 14 },
  timerDisplay:     { alignItems: "center", justifyContent: "center", minHeight: 120 },
  timerAdjust:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  timerAdjustText:  { fontFamily: FontFamily.semibold, fontSize: 14 },
  timerTime:        { fontFamily: FontFamily.bold, fontSize: 56, letterSpacing: 2 },
  timerEditRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  timerEditInput:   { fontFamily: FontFamily.bold, fontSize: 40, width: 72, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8, textAlign: "center" },
  timerEditConfirm: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 8 },
  timerEditHint:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  timerEditHintText:{ fontFamily: FontFamily.regular, fontSize: 11 },
  timerAction:      { borderRadius: 14, paddingVertical: 14 },
  timerActionInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  timerActionGlow:  { borderRadius: 14, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 8 },
  timerActionText:  { fontFamily: FontFamily.semibold, fontSize: 16 },
  timerButtonRow:   { flexDirection: "row", gap: 10, marginHorizontal: 20, marginBottom: 20 },

});
