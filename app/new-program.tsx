import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, memo } from "react";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, interpolateColor } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert,
  Platform,
  Keyboard,
  Animated,
  Easing,
  PanResponder,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useNavigation, useFocusEffect, useLocalSearchParams } from "expo-router";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, ACCT_DEEP, BTN_SLATE, BTN_SLATE_DARK, BUBBLE_LIGHT } from "../constants/theme";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { PROGRAMS_KEY, CYCLE_COACHMARK_KEY, WORKOUTS_COACHMARK_KEY, WORKOUT_DAY_OVERRIDE_KEY, type SavedProgram, type Exercise, type ProgramSet, type WorkoutMap, normaliseSets, getCurrentWeek } from "../constants/programs";
import { scheduleCloudPush } from "../lib/syncManager";
import { batchKeyOf, loadSentPrograms, loadSharedPrograms, updateSentProgram, updateSharedProgramBatch, type SentProgram, type SharedProgram } from "../utils/trainerStore";
import NeuCard from "../components/NeuCard";
import TrashIcon from "../components/TrashIcon";
import BounceButton from "../components/BounceButton";
import AuroraBackdrop from "../components/AuroraBackdrop";
import ExercisePicker from "../components/ExercisePicker";
import CollapsibleCard from "../components/CollapsibleCard";
import DumbbellIcon from "../components/DumbbellIcon";
import ExerciseImage from "../components/ExerciseImage";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { formatWeightForDisplay, parseWeightToKg } from "../utils/units";
import { formatStoredDate } from "../utils/dates";
import { exerciseIdByName } from "../utils/exerciseLookup";
import { musclesForExercise } from "../utils/muscleGroups";

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAFT_KEY = "@avenas/new_program_draft";

// Dev-only warning helper. Compiled out of release builds via `__DEV__`.
function warnStorage(op: string, key: string, err: unknown) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn("[avenas]", op, key, err);
  }
}

/**
 * Compare two WorkoutMaps by value. Key insertion order is irrelevant
 * (sorting keys before stringify). Use this anywhere we ask "did the
 * workouts actually change?" — both the in-memo `hasChanges` flag and the
 * `beforeRemove` navigation guard must agree to avoid spurious prompts.
 */
function workoutsEqual(a: WorkoutMap, b: WorkoutMap): boolean {
  const sortedJson = (w: WorkoutMap) =>
    JSON.stringify(Object.fromEntries(Object.keys(w).sort().map(k => [k, w[k]])));
  return sortedJson(a) === sortedJson(b);
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4"/>
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

function DragHandleIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={12} viewBox="0 0 16 12" fill="none">
      <Path d="M1 1.5h14M1 6h14M1 10.5h14" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramDraft = {
  step: 1 | 2;
  name: string;
  totalWeeks: number;
  cycleDays: number;
  cyclePattern: string[];
  isTrainingDay: boolean[];
  workouts: WorkoutMap;
  editId?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

// Returns a unique key per training day in format "index:label"
function trainingDayKeys(names: string[], isTraining: boolean[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < isTraining.length; i++) {
    if (!isTraining[i]) continue;
    const label = names[i].trim() || "Workout";
    result.push(`${i}:${label}`);
  }
  return result;
}

// Extracts the display label from a day key ("3:Push" → "Push")
function dayLabel(key: string): string {
  return key.split(":").slice(1).join(":");
}

// Collision-proof exercise id. A bare `Date.now()` collides when two exercises
// are added on the same millisecond (multi-select batches, or a second add
// right after a first), and a duplicate id corrupts React keys + the shared
// `collapsingIds` identity, making an exercise render/act under the wrong day.
function makeExerciseId(): string {
  return `pex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// Heal a loaded WorkoutMap whose exercises may carry duplicate ids from the old
// `Date.now() + offset` scheme. Reassigns a fresh unique id to any repeat so an
// already-saved program stops misbehaving on edit. Ids are local-only identity,
// so reassigning is safe.
function dedupeExerciseIds(workouts: WorkoutMap): WorkoutMap {
  const seen = new Set<string>();
  const out: WorkoutMap = {};
  for (const day of Object.keys(workouts)) {
    out[day] = (workouts[day] ?? []).map(ex => {
      if (!ex.id || seen.has(ex.id)) {
        const fresh = makeExerciseId();
        seen.add(fresh);
        return { ...ex, id: fresh };
      }
      seen.add(ex.id);
      return ex;
    });
  }
  return out;
}

// ─── Rest picker helpers ───────────────────────────────────────────────────────

const REST_ITEM_H = 38;
const REST_OPTIONS = [0, ...Array.from({ length: 60 }, (_, i) => (i + 1) * 5)];

function formatRest(secs: number): string {
  if (!secs) return "Off";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ─── Exercise Row ─────────────────────────────────────────────────────────────

const WARMUP_ORANGE = "#ffbf0f";

interface ExerciseRowProps {
  day: string;
  exercise: Exercise;
  exIndex: number;
  totalExercises: number;
  isDark: boolean;
  // Day-scoped handlers, all referentially stable (useCallback at the root/Step2
  // level) so the memo below can bail out. Per-exercise closures are derived
  // inside the row — inline arrows here would defeat the memo.
  onUpdateExercise: (day: string, id: string, field: keyof Exercise, value: string | number | boolean) => void;
  onUpdateExerciseSets: (day: string, id: string, sets: ProgramSet[]) => void;
  /** Write a rest value onto every exercise of every day in the draft. */
  onApplyRestToAll: (secs: number) => void;
  onStartCollapse: (day: string, id: string) => void;
  onOpenReorder: (day: string) => void;
  onEditExercise: (day: string, id: string) => void;
  onInputFocus: (nextFn: (() => void) | null, prevFn: (() => void) | null) => void;
  /** Lowercased exercise name → custom photo URI, for custom exercises. */
  customImageByName: Record<string, string>;
}

/**
 * Prescribed-weight input. Storage is canonical kg; the user edits in their
 * display unit. Each keystroke commits its parsed kg value immediately so the
 * fill-down reaches the sets below live (matching the reps fields). To avoid
 * mangling decimals ("2." round-tripped through the converter would drop the
 * dot), the field keeps a local display-text buffer that is never re-synced
 * while focused — the buffer re-syncs on blur and whenever the stored kg
 * changes while the field is NOT being edited (fill-down from an earlier set,
 * program load, unit toggle). Commits only fire on actual keystrokes, so an
 * untouched focus+blur can't nudge a fractional-kg value into a phantom
 * "unsaved change".
 */
function WeightSetInput({
  valueKg, isKg, onCommitKg, inputRef, onFocus, style, placeholderColor,
}: {
  valueKg: string | undefined;
  isKg: boolean;
  onCommitKg: (kg: string) => void;
  inputRef: (r: TextInput | null) => void;
  onFocus: () => void;
  style: any;
  placeholderColor: string;
}) {
  const [text, setText] = useState(() => formatWeightForDisplay(valueKg ?? "", isKg));
  const isFocused = useRef(false);
  useEffect(() => {
    if (isFocused.current) return;
    setText(formatWeightForDisplay(valueKg ?? "", isKg));
  }, [valueKg, isKg]);
  return (
    <TextInput
      ref={inputRef}
      style={style}
      value={text}
      onChangeText={v => {
        setText(v);
        onCommitKg(parseWeightToKg(v, isKg));
      }}
      onEndEditing={() => {
        isFocused.current = false;
        // Re-sync the buffer to the canonical display form ("080" → "80").
        setText(formatWeightForDisplay(valueKg ?? "", isKg));
      }}
      placeholder="—"
      placeholderTextColor={placeholderColor}
      keyboardType="decimal-pad"
      selectTextOnFocus
      onFocus={() => { isFocused.current = true; onFocus(); }}
    />
  );
}

// Memoized: a keystroke in one exercise's set input must re-render only that
// exercise's row, not every row in the day. All function props are stable, and
// updateExerciseSets preserves the identity of untouched Exercise objects, so
// the shallow compare bails for every row except the one being edited.
const ExerciseRow = memo(function ExerciseRow({ day, exercise, exIndex, totalExercises, isDark, onUpdateExercise, onUpdateExerciseSets, onApplyRestToAll, onStartCollapse, onOpenReorder, onEditExercise, onInputFocus, customImageByName }: ExerciseRowProps) {
  const router = useRouter();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isKg } = useUnit();
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;
  const restSecs = exercise.restSeconds ?? 0;
  const sets = normaliseSets(exercise);

  const exId = exercise.id;
  const onUpdate = useCallback((field: keyof Exercise, value: string | number | boolean) => {
    onUpdateExercise(day, exId, field, value);
  }, [onUpdateExercise, day, exId]);
  const onUpdateSets = useCallback((next: ProgramSet[]) => {
    onUpdateExerciseSets(day, exId, next);
  }, [onUpdateExerciseSets, day, exId]);

  const [showRestPicker, setShowRestPicker] = useState(false);
  const restScrollOffset = useRef(0);
  // Rest value waiting to be applied to ALL exercises. Committed only after the
  // sheet finishes closing — the every-day re-render is heavy enough to stall
  // JS and visibly hold the modal open if it runs before the unmount commits.
  const pendingRestApplyAll = useRef<number | null>(null);
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(500)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const restPanResponder = useRef(
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
          ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); setShowRestPicker(false); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  const openRestPicker = useCallback(() => {
    const initialOffset = Math.max(0, REST_OPTIONS.indexOf(restSecs)) * REST_ITEM_H;
    scrollAnim.setValue(initialOffset);
    restScrollOffset.current = initialOffset;
    slideY.setValue(500);
    backdropOpacity.setValue(0);
    setShowRestPicker(true);
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, [slideY, backdropOpacity, scrollAnim, restSecs]);

  const closeRestPicker = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      slideY.setValue(500); backdropOpacity.setValue(0); setShowRestPicker(false);
      // Flush a pending Apply-to-All on the next task so the modal's unmount
      // commits first and the bulk update can't keep the sheet on screen.
      const pending = pendingRestApplyAll.current;
      if (pending !== null) {
        pendingRestApplyAll.current = null;
        setTimeout(() => onApplyRestToAll(pending), 0);
      }
    });
  }, [slideY, backdropOpacity, onApplyRestToAll]);

  const modeOffset     = useSharedValue(exercise.isIsometric ? 1 : 0);
  const modeTrackWidth = useSharedValue(0);
  const modePillStyle  = useAnimatedStyle(() => ({
    width: modeTrackWidth.value / 2,
    transform: [{ translateX: modeOffset.value * (modeTrackWidth.value / 2) }],
  }));
  // White pill in both modes (matches the Settings unit toggle): the active
  // label is always dark (APP_LIGHT.tp) since it sits on white, inactive is grey.
  const repsLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(modeOffset.value, [0, 1], [APP_LIGHT.tp, t.ts]),
  }));
  const holdLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(modeOffset.value, [0, 1], [t.ts, APP_LIGHT.tp]),
  }));

  const [collapsingSetIdx, setCollapsingSetIdx] = useState<number | null>(null);
  const prevSetCount = useRef(sets.length);
  const newlyAddedIdx = sets.length > prevSetCount.current ? sets.length - 1 : null;
  const setRowHeight = useRef(0);
  useEffect(() => { prevSetCount.current = sets.length; }, [sets.length]);

  // Refs for keyboard prev/next navigation across set inputs
  const weightRefs  = useRef<Array<TextInput | null>>([]);
  const repsRefs    = useRef<Array<TextInput | null>>([]);
  const repsMaxRefs = useRef<Array<TextInput | null>>([]);

  // Pre-compute set labels (W for warmup, 1/2/3 for working)
  let wc = 0;
  const setLabels = sets.map(s => s.type === "warmup" ? "W" : String(++wc));

  const patchSet = useCallback((idx: number, patch: Partial<ProgramSet>) => {
    onUpdateSets(sets.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }, [sets, onUpdateSets]);

  // Hevy-style "fill down": typing a value into a set applies it to that set and
  // every set BELOW it (any type — warmup and working alike), leaving sets above
  // untouched. Lets the user enter one value instead of repeating it per set.
  // Used for the numeric fields (weight/reps/range), NOT the type toggle — that
  // stays a single-set edit via patchSet.
  const fillDown = useCallback((idx: number, patch: Partial<ProgramSet>) => {
    onUpdateSets(sets.map((s, i) => i >= idx ? { ...s, ...patch } : s));
  }, [sets, onUpdateSets]);

  // Rep mode is a single per-exercise choice driven from the header toggle.
  const currentRepMode: "target" | "range" = sets[0]?.repMode ?? "target";
  const RANGE_EXTENSION_WIDTH = 72;
  const rangeProgress = useSharedValue(currentRepMode === "range" ? 1 : 0);
  const rangeOuterStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, rangeProgress.value));
    return { width: p * RANGE_EXTENSION_WIDTH };
  });
  const rangeInnerStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, rangeProgress.value));
    return { opacity: p, transform: [{ scaleX: Math.max(p, 0.001) }] };
  });

  const toggleAllRepMode = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = currentRepMode === "target" ? "range" : "target";
    rangeProgress.value = withSpring(next === "range" ? 1 : 0, { damping: 22, stiffness: 300, mass: 0.9 });
    onUpdateSets(sets.map(s => ({ ...s, repMode: next })));
  }, [currentRepMode, sets, onUpdateSets]);


  return (
    // NOTE: no `layout` animation here. A view with LinearTransition has its frame
    // managed by Reanimated and will NOT live-reflow when a descendant's animated
    // height changes — it freezes until the next commit. That froze the card body
    // during a set's CollapsibleCard collapse/expand, so everything below jumped
    // only after the animation finished (two-phase). A plain View follows the
    // collapse live, in one smooth phase (matches the working workout.tsx layout).
    <View style={styles.exRowWrap}>
      {/* Row 1: thumbnail + name + reorder + delete */}
      <View style={styles.exTopRow}>
        {/* Tap the thumbnail → that exercise's summary page (with a button on to
            full history). The name (next to it) still opens the edit panel. */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.navigate({ pathname: "/exercise-summary", params: { exerciseName: exercise.name } });
          }}
          activeOpacity={0.7}
          accessibilityLabel={`View ${exercise.name} summary`}
          accessibilityRole="button"
        >
          <ExerciseImage
            exerciseId={exerciseIdByName(exercise.name) ?? ""}
            overrideUri={customImageByName[exercise.name.trim().toLowerCase()]}
            variant="thumb"
            size={52}
            radius={12}
            backgroundColor={t.div}
            fallbackColor={t.ts}
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onEditExercise(day, exId)} activeOpacity={0.7} style={styles.exNameBtn}>
          <Text style={[styles.exNumLabel, { color: t.ts }]}>EXERCISE {exIndex + 1} OF {totalExercises}</Text>
          <Text style={[styles.exName, { color: t.tp }]} numberOfLines={1} ellipsizeMode="tail">{exercise.name}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenReorder(day); }}
          activeOpacity={0.7}
          style={styles.exReorderBtn}
          accessibilityLabel="Reorder exercises"
          accessibilityRole="button"
        >
          <DragHandleIcon color={t.ts} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() =>
            Alert.alert("Remove Exercise", `Remove "${exercise.name}"?`, [
              { text: "Cancel", style: "cancel" },
              { text: "Remove", style: "destructive", onPress: () => onStartCollapse(day, exId) },
            ])
          }
          activeOpacity={0.7}
        >
          <TrashIcon size={16} color="#FF4D4F" />
        </TouchableOpacity>
      </View>

      {/* Coaching notes */}
      <View style={[styles.exNotesRow, { borderTopColor: divider }]}>
        <TextInput
          style={[styles.exNotesInput, { color: t.tp }]}
          value={exercise.programNotes ?? ""}
          onChangeText={v => onUpdate("programNotes", v)}
          placeholder="Add Exercise Notes..."
          placeholderTextColor={t.ts}
          multiline
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
        />
      </View>

      {/* Row 2: compact rest timer chip + Reps/Hold toggle */}
      <View style={[styles.exCompactRow, { borderTopColor: divider }]}>
        <TouchableOpacity onPress={openRestPicker} activeOpacity={0.7} style={styles.exRestChipGroup}>
          <Text style={[styles.exRestLabel, { color: t.ts }]}>Rest Timer</Text>
          <View style={styles.exRestChip}>
            <Ionicons name="timer-outline" size={14} color={restSecs > 0 ? ACCT : t.ts} />
            <Text style={[styles.exRestChipText, { color: restSecs > 0 ? ACCT : t.ts }]}>{formatRest(restSecs)}</Text>
            <Ionicons name="chevron-down" size={12} color={restSecs > 0 ? ACCT : t.ts} />
          </View>
        </TouchableOpacity>
        <View
          style={[styles.exTogglePills, { backgroundColor: isDark ? t.div : "rgba(118,118,128,0.12)" }]}
          onLayout={e => { modeTrackWidth.value = e.nativeEvent.layout.width - 6; }}
        >
          <Reanimated.View style={[styles.exTogglePillPill, { backgroundColor: BUBBLE_LIGHT, shadowOpacity: isDark ? 0.3 : 0.12 }, modePillStyle]} />
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onUpdate("isIsometric", false);
              modeOffset.value = withSpring(0, { damping: 22, stiffness: 300, mass: 0.9 });
            }}
            style={styles.exTogglePill}
            activeOpacity={0.8}
          >
            <Reanimated.Text style={[styles.exTogglePillText, repsLabelColor]}>Reps</Reanimated.Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onUpdate("isIsometric", true);
              modeOffset.value = withSpring(1, { damping: 22, stiffness: 300, mass: 0.9 });
            }}
            style={styles.exTogglePill}
            activeOpacity={0.8}
          >
            <Reanimated.Text style={[styles.exTogglePillText, holdLabelColor]}>Hold</Reanimated.Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Column headers */}
      <View style={[styles.exSetHeaderRow, { borderTopColor: divider }]}>
        <View style={styles.exSetBadgeCol}>
          <Text style={[styles.exSetHeaderLabel, { color: t.ts, width: 28, textAlign: "center" }]}>Set</Text>
        </View>
        <View style={[styles.exSetValueCol, { flexDirection: "column", alignItems: "center", gap: 1 }]}>
          <Text style={[styles.exSetTargetLabel, { color: t.ts }]}>Target</Text>
          <Text style={[styles.exSetHeaderLabel, { color: t.ts }]}>{"Weight"}</Text>
        </View>
        <TouchableOpacity
          style={[styles.exSetValueCol, styles.exSetColRep, styles.exSetHeaderToggle, { flexDirection: "column", alignItems: "center", gap: 1 }]}
          onPress={toggleAllRepMode}
          activeOpacity={0.7}
        >
          <Text style={[styles.exSetTargetLabel, { color: t.ts }]}>Target</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="chevron-down" size={12} color="transparent" style={{ marginRight: 2 }} />
            <Text style={[styles.exSetHeaderLabel, { color: t.ts }]}>
              {exercise.isIsometric
                ? (currentRepMode === "range" ? "Hold Range" : "Hold")
                : (currentRepMode === "range" ? "Rep Range" : "Reps")}
            </Text>
            <Ionicons name="chevron-down" size={12} color={t.ts} style={{ marginLeft: 2 }} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Set rows */}
      {sets.map((set, idx) => {
        const isWarmup = set.type === "warmup";
        const label = setLabels[idx];
        const repMode = set.repMode ?? currentRepMode;
        return (
          <CollapsibleCard
            key={idx}
            isCollapsing={idx === collapsingSetIdx}
            onCollapsed={() => { setCollapsingSetIdx(null); onUpdateSets(sets.slice(0, -1)); }}
            expanding={idx === newlyAddedIdx}
            naturalHeight={idx === newlyAddedIdx ? setRowHeight.current : undefined}
          >
          <View
            style={[styles.exSetRow, { borderTopColor: divider }]}
            onLayout={(idx !== newlyAddedIdx && idx !== collapsingSetIdx) ? e => { const h = e.nativeEvent.layout.height; if (h > 0) setRowHeight.current = h; } : undefined}
          >
            {/* Set type badge */}
            <View style={styles.exSetBadgeCol}>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  patchSet(idx, { type: isWarmup ? "working" : "warmup" });
                }}
                style={[styles.exSetBadge, { borderColor: isWarmup ? WARMUP_ORANGE : divider }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.exSetBadgeText, { color: isWarmup ? WARMUP_ORANGE : t.tp }]}>{label}</Text>
              </TouchableOpacity>
            </View>

            {/* Weight column */}
            <View style={styles.exSetValueCol}>
              <View style={[styles.exSetInputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                <WeightSetInput
                  inputRef={r => { weightRefs.current[idx] = r; }}
                  style={[styles.exSetInputText, { color: t.tp }]}
                  placeholderColor={t.ts}
                  valueKg={set.weightKg}
                  isKg={isKg}
                  onCommitKg={kg => fillDown(idx, { weightKg: kg })}
                  onFocus={() => {
                    const next = () => repsRefs.current[idx]?.focus();
                    const prev = idx > 0
                      ? (currentRepMode === "range"
                          ? () => repsMaxRefs.current[idx - 1]?.focus()
                          : () => repsRefs.current[idx - 1]?.focus())
                      : null;
                    onInputFocus(next, prev);
                  }}
                />
              </View>
            </View>

            {/* Rep column */}
            <View style={[styles.exSetValueCol, styles.exSetColRep]}>
              <View style={[styles.exSetInputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                <TextInput
                  ref={r => { repsRefs.current[idx] = r; }}
                  style={[styles.exSetInputText, { color: t.tp }]}
                  value={repMode === "target" ? (set.reps ?? "") : (set.repsMin ?? "")}
                  onChangeText={v => fillDown(idx, repMode === "target" ? { reps: v } : { repsMin: v })}
                  placeholder="—"
                  placeholderTextColor={t.ts}
                  keyboardType={exercise.isIsometric ? "number-pad" : "decimal-pad"}
                  selectTextOnFocus
                  onFocus={() => {
                    const next = currentRepMode === "range"
                      ? () => repsMaxRefs.current[idx]?.focus()
                      : (idx < sets.length - 1 ? () => weightRefs.current[idx + 1]?.focus() : null);
                    const prev = () => weightRefs.current[idx]?.focus();
                    onInputFocus(next, prev);
                  }}
                />
              </View>
              <Reanimated.View style={[{ overflow: "hidden" }, rangeOuterStyle]}>
                <Reanimated.View style={[{ flexDirection: "row", alignItems: "center", width: RANGE_EXTENSION_WIDTH, transformOrigin: "left" }, rangeInnerStyle]}>
                  <Text style={{ color: t.ts, fontSize: 13, fontFamily: FontFamily.semibold, marginHorizontal: 4 }}>–</Text>
                  <View style={[styles.exSetInputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.07)" }]}>
                    <TextInput
                      ref={r => { repsMaxRefs.current[idx] = r; }}
                      style={[styles.exSetInputText, { color: t.tp }]}
                      value={set.repsMax ?? ""}
                      onChangeText={v => fillDown(idx, { repsMax: v })}
                      placeholder="—"
                      placeholderTextColor={t.ts}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      onFocus={() => {
                        const next = idx < sets.length - 1 ? () => weightRefs.current[idx + 1]?.focus() : null;
                        const prev = () => repsRefs.current[idx]?.focus();
                        onInputFocus(next, prev);
                      }}
                    />
                  </View>
                </Reanimated.View>
              </Reanimated.View>
            </View>
          </View>
          </CollapsibleCard>
        );
      })}

      {/* Add / Remove row */}
      <View style={[styles.exAddRemoveRow, { borderTopColor: divider }]}>
        <BounceButton
          onPress={() => {
            if (sets.length <= 1 || collapsingSetIdx !== null) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setCollapsingSetIdx(sets.length - 1);
          }}
          style={{ opacity: sets.length <= 1 ? 0.35 : 1, flex: 1, marginRight: 6 }}
        >
          <NeuCard dark={isDark} radius={10} shadowSize="sm" style={{ borderRadius: 10 }}>
            <View style={styles.exAddRemoveBtn}>
              <Ionicons name="remove" size={14} color={t.ts} />
              <Text style={[styles.exAddRemoveText, { color: t.ts }]}>Remove Set</Text>
            </View>
          </NeuCard>
        </BounceButton>
        <BounceButton
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            // Duplicate the last working set's targets so a typed value carries
            // into new sets. Warmup values are never copied into a working set.
            const lastWorking = [...sets].reverse().find(s => s.type === "working");
            onUpdateSets([...sets, { ...(lastWorking ?? {}), type: "working" }]);
          }}
          style={{ flex: 1, marginLeft: 6 }}
        >
          <NeuCard dark={isDark} radius={10} shadowSize="sm" style={{ borderRadius: 10 }}>
            <View style={styles.exAddRemoveBtn}>
              <Ionicons name="add" size={14} color={ACCT} />
              <Text style={[styles.exAddRemoveText, { color: ACCT }]}>Add Set</Text>
            </View>
          </NeuCard>
        </BounceButton>
      </View>

      {/* Rest picker modal — only built once opened. Mounting the two 61-row
          animated wheels for every exercise up front was a large chunk of the
          Step 2 mount cost; gating on showRestPicker keeps Step 2 light and the
          open animation still plays (slideY starts offscreen before mount). */}
      {showRestPicker && (
      <Modal visible transparent animationType="none" onRequestClose={closeRestPicker}>
        <View style={styles.restBackdrop}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.restOverlay, { opacity: backdropOpacity }]} />
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeRestPicker} />
          <Animated.View style={[styles.restSheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
            <View {...restPanResponder.panHandlers} style={styles.restHandleArea}>
              <View style={[styles.restHandle, { backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)" }]} />
            </View>
            <View style={[styles.restHeader, { borderBottomColor: divider }]}>
              <Text style={[styles.restTitle, { color: t.tp, textAlign: 'center' }]}>Rest Timer</Text>
              <Text style={[styles.restSubtitle, { color: t.ts, textAlign: 'center' }]} numberOfLines={1}>{exercise.name}</Text>
            </View>
            <View style={styles.restPickerWrap}>
              <View pointerEvents="none" style={[styles.restSelTop, { borderColor: divider }]} />
              <View pointerEvents="none" style={[styles.restSelBottom, { borderColor: divider }]} />
              <Animated.ScrollView
                showsVerticalScrollIndicator={false}
                snapToInterval={REST_ITEM_H}
                decelerationRate="fast"
                contentContainerStyle={{ paddingVertical: REST_ITEM_H * 2 }}
                contentOffset={{ x: 0, y: Math.max(0, REST_OPTIONS.indexOf(restSecs)) * REST_ITEM_H }}
                scrollEventThrottle={16}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { y: scrollAnim } } }],
                  {
                    useNativeDriver: true,
                    listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
                      restScrollOffset.current = e.nativeEvent.contentOffset.y;
                    },
                  }
                )}
                onMomentumScrollEnd={(e) => {
                  const index = Math.round(e.nativeEvent.contentOffset.y / REST_ITEM_H);
                  const val = REST_OPTIONS[Math.max(0, Math.min(index, REST_OPTIONS.length - 1))];
                  onUpdate("restSeconds", val ?? 0);
                }}
              >
                {REST_OPTIONS.map((item, i) => {
                  const rotateX = scrollAnim.interpolate({
                    inputRange: [
                      (i - 2.5) * REST_ITEM_H, (i - 2) * REST_ITEM_H, (i - 1) * REST_ITEM_H,
                      i * REST_ITEM_H, (i + 1) * REST_ITEM_H, (i + 2) * REST_ITEM_H, (i + 2.5) * REST_ITEM_H,
                    ],
                    outputRange: ['-85deg', '-55deg', '-28deg', '0deg', '28deg', '55deg', '85deg'],
                    extrapolate: 'clamp',
                  });
                  const opacity = scrollAnim.interpolate({
                    inputRange: [
                      (i - 2.5) * REST_ITEM_H, (i - 2) * REST_ITEM_H, (i - 1) * REST_ITEM_H,
                      i * REST_ITEM_H, (i + 1) * REST_ITEM_H, (i + 2) * REST_ITEM_H, (i + 2.5) * REST_ITEM_H,
                    ],
                    outputRange: [0, 0.5, 0.75, 1, 0.75, 0.5, 0],
                    extrapolate: 'clamp',
                  });
                  return (
                    <Animated.View key={item} style={[styles.restItem, { opacity, transform: [{ perspective: 280 }, { rotateX }] }]}>
                      <Text style={[styles.restItemText, { color: t.ts }]}>{formatRest(item)}</Text>
                    </Animated.View>
                  );
                })}
              </Animated.ScrollView>
              <View pointerEvents="none" style={{ position: 'absolute', top: REST_ITEM_H * 2, left: 0, right: 0, height: REST_ITEM_H, overflow: 'hidden', backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg }}>
                <Animated.View style={{ transform: [{ translateY: Animated.multiply(scrollAnim, -1) }] }}>
                  {REST_OPTIONS.map((item) => (
                    <View key={item} style={styles.restItem}>
                      <Text style={[styles.restItemText, { color: t.tp, fontFamily: FontFamily.bold }]}>{formatRest(item)}</Text>
                    </View>
                  ))}
                </Animated.View>
              </View>
            </View>
            <View style={styles.restBtnPairRow}>
              <BounceButton
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const index = Math.round(restScrollOffset.current / REST_ITEM_H);
                  const val = REST_OPTIONS[Math.max(0, Math.min(index, REST_OPTIONS.length - 1))] ?? 0;
                  pendingRestApplyAll.current = val;
                  closeRestPicker();
                }}
                accessibilityLabel="Apply rest timer to all exercises"
                accessibilityRole="button"
              >
                <View style={[styles.restApplyAllBtn, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}>
                  <Text style={[styles.restApplyAll, { color: isDark ? APP_DARK.bg : "#fff" }]}>Apply to All</Text>
                </View>
              </BounceButton>
              <BounceButton
                onPress={() => {
                  const index = Math.round(restScrollOffset.current / REST_ITEM_H);
                  const val = REST_OPTIONS[Math.max(0, Math.min(index, REST_OPTIONS.length - 1))] ?? 0;
                  onUpdate("restSeconds", val);
                  closeRestPicker();
                }}
                accessibilityLabel="Confirm rest timer"
                accessibilityRole="button"
              >
                <View style={styles.restDoneWrap}>
                  <View style={styles.restDoneBtn}>
                    <Text style={styles.restDone}>Done</Text>
                  </View>
                </View>
              </BounceButton>
            </View>
          </Animated.View>
        </View>
      </Modal>
      )}

    </View>
  );
});

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({
  label, value, onDecrement, onIncrement, isDark,
}: {
  label: string; value: number;
  onDecrement: () => void; onIncrement: () => void; isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <NeuCard dark={isDark} radius={16} style={styles.stepperCard}>
      <View style={styles.stepperInner}>
        <Text style={[styles.fieldLabel, { color: t.ts }]}>{label}</Text>
        <View style={styles.stepperControls}>
          <TouchableOpacity onPress={onDecrement} style={styles.stepBtn} activeOpacity={0.7}>
            <Ionicons name="remove" size={18} color={t.tp} />
          </TouchableOpacity>
          <Text style={[styles.stepValue, { color: t.tp }]}>{value}</Text>
          <TouchableOpacity onPress={onIncrement} style={styles.stepBtn} activeOpacity={0.7}>
            <Ionicons name="add" size={18} color={t.tp} />
          </TouchableOpacity>
        </View>
      </View>
    </NeuCard>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step, isDark, canStep2, onStepPress }: {
  step: 1 | 2;
  isDark: boolean;
  canStep2: boolean;
  onStepPress: (s: 1 | 2) => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The green aurora glows behind this indicator, so light mode needs stronger
  // colors than the usual pale grays / bright ACCT: a deeper green for text and
  // the line, a translucent slate for inactive parts, and a frosted white rim
  // on the dots to lift them off the tint (same rim as the Home orbs).
  const accent  = isDark ? ACCT : ACCT_DEEP;
  const divider = isDark ? "rgba(255,255,255,0.12)" : "rgba(45,55,72,0.18)";
  const muted   = isDark ? t.ts : "rgba(45,55,72,0.55)";
  const rim     = isDark ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)";
  return (
    <View style={styles.stepIndicatorWrap}>
      <View style={[styles.stepLine, { backgroundColor: step === 2 ? accent : divider }]} />
      <View style={styles.stepIndicatorRow}>
        <BounceButton style={styles.stepItem} onPress={() => onStepPress(1)} accessibilityLabel="Go to setup" accessibilityRole="button">
          <View style={[styles.stepDot, {
            backgroundColor: ACCT,
            borderColor: rim,
            shadowColor: ACCT,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.55,
            shadowRadius: 8,
          }]}>
            <Text style={styles.stepDotText}>1</Text>
          </View>
          <Text style={[styles.stepDotLabel, { color: accent }]}>Setup</Text>
        </BounceButton>
        <BounceButton
          style={[styles.stepItem, !canStep2 && { opacity: 0.4 }]}
          onPress={() => canStep2 && onStepPress(2)}
          accessibilityLabel="Go to workouts"
          accessibilityRole="button"
        >
          <View style={[styles.stepDot, step === 2 ? {
            backgroundColor: ACCT,
            borderColor: rim,
            shadowColor: ACCT,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.55,
            shadowRadius: 8,
          } : { backgroundColor: divider, borderColor: rim }]}>
            <Text style={[styles.stepDotText, { color: step === 2 ? "#fff" : muted }]}>2</Text>
          </View>
          <Text style={[styles.stepDotLabel, { color: step === 2 ? accent : muted }]}>Workouts</Text>
        </BounceButton>
      </View>
    </View>
  );
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({
  name, setName,
  totalWeeks, setTotalWeeks,
  cycleDays, onCycleDaysChange,
  cyclePattern, isTrainingDay, onToggleDay, onSetDayName,
  isDark, onNext,
}: {
  name: string; setName: (v: string) => void;
  totalWeeks: number; setTotalWeeks: (v: number) => void;
  cycleDays: number; onCycleDaysChange: (v: number) => void;
  cyclePattern: string[]; isTrainingDay: boolean[];
  onToggleDay: (i: number) => void; onSetDayName: (i: number, t: string) => void;
  isDark: boolean; onNext: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;
  const dayInputRefs = useRef<Array<TextInput | null>>([]);
  const hasRendered = useRef(false);
  useEffect(() => { hasRendered.current = true; }, []);
  const prevCycleDays = useRef(cycleDays);
  const expandingIdx = cycleDays > prevCycleDays.current ? cycleDays - 1 : null;
  useEffect(() => { prevCycleDays.current = cycleDays; }, [cycleDays]);
  const [cycleCollapsingIdx, setCycleCollapsingIdx] = useState<number | null>(null);
  const pendingCycleDays = useRef<number | null>(null);
  const dayRowHeight = useRef(0);

  const handleCycleDecrement = useCallback(() => {
    if (cycleCollapsingIdx !== null) return;
    const next = clamp(cycleDays - 1, 2, 14);
    setCycleCollapsingIdx(cycleDays - 1);
    pendingCycleDays.current = next;
  }, [cycleDays, cycleCollapsingIdx]);

  const handleCycleCollapsed = useCallback(() => {
    const next = pendingCycleDays.current;
    if (next === null) return;
    pendingCycleDays.current = null;
    setCycleCollapsingIdx(null);
    onCycleDaysChange(next);
  }, [onCycleDaysChange]);
  const trainingIndices = cyclePattern.map((_, i) => i).filter(i => isTrainingDay[i]);
  const canProceed =
    name.trim().length > 0 &&
    isTrainingDay.some(Boolean) &&
    isTrainingDay.every((isTraining, i) => !isTraining || cyclePattern[i].trim().length > 0);

  return (
    <>
      <Text style={[styles.fieldLabel, { color: t.ts }]}>PROGRAM NAME</Text>
      <NeuCard dark={isDark} radius={16} style={styles.inputCard}>
        <TextInput
          style={[styles.textInput, { color: t.tp }]}
          placeholder="e.g. Push Pull Legs (PPL)"
          placeholderTextColor={t.ts}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
          autoCapitalize="words"
        />
      </NeuCard>

      <View style={styles.stepperRow}>
        <View style={{ flex: 1 }}>
          <Stepper
            label="TOTAL WEEKS"
            value={totalWeeks}
            onDecrement={() => setTotalWeeks(clamp(totalWeeks - 1, 1, 52))}
            onIncrement={() => setTotalWeeks(clamp(totalWeeks + 1, 1, 52))}
            isDark={isDark}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Stepper
            label="CYCLE DAYS"
            value={cycleDays}
            onDecrement={handleCycleDecrement}
            onIncrement={() => onCycleDaysChange(cycleDays + 1)}
            isDark={isDark}
          />
        </View>
      </View>

      <Text style={[styles.fieldLabel, { color: t.ts }]}>CYCLE PATTERN</Text>
      <NeuCard dark={isDark} radius={16} style={styles.cycleCard}>
        <View style={styles.cycleCardInner}>
          {cyclePattern.map((day, i) => {
            const isTraining = isTrainingDay[i];
            return (
              <Reanimated.View key={i}>
              <CollapsibleCard
                isCollapsing={cycleCollapsingIdx === i}
                onCollapsed={handleCycleCollapsed}
                expanding={expandingIdx === i}
                naturalHeight={i === expandingIdx ? dayRowHeight.current : undefined}
              >
              <View
                onLayout={e => {
                  const h = e.nativeEvent.layout.height;
                  if (h > 0 && i !== expandingIdx) dayRowHeight.current = h;
                }}
                style={[
                  styles.dayRow,
                  i > 0 && { borderTopWidth: 1, borderTopColor: divider },
                ]}
              >
                <Text style={[styles.dayLabel, { color: t.ts }]}>Day {i + 1}</Text>
                <View style={styles.nameArea}>
                  {isTraining ? (
                    <>
                      <TextInput
                        ref={(r) => { dayInputRefs.current[i] = r; }}
                        style={[styles.dayNameInput, { color: t.tp }]}
                        value={day}
                        onChangeText={(text) => onSetDayName(i, text)}
                        placeholder="Workout"
                        placeholderTextColor={t.ts}
                        returnKeyType={trainingIndices.at(-1) === i ? "done" : "next"}
                        onSubmitEditing={() => {
                          const pos = trainingIndices.indexOf(i);
                          const nextIdx = trainingIndices[pos + 1];
                          if (nextIdx !== undefined) dayInputRefs.current[nextIdx]?.focus();
                        }}
                      />
                      <Ionicons name="pencil-outline" size={12} color={t.ts} />
                      {/* Absolutely positioned — zero layout impact, text stays centred */}
                      <View style={[styles.nameUnderline, { backgroundColor: t.ts }]} />
                    </>
                  ) : (
                    <Text style={[styles.restLabel, { color: t.ts }]}>Rest</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => onToggleDay(i)}
                  style={[styles.togglePill, isTraining ? {
                    backgroundColor: ACCT,
                    shadowColor: ACCT,
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.5,
                    shadowRadius: 8,
                  } : { backgroundColor: divider }]}
                  activeOpacity={0.7}
                >
                  {isTraining
                    ? <DumbbellIcon size={13} color="#fff" />
                    : <Ionicons name="moon-outline" size={13} color={t.ts} />
                  }
                  <Text style={[styles.togglePillText, { color: isTraining ? "#fff" : t.ts }]}>
                    {isTraining ? "Training" : "Rest"}
                  </Text>
                </TouchableOpacity>
              </View>
              </CollapsibleCard>
              </Reanimated.View>
            );
          })}
        </View>
      </NeuCard>

      <BounceButton
        onPress={canProceed ? onNext : undefined}
        accessibilityLabel="Next step"
        accessibilityRole="button"
        style={{ opacity: canProceed ? 1 : 0.4 }}
      >
        {(() => {
          const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
          const btnContent = isDark ? APP_DARK.bg : "#fff";
          const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";
          return (
            <View style={[styles.primaryBtnWrap, { backgroundColor: btnBg, shadowColor: btnShadow }]}>
              <View style={[styles.primaryBtn, { backgroundColor: btnBg }]}>
                <Text style={[styles.primaryBtnText, { color: btnContent }]}>Next</Text>
                <Ionicons name="arrow-forward" size={18} color={btnContent} />
              </View>
            </View>
          );
        })()}
      </BounceButton>
    </>
  );
}

// ─── Draggable Exercise List ──────────────────────────────────────────────────

interface DraggableExerciseListProps {
  exercises: Exercise[];
  day: string;
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  onReorderExercises: (day: string, exercises: Exercise[]) => void;
  onDragStateChange: (dragging: boolean) => void;
  onRemoveExercise: (day: string, id: string) => void;
  onEditExercise: (day: string, id: string) => void;
}

function DraggableExerciseList({
  exercises, day, isDark, t,
  onReorderExercises, onDragStateChange, onRemoveExercise, onEditExercise,
}: DraggableExerciseListProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const activeIdxRef = useRef<number | null>(null);
  const hoverIdxRef = useRef<number | null>(null);
  const rowHeightRef = useRef(50);

  // Keyed by exercise ID so offsets survive reorders without index mismatch.
  // Using a Map means each exercise always owns its Animated.Value regardless of position changes.
  const rowAnimsMap = useRef(new Map<string, Animated.Value>());
  exercises.forEach(ex => {
    if (!rowAnimsMap.current.has(ex.id)) rowAnimsMap.current.set(ex.id, new Animated.Value(0));
  });

  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const onReorderRef = useRef(onReorderExercises);
  onReorderRef.current = onReorderExercises;
  const onDragStateRef = useRef(onDragStateChange);
  onDragStateRef.current = onDragStateChange;

  // After a reorder, React commits the new order to native then this fires before the frame
  // paints — resetting all offsets to 0 is invisible because exercises are already at their
  // correct rendered positions. Always reset on exercises change; no flag needed.
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
          onDragStateRef.current(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
        onPanResponderMove: (_, gs) => {
          // Drive active row directly via its stable ID — synchronous, no React state needed
          rowAnimsMap.current.get(ex.id)?.setValue(gs.dy);
          const rh = rowHeightRef.current;
          const exList = exercisesRef.current;
          const newHover = Math.max(0, Math.min(exList.length - 1, Math.round(idx + gs.dy / rh)));
          if (newHover !== hoverIdxRef.current) {
            hoverIdxRef.current = newHover;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            // useNativeDriver: false runs on the JS thread where starting a new spring
            // automatically cancels the previous one on the same value — no race conditions
            exList.forEach((item, i) => {
              if (i === idx) return;
              let toVal = 0;
              if (newHover > idx && i > idx && i <= newHover) toVal = -rh;
              else if (newHover < idx && i < idx && i >= newHover) toVal = rh;
              Animated.spring(rowAnimsMap.current.get(item.id)!, {
                toValue: toVal,
                useNativeDriver: false,
                damping: 20,
                stiffness: 280,
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
            onReorderRef.current(day, arr);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            // Don't reset anims here — useLayoutEffect resets them after React commits
            // the new order so the reset is invisible (no jump-back glitch)
          } else {
            rowAnimsMap.current.forEach(a => a.setValue(0));
          }
          activeIdxRef.current = null;
          hoverIdxRef.current = null;
          setActiveIdx(null);
          onDragStateRef.current(false);
        },
        onPanResponderTerminate: () => {
          rowAnimsMap.current.forEach(a => a.setValue(0));
          activeIdxRef.current = null;
          hoverIdxRef.current = null;
          setActiveIdx(null);
          onDragStateRef.current(false);
        },
      })
    ),
  [exercises, day]);

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
              styles.daySummaryRow,
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
            <View {...panResponders[i].panHandlers} style={styles.dragHandleArea}>
              <DragHandleIcon color={t.ts} />
            </View>
            <View style={[styles.daySummaryNumChip, { backgroundColor: ACCT + "18" }]}>
              <Text style={[styles.daySummaryNum, { color: ACCT }]}>{i + 1}</Text>
            </View>
            <TouchableOpacity
              style={styles.daySummaryNameBtn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onEditExercise(day, ex.id); }}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Text style={[styles.daySummaryName, { color: t.tp }]} numberOfLines={1}>{ex.name}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert("Remove Exercise", `Remove "${ex.name}"?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => onRemoveExercise(day, ex.id) },
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

// ─── Reorder Sheet ────────────────────────────────────────────────────────────

interface ReorderSheetProps {
  visible: boolean;
  day: string;
  exercises: Exercise[];
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  onReorderExercises: (day: string, exercises: Exercise[]) => void;
  onRemoveExercise: (day: string, id: string) => void;
  onEditExercise: (day: string, id: string) => void;
  onClose: () => void;
}

function ReorderSheet({ visible, day, exercises, isDark, t, onReorderExercises, onRemoveExercise, onEditExercise, onClose }: ReorderSheetProps) {
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
      <View style={styles.restBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.restOverlay, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />
        <Animated.View style={[styles.reorderSheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers} style={styles.restHandleArea}>
            <View style={styles.reorderHandle} />
          </View>
          <View style={[styles.restHeader, { borderBottomColor: divider }]}>
            <Text style={[styles.restTitle, { color: t.tp }]}>Reorder Exercises</Text>
            <Text style={[styles.restSubtitle, { color: t.ts }]}>{dayLabel(day)}</Text>
          </View>
          <View style={styles.reorderListWrap}>
            <DraggableExerciseList
              exercises={exercises}
              day={day}
              isDark={isDark}
              t={t}
              onReorderExercises={onReorderExercises}
              onDragStateChange={() => {}}
              onRemoveExercise={onRemoveExercise}
              onEditExercise={onEditExercise}
            />
          </View>
          <View style={styles.restDoneRow}>
            <BounceButton
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); closeSheet(); }}
              accessibilityLabel="Done"
              accessibilityRole="button"
            >
              <View style={styles.restDoneWrap}>
                <View style={styles.restDoneBtn}>
                  <Text style={styles.restDone}>Done</Text>
                </View>
              </View>
            </BounceButton>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Workout Summary sheet ────────────────────────────────────────────────────
// Compact overview of the whole program, opened from the floating Summary
// button on Step 2 (whose full page gets very long once exercises are added).
// Two steps inside one sheet, mirroring workout.tsx's ChangeDaySheet:
//   - days list: every cycle day (Training AND Rest) with exercise/set counts
//     and the muscle groups it hits. Drag the handle to reorder the cycle —
//     each day's exercises travel with it (see reorderCycleDays).
//   - day detail: that day's exercises via the existing DraggableExerciseList
//     (drag to reorder, tap to change, trash to remove), plus Go to Day (jump
//     the long Step 2 page straight to it) and Add Exercise shortcuts.

function DraggableDayList({ cyclePattern, isTrainingDay, workouts, customExercises, isDark, t, onReorder, onDragStateChange, onOpenDay }: {
  cyclePattern: string[];
  isTrainingDay: boolean[];
  workouts: WorkoutMap;
  customExercises: CustomExercise[];
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  onReorder: (from: number, to: number) => void;
  onDragStateChange: (dragging: boolean) => void;
  onOpenDay: (cycleIdx: number) => void;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const activeIdxRef = useRef<number | null>(null);
  const hoverIdxRef = useRef<number | null>(null);
  const rowHeightRef = useRef(62);
  const count = cyclePattern.length;

  // Rows are uniform height and reorder commits on release, so index-keyed
  // Animated.Values are safe here (the exercise list keys by id because its
  // rows carry identity; a cycle slot IS its position).
  const rowAnims = useRef<Animated.Value[]>([]);
  while (rowAnims.current.length < count) rowAnims.current.push(new Animated.Value(0));

  const countRef = useRef(count);
  countRef.current = count;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onDragStateRef = useRef(onDragStateChange);
  onDragStateRef.current = onDragStateChange;

  useLayoutEffect(() => {
    rowAnims.current.forEach(a => a.setValue(0));
  }, [cyclePattern, isTrainingDay]);

  const panResponders = useMemo(() =>
    cyclePattern.map((_, idx) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          activeIdxRef.current = idx;
          hoverIdxRef.current = idx;
          rowAnims.current.forEach(a => a.setValue(0));
          setActiveIdx(idx);
          onDragStateRef.current(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
        onPanResponderMove: (_, gs) => {
          rowAnims.current[idx]?.setValue(gs.dy);
          const rh = rowHeightRef.current;
          const newHover = Math.max(0, Math.min(countRef.current - 1, Math.round(idx + gs.dy / rh)));
          if (newHover !== hoverIdxRef.current) {
            hoverIdxRef.current = newHover;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            for (let i = 0; i < countRef.current; i++) {
              if (i === idx) continue;
              let toVal = 0;
              if (newHover > idx && i > idx && i <= newHover) toVal = -rh;
              else if (newHover < idx && i < idx && i >= newHover) toVal = rh;
              Animated.spring(rowAnims.current[i], {
                toValue: toVal, useNativeDriver: false, damping: 20, stiffness: 280,
              }).start();
            }
          }
        },
        onPanResponderRelease: () => {
          const from = activeIdxRef.current!;
          const to = hoverIdxRef.current ?? from;
          if (to !== from) {
            onReorderRef.current(from, to);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } else {
            rowAnims.current.forEach(a => a.setValue(0));
          }
          activeIdxRef.current = null;
          hoverIdxRef.current = null;
          setActiveIdx(null);
          onDragStateRef.current(false);
        },
        onPanResponderTerminate: () => {
          rowAnims.current.forEach(a => a.setValue(0));
          activeIdxRef.current = null;
          hoverIdxRef.current = null;
          setActiveIdx(null);
          onDragStateRef.current(false);
        },
      })
    ),
  [cyclePattern]);

  const divider = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";

  return (
    <>
      {cyclePattern.map((name, i) => {
        const isTraining = isTrainingDay[i];
        const label = name.trim() || "Workout";
        const exs = isTraining ? (workouts[`${i}:${label}`] ?? []) : [];
        const setCount = exs.reduce((n, e) => n + normaliseSets(e).length, 0);
        const muscles = isTraining
          ? Array.from(new Set(exs.flatMap(e => musclesForExercise(e.name, customExercises))))
          : [];
        const isActive = activeIdx === i;
        return (
          <Animated.View
            key={i}
            style={[
              styles.sumDayRow,
              i < count - 1 && { borderBottomWidth: 1, borderBottomColor: isActive ? "transparent" : divider },
              { transform: [{ translateY: rowAnims.current[i] }], zIndex: isActive ? 10 : 1 },
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
            <View {...panResponders[i].panHandlers} style={styles.dragHandleArea}>
              <DragHandleIcon color={t.ts} />
            </View>
            <View style={[styles.daySummaryNumChip, { backgroundColor: isTraining ? ACCT + "18" : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)") }]}>
              <Text style={[styles.daySummaryNum, { color: isTraining ? ACCT : t.ts }]}>{i + 1}</Text>
            </View>
            {isTraining ? (
              <TouchableOpacity
                style={styles.sumDayBody}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenDay(i); }}
                activeOpacity={0.7}
                accessibilityLabel={`Open ${label}`}
                accessibilityRole="button"
              >
                <Text style={[styles.sumDayName, { color: t.tp }]} numberOfLines={1}>{label}</Text>
                <Text style={[styles.sumDayMeta, { color: t.ts }]} numberOfLines={1}>
                  {exs.length} exercise{exs.length === 1 ? "" : "s"} · {setCount} set{setCount === 1 ? "" : "s"}
                  {muscles.length > 0 ? ` · ${muscles.join(", ")}` : ""}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.sumDayBody}>
                <Text style={[styles.sumDayName, { color: t.ts }]}>Rest</Text>
              </View>
            )}
            {isTraining
              ? <Ionicons name="chevron-forward" size={16} color={t.ts} />
              : <Ionicons name="moon-outline" size={15} color={t.ts} />}
          </Animated.View>
        );
      })}
    </>
  );
}

function ProgramSummarySheet({ visible, isDark, t, cyclePattern, isTrainingDay, workouts, customExercises, onReorderDays, onReorderExercises, onRemoveExercise, onEditExercise, onAddExercise, onJumpToDay, onClose }: {
  visible: boolean;
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  cyclePattern: string[];
  isTrainingDay: boolean[];
  workouts: WorkoutMap;
  customExercises: CustomExercise[];
  onReorderDays: (from: number, to: number) => void;
  onReorderExercises: (day: string, exercises: Exercise[]) => void;
  onRemoveExercise: (day: string, id: string) => void;
  onEditExercise: (day: string, id: string) => void;
  onAddExercise: (day: string) => void;
  onJumpToDay: (cycleIdx: number) => void;
  onClose: () => void;
}) {
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // null = days overview; a cycle index = that day's exercise list.
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  // The sheet's ScrollView must not fight row drags — same trick as Step 2.
  const [listScrollEnabled, setListScrollEnabled] = useState(true);

  useEffect(() => {
    if (visible) {
      setDetailIdx(null);
      setListScrollEnabled(true);
      slideY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const animateOut = useCallback((cb: () => void) => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); cb(); });
  }, [slideY, backdropOpacity]);

  const closeSheet = useCallback(() => animateOut(onClose), [animateOut, onClose]);

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

  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;

  const detailLabel = detailIdx != null ? (cyclePattern[detailIdx] ?? "").trim() || "Workout" : "";
  const detailKey = detailIdx != null ? `${detailIdx}:${detailLabel}` : null;
  const detailExs = detailKey ? (workouts[detailKey] ?? []) : [];
  const detailSets = detailExs.reduce((n, e) => n + normaliseSets(e).length, 0);

  const trainingCount = isTrainingDay.filter(Boolean).length;
  let totalEx = 0;
  let totalSets = 0;
  cyclePattern.forEach((n, i) => {
    if (!isTrainingDay[i]) return;
    const exs = workouts[`${i}:${n.trim() || "Workout"}`] ?? [];
    totalEx += exs.length;
    totalSets += exs.reduce((s, e) => s + normaliseSets(e).length, 0);
  });

  return (
    <Modal
      visible={visible}
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => { if (detailIdx != null) setDetailIdx(null); else closeSheet(); }}
    >
      <View style={styles.restBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.restOverlay, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />
        <Animated.View style={[styles.summarySheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers} style={styles.restHandleArea}>
            <View style={styles.reorderHandle} />
          </View>

          <View style={[styles.sumHeader, { borderBottomColor: divider }]}>
            {detailIdx != null ? (
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDetailIdx(null); }}
                style={styles.sumBackBtn}
                activeOpacity={0.7}
                accessibilityLabel="Back to summary"
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={20} color={t.tp} />
              </TouchableOpacity>
            ) : <View style={styles.sumBackBtn} />}
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={[styles.restTitle, { color: t.tp }]} numberOfLines={1}>
                {detailIdx != null ? detailLabel : "Workout Summary"}
              </Text>
              <Text style={[styles.restSubtitle, { color: t.ts }]} numberOfLines={1}>
                {detailIdx != null
                  ? `${detailExs.length} exercise${detailExs.length === 1 ? "" : "s"} · ${detailSets} set${detailSets === 1 ? "" : "s"}`
                  : `${trainingCount} training day${trainingCount === 1 ? "" : "s"} · ${totalEx} exercise${totalEx === 1 ? "" : "s"} · ${totalSets} set${totalSets === 1 ? "" : "s"}`}
              </Text>
            </View>
            <View style={styles.sumBackBtn} />
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            scrollEnabled={listScrollEnabled}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sumListWrap}
          >
            {detailIdx == null ? (
              <DraggableDayList
                cyclePattern={cyclePattern}
                isTrainingDay={isTrainingDay}
                workouts={workouts}
                customExercises={customExercises}
                isDark={isDark}
                t={t}
                onReorder={onReorderDays}
                onDragStateChange={dragging => setListScrollEnabled(!dragging)}
                onOpenDay={setDetailIdx}
              />
            ) : detailExs.length === 0 ? (
              <Text style={[styles.daySummaryEmpty, { color: t.ts }]}>No exercises yet</Text>
            ) : (
              <DraggableExerciseList
                exercises={detailExs}
                day={detailKey!}
                isDark={isDark}
                t={t}
                onReorderExercises={onReorderExercises}
                onDragStateChange={dragging => setListScrollEnabled(!dragging)}
                onRemoveExercise={onRemoveExercise}
                onEditExercise={(day, id) => animateOut(() => onEditExercise(day, id))}
              />
            )}
          </ScrollView>

          {detailIdx == null ? (
            <View style={styles.restDoneRow}>
              <BounceButton
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); closeSheet(); }}
                accessibilityLabel="Done"
                accessibilityRole="button"
              >
                <View style={styles.restDoneWrap}>
                  <View style={styles.restDoneBtn}>
                    <Text style={styles.restDone}>Done</Text>
                  </View>
                </View>
              </BounceButton>
            </View>
          ) : (
            <View style={styles.restBtnPairRow}>
              <BounceButton
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); animateOut(() => onJumpToDay(detailIdx)); }}
                accessibilityLabel="Go to day"
                accessibilityRole="button"
              >
                <View style={[styles.restApplyAllBtn, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}>
                  <Text style={[styles.restApplyAll, { color: isDark ? APP_DARK.bg : "#fff" }]}>Go to Day</Text>
                </View>
              </BounceButton>
              <BounceButton
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); animateOut(() => onAddExercise(detailKey!)); }}
                accessibilityLabel="Add exercise"
                accessibilityRole="button"
              >
                <View style={styles.restDoneWrap}>
                  <View style={[styles.restDoneBtn, { paddingHorizontal: 24 }]}>
                    <Text style={styles.restDone}>Add Exercise</Text>
                  </View>
                </View>
              </BounceButton>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────

interface DayCardProps {
  day: string;
  exercises: Exercise[];
  isDark: boolean;
  collapsingIds: Set<string>;
  customImageByName: Record<string, string>;
  onOpenPicker: (day: string) => void;
  onEditExercise: (day: string, id: string) => void;
  onUpdateExercise: (day: string, id: string, field: keyof Exercise, value: string | number | boolean) => void;
  onUpdateExerciseSets: (day: string, id: string, sets: ProgramSet[]) => void;
  onApplyRestToAll: (secs: number) => void;
  onRemoveExercise: (day: string, id: string) => void;
  onStartCollapse: (day: string, id: string) => void;
  onReorderExercises: (day: string, exercises: Exercise[]) => void;
  onDragStateChange: (dragging: boolean) => void;
  onInputFocus: (nextFn: (() => void) | null, prevFn: (() => void) | null) => void;
  onOpenReorder: (day: string) => void;
  onMeasureDay: (day: string, y: number) => void;
}

// One day's heading + full exercise list (always expanded — no collapsed/summary
// view). Memoized so editing one day only re-renders that day; every prop is kept
// referentially stable by the parent (callbacks via useCallback), so untouched
// days bail out.
const DayCard = memo(function DayCard({
  day, exercises, isDark, collapsingIds, customImageByName,
  onOpenPicker, onEditExercise, onUpdateExercise, onUpdateExerciseSets, onApplyRestToAll,
  onRemoveExercise, onStartCollapse, onReorderExercises, onDragStateChange,
  onInputFocus, onOpenReorder, onMeasureDay,
}: DayCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;

  // The sticky day header docks a day the moment its HEADING CARD reaches the
  // top (plain onLayout — no measureLayout, which can throw on Fabric). It used
  // to dock on the first exercise's "EXERCISE 1 OF N" label instead, which made
  // the pinned title lag on the previous day while the next day's heading (and
  // first exercise) were already on screen.
  const dayTopRef = useRef(0);
  const reportDock = useCallback(() => {
    onMeasureDay(day, dayTopRef.current);
  }, [day, onMeasureDay]);

  return (
    <View
      style={{ marginBottom: 16 }}
      onLayout={e => { dayTopRef.current = e.nativeEvent.layout.y; reportDock(); }}
    >
      <NeuCard dark={isDark} radius={16} style={styles.dayHeadingCard} innerStyle={styles.dayHeadingCardInner}>
        <View style={styles.dayHeadingRow}>
          <View style={styles.dayHeadingLeft}>
            <View style={[styles.dayAccentBar, { backgroundColor: ACCT }]} />
            <Text style={[styles.dayHeading, { color: t.tp }]}>{dayLabel(day).toUpperCase()}</Text>
            {exercises.length > 0 && (
              <NeuCard dark={isDark} radius={14} style={styles.dayExBadge} innerStyle={styles.dayExBadgeInner}>
                <Text style={[styles.dayExBadgeText, { color: ACCT }]}>{exercises.length}</Text>
              </NeuCard>
            )}
          </View>
        </View>
      </NeuCard>

      {/* Full exercise list, always shown — no collapsed/summary view. A plain
          View (no Reanimated layout-anim ancestor) so the per-set CollapsibleCards
          reflow live as sets are added. */}
      <View>
          {exercises.length === 0 && (
            <NeuCard dark={isDark} radius={16} style={styles.emptyCard}>
              <Text style={[styles.emptyHint, { color: t.ts }]}>No exercises yet</Text>
            </NeuCard>
          )}
          {exercises.map((ex, i) => {
            const card = (
              <NeuCard dark={isDark} radius={16} style={styles.exerciseCard}>
                <ExerciseRow
                  day={day}
                  exercise={ex}
                  exIndex={i}
                  totalExercises={exercises.length}
                  isDark={isDark}
                  onUpdateExercise={onUpdateExercise}
                  onUpdateExerciseSets={onUpdateExerciseSets}
                  onApplyRestToAll={onApplyRestToAll}
                  onStartCollapse={onStartCollapse}
                  onOpenReorder={onOpenReorder}
                  onEditExercise={onEditExercise}
                  onInputFocus={onInputFocus}
                  customImageByName={customImageByName}
                />
              </NeuCard>
            );
            return (
              <CollapsibleCard
                key={ex.id}
                isCollapsing={collapsingIds.has(ex.id)}
                onCollapsed={() => onRemoveExercise(day, ex.id)}
              >
                {card}
              </CollapsibleCard>
            );
          })}
          <BounceButton onPress={() => onOpenPicker(day)} accessibilityLabel="Add exercise" accessibilityRole="button">
            <View style={styles.addExBtnWrap}>
              <View style={styles.addExBtn}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addExText}>Add Exercise</Text>
              </View>
            </View>
          </BounceButton>
      </View>
    </View>
  );
});

function Step2({
  workouts, onOpenPicker, onEditExercise, onUpdateExercise, onUpdateExerciseSets, onApplyRestToAll, onRemoveExercise, onReorderExercises, onDragStateChange, isDark, onFinish, isEditMode, isReviewMode, isSharedEditMode, collapsingIds, onStartCollapse, onInputFocus, customImageByName, onMeasureDay,
}: {
  workouts: WorkoutMap;
  onOpenPicker: (day: string) => void;
  onEditExercise: (day: string, id: string) => void;
  onUpdateExercise: (day: string, id: string, field: keyof Exercise, value: string | number | boolean) => void;
  onUpdateExerciseSets: (day: string, id: string, sets: ProgramSet[]) => void;
  onApplyRestToAll: (secs: number) => void;
  onRemoveExercise: (day: string, id: string) => void;
  onReorderExercises: (day: string, exercises: Exercise[]) => void;
  onDragStateChange: (dragging: boolean) => void;
  isDark: boolean;
  onFinish: () => void;
  isEditMode: boolean;
  isReviewMode: boolean;
  isSharedEditMode: boolean;
  collapsingIds: Set<string>;
  onStartCollapse: (day: string, id: string) => void;
  onInputFocus: (nextFn: (() => void) | null, prevFn: (() => void) | null) => void;
  customImageByName: Record<string, string>;
  onMeasureDay: (day: string, y: number) => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const days = Object.keys(workouts);
  const [reorderDay, setReorderDay] = useState<string | null>(null);

  const openReorder = useCallback((day: string) => setReorderDay(day), []);

  return (
    <>
      {days.map((day) => (
        <DayCard
          key={day}
          day={day}
          exercises={workouts[day] ?? []}
          isDark={isDark}
          collapsingIds={collapsingIds}
          customImageByName={customImageByName}
          onOpenPicker={onOpenPicker}
          onEditExercise={onEditExercise}
          onUpdateExercise={onUpdateExercise}
          onUpdateExerciseSets={onUpdateExerciseSets}
          onApplyRestToAll={onApplyRestToAll}
          onRemoveExercise={onRemoveExercise}
          onStartCollapse={onStartCollapse}
          onReorderExercises={onReorderExercises}
          onDragStateChange={onDragStateChange}
          onInputFocus={onInputFocus}
          onOpenReorder={openReorder}
          onMeasureDay={onMeasureDay}
        />
      ))}

      {!isEditMode && !isReviewMode && !isSharedEditMode && (
        <BounceButton onPress={onFinish} accessibilityLabel="Create program" accessibilityRole="button">
          {(() => {
            const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
            const btnContent = isDark ? APP_DARK.bg : "#fff";
            const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";
            return (
              <View style={[styles.primaryBtnWrap, { backgroundColor: btnBg, shadowColor: btnShadow }]}>
                <View style={[styles.primaryBtn, { backgroundColor: btnBg }]}>
                  <Text style={[styles.primaryBtnText, { color: btnContent }]}>Create Program</Text>
                </View>
              </View>
            );
          })()}
        </BounceButton>
      )}

      <ReorderSheet
        visible={reorderDay !== null}
        day={reorderDay ?? ""}
        exercises={reorderDay ? (workouts[reorderDay] ?? []) : []}
        isDark={isDark}
        t={t}
        onReorderExercises={onReorderExercises}
        onRemoveExercise={onRemoveExercise}
        onEditExercise={onEditExercise}
        onClose={() => setReorderDay(null)}
      />
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NewProgramScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { id: editId, reviewId, sharedId } = useLocalSearchParams<{ id?: string; reviewId?: string; sharedId?: string }>();
  const isEditMode = !!editId;
  const isReviewMode = !!reviewId && !editId;
  const isSharedEditMode = !!sharedId && !editId && !reviewId;

  const [step, setStep] = useState<1 | 2>(1);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [name, setName] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(8);
  const [cycleDays, setCycleDays] = useState(7);
  const [cyclePattern, setCyclePattern] = useState<string[]>(Array(7).fill(""));
  const [isTrainingDay, setIsTrainingDay] = useState<boolean[]>([true, true, true, false, false, false, false]);
  const [workouts, setWorkouts] = useState<WorkoutMap>({});
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  // Lowercased name → custom photo URI, so the builder's exercise rows can show
  // the user's photo (custom exercises aren't in the bundled image maps).
  const customImageByName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of customExercises) {
      if (c.imageUri) map[c.name.trim().toLowerCase()] = c.imageUri;
    }
    return map;
  }, [customExercises]);
  const [collapsingIds, setCollapsingIds] = useState<Set<string>>(new Set());
  const [pickerState, setPickerState] = useState<{ day: string; replaceId?: string } | null>(null);
  // Workout Summary sheet (floating button on Step 2).
  const [summaryOpen, setSummaryOpen] = useState(false);
  // First-run coach mark teaching the tap-to-toggle Training/Rest interaction.
  const [showCycleCoach, setShowCycleCoach] = useState(false);
  // First-run coach mark for Step 2 — two pages: (1) set badges toggle
  // working/warmup, (2) the green Add Exercise button + multi-select.
  const [showWorkoutsCoach, setShowWorkoutsCoach] = useState(false);
  const [workoutsCoachPage, setWorkoutsCoachPage] = useState<1 | 2>(1);

  // Show the coach mark once, only when freshly creating a program (never in
  // edit/review/shared flows, where the user already knows the builder).
  useEffect(() => {
    if (isEditMode || isReviewMode || isSharedEditMode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    AsyncStorage.getItem(CYCLE_COACHMARK_KEY)
      .then(seen => {
        if (cancelled || seen) return;
        // Brief delay so the popup lands after the screen's entrance settles.
        timer = setTimeout(() => { if (!cancelled) setShowCycleCoach(true); }, 450);
      })
      .catch(e => warnStorage("getItem", CYCLE_COACHMARK_KEY, e));
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [isEditMode, isReviewMode, isSharedEditMode]);

  const dismissCycleCoach = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowCycleCoach(false);
    AsyncStorage.setItem(CYCLE_COACHMARK_KEY, "1")
      .catch(e => warnStorage("setItem", CYCLE_COACHMARK_KEY, e));
  }, []);

  // Step 2 coach mark: same one-shot pattern, but triggered on first ARRIVAL at
  // the Workouts step (not at mount) so it lands on the screen it explains.
  useEffect(() => {
    if (step !== 2 || isEditMode || isReviewMode || isSharedEditMode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    AsyncStorage.getItem(WORKOUTS_COACHMARK_KEY)
      .then(seen => {
        if (cancelled || seen) return;
        timer = setTimeout(() => { if (!cancelled) setShowWorkoutsCoach(true); }, 450);
      })
      .catch(e => warnStorage("getItem", WORKOUTS_COACHMARK_KEY, e));
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [step, isEditMode, isReviewMode, isSharedEditMode]);

  const dismissWorkoutsCoach = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowWorkoutsCoach(false);
    AsyncStorage.setItem(WORKOUTS_COACHMARK_KEY, "1")
      .catch(e => warnStorage("setItem", WORKOUTS_COACHMARK_KEY, e));
  }, []);

  // Tracks whether the draft has been loaded — prevents auto-save overwriting it before load completes
  const isDraftLoaded = useRef(false);
  // Set to true before intentional navigation so beforeRemove skips the dialog
  const isLeavingIntentionally = useRef(false);
  // Snapshot of the program state as it was loaded in edit mode
  const originalEdit = useRef<{ name: string; totalWeeks: number; cycleDays: number; isTrainingDay: boolean[]; cyclePattern: string[]; workouts: WorkoutMap } | null>(null);
  // Remembers which day's picker was open before navigating to create-custom-exercise
  const pendingPickerDay = useRef<string | null>(null);

  const hasChanges = useMemo(() => {
    if (!isEditMode && !isReviewMode && !isSharedEditMode) return false;
    const orig = originalEdit.current;
    if (!orig) return false;
    return (
      name !== orig.name ||
      totalWeeks !== orig.totalWeeks ||
      cycleDays !== orig.cycleDays ||
      JSON.stringify(isTrainingDay) !== JSON.stringify(orig.isTrainingDay) ||
      JSON.stringify(cyclePattern) !== JSON.stringify(orig.cyclePattern) ||
      !workoutsEqual(workouts, orig.workouts)
    );
  }, [isEditMode, isReviewMode, isSharedEditMode, name, totalWeeks, cycleDays, isTrainingDay, cyclePattern, workouts]);

  const updateBtnScale = useSharedValue(0);
  const updateBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: updateBtnScale.value }],
  }));
  useEffect(() => {
    updateBtnScale.value = withSpring(hasChanges ? 1 : 0, { damping: 18, stiffness: 280, mass: 0.8 });
  }, [hasChanges, updateBtnScale]);

  const [kbHeight, setKbHeight] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const nextFnRef = useRef<(() => void) | null>(null);
  const prevFnRef = useRef<(() => void) | null>(null);
  const handleInputFocus = useCallback((nextFn: (() => void) | null, prevFn: (() => void) | null = null) => {
    nextFnRef.current = nextFn;
    prevFnRef.current = prevFn;
    setHasNext(nextFn !== null);
    setHasPrev(prevFn !== null);
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => { setKbHeight(0); setHasNext(false); setHasPrev(false); nextFnRef.current = null; prevFnRef.current = null; });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Reload custom exercises and re-open picker when returning from create-custom-exercise
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] !== "string") {
        setCustomExercises(parsed as CustomExercise[]);
      }
    }).catch((e) => warnStorage("getItem", CUSTOM_KEY, e));

    if (pendingPickerDay.current) {
      setPickerState({ day: pendingPickerDay.current });
      pendingPickerDay.current = null;
    }
  }, []));

  // Load custom exercises and draft on mount
  useEffect(() => {
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      if (typeof parsed[0] === "string") {
        // Migrate old string[] format to CustomExercise[]
        const migrated: CustomExercise[] = (parsed as string[]).map(n => ({ name: n, muscles: [] }));
        setCustomExercises(migrated);
        AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(migrated))
          .catch((e) => warnStorage("setItem", CUSTOM_KEY, e));
      } else {
        setCustomExercises(parsed as CustomExercise[]);
      }
    }).catch((e) => warnStorage("getItem", CUSTOM_KEY, e));

    (async () => {
      try {
        if (isSharedEditMode && sharedId) {
          // Shared-edit mode — load the SharedProgram the trainer sent to a client.
          // Saving will write back to that SharedProgram so the client can re-accept
          // the update. Loaded via the store (NOT raw AsyncStorage): shares to real
          // accounts live in the cloud table and only the store merges them in.
          const list = await loadSharedPrograms();
          const target = list.find(s => s.id === sharedId);
          const snap = target?.programSnapshot;
          if (snap) {
            const isTraining = snap.cyclePattern.map(d => d !== "Rest");
            const names = snap.cyclePattern.map(d => d === "Rest" ? "" : d);
            const canonicalDays = trainingDayKeys(names, isTraining);
            const rawWorkouts: WorkoutMap = {};
            canonicalDays.forEach(d => { rawWorkouts[d] = (snap.workouts ?? {})[d] ?? []; });
            const canonicalWorkouts = dedupeExerciseIds(rawWorkouts);
            setName(snap.name);
            setTotalWeeks(snap.totalWeeks);
            setCycleDays(snap.cycleDays);
            setIsTrainingDay(isTraining);
            setCyclePattern(names);
            setWorkouts(canonicalWorkouts);
            originalEdit.current = {
              name: snap.name,
              totalWeeks: snap.totalWeeks,
              cycleDays: snap.cycleDays,
              isTrainingDay: isTraining,
              cyclePattern: names,
              workouts: canonicalWorkouts,
            };
          }
        } else if (isReviewMode && reviewId) {
          // Review mode — load the SentProgram snapshot the gym user sent.
          // We treat its snapshot as the seed for the builder; saving will
          // write the edited program back into that same SentProgram entry.
          // Loaded via the store so cloud review rows are included.
          const list = await loadSentPrograms();
          const target = list.find(s => s.id === reviewId);
          const snap = target?.programSnapshot;
          if (snap) {
            const isTraining = snap.cyclePattern.map(d => d !== "Rest");
            const names = snap.cyclePattern.map(d => d === "Rest" ? "" : d);
            const canonicalDays = trainingDayKeys(names, isTraining);
            const rawWorkouts: WorkoutMap = {};
            canonicalDays.forEach(d => { rawWorkouts[d] = (snap.workouts ?? {})[d] ?? []; });
            const canonicalWorkouts = dedupeExerciseIds(rawWorkouts);
            setName(snap.name);
            setTotalWeeks(snap.totalWeeks);
            setCycleDays(snap.cycleDays);
            setIsTrainingDay(isTraining);
            setCyclePattern(names);
            setWorkouts(canonicalWorkouts);
            originalEdit.current = {
              name: snap.name,
              totalWeeks: snap.totalWeeks,
              cycleDays: snap.cycleDays,
              isTrainingDay: isTraining,
              cyclePattern: names,
              workouts: canonicalWorkouts,
            };
          }
        } else if (editId) {
          // Edit mode — check for an in-progress draft first, then fall back to saved program
          const draftRaw = await AsyncStorage.getItem(DRAFT_KEY);
          let loadedFromDraft = false;
          if (draftRaw) {
            const draft = JSON.parse(draftRaw) as ProgramDraft;
            if (draft.editId === editId) {
              // Always land on Step 1 (setup), even if the draft was saved on Step 2.
              // Opening Create/Edit should never jump straight to the exercise list.
              if (draft.name !== undefined) setName(draft.name);
              if (draft.totalWeeks) setTotalWeeks(draft.totalWeeks);
              if (draft.cycleDays) setCycleDays(draft.cycleDays);
              if (draft.cyclePattern) setCyclePattern(draft.cyclePattern);
              if (draft.isTrainingDay) setIsTrainingDay(draft.isTrainingDay);
              if (draft.workouts) {
                // Canonicalize draft workouts so stale key formats don't cause false "hasChanges"
                const draftDays = trainingDayKeys(draft.cyclePattern ?? [], draft.isTrainingDay ?? []);
                const canonical: WorkoutMap = {};
                draftDays.forEach(d => { canonical[d] = draft.workouts[d] ?? []; });
                setWorkouts(dedupeExerciseIds(canonical));
              }
              loadedFromDraft = true;
            }
          }
          // Always load originalEdit from the saved program (for change-detection)
          const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
          const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
          const program = programs.find(p => p.id === editId);
          if (program) {
            const isTraining = program.cyclePattern.map(d => d !== "Rest");
            const names = program.cyclePattern.map(d => d === "Rest" ? "" : d);
            // Canonicalize workouts to the same key format `handleNext` produces so
            // navigating between steps never triggers a spurious "hasChanges" diff.
            const canonicalDays = trainingDayKeys(names, isTraining);
            const rawWorkouts: WorkoutMap = {};
            canonicalDays.forEach(d => { rawWorkouts[d] = (program.workouts ?? {})[d] ?? []; });
            const canonicalWorkouts = dedupeExerciseIds(rawWorkouts);
            if (!loadedFromDraft) {
              setName(program.name);
              setTotalWeeks(program.totalWeeks);
              setCycleDays(program.cycleDays);
              setIsTrainingDay(isTraining);
              setCyclePattern(names);
              setWorkouts(canonicalWorkouts);
            }
            originalEdit.current = {
              name: program.name,
              totalWeeks: program.totalWeeks,
              cycleDays: program.cycleDays,
              isTrainingDay: isTraining,
              cyclePattern: names,
              workouts: canonicalWorkouts,
            };
          }
        } else {
          // Create mode — load draft (ignore drafts that belong to an edit session)
          const raw = await AsyncStorage.getItem(DRAFT_KEY);
          if (raw) {
            const draft = JSON.parse(raw) as ProgramDraft;
            if (draft.editId) { isDraftLoaded.current = true; return; }
            // Always land on Step 1 (see edit-mode note above) — never auto-jump to Step 2.
            if (draft.name !== undefined) setName(draft.name);
            if (draft.totalWeeks) setTotalWeeks(draft.totalWeeks);
            if (draft.cycleDays) setCycleDays(draft.cycleDays);
            if (draft.cyclePattern) setCyclePattern(draft.cyclePattern);
            if (draft.isTrainingDay) setIsTrainingDay(draft.isTrainingDay);
            if (draft.workouts) setWorkouts(dedupeExerciseIds(draft.workouts));
          }
        }
      } catch { /* corrupt data — use defaults */ }
      isDraftLoaded.current = true;
    })();
  }, []);

  // Auto-save draft on state changes, debounced one keystroke-burst at a time —
  // serializing + writing the whole draft per keystroke added to the set-input
  // fill-down latency. Review-mode edits don't persist a create-flow draft —
  // they live in the SentProgram entry and would otherwise pollute the next
  // plain "New Program" session.
  //
  // `draftDeleted` is set right before the intentional DRAFT_KEY removals
  // (Finish / Discard) so a trailing debounce write can't resurrect the draft;
  // any other unmount (e.g. "Save Draft") flushes the pending write instead.
  const draftDeleted = useRef(false);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<ProgramDraft | null>(null);
  useEffect(() => {
    if (!isDraftLoaded.current) return;
    if (isReviewMode || isSharedEditMode) return;
    const draft: ProgramDraft = { step, name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts, ...(editId ? { editId } : {}) };
    pendingDraft.current = draft;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      draftSaveTimer.current = null;
      pendingDraft.current = null;
      if (draftDeleted.current) return;
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
        .catch((e) => warnStorage("setItem", DRAFT_KEY, e));
    }, 400);
  }, [step, name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts, editId, isReviewMode, isSharedEditMode]);
  useEffect(() => () => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    const pending = pendingDraft.current;
    if (pending && !draftDeleted.current) {
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(pending))
        .catch((e) => warnStorage("setItem", DRAFT_KEY, e));
    }
  }, []);

  // Intercept back navigation — prompt save or discard
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e: any) => {
      if (isLeavingIntentionally.current) return;

      if (isEditMode || isReviewMode || isSharedEditMode) {
        const orig = originalEdit.current;
        if (!orig) return;
        // Use workoutsEqual (sorted-keys form) — matches the `hasChanges` useMemo
        // exactly. Previously this used plain JSON.stringify, so insertion-order
        // differences between draft and original surfaced as phantom prompts.
        const hasChanges =
          name !== orig.name ||
          totalWeeks !== orig.totalWeeks ||
          cycleDays !== orig.cycleDays ||
          JSON.stringify(isTrainingDay) !== JSON.stringify(orig.isTrainingDay) ||
          JSON.stringify(cyclePattern) !== JSON.stringify(orig.cyclePattern) ||
          !workoutsEqual(workouts, orig.workouts);
        if (!hasChanges) return;
      } else {
        const hasDraft =
          name.trim().length > 0 ||
          step === 2 ||
          Object.values(workouts).some(exs => exs.length > 0);
        if (!hasDraft) return;
      }

      e.preventDefault();
      Alert.alert(
        "Unsaved Changes",
        "Would you like to save your progress or discard it?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              isLeavingIntentionally.current = true;
              draftDeleted.current = true;
              AsyncStorage.removeItem(DRAFT_KEY).catch((err) => warnStorage("removeItem", DRAFT_KEY, err));
              navigation.dispatch(e.data.action);
            },
          },
          {
            text: isReviewMode ? "Save" : "Save Draft",
            onPress: async () => {
              if (isReviewMode && reviewId) {
                // Review mode has no auto-save draft — persist edits to the
                // SentProgram snapshot before navigating away.
                const programName = name.trim() || "My Program";
                const savedCyclePattern = cyclePattern.map((n, i) => isTrainingDay[i] ? (n.trim() || "Workout") : "Rest");
                const trainingDays = isTrainingDay.filter(Boolean).length;
                try {
                  const list = await loadSentPrograms();
                  const target = list.find(s => s.id === reviewId);
                  const prev = target?.programSnapshot;
                  const startDate = formatStoredDate(new Date());
                  const updatedSnap: SavedProgram = {
                    id: prev?.id ?? `snap_${Date.now()}`,
                    name: programName,
                    totalWeeks,
                    currentWeek: prev?.currentWeek ?? 0,
                    status: prev?.status ?? "created",
                    startDate: prev?.startDate ?? startDate,
                    trainingDays,
                    cycleDays,
                    cyclePattern: savedCyclePattern,
                    workouts,
                    extraWorkouts: prev?.extraWorkouts,
                    cycleOffset: prev?.cycleOffset,
                    completedDate: prev?.completedDate,
                  };
                  await updateSentProgram(reviewId, { programSnapshot: updatedSnap, programName, lastEditedAtISO: new Date().toISOString() });
                } catch (err) { warnStorage("setItem", "sent_programs", err); }
              }
              isLeavingIntentionally.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, name, step, workouts, isEditMode, isReviewMode, isSharedEditMode, totalWeeks, cycleDays, isTrainingDay, cyclePattern]);

  const handleCycleDaysChange = useCallback((next: number) => {
    const clamped = clamp(next, 2, 14);
    setCycleDays(clamped);
    setCyclePattern(prev =>
      clamped > prev.length ? [...prev, ...Array(clamped - prev.length).fill("")] : prev.slice(0, clamped)
    );
    setIsTrainingDay(prev =>
      clamped > prev.length ? [...prev, ...Array(clamped - prev.length).fill(false)] : prev.slice(0, clamped)
    );
  }, []);

  const toggleDay = useCallback((index: number) => {
    setIsTrainingDay(prev => { const next = [...prev]; next[index] = !next[index]; return next; });
  }, []);

  const setDayName = useCallback((index: number, text: string) => {
    setCyclePattern(prev => { const next = [...prev]; next[index] = text; return next; });
  }, []);

  const handleNext = useCallback(() => {
    const days = trainingDayKeys(cyclePattern, isTrainingDay);
    setWorkouts(prev => {
      const prevKeys = Object.keys(prev);
      if (prevKeys.length === days.length && days.every(d => d in prev)) return prev;
      const next: WorkoutMap = {};
      days.forEach((d: string) => { next[d] = prev[d] ?? []; });
      return next;
    });
    setStep(2);
  }, [cyclePattern, isTrainingDay]);

  const addExercise = useCallback((day: string, exName: string, setCount = 1) => {
    setWorkouts(prev => {
      // New exercises inherit the prevailing rest timer: the most common
      // restSeconds (> 0) across the whole draft. Once the user sets a rest
      // anywhere (or applies one to all), later additions follow it — no
      // repeated wheel trips. Ties keep the first-seen value (stable).
      const restCounts = new Map<number, number>();
      for (const d of Object.keys(prev)) {
        for (const e of prev[d] ?? []) {
          const r = e.restSeconds ?? 0;
          if (r > 0) restCounts.set(r, (restCounts.get(r) ?? 0) + 1);
        }
      }
      let inheritedRest: number | undefined;
      let bestCount = 0;
      restCounts.forEach((n, r) => { if (n > bestCount) { bestCount = n; inheritedRest = r; } });

      const sets: ProgramSet[] = Array.from(
        { length: Math.max(1, Math.round(setCount)) },
        () => ({ type: "working" as const })
      );
      return {
        ...prev,
        [day]: [...(prev[day] ?? []), {
          id: makeExerciseId(),
          name: exName,
          sets,
          ...(inheritedRest !== undefined ? { restSeconds: inheritedRest } : {}),
        }],
      };
    });
  }, []);

  const updateExercise = useCallback((day: string, id: string, field: keyof Exercise, value: string | number | boolean) => {
    setWorkouts(prev => ({
      ...prev,
      [day]: prev[day].map(e => e.id === id ? { ...e, [field]: value } : e),
    }));
  }, []);

  const updateExerciseSets = useCallback((day: string, id: string, sets: ProgramSet[]) => {
    setWorkouts(prev => ({
      ...prev,
      [day]: prev[day].map(e => e.id === id ? { ...e, sets } : e),
    }));
  }, []);

  // "Apply to All" in the rest picker: one rest value for every exercise on
  // every day. Individual exercises can still be changed afterwards.
  const applyRestToAll = useCallback((secs: number) => {
    setWorkouts(prev => {
      const next: WorkoutMap = {};
      for (const day of Object.keys(prev)) {
        next[day] = prev[day].map(e => ({ ...e, restSeconds: secs }));
      }
      return next;
    });
  }, []);

  const removeExercise = useCallback((day: string, id: string) => {
    setWorkouts(prev => ({ ...prev, [day]: prev[day].filter(e => e.id !== id) }));
    setCollapsingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const startCollapse = useCallback((day: string, id: string) => {
    setCollapsingIds(prev => new Set(prev).add(id));
  }, []);

  // Stable identities for the Step 2 handlers that end up as DayCard /
  // ExerciseRow props — inline arrows here would defeat their memo() and make
  // every keystroke in a set input re-render every day card (that lag was
  // user-visible on device).
  const openPickerForDay = useCallback((day: string) => setPickerState({ day }), []);
  const editExerciseInPicker = useCallback((day: string, id: string) => setPickerState({ day, replaceId: id }), []);
  const handleDragStateChange = useCallback((dragging: boolean) => setScrollEnabled(!dragging), []);

  const reorderExercises = useCallback((day: string, exercises: Exercise[]) => {
    setWorkouts(prev => ({ ...prev, [day]: exercises }));
  }, []);

  // Reorder the cycle (Workout Summary sheet): move the day at `from` to `to`,
  // carrying its Training/Rest flag AND its exercises. Workout keys embed the
  // day index (`${i}:${label}`), so the map is rebuilt against new positions —
  // same canonical form handleNext produces, so no phantom "hasChanges" diffs.
  const reorderCycleDays = useCallback((from: number, to: number) => {
    if (from === to) return;
    const order = cyclePattern.map((_, i) => i);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    setCyclePattern(order.map(i => cyclePattern[i]));
    setIsTrainingDay(order.map(i => isTrainingDay[i]));
    setWorkouts(prev => {
      const next: WorkoutMap = {};
      order.forEach((oldIdx, newIdx) => {
        if (!isTrainingDay[oldIdx]) return;
        const label = cyclePattern[oldIdx].trim() || "Workout";
        next[`${newIdx}:${label}`] = prev[`${oldIdx}:${label}`] ?? [];
      });
      return next;
    });
  }, [cyclePattern, isTrainingDay]);

  const deleteCustomExercise = useCallback((exName: string) => {
    const next = customExercises.filter(e => e.name !== exName);
    setCustomExercises(next);
    AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
      .then(() => scheduleCloudPush())
      .catch((e) => warnStorage("setItem", CUSTOM_KEY, e));
    // Also remove this exercise from every day in the current program
    setWorkouts(prev => {
      const updated: WorkoutMap = {};
      for (const day of Object.keys(prev)) {
        updated[day] = prev[day].filter(e => e.name !== exName);
      }
      return updated;
    });
  }, [customExercises]);

  const handleFinish = useCallback(() => {
    const programName = name.trim() || "My Program";
    const savedCyclePattern = cyclePattern.map((n, i) => isTrainingDay[i] ? (n.trim() || "Workout") : "Rest");
    const trainingDays = isTrainingDay.filter(Boolean).length;
    const startDate = formatStoredDate(new Date());

    if (isSharedEditMode && sharedId) {
      // Shared-edit mode — write the edited program back into the SharedProgram
      // snapshot and clear acceptedAtISO so the recipient gets a tick to re-accept the update.
      const doSharedSave = async () => {
        try {
          // Store load (not raw AsyncStorage) — cloud shares only exist there.
          const list = await loadSharedPrograms();
          const target = list.find(s => s.id === sharedId);
          const prev = target?.programSnapshot;
          const updatedSnap: SavedProgram = {
            id: prev?.id ?? `snap_${Date.now()}`,
            name: programName,
            totalWeeks,
            currentWeek: prev?.currentWeek ?? 0,
            status: prev?.status ?? "created",
            startDate: prev?.startDate ?? startDate,
            trainingDays,
            cycleDays,
            cyclePattern: savedCyclePattern,
            workouts,
            extraWorkouts: prev?.extraWorkouts,
            cycleOffset: prev?.cycleOffset,
            completedDate: prev?.completedDate,
          };
          if (!target) throw new Error("Shared program not found");
          await updateSharedProgramBatch(batchKeyOf(target), {
            programSnapshot: updatedSnap,
            programName,
            lastEditedAtISO: new Date().toISOString(),
            acceptedAtISO: undefined,
          });
        } catch (e) {
          Alert.alert("Save failed", e instanceof Error ? e.message : String(e));
          return;
        }
        isLeavingIntentionally.current = true;
        router.back();
      };
      doSharedSave();
      return;
    }

    if (isReviewMode && reviewId) {
      // Review mode — write the edited program back into the SentProgram's
      // snapshot so the trainer's edits are what gets returned on Send Back.
      const doReview = async () => {
        try {
          // Store load (not raw AsyncStorage) — cloud review rows only exist there.
          const list = await loadSentPrograms();
          const target = list.find(s => s.id === reviewId);
          const prev = target?.programSnapshot;
          const updatedSnap: SavedProgram = {
            id: prev?.id ?? `snap_${Date.now()}`,
            name: programName,
            totalWeeks,
            currentWeek: prev?.currentWeek ?? 0,
            status: prev?.status ?? "created",
            startDate: prev?.startDate ?? startDate,
            trainingDays,
            cycleDays,
            cyclePattern: savedCyclePattern,
            workouts,
            extraWorkouts: prev?.extraWorkouts,
            cycleOffset: prev?.cycleOffset,
            completedDate: prev?.completedDate,
          };
          await updateSentProgram(reviewId, { programSnapshot: updatedSnap, programName, lastEditedAtISO: new Date().toISOString() });
        } catch (e) {
          Alert.alert("Save failed", e instanceof Error ? e.message : String(e));
          return;
        }
        isLeavingIntentionally.current = true;
        router.back();
      };
      doReview();
      return;
    }

    if (isEditMode) {
      // Edit mode — update the existing program in place
      const doUpdate = async () => {
        try {
          const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
          const existing: SavedProgram[] = raw ? JSON.parse(raw) : [];
          const updated = existing.map(p => p.id === editId ? {
            ...p,
            name: programName,
            totalWeeks,
            trainingDays,
            cycleDays,
            cyclePattern: savedCyclePattern,
            workouts,
          } : p);
          await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
          draftDeleted.current = true;
          await AsyncStorage.removeItem(DRAFT_KEY);
          scheduleCloudPush();
        } catch (e) {
          Alert.alert("Save failed", e instanceof Error ? e.message : String(e));
          return;
        }
        isLeavingIntentionally.current = true;
        router.back();
      };
      doUpdate();
      return;
    }

    // Create mode — add new program
    const newProgram: SavedProgram = {
      id: Date.now().toString(),
      name: programName,
      totalWeeks,
      currentWeek: 0,
      status: "created",
      startDate,
      trainingDays,
      cycleDays,
      cyclePattern: savedCyclePattern,
      workouts,
    };

    const save = async (makeActive: boolean) => {
      try {
        const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
        const existing: SavedProgram[] = raw ? JSON.parse(raw) : [];
        let updated = [...existing, newProgram];
        if (makeActive) {
          // Demote the old active the same way programs.tsx handleMakeActive
          // does: week-aware (completed / paused / created), snapshotting its
          // currentWeek — the two activation paths must not diverge.
          updated = updated.map(p => {
            if (p.id === newProgram.id) return { ...p, status: "active" as const, currentWeek: 1 };
            if (p.status === "active") {
              const week = getCurrentWeek(p);
              if (week >= p.totalWeeks) {
                return { ...p, status: "completed" as const, currentWeek: p.totalWeeks, completedDate: startDate };
              }
              return { ...p, status: week > 1 ? "paused" as const : "created" as const, currentWeek: week };
            }
            return p;
          });
        }
        await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
        // A same-day change-day override belongs to the demoted program — clear
        // it so the workout tab shows the new program's scheduled day.
        if (makeActive) {
          AsyncStorage.removeItem(WORKOUT_DAY_OVERRIDE_KEY)
            .catch((err) => warnStorage("removeItem", WORKOUT_DAY_OVERRIDE_KEY, err));
        }
        scheduleCloudPush();
      } catch (e) {
        Alert.alert("Save failed", e instanceof Error ? e.message : String(e));
        return;
      }
      isLeavingIntentionally.current = true;
      draftDeleted.current = true;
      AsyncStorage.removeItem(DRAFT_KEY).catch((err) => warnStorage("removeItem", DRAFT_KEY, err));
      router.back();
    };

    Alert.alert(
      "Program Created!",
      `"${programName}" has been saved. Would you like to set it as your active program?`,
      [
        { text: "Set as Active", onPress: () => save(true) },
        { text: "Not Now", onPress: () => save(false) },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }, [name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts, router, isEditMode, editId, isReviewMode, reviewId, isSharedEditMode, sharedId]);

  const handleBack = () => { if (step === 2) setStep(1); else router.back(); };

  const canProceed =
    name.trim().length > 0 &&
    isTrainingDay.some(Boolean) &&
    isTrainingDay.every((isTraining, i) => !isTraining || cyclePattern[i].trim().length > 0);

  // ── Sticky day header (Step 2) ──────────────────────────────────────────────
  // A scroll-linked filmstrip of the day names, pinned at the top next to the back
  // button. Every name is stacked in one strip and a single scrollY-driven
  // translateY rolls the active one into place — so it animates identically in BOTH
  // scroll directions (no discrete state flip that only played one way). Each title
  // also fades as it rolls off centre, so titles dissolve instead of hard-clipping
  // at the bar edges. scrollY is native RN Animated (not Reanimated — avoids the
  // Reanimated.ScrollView reflow bug).
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const dayOffsets = useRef<Record<string, number>>({});
  const [, bumpOffsets] = useState(0);
  const daysOrder = useMemo(() => Object.keys(workouts), [workouts]);
  const PIN_TOP = insets.top + 16;   // screen-Y where a day docks (aligns with back button)
  const PIN_H = 40;                  // one title row's height / roll distance
  const onMeasureDay = useCallback((day: string, y: number) => {
    if (dayOffsets.current[day] !== y) { dayOffsets.current[day] = y; bumpOffsets(v => v + 1); }
  }, []);

  // Jump the long Step 2 page to a day (Workout Summary's "Go to Day"). Lands
  // exactly on the day's dock boundary, so the pinned title strip shows it —
  // the same scroll position you'd reach scrolling there by hand. The small
  // delay lets the sheet's modal finish unmounting before the scroll animates.
  const jumpToDay = useCallback((cycleIdx: number) => {
    const key = `${cycleIdx}:${(cyclePattern[cycleIdx] ?? "").trim() || "Workout"}`;
    const off = dayOffsets.current[key];
    if (off == null) return;
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, off - PIN_TOP + 2), animated: true }), 80);
  }, [cyclePattern, PIN_TOP]);

  // Strip translateY(scrollY): day 0 rolls in from one row below over the last PIN_H
  // before it docks (so it enters/exits like every other transition, not a pop);
  // thereafter it holds day i centred through day i's section and shifts by one row
  // over the last PIN_H before day i+1 docks. Piecewise + fully scroll-linked, so
  // it's symmetric both ways.
  const dayBoundaries = daysOrder.map(d => {
    const off = dayOffsets.current[d];
    return off != null ? off - PIN_TOP : null;   // scrollY at which this day docks
  });
  let stripReady = dayBoundaries.length >= 1 && dayBoundaries.every(b => b != null);
  const stripInput: number[] = [];
  const stripOutput: number[] = [];
  if (stripReady) {
    for (let i = 0; i < dayBoundaries.length; i++) {
      const Bi = dayBoundaries[i] as number;
      // Roll from the previous row (day 0's "previous" is one row below = +PIN_H,
      // i.e. off-screen under the bar) up to this day centred, over [Bi-PIN_H, Bi].
      const fromTY = i === 0 ? PIN_H : -(i - 1) * PIN_H;
      stripInput.push(Bi - PIN_H); stripOutput.push(fromTY);
      stripInput.push(Bi);         stripOutput.push(-i * PIN_H);
    }
    // interpolate() needs a strictly-increasing input range; a mid-measure can
    // briefly produce non-monotonic offsets, so bail to static until stable.
    for (let k = 1; k < stripInput.length; k++) {
      if (stripInput[k] <= stripInput[k - 1]) { stripReady = false; break; }
    }
  }
  const stripTYNode = stripReady
    ? scrollY.interpolate({ inputRange: stripInput, outputRange: stripOutput, extrapolate: "clamp" })
    : null;
  const stripTY = stripTYNode ?? 0;
  // Each title is fully opaque only while centred (stripTY ≈ -i*PIN_H), fading to 0
  // one row away in either direction — so it's transparent by the time it reaches a
  // bar edge (no hard clip line) and hidden entirely before day 0 has rolled in.
  const titleOpacity = (i: number) =>
    stripTYNode
      ? stripTYNode.interpolate({ inputRange: [-(i + 1) * PIN_H, -i * PIN_H, -(i - 1) * PIN_H], outputRange: [0, 1, 0], extrapolate: "clamp" })
      : 0;
  const updateBtnGap = isEditMode || isReviewMode || isSharedEditMode;   // leave room for the Update button

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* Pastel glow matching the green New Program orb on Home */}
      <AuroraBackdrop dark={isDark} tint="green" />

      {/* Back button */}
      <TouchableOpacity
        onPress={handleBack}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel={step === 2 ? "Back to setup" : "Go back"}
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>


      {(isEditMode || isReviewMode || isSharedEditMode) && (
        <Reanimated.View style={[{ position: "absolute", top: insets.top + 16, right: 20, zIndex: 10 }, updateBtnStyle]} pointerEvents={hasChanges ? "box-none" : "none"}>
          <BounceButton onPress={handleFinish} accessibilityLabel="Save changes" accessibilityRole="button">
            <View style={[styles.updateBtn, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}>
              <Text style={[styles.updateBtnText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Update</Text>
            </View>
          </BounceButton>
        </Reanimated.View>
      )}

      {/* Sticky day header — pins the current day's name next to the back button.
          Two title layers (current + next) clipped to a PIN_H-tall bar; the next
          pushes the current up and out, driven natively by scrollY. */}
      {step === 2 && daysOrder.length > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", top: PIN_TOP, left: 92, right: updateBtnGap ? 116 : 20, height: PIN_H, zIndex: 9, overflow: "hidden" }}
        >
          {/* One filmstrip of all day names; translateY rolls the active one to
              centre. Each row fades off-centre so the roll dissolves (no clip lines). */}
          <Animated.View style={{ transform: [{ translateY: stripTY }] }}>
            {daysOrder.map((d, i) => (
              <Animated.View
                key={d}
                style={{ height: PIN_H, justifyContent: "center", alignItems: "flex-start", opacity: titleOpacity(i) }}
              >
                <View style={[styles.pinnedDayChip, { backgroundColor: isDark ? APP_DARK.div : "#ffffff" }]}>
                  <Text numberOfLines={1} style={[styles.dayHeading, { color: t.tp }]}>{dayLabel(d).toUpperCase()}</Text>
                </View>
              </Animated.View>
            ))}
          </Animated.View>
        </Animated.View>
      )}

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFillObject} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      {/* RN Animated.ScrollView (core RN Animated, NOT Reanimated.ScrollView) so the
          sticky day header can read scrollY on the native thread. This is distinct
          from Reanimated.ScrollView, which caused the set-overflow reflow bug — the
          native scroll view still reflows its content normally. */}
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator
        indicatorStyle={isDark ? "white" : "black"}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        scrollEnabled={scrollEnabled}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + (step === 2 ? 120 : 40) }}
      >
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>{isEditMode ? "EDIT PROGRAM" : "NEW PROGRAM"}</Text>
          <View style={{ width: 66 }} />
        </View>

        <StepIndicator
          step={step}
          isDark={isDark}
          canStep2={canProceed}
          onStepPress={(s) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (s === 2) handleNext(); else setStep(1); }}
        />

        {step === 1 ? (
          <Step1
            name={name} setName={setName}
            totalWeeks={totalWeeks} setTotalWeeks={setTotalWeeks}
            cycleDays={cycleDays} onCycleDaysChange={handleCycleDaysChange}
            cyclePattern={cyclePattern} isTrainingDay={isTrainingDay}
            onToggleDay={toggleDay} onSetDayName={setDayName}
            isDark={isDark} onNext={handleNext}
          />
        ) : (
          <Step2
            workouts={workouts}
            onOpenPicker={openPickerForDay}
            onEditExercise={editExerciseInPicker}
            onUpdateExercise={updateExercise}
            onUpdateExerciseSets={updateExerciseSets}
            onApplyRestToAll={applyRestToAll}
            onRemoveExercise={removeExercise}
            onReorderExercises={reorderExercises}
            onDragStateChange={handleDragStateChange}
            isDark={isDark}
            onFinish={handleFinish}
            isEditMode={isEditMode}
            isReviewMode={isReviewMode}
            isSharedEditMode={isSharedEditMode}
            collapsingIds={collapsingIds}
            onStartCollapse={startCollapse}
            onInputFocus={handleInputFocus}
            customImageByName={customImageByName}
            onMeasureDay={onMeasureDay}
          />
        )}
      </Animated.ScrollView>

      {/* Floating keyboard toolbar (back / forward / dismiss) */}
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

      {/* Floating Workout Summary button — Step 2 only, where the full page gets
          long. Hidden while the keyboard is up so it never overlaps the toolbar. */}
      {step === 2 && kbHeight === 0 && (
        <View style={{ position: "absolute", right: 20, bottom: insets.bottom + 24, zIndex: 8 }}>
          <BounceButton
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSummaryOpen(true); }}
            accessibilityLabel="Workout summary"
            accessibilityRole="button"
          >
            <View style={styles.summaryFabWrap}>
              <View style={styles.summaryFab}>
                <Ionicons name="list" size={16} color="#fff" />
                <Text style={styles.summaryFabText}>Summary</Text>
              </View>
            </View>
          </BounceButton>
        </View>
      )}

      <ProgramSummarySheet
        visible={summaryOpen}
        isDark={isDark}
        t={t}
        cyclePattern={cyclePattern}
        isTrainingDay={isTrainingDay}
        workouts={workouts}
        customExercises={customExercises}
        onReorderDays={reorderCycleDays}
        onReorderExercises={reorderExercises}
        onRemoveExercise={removeExercise}
        onEditExercise={(day, id) => { setSummaryOpen(false); setPickerState({ day, replaceId: id }); }}
        onAddExercise={(day) => { setSummaryOpen(false); setPickerState({ day }); }}
        onJumpToDay={(i) => { setSummaryOpen(false); jumpToDay(i); }}
        onClose={() => setSummaryOpen(false)}
      />

      {/* Exercise picker — rendered above ScrollView so it's never clipped */}
      {pickerState !== null && (
        <ExercisePicker
          visible
          subtitle={dayLabel(pickerState.day).toUpperCase()}
          customExercises={customExercises}
          withSetCount={!pickerState.replaceId}
          onSelectMultiple={(exNames, setCount) => {
            if (pickerState.replaceId) {
              updateExercise(pickerState.day, pickerState.replaceId, "name", exNames[0]);
            } else {
              exNames.forEach((name) => addExercise(pickerState.day, name, setCount));
            }
            setPickerState(null);
          }}
          onCreateCustom={() => {
            pendingPickerDay.current = pickerState?.day ?? null;
            setPickerState(null);
            router.navigate("/create-custom-exercise");
          }}
          onEditCustom={name => {
            pendingPickerDay.current = pickerState?.day ?? null;
            setPickerState(null);
            router.navigate({ pathname: "/create-custom-exercise", params: { edit: name } });
          }}
          onDeleteCustom={deleteCustomExercise}
          onClose={() => setPickerState(null)}
          isDark={isDark}
        />
      )}

      {/* First-run coach mark — teaches that each day's pill is tappable to
          switch between Training and Rest. Shown once (CYCLE_COACHMARK_KEY),
          only on Step 1 where the cycle pattern is visible. */}
      {showCycleCoach && step === 1 && (
        <Modal visible transparent animationType="fade" onRequestClose={dismissCycleCoach}>
          <View style={styles.coachBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismissCycleCoach} />
            <NeuCard dark={isDark} radius={24} style={styles.coachCard} innerStyle={styles.coachCardInner}>
              <Text style={[styles.coachTitle, { color: t.tp }]}>Set up your week</Text>
              <Text style={[styles.coachBody, { color: t.ts }]}>
                Tap any day to switch it between Training and Rest. Name your training days and we build the schedule for you.
              </Text>

              {/* Live demo of the two pill states */}
              <View style={styles.coachDemoRow}>
                <View style={[styles.togglePill, { backgroundColor: ACCT }]}>
                  <DumbbellIcon size={13} color="#fff" />
                  <Text style={[styles.togglePillText, { color: "#fff" }]}>Training</Text>
                </View>
                <Ionicons name="swap-horizontal" size={20} color={t.ts} />
                <View style={[styles.togglePill, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : t.div }]}>
                  <Ionicons name="moon-outline" size={13} color={t.ts} />
                  <Text style={[styles.togglePillText, { color: t.ts }]}>Rest</Text>
                </View>
              </View>

              <BounceButton onPress={dismissCycleCoach} accessibilityLabel="Got it" accessibilityRole="button">
                <View style={styles.coachBtnWrap}>
                  <View style={styles.coachBtn}>
                    <Text style={styles.coachBtnText}>Got it</Text>
                  </View>
                </View>
              </BounceButton>
            </NeuCard>
          </View>
        </Modal>
      )}

      {/* First-run coach mark for Step 2, two pages: (1) the set-number badge
          toggles working/warmup, (2) the green Add Exercise button opens a
          multi-select picker. Shown once (WORKOUTS_COACHMARK_KEY), only when
          the Workouts step is visible. Backdrop tap dismisses either page. */}
      {showWorkoutsCoach && step === 2 && (
        <Modal visible transparent animationType="fade" onRequestClose={dismissWorkoutsCoach}>
          <View style={styles.coachBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismissWorkoutsCoach} />
            <NeuCard dark={isDark} radius={24} style={styles.coachCard} innerStyle={styles.coachCardInner}>
              {workoutsCoachPage === 1 ? (
                <>
                  <Text style={[styles.coachTitle, { color: t.tp }]}>Build your workouts</Text>
                  <Text style={[styles.coachBody, { color: t.ts }]}>
                    Fill in the weight and reps for every set. Tap a set&apos;s number to switch it between a working set and a warmup.
                  </Text>

                  {/* Live demo of the two set-badge states */}
                  <View style={styles.coachDemoRow}>
                    <View style={[styles.exSetBadge, { borderColor: isDark ? "rgba(255,255,255,0.25)" : t.div }]}>
                      <Text style={[styles.exSetBadgeText, { color: t.tp }]}>1</Text>
                    </View>
                    <Ionicons name="swap-horizontal" size={20} color={t.ts} />
                    <View style={[styles.exSetBadge, { borderColor: WARMUP_ORANGE }]}>
                      <Text style={[styles.exSetBadgeText, { color: WARMUP_ORANGE }]}>W</Text>
                    </View>
                    <Text style={[styles.coachDemoNote, { color: t.ts }]}>warmup</Text>
                  </View>

                  <BounceButton
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWorkoutsCoachPage(2); }}
                    accessibilityLabel="Next tip"
                    accessibilityRole="button"
                  >
                    <View style={styles.coachBtnWrap}>
                      <View style={styles.coachBtn}>
                        <Text style={styles.coachBtnText}>Next</Text>
                      </View>
                    </View>
                  </BounceButton>
                </>
              ) : (
                <>
                  <Text style={[styles.coachTitle, { color: t.tp }]}>Add your exercises</Text>
                  <Text style={[styles.coachBody, { color: t.ts }]}>
                    Every training day has this button. Tap it to browse exercises, and select as many as you like. They are all added in one go.
                  </Text>

                  {/* Replica of the per-day Add Exercise button */}
                  <View style={styles.coachDemoRow}>
                    <View style={styles.addExBtnWrap}>
                      <View style={styles.addExBtn}>
                        <Ionicons name="add" size={18} color="#fff" />
                        <Text style={styles.addExText}>Add Exercise</Text>
                      </View>
                    </View>
                  </View>

                  <BounceButton onPress={dismissWorkoutsCoach} accessibilityLabel="Got it" accessibilityRole="button">
                    <View style={styles.coachBtnWrap}>
                      <View style={styles.coachBtn}>
                        <Text style={styles.coachBtnText}>Got it</Text>
                      </View>
                    </View>
                  </BounceButton>
                </>
              )}
            </NeuCard>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:             { flex: 1 },
  kbFloatBtn:       { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
  topGradient:      { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn:          { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  header:           { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 20 },
  screenTitle:      { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textAlign: "center", flex: 1 },

  // Step indicator
  stepIndicatorWrap: { marginBottom: 28, position: "relative" },
  stepLine:          { position: "absolute", left: "32%", right: "32%", top: 13, height: 2 },
  stepIndicatorRow:  { flexDirection: "row" },
  stepItem:          { flex: 1, alignItems: "center", gap: 6, zIndex: 1 },
  stepDot:           { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  stepDotText:       { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
  stepDotLabel:      { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.5 },

  // Fields
  fieldLabel:       { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginTop: 4 },
  inputCard:        { marginBottom: 20, borderRadius: 16 },
  textInput:        { fontFamily: FontFamily.regular, fontSize: 16, paddingHorizontal: 18, paddingVertical: 16 },

  // Steppers
  stepperRow:       { flexDirection: "row", gap: 12, marginBottom: 20 },
  stepperCard:      { borderRadius: 16 },
  stepperInner:     { padding: 16, alignItems: "center", gap: 12 },
  stepperControls:  { flexDirection: "row", alignItems: "center", gap: 20 },
  stepBtn:          { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  stepValue:        { fontFamily: FontFamily.bold, fontSize: 24, minWidth: 36, textAlign: "center" },

  // Cycle pattern
  cycleCard:        { marginBottom: 28, borderRadius: 16 },
  cycleCardInner:   { paddingVertical: 4 },
  dayRow:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 54, gap: 12 },
  dayLabel:         { fontFamily: FontFamily.semibold, fontSize: 13, width: 44 },
  nameArea:         { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  nameUnderline:    { position: "absolute", bottom: -6, left: 0, right: 20, height: 1 },
  dayNameInput:     { flex: 1, fontFamily: FontFamily.regular, fontSize: 14 },
  restLabel:        { flex: 1, fontFamily: FontFamily.regular, fontSize: 14 },
  togglePill:       { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  togglePillText:   { fontFamily: FontFamily.semibold, fontSize: 12 },

  // First-run coach mark
  coachBackdrop:    { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, backgroundColor: "rgba(0,0,0,0.45)" },
  coachCard:        { width: "100%", maxWidth: 360 },
  coachCardInner:   { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20 },
  coachTitle:       { fontFamily: FontFamily.bold, fontSize: 19, textAlign: "center" },
  coachBody:        { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
  coachDemoRow:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 18, marginBottom: 22 },
  coachDemoNote:    { fontFamily: FontFamily.regular, fontSize: 12 },
  coachBtnWrap:     { borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  coachBtn:         { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 15, alignItems: "center" },
  coachBtnText:     { fontFamily: FontFamily.semibold, fontSize: 16, color: "#FFFFFF" },

  // Primary button
  primaryBtnWrap:   { borderRadius: 16, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  primaryBtn:       { borderRadius: 16, backgroundColor: ACCT, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  primaryBtnText:   { fontFamily: FontFamily.bold, fontSize: 16, color: "#FFFFFF", letterSpacing: 0.3 },
  updateBtn:        { height: 40, borderRadius: 20, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
  updateBtnText:    { fontFamily: FontFamily.bold, fontSize: 13, letterSpacing: 0.3 },

  // Step 2 — workout days
  dayHeadingCard:       { borderRadius: 16, marginBottom: 8 },
  dayHeadingCardInner:  { paddingVertical: 12, paddingHorizontal: 16 },
  dayHeadingRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayHeadingLeft:       { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  dayAccentBar:         { width: 3, height: 18, borderRadius: 2 },
  dayHeading:           { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 1.2 },
  // Matches the workout page's "Start" pill (workoutTimerPill) and the back
  // button height: a 40px-tall pill. Fills the PIN_H (40) roll window exactly.
  pinnedDayChip:        { height: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  dayExBadge:           { width: 28, height: 28 },
  dayExBadgeInner:      { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  dayExBadgeText:       { fontFamily: FontFamily.bold, fontSize: 13 },
  daySummaryCard:       { borderRadius: 16, marginBottom: 14 },
  daySummaryCardInner:  { paddingVertical: 4, paddingHorizontal: 0 },
  daySummaryEmpty:      { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", paddingVertical: 14, paddingHorizontal: 16 },
  daySummaryRow:        { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12 },
  dragHandleArea:       { paddingHorizontal: 4, paddingVertical: 4, justifyContent: "center", alignItems: "center" },
  daySummaryNumChip:    { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  daySummaryActions:    { flexDirection: "row", alignItems: "center", gap: 14 },
  daySummaryNum:        { fontFamily: FontFamily.bold, fontSize: 13 },
  daySummaryNameBtn:    { flex: 1, flexDirection: "row", alignItems: "center" },
  daySummaryName:       { fontFamily: FontFamily.regular, fontSize: 15, flex: 1 },
  workoutDayCard:   { borderRadius: 16 },
  exerciseCard:     { borderRadius: 16, marginBottom: 14 },
  emptyCard:        { borderRadius: 16, marginBottom: 14 },
  emptyHint:        { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 16 },
  addExBtnWrap:     { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12, marginTop: 6, marginBottom: 8 },
  addExBtn:         { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 10, paddingHorizontal: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  addExText:        { fontFamily: FontFamily.semibold, fontSize: 14, color: "#FFFFFF" },

  // Exercise row
  exRowWrap:        { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0 },
  exTopRow:           { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  exReorderBtn:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  exNameBtn:        { flex: 1, flexDirection: "column", justifyContent: "center", gap: 3 },
  exNumLabel:       { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.8 },
  exName:           { fontFamily: FontFamily.bold, fontSize: 16, flexShrink: 1 },
  exCompactRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 9, borderTopWidth: 1 },
  exRestChipGroup:  { flexDirection: "row", alignItems: "center", gap: 8 },
  exRestLabel:      { fontFamily: FontFamily.semibold, fontSize: 13 },
  exRestChip:       { flexDirection: "row", alignItems: "center", gap: 5 },
  exRestChipText:   { fontFamily: FontFamily.semibold, fontSize: 13 },
  exTogglePills:    { flexDirection: "row", borderRadius: 20, padding: 3 },
  exTogglePillPill: { position: "absolute", top: 3, left: 3, bottom: 3, borderRadius: 17, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowRadius: 4, elevation: 3 },
  exTogglePill:     { paddingHorizontal: 14, paddingVertical: 6, alignItems: "center" },
  exTogglePillText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  exSetHeaderRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, paddingRight: 16 },
  exSetHeaderLabel: { fontFamily: FontFamily.semibold, fontSize: 13 },
  exSetTargetLabel: { fontFamily: FontFamily.semibold, fontSize: 13 },
  exSetHeaderToggle:{ flexDirection: "row", alignItems: "center", justifyContent: "center" },
  exSetHeaderToggleSpacer: { width: 14 },
  exSetRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 48, borderTopWidth: 1, paddingRight: 16 },
  exSetBadgeCol:    { width: 54, alignItems: "flex-start", paddingLeft: 10 },
  exSetValueCol:    { width: 100, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  exSetColRep:      { width: 128 },
  exSetUnitSpacer:  { width: 22 },
  exSetBadge:       { width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  exSetBadgeText:   { fontFamily: FontFamily.semibold, fontSize: 15 },
  exSetInputBox:    { height: 32, width: 56, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  exSetInputText:   { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: "center", width: "100%" },
  exSetUnit:        { fontFamily: FontFamily.semibold, fontSize: 13, marginLeft: 4 },
  exAddRemoveRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 9, borderTopWidth: 1 },
  exAddRemoveBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10 },
  exAddRemoveText:  { fontFamily: FontFamily.semibold, fontSize: 13 },
  exNotesRow:       { borderTopWidth: 1, paddingVertical: 10, paddingLeft: 9 },
  exNotesInput:     { fontFamily: FontFamily.semibold, fontSize: 13, minHeight: 36, lineHeight: 20, paddingLeft: 0 },

  // Rest picker modal
  restBackdrop:     { flex: 1, justifyContent: "flex-end" },
  restOverlay:      { backgroundColor: "rgba(0,0,0,0.45)" },
  restSheet:        { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 },
  restHandleArea:   { paddingVertical: 12, alignItems: "center" },
  restHandle:       { width: 40, height: 4, borderRadius: 2 },
  restHeader:       { alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  restDoneRow:      { alignItems: "center", paddingTop: 16, paddingBottom: 4 },
  restBtnPairRow:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 16, paddingBottom: 4 },
  restApplyAllBtn:  { borderRadius: 50, paddingVertical: 13, paddingHorizontal: 24 },
  restApplyAll:     { fontFamily: FontFamily.semibold, fontSize: 16 },
  restTitle:        { fontFamily: FontFamily.bold, fontSize: 16 },
  restSubtitle:     { fontFamily: FontFamily.regular, fontSize: 14, marginTop: 2 },
  restDoneWrap:     { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  restDoneBtn:      { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 13, paddingHorizontal: 40 },
  restDone:         { fontFamily: FontFamily.semibold, fontSize: 16, color: "#FFFFFF" },
  restPickerWrap:   { height: REST_ITEM_H * 5, overflow: "hidden" },
  restSelTop:       { position: "absolute", top: REST_ITEM_H * 2, left: 24, right: 24, borderTopWidth: 1, zIndex: 1 },
  restSelBottom:    { position: "absolute", top: REST_ITEM_H * 3, left: 24, right: 24, borderTopWidth: 1, zIndex: 1 },
  restItem:         { height: REST_ITEM_H, alignItems: "center", justifyContent: "center" },
  restItemText:     { fontSize: 20 },

  // Reorder sheet
  reorderSheet:     { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 },
  reorderHandle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  reorderListWrap:  { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 },

  // Workout Summary sheet + floating button
  summarySheet:     { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 30, maxHeight: "82%" },
  sumHeader:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  sumBackBtn:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  sumListWrap:      { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 },
  sumDayRow:        { flexDirection: "row", alignItems: "center", gap: 10, height: 62, paddingHorizontal: 8 },
  sumDayBody:       { flex: 1, justifyContent: "center", gap: 2 },
  sumDayName:       { fontFamily: FontFamily.semibold, fontSize: 15 },
  sumDayMeta:       { fontFamily: FontFamily.regular, fontSize: 12 },
  summaryFabWrap:   { borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  summaryFab:       { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 12, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 6 },
  summaryFabText:   { fontFamily: FontFamily.semibold, fontSize: 14, color: "#FFFFFF" },
});
