import { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Animated,
  PanResponder,
  Modal,
  Easing,
  Keyboard,
  Platform,
} from "react-native";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing as ReEasing,
} from "react-native-reanimated";
import { Svg, Path } from "react-native-svg";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard, { NEU_BG, NEU_BG_DARK } from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import CollapsibleCard from "../components/CollapsibleCard";
import ExercisePicker from "../components/ExercisePicker";
import FadeScreen from "../components/FadeScreen";
import AuroraBackdrop from "../components/AuroraBackdrop";
import TrashIcon from "../components/TrashIcon";
import TimeEditSheet from "../components/TimeEditSheet";
import { computeDurationMins, completedAtISO } from "../components/TimeWheelPicker";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import {
  WORKOUT_HISTORY_KEY,
  WORKOUT_DATES_KEY,
  type CompletedWorkout,
  type CompletedExercise,
} from "../constants/programs";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { scheduleCloudPush } from "../lib/syncManager";
import { useUnit } from "../contexts/UnitContext";
import { formatWeightForDisplay, parseWeightToKg } from "../utils/units";
import { useTheme } from "../contexts/ThemeContext";

const WARMUP_ORANGE = "#ffbf0f";
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// Abbreviated on purpose: with the full name, "Wednesday" was the one day whose
// chip row didn't fit on a single line and pushed the duration chip down.
const DAY_SHORT   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (secs < 3600) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function workoutMetaParts(completedIso: string, durationSeconds: number): { date: string; time: string; duration: string | null } {
  const d = new Date(completedIso);
  const dateStr = `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
  const endTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (durationSeconds > 0) {
    const startTime = new Date(d.getTime() - durationSeconds * 1000)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    return { date: dateStr, time: `${startTime} – ${endTime}`, duration: fmtDuration(durationSeconds) };
  }
  return { date: dateStr, time: endTime, duration: null };
}

// Date / time-range / duration chips under the workout title. Each stat sits in
// its own soft pill so the session summary reads at a glance; in edit mode the
// pills tint ACCT and a solid green Edit chip joins them, so "tap to change the
// time" is unmistakable (the old treatment was small text that merely turned
// green).
function WorkoutMetaRow({ completedIso, durationSeconds, isDark, editable = false }: {
  completedIso: string; durationSeconds: number; isDark: boolean; editable?: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const parts = workoutMetaParts(completedIso, durationSeconds);
  const chipBg = editable
    ? `${ACCT}22`
    : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  // Values stay primary-text in BOTH modes — ACCT green text on the pale green
  // wash is unreadable in light mode. Editability is signalled by the tinted
  // background, the green icons, and the solid Edit chip instead.
  const textColor = t.tp;
  const iconColor = editable ? ACCT : t.ts;
  const items: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string }[] = [
    { icon: "calendar-outline", label: parts.date },
    { icon: "time-outline", label: parts.time },
    ...(parts.duration !== null ? [{ icon: "stopwatch-outline" as const, label: parts.duration }] : []),
  ];
  return (
    <View style={styles.metaRow}>
      {items.map(it => (
        <View key={it.icon} style={[styles.metaChip, { backgroundColor: chipBg }]}>
          <Ionicons name={it.icon} size={13} color={iconColor} />
          <Text style={[styles.metaText, { color: textColor }]}>{it.label}</Text>
        </View>
      ))}
      {editable && (
        <View style={[styles.metaChip, styles.metaEditChip]}>
          <Ionicons name="pencil" size={12} color="#fff" />
          <Text style={[styles.metaText, { color: "#fff" }]}>Edit</Text>
        </View>
      )}
    </View>
  );
}

// ─── KeyboardDismissIcon ──────────────────────────────────────────────────────

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

// ─── ExpandablePanel ───────────────────────────────────────────────────────────

function ExpandablePanel({ expanded, children, duration = 280, clip = false }: {
  expanded: boolean; children: React.ReactNode; duration?: number; clip?: boolean;
}) {
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

  const animStyle = useAnimatedStyle(() =>
    clip
      ? { height: height.value, overflow: "hidden" }
      : { height: height.value, opacity: opacity.value }
  );

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

// ─── DetailDraggableList ───────────────────────────────────────────────────────

function DetailDraggableList({ exercises, isDark, t, onReorder }: {
  exercises: CompletedExercise[];
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  onReorder: (exercises: CompletedExercise[]) => void;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const activeIdxRef = useRef<number | null>(null);
  const hoverIdxRef = useRef<number | null>(null);
  const rowHeightRef = useRef(50);

  const rowAnimsMap = useRef(new Map<number, Animated.Value>());
  exercises.forEach((_, i) => {
    if (!rowAnimsMap.current.has(i)) rowAnimsMap.current.set(i, new Animated.Value(0));
  });

  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useLayoutEffect(() => {
    rowAnimsMap.current.forEach(a => a.setValue(0));
  }, [exercises]);

  const panResponders = useMemo(() =>
    exercises.map((_, idx) =>
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
          rowAnimsMap.current.get(idx)?.setValue(gs.dy);
          const rh = rowHeightRef.current;
          const exList = exercisesRef.current;
          const newHover = Math.max(0, Math.min(exList.length - 1, Math.round(idx + gs.dy / rh)));
          if (newHover !== hoverIdxRef.current) {
            hoverIdxRef.current = newHover;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            exList.forEach((_, i) => {
              if (i === idx) return;
              let toVal = 0;
              if (newHover > idx && i > idx && i <= newHover) toVal = -rh;
              else if (newHover < idx && i < idx && i >= newHover) toVal = rh;
              Animated.spring(rowAnimsMap.current.get(i)!, {
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
        const anim = rowAnimsMap.current.get(i)!;
        return (
          <Animated.View
            key={i}
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
            <Text style={[styles.woDragName, { color: t.tp, flex: 1 }]} numberOfLines={1}>{ex.name}</Text>
          </Animated.View>
        );
      })}
    </>
  );
}

// ─── DetailReorderSheet ────────────────────────────────────────────────────────

function DetailReorderSheet({ visible, exercises, isDark, t, onReorder, onClose }: {
  visible: boolean;
  exercises: CompletedExercise[];
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  onReorder: (exercises: CompletedExercise[]) => void;
  onClose: () => void;
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
          </View>
          <View style={styles.woReorderListWrap}>
            <DetailDraggableList
              exercises={exercises}
              isDark={isDark}
              t={t}
              onReorder={onReorder}
            />
          </View>
          <View style={styles.woReorderDoneRow}>
            <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); closeSheet(); }}>
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

// ─── WorkoutDetailScreen ───────────────────────────────────────────────────────

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const { isKg } = useUnit();

  const insets = useSafeAreaInsets();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Stored weights are canonical kg. The edit buffer + on-screen rows work in the
  // user's display unit; convert kg→display when loading into the buffer / for
  // the read-only view, and display→kg when saving back.
  const exToDisplay = (exs: CompletedExercise[]): CompletedExercise[] =>
    exs.map(ex => ({ ...ex, sets: ex.sets.map(s => ({ ...s, weight: formatWeightForDisplay(s.weight, isKg) })) }));
  const exToKg = (exs: CompletedExercise[]): CompletedExercise[] =>
    exs.map(ex => ({ ...ex, sets: ex.sets.map(s => ({ ...s, weight: parseWeightToKg(s.weight, isKg) })) }));

  const [workout, setWorkout]               = useState<CompletedWorkout | null>(null);
  const [isEditing, setIsEditing]           = useState(false);
  const [editedExercises, setEditedExercises] = useState<CompletedExercise[]>([]);
  const [editedIsIsometric, setEditedIsIsometric] = useState<boolean[]>([]);
  // Editable session time (start = completedAt - duration; end = completedAt).
  const [editedCompletedAt, setEditedCompletedAt] = useState("");
  const [editedDurationSeconds, setEditedDurationSeconds] = useState(0);
  const [timeSheetOpen, setTimeSheetOpen]   = useState(false);
  const [reorderOpen, setReorderOpen]       = useState(false);
  const [changingExIdx, setChangingExIdx]   = useState<number | null>(null);
  // Add-exercise flow (edit mode): shares the ExercisePicker with change-exercise;
  // this flag switches it to multi-select append.
  const [addingExercise, setAddingExercise] = useState(false);
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [collapsingSet, setCollapsingSet]   = useState<{ exIdx: number; setIdx: number } | null>(null);
  const [justAddedSet, setJustAddedSet]     = useState<{ exIdx: number; setIdx: number } | null>(null);
  // Workout-level session notes. Edited + persisted independently of the exercise
  // edit/save flow (saved on blur / close), mirroring the live workout page.
  const [editedSessionNotes, setEditedSessionNotes] = useState("");
  const [showSessionNotes, setShowSessionNotes]     = useState(false);
  const sessionNotesRef = useRef<TextInput | null>(null);
  const setRowHeightRef = useRef(0);
  const [collapsingIndices, setCollapsingIndices] = useState<Set<number>>(new Set());
  const startCollapseEx = (idx: number) => setCollapsingIndices(prev => new Set(prev).add(idx));
  const [kbHeight, setKbHeight] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const nextFnRef = useRef<(() => void) | null>(null);
  const prevFnRef = useRef<(() => void) | null>(null);
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  const handleInputFocus = useCallback((nextFn: (() => void) | null, prevFn: (() => void) | null = null) => {
    setHasNext(nextFn !== null);
    setHasPrev(prevFn !== null);
    nextFnRef.current = nextFn;
    prevFnRef.current = prevFn;
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide  = Keyboard.addListener("keyboardWillHide", () => { setKbHeight(0); setHasNext(false); setHasPrev(false); nextFnRef.current = null; prevFnRef.current = null; });
    return () => { show.remove(); hide.remove(); };
  }, []);

  const divider = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  const bg      = isDark ? NEU_BG_DARK : NEU_BG;

  useEffect(() => {
    AsyncStorage.getItem(WORKOUT_HISTORY_KEY).then(raw => {
      if (!raw) return;
      const history: CompletedWorkout[] = JSON.parse(raw);
      const found = history.find(w => w.id === id) ?? null;
      setWorkout(found);
      if (found) {
        setEditedExercises(exToDisplay(found.exercises));
        setEditedIsIsometric(found.exercises.map(() => false));
        setEditedCompletedAt(found.completedAt);
        setEditedDurationSeconds(found.durationSeconds);
        setEditedSessionNotes(found.sessionNotes ?? "");
      }
    }).catch(() => {});
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setCustomExercises(parsed as CustomExercise[]);
    }).catch(() => {});
  }, [id]);

  const changeExercise = (exIdx: number, newName: string) => {
    setEditedExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : { ...ex, name: newName }));
  };

  // Append exercises picked from the ExercisePicker, each starting with one
  // empty working set (same default as log-workout). The isometric flags array
  // must grow in lockstep — it's index-aligned with editedExercises.
  const addExercises = (names: string[]) => {
    if (names.length === 0) return;
    setEditedExercises(prev => [
      ...prev,
      ...names.map(name => ({
        name,
        sets: [{ type: "working" as const, weight: "", reps: "", done: false }],
        notes: "",
      })),
    ]);
    setEditedIsIsometric(prev => [...prev, ...names.map(() => false)]);
  };

  const handleSave = async () => {
    if (!workout) return;
    const updated = {
      ...workout,
      // display units → canonical kg. A filled set on a logged workout was
      // performed, so mark it done on save — progress stats only count done
      // working sets, and this edit view has no checkbox (sets added here or
      // via Add Set start done:false and would otherwise never count). A set
      // left empty stays not-done and is ignored by stats.
      exercises: exToKg(editedExercises).map(ex => ({
        ...ex,
        sets: ex.sets.map(s =>
          !s.done && (s.weight.trim() || s.reps.trim()) ? { ...s, done: true } : s,
        ),
      })),
      completedAt: editedCompletedAt || workout.completedAt,
      durationSeconds: editedDurationSeconds,
    };
    const raw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
    const history: CompletedWorkout[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(
      WORKOUT_HISTORY_KEY,
      JSON.stringify(history.map(w => w.id === updated.id ? updated : w))
    );
    scheduleCloudPush();
    setWorkout(updated);
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (workout) {
      setEditedExercises(exToDisplay(workout.exercises));
      setEditedIsIsometric(workout.exercises.map(() => false));
      setEditedCompletedAt(workout.completedAt);
      setEditedDurationSeconds(workout.durationSeconds);
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!workout) return;
    Alert.alert(
      "Delete Workout?",
      `"${workout.workoutName}" will be permanently removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const raw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
            const history: CompletedWorkout[] = raw ? JSON.parse(raw) : [];
            const updated = history.filter(w => w.id !== workout.id);
            await AsyncStorage.setItem(WORKOUT_HISTORY_KEY, JSON.stringify(updated));
            if (!updated.some(w => w.date === workout.date)) {
              const dRaw = await AsyncStorage.getItem(WORKOUT_DATES_KEY);
              const dates: string[] = dRaw ? JSON.parse(dRaw) : [];
              await AsyncStorage.setItem(WORKOUT_DATES_KEY, JSON.stringify(dates.filter(d => d !== workout.date)));
            }
            scheduleCloudPush();
            router.back();
          },
        },
      ]
    );
  };

  // Persist just the session notes back to history (independent of the exercise
  // save flow). Reads the latest history so it never clobbers other edits, and
  // mirrors the change into local `workout` state so handleSave's `...workout`
  // carries it forward. No-ops when nothing changed to avoid spurious sync pushes.
  const persistSessionNotes = async (value: string) => {
    if (!workout) return;
    const next = value.trim() ? value : undefined;
    if ((workout.sessionNotes ?? "") === (next ?? "")) return;
    const raw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
    const history: CompletedWorkout[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(
      WORKOUT_HISTORY_KEY,
      JSON.stringify(history.map(w => (w.id === workout.id ? { ...w, sessionNotes: next } : w))),
    );
    scheduleCloudPush();
    setWorkout(prev => (prev ? { ...prev, sessionNotes: next } : prev));
  };

  const openSessionNotes = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowSessionNotes(true);
    setTimeout(() => sessionNotesRef.current?.focus(), 80);
  };

  const closeSessionNotes = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    void persistSessionNotes(editedSessionNotes);
    setShowSessionNotes(false);
  };

  const updateNote = (exIdx: number, value: string) => {
    setEditedExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : { ...ex, notes: value }));
  };

  const updateSet = (exIdx: number, setIdx: number, field: "weight" | "reps", value: string) => {
    setEditedExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex,
      sets: ex.sets.map((s, j) => j !== setIdx ? s : { ...s, [field]: value }),
    }));
  };

  const updateExName = (exIdx: number, name: string) => {
    setEditedExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : { ...ex, name }));
  };

  const toggleSetType = (exIdx: number, setIdx: number) => {
    setEditedExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex,
      sets: ex.sets.map((s, j) => j !== setIdx ? s : {
        ...s, type: s.type === "warmup" ? "working" : "warmup",
      }),
    }));
  };

  const addSet = (exIdx: number) => {
    setEditedExercises(prev => {
      const updated = prev.map((ex, i) => i !== exIdx ? ex : {
        ...ex,
        sets: [...ex.sets, { type: "working" as const, weight: "", reps: "", done: false }],
      });
      setJustAddedSet({ exIdx, setIdx: updated[exIdx].sets.length - 1 });
      return updated;
    });
  };

  const removeSet = (exIdx: number) => {
    const lastIdx = editedExercises[exIdx].sets.length - 1;
    setCollapsingSet({ exIdx, setIdx: lastIdx });
  };

  const removeExercise = (exIdx: number) => {
    setEditedExercises(prev => prev.filter((_, i) => i !== exIdx));
    setEditedIsIsometric(prev => prev.filter((_, i) => i !== exIdx));
  };

  const toggleIsometric = (exIdx: number) => {
    setEditedIsIsometric(prev => prev.map((v, i) => i === exIdx ? !v : v));
  };

  const handleReorder = (reordered: CompletedExercise[]) => {
    const oldOrder = editedExercises;
    setEditedExercises(reordered);
    setEditedIsIsometric(reordered.map(ex => {
      const oldIdx = oldOrder.findIndex(o => o.name === ex.name);
      return oldIdx >= 0 ? editedIsIsometric[oldIdx] : false;
    }));
  };

  const exercises = workout ? (isEditing ? editedExercises : exToDisplay(workout.exercises)) : [];

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Blush glow — carries the Journal flow's tint into this detail screen */}
      <AuroraBackdrop dark={isDark} tint="blush" />
      {/* Top gradient blur */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 14, left: 20, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.navBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.navBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      {/* Action buttons */}
      <View style={{ position: "absolute", top: insets.top + 14, right: 20, zIndex: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
        {isEditing ? (
          <>
            <TouchableOpacity onPress={handleCancel} activeOpacity={0.8}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView glassEffectStyle="regular" style={styles.navBtn}>
                  <Ionicons name="close" size={22} color={t.tp} />
                </GlassView>
              ) : (
                <View style={[styles.navBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
                  <Ionicons name="close" size={22} color={t.tp} />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} activeOpacity={0.8} style={{ shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }}>
              <View style={[styles.navBtn, { backgroundColor: ACCT }]}>
                <Ionicons name="checkmark" size={22} color="#fff" />
              </View>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={() => setIsEditing(true)} activeOpacity={0.8}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView glassEffectStyle="regular" style={styles.navBtn}>
                  <Ionicons name="create-outline" size={20} color={t.tp} />
                </GlassView>
              ) : (
                <View style={[styles.navBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
                  <Ionicons name="create-outline" size={20} color={t.tp} />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} activeOpacity={0.8}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView glassEffectStyle="regular" style={styles.navBtn}>
                  <TrashIcon size={18} color={t.tp} />
                </GlassView>
              ) : (
                <View style={[styles.navBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
                  <TrashIcon size={18} color={t.tp} />
                </View>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + (isEditing ? 100 : 40), paddingHorizontal: 20 }}
      >
        {/* Nav title — scrolls with content */}
        <View style={styles.scrollTitleRow}>
          <View style={{ width: 66 }} />
          <Text style={[styles.navTitle, { color: t.tp }]}>JOURNAL</Text>
          <View style={{ width: 66 }} />
        </View>

        {workout && (
          <>
            {/* Header */}
            <View style={{ marginBottom: 24 }}>
              <Text style={[styles.title, { color: t.tp }]}>{workout.workoutName}</Text>
              {isEditing ? (
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTimeSheetOpen(true); }}
                  activeOpacity={0.7}
                  style={{ alignSelf: "flex-start" }}
                >
                  <WorkoutMetaRow completedIso={editedCompletedAt || workout.completedAt} durationSeconds={editedDurationSeconds} isDark={isDark} editable />
                </TouchableOpacity>
              ) : (
                <WorkoutMetaRow completedIso={workout.completedAt} durationSeconds={workout.durationSeconds} isDark={isDark} />
              )}
            </View>

            {/* Session Notes — workout-level, same button style as the live workout page */}
            <View style={{ marginBottom: 20 }}>
              {showSessionNotes ? (
                <NeuCard dark={isDark} style={{ borderRadius: 16 }}>
                  <View style={styles.sessionNotesInner}>
                    <View style={styles.sessionNotesHeader}>
                      <Text style={[styles.sessionNotesTitle, { color: t.tp }]}>Session Notes</Text>
                      <BounceButton onPress={closeSessionNotes} accessibilityLabel="Save session notes">
                        <View style={styles.notesTickBtn}>
                          <Ionicons name="checkmark" size={18} color="#fff" />
                        </View>
                      </BounceButton>
                    </View>
                    <TextInput
                      ref={r => { sessionNotesRef.current = r; }}
                      style={[styles.sessionNotesInput, { color: t.tp }]}
                      placeholder="How did the session go? Anything to note..."
                      placeholderTextColor={t.ts}
                      multiline
                      value={editedSessionNotes}
                      onChangeText={setEditedSessionNotes}
                      onBlur={() => void persistSessionNotes(editedSessionNotes)}
                      textAlignVertical="top"
                    />
                  </View>
                </NeuCard>
              ) : editedSessionNotes.trim() ? (
                <TouchableOpacity activeOpacity={0.85} onPress={openSessionNotes}>
                  <NeuCard dark={isDark} style={{ borderRadius: 16 }}>
                    <View style={styles.sessionNotesInner}>
                      <View style={styles.sessionNotesHeader}>
                        <Text style={[styles.sessionNotesTitle, { color: t.tp }]}>Session Notes</Text>
                        <Ionicons name="pencil" size={15} color={t.ts} />
                      </View>
                      <Text style={[styles.sessionNotesText, { color: t.ts }]}>{editedSessionNotes.trim()}</Text>
                    </View>
                  </NeuCard>
                </TouchableOpacity>
              ) : (
                <BounceButton onPress={openSessionNotes} accessibilityLabel="Add session notes">
                  <View style={styles.sessionNotesAddRow}>
                    <View style={styles.notesToggleBtn}>
                      <NeuCard dark={isDark} radius={20} style={{ width: 40, height: 40 }} innerStyle={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="document-text-outline" size={20} color={t.tp} />
                      </NeuCard>
                      <View style={styles.notesTogglePlus}>
                        <Text style={styles.notesTogglePlusText}>+</Text>
                      </View>
                    </View>
                    <Text style={[styles.sessionNotesAddLabel, { color: t.ts }]}>Add session notes</Text>
                  </View>
                </BounceButton>
              )}
            </View>

            {/* Exercises */}
            {exercises.map((ex, ei) => {
              let workingCounter = 0;
              const isIsometric = editedIsIsometric[ei] ?? false;
              return (
                <CollapsibleCard
                  key={ei}
                  isCollapsing={collapsingIndices.has(ei)}
                  onCollapsed={() => {
                    removeExercise(ei);
                    setCollapsingIndices(prev => { const n = new Set(prev); n.delete(ei); return n; });
                  }}
                >
                <NeuCard dark={isDark} style={{ borderRadius: 20, marginBottom: 20 }}>
                  <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 }}>

                    {/* Exercise name */}
                    <View style={styles.exHeader}>
                      <NeuCard dark={isDark} radius={16} style={styles.exNumBadge} innerStyle={styles.exNumInner}>
                        <Text style={[styles.exNumText, { color: ACCT }]}>{ei + 1}</Text>
                      </NeuCard>
                      <TextInput
                        style={[styles.exName, { color: t.tp, flex: 1, padding: 0 }]}
                        value={ex.name}
                        onChangeText={name => updateExName(ei, name.replace(/\n/g, ""))}
                        returnKeyType="default"
                        editable={isEditing}
                        multiline
                        scrollEnabled={false}
                      />
                    </View>

                    {/* Column headers */}
                    <View style={[styles.colHeaderRow, { borderBottomColor: divider }]}>
                      <View style={styles.setCol}>
                        <Text style={[styles.colText, { color: t.ts }]}>SET</Text>
                      </View>
                      <View style={{ width: 32 }} />
                      <View style={styles.kgCol}>
                        <Text style={[styles.colText, { color: t.ts }]}>WEIGHT</Text>
                      </View>
                      <View style={[styles.repsCol, { paddingRight: 20 }]}>
                        <Text style={[styles.colText, { color: t.ts }]}>{isIsometric ? "HOLD" : "REPS"}</Text>
                      </View>
                    </View>

                    {/* Set rows */}
                    <View style={{ paddingTop: 0, paddingBottom: 0 }}>
                      {ex.sets.map((set, j) => {
                        const isWU = set.type === "warmup";
                        if (!isWU) workingCounter++;
                        const label = isWU ? "W" : String(workingCounter);
                        const isLast = j === ex.sets.length - 1;
                        const isThisCollapsing = collapsingSet?.exIdx === ei && collapsingSet?.setIdx === j;
                        const isThisExpanding = justAddedSet?.exIdx === ei && justAddedSet?.setIdx === j;
                        return (
                          <CollapsibleCard
                            key={j}
                            isCollapsing={isThisCollapsing}
                            onCollapsed={() => {
                              setEditedExercises(prev => prev.map((ex, i) => i !== ei ? ex : {
                                ...ex,
                                sets: ex.sets.slice(0, -1),
                              }));
                              setCollapsingSet(null);
                            }}
                            expanding={isThisExpanding}
                            naturalHeight={setRowHeightRef.current || 56}
                          >
                          <View
                            style={styles.setRow}
                            onLayout={(!isThisExpanding && !isThisCollapsing) ? (e) => {
                              const h = e.nativeEvent.layout.height;
                              if (h > 0) setRowHeightRef.current = h;
                            } : undefined}
                          >
                            <View style={[styles.setCol, { alignItems: "center", justifyContent: "center" }]}>
                              {isEditing ? (
                                <TouchableOpacity
                                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSetType(ei, j); }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  activeOpacity={0.6}
                                >
                                  <View style={[styles.setBadge, { borderColor: isWU ? WARMUP_ORANGE : divider }]}>
                                    <Text style={[styles.setBadgeText, { color: isWU ? WARMUP_ORANGE : t.tp }]}>{label}</Text>
                                  </View>
                                </TouchableOpacity>
                              ) : (
                                <Text style={[styles.setText, { color: isWU ? WARMUP_ORANGE : t.tp }]}>{label}</Text>
                              )}
                            </View>
                            <View style={{ width: 32 }} />
                            <View style={styles.inputCell}>
                              <View style={[styles.inputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderWidth: 1, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                                <TextInput
                                  ref={r => { inputRefs.current[`${ei}-${j}-w`] = r; }}
                                  style={[styles.inputText, { color: isDark ? "#fff" : t.tp }]}
                                  value={set.weight}
                                  onChangeText={v => updateSet(ei, j, "weight", v)}
                                  keyboardType="decimal-pad"
                                  placeholder="—"
                                  placeholderTextColor={t.ts}
                                  editable={isEditing}
                                  onFocus={() => {
                                    const next = inputRefs.current[`${ei}-${j}-r`];
                                    const prevKey = j > 0 ? `${ei}-${j - 1}-r` : ei > 0 ? `${ei - 1}-${exercises[ei - 1].sets.length - 1}-r` : null;
                                    const prev = prevKey ? inputRefs.current[prevKey] : null;
                                    handleInputFocus(next ? () => next.focus() : null, prev ? () => prev!.focus() : null);
                                  }}
                                />
                              </View>
                            </View>
                            <View style={[styles.inputCell, { paddingRight: 20 }]}>
                              <View style={[styles.inputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderWidth: 1, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                                <TextInput
                                  ref={r => { inputRefs.current[`${ei}-${j}-r`] = r; }}
                                  style={[styles.inputText, { color: isDark ? "#fff" : t.tp }]}
                                  value={set.reps}
                                  onChangeText={v => updateSet(ei, j, "reps", v)}
                                  keyboardType="number-pad"
                                  placeholder="—"
                                  placeholderTextColor={t.ts}
                                  editable={isEditing}
                                  onFocus={() => {
                                    let nextKey: string | null = null;
                                    if (j < ex.sets.length - 1) nextKey = `${ei}-${j + 1}-w`;
                                    else if (ei < exercises.length - 1) nextKey = `${ei + 1}-0-w`;
                                    const next = nextKey ? inputRefs.current[nextKey] : null;
                                    const prev = inputRefs.current[`${ei}-${j}-w`];
                                    handleInputFocus(next ? () => next!.focus() : null, prev ? () => prev!.focus() : null);
                                  }}
                                />
                              </View>
                            </View>
                            {isEditing && isLast && ex.sets.length > 1 && (
                              <TouchableOpacity
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); removeSet(ei); }}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={{ position: "absolute", right: 0, top: 16 }}
                              >
                                <View style={styles.removeSetBtn}>
                                  <Ionicons name="remove" size={13} color="#fff" />
                                </View>
                              </TouchableOpacity>
                            )}
                          </View>
                          </CollapsibleCard>
                        );
                      })}
                    </View>

                    {(isEditing || ex.notes?.trim()) ? (
                    <View style={[styles.notesEditRow, { borderTopColor: divider }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.notesLabel, { color: t.tp }]}>Notes</Text>
                        {isEditing ? (
                          <TextInput
                            style={[styles.notesInput, { color: t.tp }]}
                            value={ex.notes ?? ""}
                            onChangeText={v => updateNote(ei, v)}
                            placeholder="Add note..."
                            placeholderTextColor={t.ts}
                            multiline
                          />
                        ) : (
                          <Text style={[styles.notesInput, { color: t.ts }]}>
                            {ex.notes?.trim() || ""}
                          </Text>
                        )}
                      </View>
                      {isEditing && <Ionicons name="pencil" size={14} color={t.ts} style={{ marginTop: 2 }} />}
                    </View>
                    ) : null}

                    {/* Edit panel — same design as workout page */}
                    <ExpandablePanel expanded={isEditing} duration={500} clip>
                      <>
                        {/* Move row + Add Set */}
                        <View style={[styles.editMoveRow, { borderTopColor: divider }]}>
                          <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setReorderOpen(true); }}
                            activeOpacity={0.7}
                            style={styles.exReorderBtn}
                          >
                            <DragHandleIcon color={t.ts} />
                          </TouchableOpacity>
                          <Text style={[styles.editMoveLabel, { color: t.ts, flex: 1 }]}>Move exercise</Text>
                          <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); addSet(ei); }}
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
                              onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleIsometric(ei); },
                              icon: <Ionicons name="timer-outline" size={13} color={isIsometric ? ACCT : t.ts} />,
                              label: isIsometric ? "Hold" : "Reps",
                              color: isIsometric ? ACCT : t.ts,
                            },
                            {
                              onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setChangingExIdx(ei); },
                              icon: <Ionicons name="swap-horizontal" size={13} color={t.ts} />,
                              label: "Change",
                              color: t.ts,
                            },
                            {
                              onPress: () => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                Alert.alert(
                                  "Remove Exercise",
                                  `Remove "${ex.name}" from this workout?`,
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    { text: "Remove", style: "destructive", onPress: () => startCollapseEx(ei) },
                                  ]
                                );
                              },
                              icon: <TrashIcon size={13} color="#FF4D4F" />,
                              label: "Remove",
                              color: "#FF4D4F",
                            },
                          ].map(({ onPress, icon, label, color }) => (
                            <TouchableOpacity key={label} onPress={onPress} activeOpacity={0.8} style={{ flex: 1 }}>
                              <View style={{ borderRadius: 12, backgroundColor: bg, shadowColor: isDark ? "#000" : "#a3afc0", shadowOffset: { width: isDark ? 0 : 4, height: isDark ? 2 : 4 }, shadowOpacity: isDark ? 0.35 : 0.5, shadowRadius: 8 }}>
                                <View style={{ borderRadius: 12, backgroundColor: bg, shadowColor: isDark ? "transparent" : "#FFFFFF", shadowOffset: { width: -3, height: -3 }, shadowOpacity: isDark ? 0 : 1, shadowRadius: 4 }}>
                                  <View style={{ borderRadius: 12, backgroundColor: bg, overflow: "hidden", paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 }}>
                                    {icon}
                                    <Text style={[styles.editChipText, { color }]}>{label}</Text>
                                  </View>
                                </View>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    </ExpandablePanel>

                  </View>
                </NeuCard>
                </CollapsibleCard>
              );
            })}

          </>
        )}
      </ScrollView>

      {/* Add an exercise to this logged workout — the same floating round green
          + used by the workout / log-workout screens, pinned bottom-left while
          editing. History edits never touch the program — only this
          CompletedWorkout. */}
      {isEditing && (
        <View style={{ position: "absolute", left: 20, bottom: insets.bottom + 24, zIndex: 6 }}>
          <BounceButton
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddingExercise(true); }}
            accessibilityLabel="Add exercise"
            accessibilityRole="button"
          >
            <View style={styles.addRoundWrap}>
              <View style={styles.addRoundBtn}>
                <Ionicons name="add" size={24} color="#fff" />
              </View>
            </View>
          </BounceButton>
        </View>
      )}
      <ExercisePicker
        visible={changingExIdx !== null || addingExercise}
        subtitle={addingExercise ? "ADD EXERCISES" : "CHANGE EXERCISE"}
        customExercises={customExercises}
        onSelectMultiple={names => {
          if (addingExercise) {
            addExercises(names);
            setAddingExercise(false);
          } else {
            if (names.length > 0 && changingExIdx !== null) changeExercise(changingExIdx, names[0]);
            setChangingExIdx(null);
          }
        }}
        onDeleteCustom={name => {
          const next = customExercises.filter(e => e.name !== name);
          setCustomExercises(next);
          AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next)).catch(() => {});
        }}
        onEditCustom={() => {}}
        onCreateCustom={() => {}}
        onClose={() => { setChangingExIdx(null); setAddingExercise(false); }}
        isDark={isDark}
      />
      <DetailReorderSheet
        visible={reorderOpen}
        exercises={editedExercises}
        isDark={isDark}
        t={t}
        onReorder={handleReorder}
        onClose={() => setReorderOpen(false)}
      />
      {workout && editedCompletedAt !== "" && (
        <TimeEditSheet
          visible={timeSheetOpen}
          isDark={isDark}
          title={workout.workoutName}
          subtitle="Start & End Time"
          confirmLabel="Save Time"
          startDate={new Date(new Date(editedCompletedAt).getTime() - editedDurationSeconds * 1000)}
          endDate={new Date(editedCompletedAt)}
          onConfirm={(start, end) => {
            setEditedCompletedAt(completedAtISO(workout.date, end));
            setEditedDurationSeconds(computeDurationMins(start, end) * 60);
            setTimeSheetOpen(false);
          }}
          onClose={() => setTimeSheetOpen(false)}
        />
      )}
      {kbHeight > 0 && Platform.OS === "ios" && (
        <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, flexDirection: "row", gap: 8, zIndex: 999 }}>
          <TouchableOpacity onPress={() => prevFnRef.current?.()} activeOpacity={hasPrev ? 0.75 : 1} disabled={!hasPrev} style={[styles.kbDismissBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff", opacity: hasPrev ? 1 : 0.35 }]}>
              <Ionicons name="chevron-back" size={24} color={isDark ? "#fff" : "#333"} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => nextFnRef.current?.()} activeOpacity={hasNext ? 0.75 : 1} disabled={!hasNext} style={[styles.kbDismissBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff", opacity: hasNext ? 1 : 0.35 }]}>
              <Ionicons name="chevron-forward" size={24} color={isDark ? "#fff" : "#333"} />
            </TouchableOpacity>
          <TouchableOpacity onPress={() => Keyboard.dismiss()} activeOpacity={0.75} style={[styles.kbDismissBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}>
            <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        </View>
      )}
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  navBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },

  title: { fontFamily: FontFamily.bold, fontSize: 26, marginBottom: 4 },
  metaRow:      { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 },
  metaChip:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  metaEditChip: { backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
  metaText:     { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },

  exHeader:    { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  exNumBadge:  { width: 32, height: 32 },
  exNumInner:  { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  exNumText:   { fontFamily: FontFamily.bold, fontSize: 13 },
  exName: { fontFamily: FontFamily.bold, fontSize: 22 },

  colHeaderRow: { flexDirection: "row", alignItems: "center", paddingBottom: 6, paddingHorizontal: 4, borderBottomWidth: 1 },
  colText:      { fontFamily: FontFamily.semibold, fontSize: 11, textAlign: "center", letterSpacing: 0.4 },
  setCol:       { width: 36, alignItems: "center" },
  kgCol:        { flex: 1, alignItems: "center" },
  repsCol:      { flex: 1, alignItems: "center" },

  setRow:       { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 4 },
  setBadge:     { width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  setBadgeText: { fontFamily: FontFamily.semibold, fontSize: 15 },
  setText:      { fontFamily: FontFamily.semibold, fontSize: 15, textAlign: "center" },
  dataText:     { fontFamily: FontFamily.regular, fontSize: 15, textAlign: "center" },
  inputCell:    { flex: 1, alignItems: "center", justifyContent: "center" },
  checkCol:     { width: 32, alignItems: "center", justifyContent: "center" },
  removeSetBtn: { width: 24, height: 24, borderRadius: 13, backgroundColor: "#FF4D4F", alignItems: "center", justifyContent: "center", shadowColor: "#FF4D4F", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },
  addRoundWrap: { borderRadius: 24, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  addRoundBtn:  { width: 44, height: 44, borderRadius: 22, backgroundColor: ACCT, alignItems: "center", justifyContent: "center" },

  inputBox:  { width: 80, height: 40, borderRadius: 10, justifyContent: "center" },
  inputText: { fontFamily: FontFamily.bold, fontSize: 15, textAlign: "center", flex: 1, paddingVertical: 0 },

  notes:        { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", paddingTop: 10, marginTop: 8, borderTopWidth: 1 },
  notesEditRow: { flexDirection: "row", alignItems: "flex-start", borderTopWidth: 1, marginTop: 8, paddingTop: 10, paddingBottom: 10, gap: 6 },
  notesInput:   { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", flex: 1, paddingVertical: 0 },

  editMoveRow:  { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 10 },
  editMoveLabel: { fontFamily: FontFamily.regular, fontSize: 12, marginLeft: 2 },
  exReorderBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  editChipsRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 6 },
  editChipText: { fontFamily: FontFamily.semibold, fontSize: 12 },

  scrollTitleRow: { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 16 },
  navTitle:       { flex: 1, textAlign: "center", fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase" },

  woReorderBackdrop:   { flex: 1, justifyContent: "flex-end" },
  woReorderOverlay:    { backgroundColor: "rgba(0,0,0,0.45)" },
  woReorderSheet:      { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 },
  woReorderHandleArea: { paddingVertical: 12, alignItems: "center" },
  woReorderHandle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  woReorderHeader:     { alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  woReorderTitle:      { fontFamily: FontFamily.bold, fontSize: 16 },
  woReorderListWrap:   { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 },
  woReorderDoneRow:    { alignItems: "center", paddingTop: 16, paddingBottom: 4 },
  woReorderDoneWrap:   { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10 },
  woReorderDoneBtn:    { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 13, paddingHorizontal: 40 },
  woReorderDone:       { fontFamily: FontFamily.semibold, fontSize: 16, color: "#FFFFFF" },

  woDragRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12 },
  woDragHandle:  { paddingHorizontal: 4, paddingVertical: 4, justifyContent: "center", alignItems: "center" },
  woDragNumChip: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  woDragNum:     { fontFamily: FontFamily.bold, fontSize: 13 },
  woDragName:    { fontFamily: FontFamily.regular, fontSize: 15 },
  kbDismissBtn:  { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
  notesLabel:    { fontFamily: FontFamily.semibold, fontSize: 13, marginBottom: 6 },

  // Session notes — button + card styling mirrors the live workout page.
  notesToggleBtn:      { width: 40, height: 40 },
  // Same green save-tick as the live workout page's notes card.
  notesTickBtn:        { width: 32, height: 32, borderRadius: 16, backgroundColor: ACCT, alignItems: "center", justifyContent: "center", shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },
  notesTogglePlus:     { position: "absolute", top: -4, right: -6, backgroundColor: ACCT, borderRadius: 7, width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  notesTogglePlusText: { color: "#fff", fontSize: 10, fontFamily: FontFamily.bold, lineHeight: 14 },
  sessionNotesInner:   { padding: 16 },
  sessionNotesHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sessionNotesTitle:   { fontFamily: FontFamily.bold, fontSize: 16 },
  sessionNotesInput:   { fontFamily: FontFamily.regular, fontSize: 14, minHeight: 72, lineHeight: 22 },
  sessionNotesText:    { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 22 },
  sessionNotesAddRow:  { flexDirection: "row", alignItems: "center", gap: 12 },
  sessionNotesAddLabel: { fontFamily: FontFamily.semibold, fontSize: 14 },
});
