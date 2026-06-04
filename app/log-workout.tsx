import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing as ReEasing } from "react-native-reanimated";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Animated, Easing, KeyboardAvoidingView,
  Platform, Alert, PanResponder, Keyboard,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard, { NEU_BG, NEU_BG_DARK } from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import CollapsibleCard from "../components/CollapsibleCard";
import FadeScreen from "../components/FadeScreen";
import TrashIcon from "../components/TrashIcon";
import ExercisePicker from "../components/ExercisePicker";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../constants/theme";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, logDraftKey,
  normaliseSets, type SavedProgram, type CompletedWorkout, type ProgramSet,
} from "../constants/programs";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { parseStoredDate, formatStoredDate } from "../utils/dates";
import { useTheme } from "../contexts/ThemeContext";

const WARMUP_ORANGE = "#ffbf0f";

const MONTH_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAY_FULL[date.getDay()]} ${d} ${MONTH_FULL[m - 1]}`;
}

type WorkingSet = { type: "warmup" | "working"; weight: string; reps: string; done: boolean; programSet?: ProgramSet };
type LogExercise = {
  id: string;
  name: string;
  sets: WorkingSet[];
  notes: string;
  programNotes?: string;
  isIsometric?: boolean;
};

function makeId(): string {
  return `lex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultSet(type: "warmup" | "working" = "working"): WorkingSet {
  return { type, weight: "", reps: "", done: true };
}

// ─── Time helpers ──────────────────────────────────────────────────────────────

type TimeVal = { hour: number; minute: number; period: "AM" | "PM" };
type WorkoutTime = { start: TimeVal; end: TimeVal };

function toTotalMins(tv: TimeVal): number {
  const h24 = tv.hour % 12 + (tv.period === "PM" ? 12 : 0);
  return h24 * 60 + tv.minute;
}

function computeDurationMins(start: TimeVal, end: TimeVal): number {
  const s = toTotalMins(start);
  const e = toTotalMins(end);
  return e >= s ? e - s : 24 * 60 - s + e;
}

function fmtTimeVal(tv: TimeVal): string {
  return `${tv.hour}:${String(tv.minute).padStart(2, "0")} ${tv.period}`;
}

function fmtDurationMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
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

// ─── WheelPicker ──────────────────────────────────────────────────────────────
// IMPORTANT: Must be a module-level component (not defined inside another
// component). Defining it inside a render function creates a new type on every
// parent re-render, causing React to unmount/remount and losing scroll position.

const WHEEL_H = 46;
const HOURS   = ["1","2","3","4","5","6","7","8","9","10","11","12"];
const MINUTES = ["00","05","10","15","20","25","30","35","40","45","50","55"];
const PERIODS = ["AM","PM"];

function WheelPicker({ items, initialIdx, onSelect, isDark, width, bgColor }: {
  items: string[]; initialIdx: number; onSelect: (idx: number) => void;
  isDark: boolean; width: number; bgColor: string;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const scrollRef = useRef<ScrollView>(null);
  // Keep latest onSelect in a ref so the commit closure is never stale
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Scroll to initial position after layout settles
  useEffect(() => {
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: initialIdx * WHEEL_H, animated: false });
    }, 60);
    return () => clearTimeout(id);
  }, []); // intentionally runs only on mount

  const commit = (y: number) => {
    const idx = Math.min(items.length - 1, Math.max(0, Math.round(y / WHEEL_H)));
    onSelectRef.current(idx);
  };

  const fadeColor = bgColor;

  return (
    <View style={{ width, height: WHEEL_H * 3 }}>
      <ScrollView
        ref={scrollRef}
        snapToInterval={WHEEL_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: WHEEL_H }}
        onMomentumScrollEnd={e => commit(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={e => commit(e.nativeEvent.contentOffset.y)}
      >
        {items.map((item, i) => (
          <View key={i} style={{ height: WHEEL_H, width, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: FontFamily.semibold, fontSize: 20, color: t.tp }}>
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Top and bottom gradient fades — no overflow:hidden needed */}
      <LinearGradient
        pointerEvents="none"
        colors={[fadeColor, fadeColor + "00"]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: WHEEL_H + 6 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[fadeColor + "00", fadeColor]}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: WHEEL_H + 6 }}
      />

      {/* Center selection band */}
      <View pointerEvents="none" style={{
        position: "absolute", top: WHEEL_H, left: 0, right: 0, height: WHEEL_H,
        borderTopWidth: 1, borderBottomWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.09)",
      }} />
    </View>
  );
}

// ─── TimeRow ───────────────────────────────────────────────────────────────────
// Also module-level — must not be defined inside TimePickerSheet.

function TimeRow({ label, val, onChange, isDark, bgColor }: {
  label: string; val: TimeVal; onChange: (v: TimeVal) => void;
  isDark: boolean; bgColor: string;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={s.timeRow}>
      <Text style={[s.timeRowLabel, { color: t.ts }]}>{label}</Text>
      <View style={s.wheelGroup}>
        <WheelPicker
          items={HOURS} isDark={isDark} width={52} bgColor={bgColor}
          initialIdx={val.hour - 1}
          onSelect={idx => onChange({ ...val, hour: idx + 1 })}
        />
        <Text style={[s.wheelColon, { color: t.tp }]}>:</Text>
        <WheelPicker
          items={MINUTES} isDark={isDark} width={52} bgColor={bgColor}
          initialIdx={val.minute / 5}
          onSelect={idx => onChange({ ...val, minute: idx * 5 })}
        />
        <WheelPicker
          items={PERIODS} isDark={isDark} width={52} bgColor={bgColor}
          initialIdx={val.period === "AM" ? 0 : 1}
          onSelect={idx => onChange({ ...val, period: idx === 0 ? "AM" : "PM" })}
        />
      </View>
      {/* phantom matches label width so wheels land at true center */}
      <View style={{ width: 48 }} />
    </View>
  );
}

// ─── TimePickerSheet ───────────────────────────────────────────────────────────

function TimePickerSheet({ visible, isDark, initialTime, onConfirm, onClear, onClose }: {
  visible: boolean; isDark: boolean;
  initialTime: WorkoutTime | null;
  onConfirm: (wt: WorkoutTime) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOp = useRef(new Animated.Value(0)).current;

  const makeDefault = (): WorkoutTime => {
    const now = new Date();
    const h = now.getHours();
    const m = Math.floor(now.getMinutes() / 5) * 5;
    const h12 = h % 12 || 12;
    const endH = (h + 1) % 24;
    return {
      start: { hour: h12,          minute: m, period: h < 12 ? "AM" : "PM" },
      end:   { hour: endH % 12 || 12, minute: m, period: endH < 12 ? "AM" : "PM" },
    };
  };

  const [wt, setWt] = useState<WorkoutTime>(initialTime ?? makeDefault());

  useEffect(() => {
    if (visible) {
      setWt(initialTime ?? makeDefault());
      slideY.setValue(600);
      backdropOp.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOp, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOp, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(600); backdropOp.setValue(0); onClose(); });
  }, [onClose]);

  const durationMins = computeDurationMins(wt.start, wt.end);
  const divider = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)";
  const bgColor = t.bg;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)", opacity: backdropOp }]} />
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismiss} />
      <Animated.View style={[s.timeSheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 16, transform: [{ translateY: slideY }] }]}>
        <View style={s.sheetHandleArea}><View style={s.sheetHandle} /></View>

        {/* Header */}
        <View style={[s.timeSheetHeader, { borderBottomColor: divider }]}>
          <View style={{ width: 44 }} />
          <Text style={[s.timeSheetTitle, { color: t.tp, flex: 1, textAlign: "center" }]}>Workout Time</Text>
          <View style={{ width: 44, alignItems: "flex-end" }}>
            {initialTime && (
              <TouchableOpacity onPress={() => { onClear(); dismiss(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontFamily: FontFamily.semibold, fontSize: 14, color: "#FF4D4F" }}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Pickers — TimeRow is module-level so it never remounts on wt change */}
        <View style={[s.timePickerBody, { borderBottomColor: divider }]}>
          <TimeRow
            label="Start" val={wt.start} isDark={isDark} bgColor={bgColor}
            onChange={v => setWt(prev => ({ ...prev, start: v }))}
          />
          <View style={[s.timeRowDivider, { backgroundColor: divider }]} />
          <TimeRow
            label="End" val={wt.end} isDark={isDark} bgColor={bgColor}
            onChange={v => setWt(prev => ({ ...prev, end: v }))}
          />
        </View>

        {/* Duration */}
        <Text style={[s.timeDuration, { color: t.ts }]}>
          Duration: {fmtDurationMins(durationMins)}
        </Text>

        {/* Confirm */}
        <View style={{ alignItems: "center", paddingHorizontal: 20 }}>
          <BounceButton onPress={() => { onConfirm(wt); dismiss(); }}>
            <View style={s.timeConfirmWrap}>
              <View style={s.timeConfirmBtn}>
                <Text style={s.timeConfirmText}>Save Session Time</Text>
              </View>
            </View>
          </BounceButton>
        </View>
      </Animated.View>
    </Modal>
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

// ─── CheckboxCell ──────────────────────────────────────────────────────────────

function CheckboxCell({ done, isDark, onToggle }: { done: boolean; isDark: boolean; onToggle: () => void }) {
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
      <Animated.View style={[s.checkCircle, done ? {
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

// ─── LogDraggableList ──────────────────────────────────────────────────────────

function LogDraggableList({ exercises, isDark, t, onReorder }: {
  exercises: LogExercise[];
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  onReorder: (exercises: LogExercise[]) => void;
}) {
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
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

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
              s.dragRow,
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
            onLayout={i === 0 ? e => { rowHeightRef.current = e.nativeEvent.layout.height; } : undefined}
          >
            <View {...panResponders[i].panHandlers} style={s.dragHandle}>
              <DragHandleIcon color={t.ts} />
            </View>
            <View style={[s.dragNumChip, { backgroundColor: ACCT + "18" }]}>
              <Text style={[s.dragNum, { color: ACCT }]}>{i + 1}</Text>
            </View>
            <View style={s.dragNameWrap}>
              <Text style={[s.dragName, { color: t.tp }]} numberOfLines={1}>{ex.name}</Text>
            </View>
          </Animated.View>
        );
      })}
    </>
  );
}

// ─── LogReorderSheet ───────────────────────────────────────────────────────────

function LogReorderSheet({ visible, exercises, isDark, workoutName, onReorder, onClose }: {
  visible: boolean;
  exercises: LogExercise[];
  isDark: boolean;
  workoutName: string;
  onReorder: (exercises: LogExercise[]) => void;
  onClose: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
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

  const closeSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); onClose(); });
  }, [slideY, backdropOpacity, onClose]);

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

  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeSheet}>
      <View style={s.sheetBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, s.sheetOverlay, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />
        <Animated.View style={[s.sheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers} style={s.sheetHandleArea}>
            <View style={s.sheetHandle} />
          </View>
          <View style={[s.sheetHeader, { borderBottomColor: divider }]}>
            <Text style={[s.sheetTitle, { color: t.tp }]}>Reorder Exercises</Text>
            <Text style={[s.sheetSubtitle, { color: t.ts }]}>{workoutName}</Text>
          </View>
          <View style={s.sheetListWrap}>
            <LogDraggableList
              exercises={exercises}
              isDark={isDark}
              t={t}
              onReorder={onReorder}
            />
          </View>
          <View style={s.sheetDoneRow}>
            <BounceButton onPress={closeSheet}>
              <View style={s.sheetDoneWrap}>
                <View style={s.sheetDoneBtn}>
                  <Text style={s.sheetDoneText}>Done</Text>
                </View>
              </View>
            </BounceButton>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── ExerciseCard ─────────────────────────────────────────────────────────────

interface ExerciseCardProps {
  ex: LogExercise;
  exIndex: number;
  totalExercises: number;
  isDark: boolean;
  onUpdateSet: (setIdx: number, field: "weight" | "reps", value: string) => void;
  onToggleDone: (setIdx: number) => void;
  onToggleType: (setIdx: number) => void;
  onAddSet: () => void;
  onRemoveLastSet: () => void;
  onRemoveExercise: () => void;
  onOpenReorder: () => void;
  onChangeExercise: () => void;
  onToggleIsometric: () => void;
  onUpdateNotes: (notes: string) => void;
  onInputFocus: (nextFn: (() => void) | null, prevFn: (() => void) | null) => void;
  prevSets?: string[];
}

function ExerciseCard({
  ex, exIndex, totalExercises, isDark,
  onUpdateSet, onToggleDone, onToggleType, onAddSet, onRemoveLastSet,
  onRemoveExercise, onOpenReorder, onChangeExercise, onToggleIsometric, onUpdateNotes,
  onInputFocus, prevSets,
}: ExerciseCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.1)" : t.div;
  const [editing, setEditing] = useState(false);
  const bg = isDark ? NEU_BG_DARK : NEU_BG;
  const weightRefs = useRef<(TextInput | null)[]>([]);
  const repsRefs = useRef<(TextInput | null)[]>([]);

  const [collapsingSetIdx, setCollapsingSetIdx] = useState<number | null>(null);
  const prevSetCount = useRef(ex.sets.length);
  const newlyAddedIdx = ex.sets.length > prevSetCount.current ? ex.sets.length - 1 : null;
  const setRowHeight = useRef(0);
  useEffect(() => { prevSetCount.current = ex.sets.length; }, [ex.sets.length]);

  let workingCounter = 0;

  return (
    <NeuCard dark={isDark} style={s.exCard}>
      <View style={s.exInner}>

        {/* Header */}
        <View style={s.exHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[s.exNumLabel, { color: t.ts }]}>EXERCISE {exIndex + 1} OF {totalExercises}</Text>
            <Text style={[s.exName, { color: t.tp }]} numberOfLines={1}>{ex.name}</Text>
          </View>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setEditing(e => !e); }}
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
        </View>

        {/* Program notes */}
        {ex.programNotes ? (
          <Text style={{ fontFamily: FontFamily.regular, fontSize: 13, color: t.ts, lineHeight: 19, paddingHorizontal: 2, paddingBottom: 10 }}>
            {ex.programNotes}
          </Text>
        ) : null}

        {/* Column headers */}
        <View style={[s.colHeaderRow, { borderBottomColor: divider }]}>
          <Text style={[s.colText, s.setCol,  { color: t.ts }]}>SET</Text>
          <Text style={[s.colText, s.prevCol, { color: t.ts }]}>PREV</Text>
          <Text style={[s.colText, s.inputCol, { color: t.ts }]}>WEIGHT</Text>
          <Text style={[s.colText, s.inputCol, { color: t.ts }]}>REPS</Text>
          <View style={s.checkCol} />
        </View>

        {/* Set rows */}
        <View>
          {ex.sets.map((set, idx) => {
            const isWU = set.type === "warmup";
            if (!isWU) workingCounter++;
            const setLabel = isWU ? "W" : String(workingCounter);
            const isLast = idx === ex.sets.length - 1;

            return (
              <CollapsibleCard
                key={idx}
                isCollapsing={idx === collapsingSetIdx}
                onCollapsed={() => { setCollapsingSetIdx(null); onRemoveLastSet(); }}
                expanding={idx === newlyAddedIdx}
                naturalHeight={idx === newlyAddedIdx ? setRowHeight.current : undefined}
              >
                <View
                  style={s.setRow}
                  onLayout={(idx !== newlyAddedIdx && idx !== collapsingSetIdx) ? e => {
                    const h = e.nativeEvent?.layout?.height;
                    if (h != null && h > 0) setRowHeight.current = h;
                  } : undefined}
                >
                  {/* Type badge */}
                  {editing ? (
                    <TouchableOpacity
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggleType(idx); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.6}
                      style={s.setCol}
                    >
                      <View style={[s.setEditBadge, { borderColor: isWU ? WARMUP_ORANGE : divider, alignSelf: "center" }]}>
                        <Text style={[s.setText, { color: isWU ? WARMUP_ORANGE : t.tp }]}>{setLabel}</Text>
                      </View>
                    </TouchableOpacity>
                  ) : (
                    <Text style={[s.setText, s.setCol, { color: isWU ? WARMUP_ORANGE : t.tp }]}>{setLabel}</Text>
                  )}

                  {/* PREV */}
                  <View style={s.prevCol}>
                    <Text style={[s.prevText, { color: `${t.tp}66` }]} numberOfLines={1}>
                      {prevSets?.[idx] ?? "—"}
                    </Text>
                  </View>

                  {/* Weight */}
                  <View style={[s.inputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                    <TextInput
                      ref={r => { weightRefs.current[idx] = r; }}
                      style={[s.inputText, { color: isDark ? "#fff" : t.tp }]}
                      keyboardType="decimal-pad"
                      value={set.weight}
                      onChangeText={v => onUpdateSet(idx, "weight", v)}
                      onFocus={() => onInputFocus(
                        () => repsRefs.current[idx]?.focus(),
                        idx > 0 ? () => repsRefs.current[idx - 1]?.focus() : null,
                      )}
                      placeholder={set.programSet?.weightKg || "—"}
                      placeholderTextColor={`${t.tp}66`}
                      selectTextOnFocus
                    />
                  </View>

                  {/* Reps / Hold */}
                  <View style={[s.inputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                    <TextInput
                      ref={r => { repsRefs.current[idx] = r; }}
                      style={[s.inputText, { color: isDark ? "#fff" : t.tp }]}
                      keyboardType="decimal-pad"
                      value={set.reps}
                      onChangeText={v => onUpdateSet(idx, "reps", v)}
                      onFocus={() => {
                        if (idx < ex.sets.length - 1) {
                          onInputFocus(() => weightRefs.current[idx + 1]?.focus(), () => weightRefs.current[idx]?.focus());
                        } else {
                          onInputFocus(null, () => weightRefs.current[idx]?.focus());
                        }
                      }}
                      placeholder={set.programSet?.reps || "—"}
                      placeholderTextColor={`${t.tp}66`}
                      selectTextOnFocus
                    />
                  </View>

                  {/* Checkbox or remove-set button */}
                  <View style={s.checkCol}>
                    {editing && isLast && ex.sets.length > 1 ? (
                      <TouchableOpacity
                        onPress={() => {
                          if (collapsingSetIdx !== null || ex.sets.length <= 1) return;
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setCollapsingSetIdx(ex.sets.length - 1);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <View style={s.removeSetBtn}>
                          <Ionicons name="remove" size={13} color="#fff" />
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <CheckboxCell
                        done={set.done}
                        isDark={isDark}
                        onToggle={() => {
                          if (!set.done && !set.weight.trim() && !set.reps.trim()) {
                            const prev = prevSets?.[idx];
                            if (prev && prev !== "—") {
                              const parts = prev.split("×");
                              onUpdateSet(idx, "weight", parts[0] ?? "");
                              onUpdateSet(idx, "reps", parts[1] ?? "");
                            }
                          }
                          onToggleDone(idx);
                        }}
                      />
                    )}
                  </View>
                </View>
              </CollapsibleCard>
            );
          })}
        </View>

        {/* Edit mode controls */}
        <ExpandablePanel expanded={editing} duration={500} clip>
          <>
            {/* Move row + Add Set */}
            <View style={[s.editMoveRow, { borderTopColor: divider }]}>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenReorder(); }}
                activeOpacity={0.7}
                style={s.exReorderBtn}
              >
                <DragHandleIcon color={t.ts} />
              </TouchableOpacity>
              <Text style={[s.editMoveLabel, { color: t.ts, flex: 1 }]}>Move exercise</Text>
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
                <Text style={[s.editChipText, { color: "#fff" }]}>Add Set</Text>
              </TouchableOpacity>
            </View>

            {/* Three chips */}
            <View style={s.editChipsRow}>
              {[
                {
                  onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggleIsometric(); },
                  icon: <Ionicons name="timer-outline" size={13} color={ex.isIsometric ? ACCT : t.ts} />,
                  label: ex.isIsometric ? "Hold" : "Reps",
                  color: ex.isIsometric ? ACCT : t.ts,
                },
                {
                  onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChangeExercise(); },
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
                        { text: "Remove", style: "destructive", onPress: onRemoveExercise },
                      ]
                    );
                  },
                  icon: <TrashIcon size={13} color="#FF4D4F" />,
                  label: "Remove",
                  color: "#FF4D4F",
                },
              ].map(({ onPress, icon, label, color }) => (
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
                      shadowRadius: 4,
                    }}>
                      <View style={{
                        borderRadius: 12, backgroundColor: bg, overflow: "hidden",
                        paddingVertical: 10, flexDirection: "row",
                        alignItems: "center", justifyContent: "center", gap: 5,
                      }}>
                        {icon}
                        <Text style={[s.editChipText, { color }]}>{label}</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </>
        </ExpandablePanel>

        {/* Exercise notes */}
        <View style={[s.exNotesRow, { borderTopColor: divider }]}>
          <Text style={{ fontFamily: FontFamily.semibold, fontSize: 13, color: t.tp, marginBottom: 6 }}>Notes</Text>
          <TextInput
            style={[s.exNotesInput, { color: t.tp }]}
            placeholder="Add exercise notes..."
            placeholderTextColor={t.ts}
            value={ex.notes}
            onChangeText={onUpdateNotes}
            multiline
            textAlignVertical="top"
          />
        </View>

      </View>
    </NeuCard>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LogWorkoutScreen() {
  const { date, workoutName, programId, addToProgramId } = useLocalSearchParams<{
    date: string; workoutName: string; programId?: string; addToProgramId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [exercises, setExercises] = useState<LogExercise[]>([]);
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [addExVisible, setAddExVisible] = useState(false);
  const [changingExId, setChangingExId] = useState<string | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workoutTime, setWorkoutTime] = useState<WorkoutTime | null>(null);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [prevByName, setPrevByName] = useState<Record<string, string[]>>({});
  const [kbHeight, setKbHeight] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  // Draft persistence — sets/notes/time entered here are autosaved per (date, workoutName)
  // so a full app exit doesn't lose them. Cleared on successful save.
  const draftLockedRef = useRef(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftKey = date && workoutName ? logDraftKey(date, workoutName) : null;
  const nextFnRef = useRef<(() => void) | null>(null);
  const prevFnRef = useRef<(() => void) | null>(null);
  const handleInputFocus = useCallback((fn: (() => void) | null, prevFn: (() => void) | null = null) => {
    nextFnRef.current = fn;
    prevFnRef.current = prevFn;
    setHasNext(fn !== null);
    setHasPrev(prevFn !== null);
  }, []);

  // Restore an in-progress log draft (if any) before the program-template loader runs.
  useEffect(() => {
    if (!draftKey) { setDraftRestored(true); return; }
    AsyncStorage.getItem(draftKey).then(raw => {
      if (raw) {
        try {
          const draft = JSON.parse(raw);
          if (Array.isArray(draft?.exercises)) {
            setExercises(draft.exercises);
            setNotes(draft.notes ?? "");
            setWorkoutTime(draft.workoutTime ?? null);
            draftLockedRef.current = true;
          }
        } catch {
          AsyncStorage.removeItem(draftKey).catch(() => {});
        }
      }
      setDraftRestored(true);
    }).catch(() => setDraftRestored(true));
  }, [draftKey]);

  // Load exercise template from program — skipped if a draft was restored, so we don't
  // overwrite the user's in-progress entries with a fresh template.
  useEffect(() => {
    if (!draftRestored) return;
    if (draftLockedRef.current) return;
    const pid = programId && programId.length > 0 ? programId : null;
    if (!pid || !workoutName) return;

    AsyncStorage.getItem(PROGRAMS_KEY).then(raw => {
      if (!raw) return;
      const progs: SavedProgram[] = JSON.parse(raw);
      const prog = progs.find(p => p.id === pid);
      if (!prog) return;

      const entry = Object.entries(prog.workouts).find(([key]) =>
        key === workoutName || key.endsWith(`:${workoutName}`)
      );
      if (!entry) return;

      const loaded: LogExercise[] = entry[1].map(ex => {
        const sets = normaliseSets(ex);
        return {
          id: makeId(),
          name: ex.name,
          sets: sets.map(ps => ({ type: ps.type, weight: "", reps: "", done: false, programSet: ps })),
          notes: "",
          programNotes: ex.programNotes,
          isIsometric: ex.isIsometric,
        };
      });
      setExercises(loaded);
    }).catch(() => {});
  }, [draftRestored, programId, workoutName]);

  // Autosave draft on change after restoration. Only persist once the user has actually
  // engaged (entered something, customised the list, or set a workout time), to avoid
  // creating spurious empty drafts the moment they open the screen.
  useEffect(() => {
    if (!draftRestored) return;
    if (!draftKey) return;
    const hasContent =
      draftLockedRef.current ||
      notes.trim().length > 0 ||
      workoutTime !== null ||
      exercises.some(ex =>
        ex.notes.trim().length > 0 ||
        ex.sets.some(s => s.weight.trim().length > 0 || s.reps.trim().length > 0 || s.done)
      );
    if (!hasContent) return;
    draftLockedRef.current = true;
    AsyncStorage.setItem(
      draftKey,
      JSON.stringify({ exercises, notes, workoutTime })
    ).catch(() => {});
  }, [draftRestored, draftKey, exercises, notes, workoutTime]);

  useEffect(() => {
    AsyncStorage.getItem(WORKOUT_HISTORY_KEY).then(raw => {
      if (!raw) return;
      setPrevByName(buildPrevByName(JSON.parse(raw), date));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => { setKbHeight(0); setHasNext(false); setHasPrev(false); nextFnRef.current = null; prevFnRef.current = null; });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Load custom exercises
  useEffect(() => {
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setCustomExercises(parsed as CustomExercise[]);
    }).catch(() => {});
  }, []);

  // ── Mutations ──

  const updateSet = useCallback((exId: string, setIdx: number, field: "weight" | "reps", value: string) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      // "Fill down" — same as the program builder: the typed value applies to
      // this set AND every set below it, so identical sets are entered once.
      // Each affected set that ends up with both weight + reps is auto-marked
      // done (the existing single-set rule), so e.g. 3 matching sets get logged
      // in one entry instead of three.
      const updatedSets = ex.sets.map((s, i) => {
        if (i < setIdx) return s;
        const next = { ...s, [field]: value };
        if (!next.done && next.weight.trim() && next.reps.trim()) next.done = true;
        return next;
      });
      return { ...ex, sets: updatedSets };
    }));
  }, []);

  const toggleDone = useCallback((exId: string, setIdx: number) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      return { ...ex, sets: ex.sets.map((s, i) => i === setIdx ? { ...s, done: !s.done } : s) };
    }));
  }, []);

  const toggleType = useCallback((exId: string, setIdx: number) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      return {
        ...ex,
        sets: ex.sets.map((s, i) => i === setIdx
          ? { ...s, type: (s.type === "warmup" ? "working" : "warmup") as "warmup" | "working" }
          : s
        ),
      };
    }));
  }, []);

  const addSet = useCallback((exId: string) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const lastType = ex.sets.length > 0 ? ex.sets[ex.sets.length - 1].type : "working";
      return { ...ex, sets: [...ex.sets, defaultSet(lastType)] };
    }));
  }, []);

  const removeLastSet = useCallback((exId: string) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId || ex.sets.length <= 1) return ex;
      return { ...ex, sets: ex.sets.slice(0, -1) };
    }));
  }, []);

  const removeExercise = useCallback((exId: string) => {
    setExercises(prev => prev.filter(ex => ex.id !== exId));
  }, []);

  const addExercise = useCallback((name: string) => {
    setExercises(prev => [...prev, { id: makeId(), name, sets: [defaultSet("working")], notes: "" }]);
  }, []);

  const changeExercise = useCallback((exId: string, newName: string) => {
    setExercises(prev => prev.map(ex => ex.id === exId ? { ...ex, name: newName } : ex));
  }, []);

  const toggleIsometric = useCallback((exId: string) => {
    setExercises(prev => prev.map(ex => ex.id === exId ? { ...ex, isIsometric: !ex.isIsometric } : ex));
  }, []);

  const updateExNotes = useCallback((exId: string, exNotes: string) => {
    setExercises(prev => prev.map(ex => ex.id === exId ? { ...ex, notes: exNotes } : ex));
  }, []);

  const deleteCustomExercise = useCallback((name: string) => {
    setCustomExercises(prev => {
      const next = prev.filter(e => e.name !== name);
      AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // ── Save ──

  const doSave = async () => {
    if (saving) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Compute completedAt and durationSeconds from selected times.
    // completedAt = end time on the SELECTED date (always), so formatWorkoutDate
    // shows the correct date even for midnight-crossing workouts.
    let completedAt = new Date(`${date}T12:00:00`).toISOString();
    let durationSeconds = 0;
    if (workoutTime) {
      const { start, end } = workoutTime;
      const endH24 = end.hour % 12 + (end.period === "PM" ? 12 : 0);
      completedAt = new Date(
        `${date}T${String(endH24).padStart(2, "0")}:${String(end.minute).padStart(2, "0")}:00`
      ).toISOString();
      durationSeconds = computeDurationMins(start, end) * 60;
    }

    // The program this session belongs to: the day's program (`programId`), or
    // the one a free workout was added to (`addToProgramId`). "" = no program
    // (definitive — not a legacy record). See workoutBelongsToProgram.
    const owningProgramId =
      (programId && programId.length > 0) ? programId
      : (addToProgramId && addToProgramId.length > 0) ? addToProgramId
      : "";

    const completed: CompletedWorkout = {
      id: `workout_${Date.now()}`,
      date: date ?? "",
      completedAt,
      workoutName: workoutName ?? "",
      programId: owningProgramId,
      durationSeconds,
      sessionNotes: notes.trim() || undefined,
      exercises: exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets.map(s => ({ type: s.type, weight: s.weight, reps: s.reps, done: s.done })),
        notes: ex.notes,
      })),
    };

    try {
      const histRaw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
      const history: CompletedWorkout[] = histRaw ? JSON.parse(histRaw) : [];
      await AsyncStorage.setItem(WORKOUT_HISTORY_KEY, JSON.stringify([completed, ...history]));

      const datesRaw = await AsyncStorage.getItem(WORKOUT_DATES_KEY);
      const dates: string[] = datesRaw ? JSON.parse(datesRaw) : [];
      if (!dates.includes(date)) {
        await AsyncStorage.setItem(WORKOUT_DATES_KEY, JSON.stringify([...dates, date]));
      }

      // Update the owning program: record a free workout's name as an extra, and
      // back-date the program's start when this session predates it. Logging a
      // session you actually did earlier (e.g. you "started" today but really
      // began two weeks ago) moves the program's start — and therefore its
      // current week / progress everywhere — back to that date.
      if (owningProgramId) {
        const addPid = addToProgramId && addToProgramId.length > 0 ? addToProgramId : null;
        const [yy, mm, dd] = (date ?? "").split("-").map(Number);
        const loggedDate = (Number.isFinite(yy) && Number.isFinite(mm) && Number.isFinite(dd))
          ? new Date(yy, mm - 1, dd) : null;

        const progsRaw = await AsyncStorage.getItem(PROGRAMS_KEY);
        const progs: SavedProgram[] = progsRaw ? JSON.parse(progsRaw) : [];
        let changed = false;
        const updated = progs.map(p => {
          if (p.id !== owningProgramId) return p;
          let next = p;
          // Free workout added to a program → remember its name as an extra.
          if (addPid === p.id && workoutName && !(p.extraWorkouts ?? []).includes(workoutName)) {
            next = { ...next, extraWorkouts: [...(next.extraWorkouts ?? []), workoutName] };
            changed = true;
          }
          // Move the start back if this session is earlier than the current start
          // (only ever earlier — a later session doesn't change when it began).
          const start = parseStoredDate(next.startDate);
          if (loggedDate && (!start || loggedDate.getTime() < start.getTime())) {
            next = { ...next, startDate: formatStoredDate(loggedDate) };
            changed = true;
          }
          return next;
        });
        if (changed) await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
      }

      // Draft has been committed to history — clear it so reopening this date+workout
      // starts fresh next time.
      if (draftKey) {
        draftLockedRef.current = false;
        await AsyncStorage.removeItem(draftKey);
      }
    } catch (_) {}

    router.back();
  };

  const saveWorkout = () => {
    const incomplete = exercises.some(ex =>
      ex.sets.some(s => !s.done || !s.weight.trim() || !s.reps.trim())
    );
    if (incomplete) {
      Alert.alert(
        "Incomplete Sets",
        "Some sets haven't been filled out or ticked. Would you like to save anyway?",
        [
          { text: "Go Back", style: "cancel" },
          { text: "Save Anyway", onPress: doSave },
        ]
      );
    } else {
      doSave();
    }
  };

  const dateLabel = date ? formatDate(date) : "";

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Top gradient blur */}
      <View pointerEvents="none" style={[s.topGradient, { height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black","rgba(0,0,0,0.8)","rgba(0,0,0,0.6)","rgba(0,0,0,0.3)","transparent"]}
              locations={[0, 0.45, 0.65, 0.85, 1]}
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
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={s.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[s.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      {/* Time button — top right */}
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTimePickerVisible(true); }}
        style={{ position: "absolute", top: insets.top + 14, right: 20, zIndex: 10 }}
        activeOpacity={0.8}
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={s.backBtn}>
            <Ionicons name="time-outline" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[s.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="time-outline" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 100 }]}
        >
          {/* Nav title — scrolls with content like journal page */}
          <View style={s.scrollTitleRow}>
            <View style={{ width: 66 }} />
            <Text style={[s.navTitle, { color: t.tp }]}>JOURNAL</Text>
            <View style={{ width: 66 }} />
          </View>

          {/* Page header */}
          <View style={s.pageHeader}>
            <Text style={[s.workoutTitle, { color: t.tp }]}>{workoutName}</Text>
            <Text style={[s.dateLabel, { color: t.ts }]}>{dateLabel}</Text>
            {workoutTime && (
              <TouchableOpacity onPress={() => setTimePickerVisible(true)} activeOpacity={0.7} style={{ marginTop: 6 }}>
                <Text style={[s.timeLabel, { color: t.ts }]}>
                  {fmtTimeVal(workoutTime.start)} – {fmtTimeVal(workoutTime.end)}
                  {"  ·  "}{fmtDurationMins(computeDurationMins(workoutTime.start, workoutTime.end))}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Exercise cards */}
          {exercises.map((ex, idx) => (
            <ExerciseCard
              key={ex.id}
              ex={ex}
              exIndex={idx}
              totalExercises={exercises.length}
              isDark={isDark}
              onUpdateSet={(setIdx, field, value) => updateSet(ex.id, setIdx, field, value)}
              onToggleDone={setIdx => toggleDone(ex.id, setIdx)}
              onToggleType={setIdx => toggleType(ex.id, setIdx)}
              onAddSet={() => addSet(ex.id)}
              onRemoveLastSet={() => removeLastSet(ex.id)}
              onRemoveExercise={() => removeExercise(ex.id)}
              onOpenReorder={() => setReorderOpen(true)}
              onChangeExercise={() => setChangingExId(ex.id)}
              onToggleIsometric={() => toggleIsometric(ex.id)}
              onUpdateNotes={exNotes => updateExNotes(ex.id, exNotes)}
              onInputFocus={handleInputFocus}
              prevSets={prevByName[ex.name] ?? []}
            />
          ))}

          {/* Bottom action row: notes toggle + add exercise */}
          <View style={s.bottomActionRow}>
            {exercises.length > 0 && (
              <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowNotes(n => !n); }}>
                <View style={s.notesToggleWrap}>
                  <NeuCard dark={isDark} style={s.notesToggleBtn}>
                    <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="document-text-outline" size={20} color={t.tp} />
                    </View>
                  </NeuCard>
                  <View style={s.notesTogglePlus}>
                    <Text style={s.notesTogglePlusText}>+</Text>
                  </View>
                </View>
              </BounceButton>
            )}
            <View style={{ flex: 1, alignItems: "center" }}>
              <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddExVisible(true); }}>
                <View style={s.addExBtnWrap}>
                  <View style={s.addExBtn}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={s.addExText}>Add Exercise</Text>
                  </View>
                </View>
              </BounceButton>
            </View>
            {exercises.length > 0 && <View style={s.notesToggleWrap} />}
          </View>

          {/* Session notes */}
          <ExpandablePanel expanded={showNotes} duration={500}>
            <NeuCard dark={isDark} style={{ marginBottom: 4, borderRadius: 16 }}>
              <View style={s.notesInner}>
                <View style={s.notesHeader}>
                  <Text style={{ fontFamily: FontFamily.bold, fontSize: 16, color: t.tp }}>Session Notes</Text>
                  <BounceButton onPress={() => setShowNotes(false)}>
                    <Ionicons name="close" size={20} color={t.ts} />
                  </BounceButton>
                </View>
                <TextInput
                  style={[s.notesInput, { color: t.tp }]}
                  placeholder="How's the session going? Anything to note..."
                  placeholderTextColor={t.ts}
                  multiline
                  value={notes}
                  onChangeText={setNotes}
                  textAlignVertical="top"
                />
              </View>
            </NeuCard>
          </ExpandablePanel>

        </ScrollView>

      </KeyboardAvoidingView>

      {/* Keyboard toolbar */}
      {kbHeight > 0 && Platform.OS === "ios" && (
        <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, flexDirection: "row", gap: 8, zIndex: 999 }}>
          <TouchableOpacity
              onPress={() => prevFnRef.current?.()}
              activeOpacity={hasPrev ? 0.75 : 1}
              disabled={!hasPrev}
              style={[s.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff", opacity: hasPrev ? 1 : 0.35 }]}
            >
              <Ionicons name="chevron-back" size={24} color={isDark ? "#fff" : "#333"} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => nextFnRef.current?.()}
              activeOpacity={hasNext ? 0.75 : 1}
              disabled={!hasNext}
              style={[s.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff", opacity: hasNext ? 1 : 0.35 }]}
            >
              <Ionicons name="chevron-forward" size={24} color={isDark ? "#fff" : "#333"} />
            </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Keyboard.dismiss()}
            activeOpacity={0.75}
            style={[s.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}
          >
            <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        </View>
      )}

      {/* Save Workout — floating above safe area */}
      <View style={[s.saveRow, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        <BounceButton onPress={saveWorkout}>
          <View style={[s.saveBtn, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }, saving && { opacity: 0.6 }]}>
            <Ionicons name="checkmark-circle" size={18} color={isDark ? APP_DARK.bg : "#fff"} />
            <Text style={[s.saveBtnText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Save Workout</Text>
          </View>
        </BounceButton>
      </View>

      {/* Add exercise picker */}
      <ExercisePicker
        visible={addExVisible}
        subtitle={workoutName ?? "WORKOUT"}
        customExercises={customExercises}
        onSelectMultiple={names => { names.forEach(addExercise); setAddExVisible(false); }}
        onDeleteCustom={deleteCustomExercise}
        onEditCustom={() => {}}
        onCreateCustom={() => {}}
        onClose={() => setAddExVisible(false)}
        isDark={isDark}
      />

      {/* Change exercise picker */}
      <ExercisePicker
        visible={!!changingExId}
        subtitle="CHANGE EXERCISE"
        customExercises={customExercises}
        onSelectMultiple={names => {
          if (names.length > 0 && changingExId) changeExercise(changingExId, names[0]);
          setChangingExId(null);
        }}
        onDeleteCustom={deleteCustomExercise}
        onEditCustom={() => {}}
        onCreateCustom={() => {}}
        onClose={() => setChangingExId(null)}
        isDark={isDark}
      />

      {/* Reorder sheet */}
      <LogReorderSheet
        visible={reorderOpen}
        exercises={exercises}
        isDark={isDark}
        workoutName={workoutName ?? ""}
        onReorder={setExercises}
        onClose={() => setReorderOpen(false)}
      />

      {/* Time picker */}
      <TimePickerSheet
        visible={timePickerVisible}
        isDark={isDark}
        initialTime={workoutTime}
        onConfirm={wt => setWorkoutTime(wt)}
        onClear={() => setWorkoutTime(null)}
        onClose={() => setTimePickerVisible(false)}
      />
    </FadeScreen>
  );
}

const s = StyleSheet.create({
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 5 },
  scrollTitleRow: { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 16 },
  navTitle:       { flex: 1, textAlign: "center", fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase" },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scroll:      { paddingHorizontal: 20 },

  pageHeader:   { marginBottom: 28 },
  workoutTitle: { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 0.2 },
  dateLabel:    { fontFamily: FontFamily.regular, fontSize: 15, marginTop: 4 },

  // Exercise card
  exCard:     { marginBottom: 20, borderRadius: 20 },
  exInner:    { padding: 16, gap: 10 },
  exHeader:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 },
  exNumLabel: { fontFamily: FontFamily.semibold, fontSize: 13 },
  exName:     { fontFamily: FontFamily.bold, fontSize: 22, flex: 1 },

  // Prev column
  prevCol:  { width: 72, alignItems: "center", justifyContent: "center" },
  prevText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },

  // Column headers
  colHeaderRow: { flexDirection: "row", alignItems: "center", paddingBottom: 4, borderBottomWidth: 1, paddingHorizontal: 4, gap: 6 },
  colText:      { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: "center" },
  setCol:       { width: 36, textAlign: "center" },
  inputCol:     { flex: 1 },
  checkCol:     { width: 32, alignItems: "center", justifyContent: "center" },

  // Set rows
  setRow:      { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 4, gap: 6 },
  setText:     { fontFamily: FontFamily.semibold, fontSize: 15, textAlign: "center" },
  setEditBadge:{ width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inputBox:    { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, justifyContent: "center" },
  inputText:   { fontFamily: FontFamily.bold, fontSize: 15, textAlign: "center", flex: 1, paddingVertical: 0 },
  checkCircle: { width: 24, height: 24, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  removeSetBtn:{ width: 24, height: 24, borderRadius: 13, backgroundColor: "#FF4D4F", alignItems: "center", justifyContent: "center", shadowColor: "#FF4D4F", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },

  // Edit mode
  editMoveRow:  { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 10 },
  editMoveLabel:{ fontFamily: FontFamily.regular, fontSize: 12, marginLeft: 2 },
  exReorderBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  editChipsRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 6 },
  editChipText: { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Exercise notes
  exNotesRow:   { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  exNotesInput: { fontFamily: FontFamily.regular, fontSize: 13, minHeight: 36, lineHeight: 20 },

  // Bottom action row
  bottomActionRow:    { flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 20 },
  notesToggleWrap:    { width: 44, alignItems: "center", justifyContent: "center" },
  notesToggleBtn:     { width: 40, height: 40 },
  notesTogglePlus:    { position: "absolute", top: -4, right: -6, backgroundColor: ACCT, borderRadius: 7, width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  notesTogglePlusText:{ color: "#fff", fontSize: 10, fontFamily: FontFamily.bold, lineHeight: 14 },

  // Add exercise
  addExBtnWrap: { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  addExBtn:     { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 10, paddingHorizontal: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  addExText:    { fontFamily: FontFamily.semibold, fontSize: 14, color: "#FFFFFF" },

  // Session notes
  notesInner:  { padding: 16 },
  notesInput:  { fontFamily: FontFamily.regular, fontSize: 14, minHeight: 72, lineHeight: 22 },
  notesHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },

  // Keyboard toolbar
  kbFloatBtn: { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },

  // Save button
  saveRow:    { position: "absolute", left: 20, right: 20 },
  saveBtn:    { borderRadius: 16, paddingVertical: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, shadowColor: "#000", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.45, shadowRadius: 8 },
  saveBtnText:{ fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 0.3 },

  // Reorder sheet
  sheetBackdrop:  { flex: 1, justifyContent: "flex-end" },
  sheetOverlay:   { backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:          { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 },
  sheetHandleArea:{ paddingVertical: 12, alignItems: "center" },
  sheetHandle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  sheetHeader:    { alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  sheetTitle:     { fontFamily: FontFamily.bold, fontSize: 16 },
  sheetSubtitle:  { fontFamily: FontFamily.regular, fontSize: 14, marginTop: 2 },
  sheetListWrap:  { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 },
  sheetDoneRow:   { alignItems: "center", paddingTop: 16, paddingBottom: 4 },
  sheetDoneWrap:  { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10 },
  sheetDoneBtn:   { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 13, paddingHorizontal: 40 },
  sheetDoneText:  { fontFamily: FontFamily.semibold, fontSize: 16, color: "#FFFFFF" },

  // Draggable list
  dragRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12 },
  dragHandle: { paddingHorizontal: 4, paddingVertical: 4, justifyContent: "center", alignItems: "center" },
  dragNumChip:{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  dragNum:    { fontFamily: FontFamily.bold, fontSize: 13 },
  dragNameWrap:{ flex: 1, flexDirection: "row", alignItems: "center" },
  dragName:   { fontFamily: FontFamily.regular, fontSize: 15, flex: 1 },

  // Time display in header
  timeLabel:  { fontFamily: FontFamily.semibold, fontSize: 14, letterSpacing: 0.2 },

  // Time picker sheet
  timeSheet:       { borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  timeSheetHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  timeSheetTitle:  { fontFamily: FontFamily.bold, fontSize: 20 },
  timePickerBody:  { paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1 },
  timeRow:         { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 6, gap: 8 },
  timeRowLabel:    { fontFamily: FontFamily.semibold, fontSize: 13, width: 40, textAlign: "right", letterSpacing: 0.4 },
  timeRowDivider:  { height: 1, marginVertical: 4 },
  wheelGroup:      { flexDirection: "row", alignItems: "center", gap: 2 },
  wheelColon:      { fontFamily: FontFamily.bold, fontSize: 22, paddingHorizontal: 2 },
  timeDuration:    { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 14 },
  timeConfirmWrap: { borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10 },
  timeConfirmBtn:  { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 11, paddingHorizontal: 32 },
  timeConfirmText: { fontFamily: FontFamily.semibold, fontSize: 15, color: "#fff" },
});
