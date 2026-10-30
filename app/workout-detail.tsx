import { Fragment, useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  type ScrollViewInstance,
  type TextInputInstance,
} from "react-native";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing as ReEasing,
} from "react-native-reanimated";
import { Svg, Path } from "react-native-svg";
import { BlurView } from "expo-blur";
import MaskedView from "../components/MaskedView";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFloatingBarsReach, usePinnedLift } from "../hooks/useFloatingBars";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import GlassButton, { GlassSurface } from "../components/GlassButton";
import CollapsibleCard from "../components/CollapsibleCard";
import ExercisePicker from "../components/ExercisePicker";
import NumberBadge from "../components/NumberBadge";
import ReorderExercisesSheet, { DragHandleIcon } from "../components/ReorderExercisesSheet";
import FadeScreen from "../components/FadeScreen";
import AuroraBackdrop from "../components/AuroraBackdrop";
import TrashIcon from "../components/TrashIcon";
import TimeEditSheet from "../components/TimeEditSheet";
import WorkoutAchievements from "../components/WorkoutAchievements";
import { stampSession } from "../components/TimeWheelPicker";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, DANGER_BRIGHT } from "../constants/theme";
import { cardButton, CARD_BUTTON_BORDER, darkGlow, glowOpacity, haloGlow, PILL_RADIUS, PILL_SHADOW, setInputSurface } from "../constants/buttons";
import { ABOVE_KEYBOARD_TOOLS, scrollEndPadding } from "../constants/floatingBars";
import { SessionCueLine, SkippedRow } from "../components/ChangeCue";
import { sessionChanges } from "../utils/exerciseChanges";
import { useFieldAboveKeyboard } from "../hooks/useFieldAboveKeyboard";
import {
  WORKOUT_HISTORY_KEY,
  WORKOUT_DATES_KEY,
  type CompletedWorkout,
  type CompletedExercise,
} from "../constants/programs";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { scheduleCloudPush } from "../lib/syncManager";
import { useUnit } from "../contexts/UnitContext";
import { useClientUnit } from "../hooks/useClientUnit";
import { formatWeightForDisplay, parseWeightToKg, unitLabel, unitOf } from "../utils/units";
import { useTheme } from "../contexts/ThemeContext";
import { loadCachedClientData } from "../utils/trainerStore";
import { swapOrigin } from "../utils/workout";
import { customIdForName } from "../utils/customExercises";
import { exercisePageParams } from "../utils/customExerciseDetails";
import { deleteCustomExercise as deleteCustomEverywhere } from "../utils/customExerciseStore";
import { fromYMD } from "../utils/dates";
import { displayWorkoutName } from "../utils/programDays";
import { achievementsForWorkout, prSetsOfWorkout } from "../utils/achievements";
import PrTrophy from "../components/PrTrophy";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";

const WARMUP_ORANGE = "#ffbf0f";
/** The floating + while editing, a size up from the buttons at the top. */
const ADD_SIZE = 44;
/** A date / time chip's height: its 18pt line, 6pt above and below. */
const META_CHIP_H = 30;
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

// The day is the session's TRAINING day (`date`), never completedAt's: a
// session finished after midnight is the day before's, and completedAt is the
// real finish (utils/sessionTime.ts).
function workoutMetaParts(dateYMD: string, completedIso: string, durationSeconds: number): { date: string; time: string; duration: string | null } {
  const d = new Date(completedIso);
  const day = fromYMD(dateYMD) ?? d;
  const dateStr = `${DAY_SHORT[day.getDay()]} ${day.getDate()} ${MONTH_SHORT[day.getMonth()]}`;
  const endTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (durationSeconds > 0) {
    const startTime = new Date(d.getTime() - durationSeconds * 1000)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    return { date: dateStr, time: `${startTime} – ${endTime}`, duration: fmtDuration(durationSeconds) };
  }
  return { date: dateStr, time: endTime, duration: null };
}

// Date / time-range / duration chips under the workout title. Each stat sits in
// its own soft grey pill so the session summary reads at a glance. In edit mode
// a clear glass Edit chip joins them, the page's ink on it, and the pills stay
// grey (user request, 2026-10-30: the pills turned green and the Edit chip was
// a solid green one with a glow).
function WorkoutMetaRow({ dateYMD, completedIso, durationSeconds, isDark, editable = false }: {
  dateYMD: string; completedIso: string; durationSeconds: number; isDark: boolean; editable?: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const parts = workoutMetaParts(dateYMD, completedIso, durationSeconds);
  const chipBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  const items: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string }[] = [
    { icon: "calendar-outline", label: parts.date },
    { icon: "time-outline", label: parts.time },
    ...(parts.duration !== null ? [{ icon: "stopwatch-outline" as const, label: parts.duration }] : []),
  ];
  return (
    <View style={styles.metaRow}>
      {items.map(it => (
        <View key={it.icon} style={[styles.metaChip, { backgroundColor: chipBg }]}>
          <Ionicons name={it.icon} size={13} color={t.ts} />
          <Text style={[styles.metaText, { color: t.tp }]}>{it.label}</Text>
        </View>
      ))}
      {/* The row bounces as one under a press (the page's BounceButton), so
          the glass takes no press of its own. */}
      {editable && (
        <GlassSurface style={[styles.metaChip, styles.metaEditChip]} solidStyle={PILL_SHADOW}>
          <Ionicons name="pencil" size={12} color={t.tp} />
          <Text style={[styles.metaText, { color: t.tp }]}>Edit</Text>
        </GlassSurface>
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

// ─── WorkoutDetailScreen ───────────────────────────────────────────────────────

export default function WorkoutDetailScreen() {
  /**
   * `edit=1` opens straight into edit mode.
   *
   * Set by the Workout tab's "Edit Workout" button, which is a request to edit,
   * not to look: landing read-only meant finishing a session, tapping Edit
   * Workout, and then having to find a second Edit in the top right before a
   * single number could be changed. Every other route here — a card on Home, a
   * day in the journal calendar, a PR tile — is a view, and stays one.
   *
   * `clientId` makes it a TRAINER reading a client's session, opened from the
   * client page's Journal tab. Same screen on purpose, so a trainer sees the
   * workout exactly as the client does (weights in the viewer's unit), but
   * read-only: nothing here may write it, since it isn't this account's
   * history. The workout comes from the copy the client page just loaded.
   */
  const { id, edit, clientId } = useLocalSearchParams<{ id: string; edit?: string; clientId?: string }>();
  const readOnly = !!clientId;
  const router = useRouter();
  const { isDark } = useTheme();
  const { isKg: ownIsKg } = useUnit();
  // A client's workout reads in the unit THEY log in (0036), exactly as on
  // their phone, rather than converted into the trainer's.
  const clientIsKg = useClientUnit(clientId);
  const isKg = clientIsKg ?? ownIsKg;

  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  // The + pinned while editing stands on the workout bar while it shows.
  const { lift: pinnedLift, liftStyle: pinnedStyle } = usePinnedLift(insets.bottom + 24);
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Stored weights are canonical kg. The edit buffer + on-screen rows work in the
  // user's display unit; convert kg→display when loading into the buffer / for
  // the read-only view, and display→kg when saving back.
  const exToDisplay = (exs: CompletedExercise[]): CompletedExercise[] =>
    exs.map(ex => ({ ...ex, sets: ex.sets.map(s => ({ ...s, weight: formatWeightForDisplay(s.weight, isKg) })) }));
  const exToKg = (exs: CompletedExercise[]): CompletedExercise[] =>
    exs.map(ex => ({ ...ex, sets: ex.sets.map(s => ({ ...s, weight: parseWeightToKg(s.weight, isKg) })) }));

  const [workout, setWorkout]               = useState<CompletedWorkout | null>(null);
  // The whole history this workout was read from: what it earned is measured
  // against the sessions completed before it.
  const [history, setHistory]               = useState<CompletedWorkout[]>([]);
  const [isEditing, setIsEditing]           = useState(false);
  const [editedExercises, setEditedExercises] = useState<CompletedExercise[]>([]);
  const [editedIsIsometric, setEditedIsIsometric] = useState<boolean[]>([]);
  // A stable key per exercise, index-aligned with editedExercises like the
  // isometric flags, so each card (and the notes box in it) moves WITH its
  // exercise. Cards were keyed by position, so a reorder handed the first
  // card's notes box, still sized for a five-line note, an empty one: a
  // multiline TextInput doesn't shrink when its text is replaced rather than
  // typed. `savedKeys` are the saved order's keys, which Cancel restores, so
  // leaving edit mode never remounts a card and its edit panel still animates.
  const [editedKeys, setEditedKeys] = useState<string[]>([]);
  const savedKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  const newKeys = (n: number) => Array.from({ length: n }, () => `ex${keySeq.current++}`);
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
  const sessionNotesRef = useRef<TextInputInstance | null>(null);
  const setRowHeightRef = useRef(0);
  const [collapsingIndices, setCollapsingIndices] = useState<Set<number>>(new Set());
  const startCollapseEx = (idx: number) => setCollapsingIndices(prev => new Set(prev).add(idx));
  const [kbHeight, setKbHeight] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const nextFnRef = useRef<(() => void) | null>(null);
  const prevFnRef = useRef<(() => void) | null>(null);
  const inputRefs = useRef<Record<string, TextInputInstance | null>>({});

  // Every field on this page is in the list (session notes, names, sets,
  // exercise notes), so each one that focuses is scrolled clear of the keyboard
  // and its tools (hooks/useFieldAboveKeyboard.ts), as on the Workout tab.
  // Editing notes low on the page left them behind the keyboard (user report,
  // 2026-10-13).
  const scrollRef = useRef<ScrollViewInstance>(null);
  const fieldFocused = useFieldAboveKeyboard(scrollRef, kbHeight, ABOVE_KEYBOARD_TOOLS);
  const handleInputFocus = useCallback((nextFn: (() => void) | null, prevFn: (() => void) | null = null) => {
    setHasNext(nextFn !== null);
    setHasPrev(prevFn !== null);
    nextFnRef.current = nextFn;
    prevFnRef.current = prevFn;
    fieldFocused();
  }, [fieldFocused]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide  = Keyboard.addListener("keyboardWillHide", () => { setKbHeight(0); setHasNext(false); setHasPrev(false); nextFnRef.current = null; prevFnRef.current = null; });
    return () => { show.remove(); hide.remove(); };
  }, []);

  const divider = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  // A set's boxes, as the Workout tab draws them (setInputSurface).
  const inputSurface = setInputSurface(t, isDark);

  // Its PRs and any milestone, as they were when it was saved: measured against
  // the sessions before it, so a heavier one since doesn't take them away. The
  // saved copy, not the edit buffer, so it follows a save and not a keystroke.
  const earned = useMemo(
    () => (workout ? achievementsForWorkout(workout, history) : []),
    [workout, history],
  );
  // Which sets wear the PR trophy by their number, read the same way from the
  // saved copy (utils/achievements.ts). Index-aligned with the saved sets, so
  // drawn only while not editing, where the rows are the saved ones in order.
  const prSets = useMemo(
    () => (workout ? prSetsOfWorkout(workout, history) : null),
    [workout, history],
  );

  useEffect(() => {
    const loadHistory: Promise<CompletedWorkout[]> = clientId
      ? loadCachedClientData(clientId).then(d => d.workoutHistory)
      : AsyncStorage.getItem(WORKOUT_HISTORY_KEY).then(raw => (raw ? JSON.parse(raw) : []));
    loadHistory.then(history => {
      const found = history.find(w => w.id === id) ?? null;
      setHistory(history);
      setWorkout(found);
      if (found) {
        setEditedExercises(exToDisplay(found.exercises));
        setEditedIsIsometric(found.exercises.map(e => !!e.isIsometric));
        const keys = newKeys(found.exercises.length);
        setEditedKeys(keys);
        savedKeys.current = keys;
        setEditedCompletedAt(found.completedAt);
        setEditedDurationSeconds(found.durationSeconds);
        setEditedSessionNotes(found.sessionNotes ?? "");
        // Here, not on mount: edit mode renders from the buffers seeded above,
        // so flipping it before they exist would show one empty frame. This
        // effect runs once per workout (its deps are route params), so saving and
        // leaving edit mode afterwards can't be undone by a re-run.
        if (edit === "1" && !clientId) setIsEditing(true);
      }
    }).catch(() => {});
    // Only the edit mode's exercise picker uses these.
    if (clientId) return;
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setCustomExercises(parsed as CustomExercise[]);
    }).catch(() => {});
  }, [id, edit, clientId]);

  // Correcting which exercise was done. It keeps its place in the program
  // (programExerciseId) and records what the program had there, exactly like a
  // swap on the Workout screen, so the next session's hint still finds that
  // place (utils/workout.ts buildPrevNoteLookup). The note is kept: this is an
  // edit of a record, and the note may be exactly what was meant.
  const changeExercise = (exIdx: number, newName: string, customId?: string) => {
    setEditedExercises(prev => prev.map((ex, i) => i !== exIdx ? ex
      : { ...ex, name: newName, customId, ...swapOrigin(ex, { name: newName, customId }) }));
  };

  // Append exercises picked from the ExercisePicker, each starting with one
  // empty working set (same default as log-workout). The isometric flags array
  // must grow in lockstep — it's index-aligned with editedExercises.
  const addExercises = (names: string[], customIds: (string | undefined)[] = []) => {
    if (names.length === 0) return;
    setEditedExercises(prev => [
      ...prev,
      ...names.map((name, i) => ({
        name,
        ...(customIds[i] ? { customId: customIds[i] } : {}),
        sets: [{ type: "working" as const, weight: "", reps: "", done: false }],
        notes: "",
      })),
    ]);
    setEditedIsIsometric(prev => [...prev, ...names.map(() => false)]);
    const added = newKeys(names.length);
    setEditedKeys(prev => [...prev, ...added]);
  };

  // The three writers below all target THIS account's history, so each refuses
  // a client's workout outright rather than relying on its button being hidden.
  const handleSave = async () => {
    if (!workout || readOnly) return;
    const updated = {
      ...workout,
      // display units → canonical kg. A filled set on a logged workout was
      // performed, so mark it done on save — progress stats only count done
      // working sets, and this edit view has no checkbox (sets added here or
      // via Add Set start done:false and would otherwise never count). A set
      // left empty stays not-done and is ignored by stats.
      exercises: exToKg(editedExercises).map((ex, i) => {
        // The Hold switch, saved (CompletedExercise.isIsometric): it used to
        // open off and be forgotten on save.
        const { isIsometric: _was, ...rest } = ex;
        return {
          ...rest,
          ...(editedIsIsometric[i] ? { isIsometric: true as const } : {}),
          sets: ex.sets.map(s =>
            !s.done && (s.weight.trim() || s.reps.trim()) ? { ...s, done: true } : s,
          ),
        };
      }),
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
    savedKeys.current = editedKeys;
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (workout) {
      setEditedExercises(exToDisplay(workout.exercises));
      setEditedIsIsometric(workout.exercises.map(e => !!e.isIsometric));
      setEditedKeys(savedKeys.current);
      setEditedCompletedAt(workout.completedAt);
      setEditedDurationSeconds(workout.durationSeconds);
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!workout || readOnly) return;
    Alert.alert(
      "Delete Workout?",
      `"${displayWorkoutName(workout.workoutName)}" will be permanently removed.`,
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
    if (!workout || readOnly) return;
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

  // Typing a different name is the same correction as Change above. Safe per
  // keystroke: swapOrigin keeps the FIRST name typed over, and typing it back
  // records nothing, since it's that exercise again (its custom id and all). A
  // name that's one of your live custom exercises is that one.
  const updateExName = (exIdx: number, name: string) => {
    setEditedExercises(prev => prev.map((ex, i) => {
      if (i !== exIdx) return ex;
      const was = ex.swappedFrom ?? ex.name;
      const wasId = ex.swappedFrom ? ex.swappedFromId : ex.customId;
      const customId = was.trim().toLowerCase() === name.trim().toLowerCase()
        ? wasId
        : customIdForName(name, customExercises);
      return { ...ex, name, customId, ...swapOrigin(ex, { name, customId }) };
    }));
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
    setEditedKeys(prev => prev.filter((_, i) => i !== exIdx));
  };

  const toggleIsometric = (exIdx: number) => {
    setEditedIsIsometric(prev => prev.map((v, i) => i === exIdx ? !v : v));
  };

  // The sheet hands back the SAME exercise objects in a new order, so where
  // each came from is its identity, not its name (a day can list one exercise
  // twice). Its key and Reps/Hold flag move with it.
  const handleReorder = (reordered: CompletedExercise[]) => {
    const from = reordered.map(ex => editedExercises.indexOf(ex));
    if (from.some(i => i < 0)) return;
    setEditedExercises(reordered);
    setEditedIsIsometric(from.map(i => editedIsIsometric[i] ?? false));
    setEditedKeys(from.map(i => editedKeys[i]));
    movedInSheet.current = true;
  };

  // Moving an exercise finishes the edit, as moving one on the Workout tab
  // closes its edit panel: closing the reorder sheet after a move saves, the
  // same as the tick. Through refs, because the sheet's drag-to-dismiss handler
  // is built once and keeps the FIRST onClose it was given; a direct call from
  // there would save the order from before the move.
  const movedInSheet = useRef(false);
  // Change and Remove in the sheet carry the edit on (the picker, the card's
  // collapse), so a move before them isn't saved as the sheet closes. The
  // sheet runs these before its onClose.
  const changeFromSheet = (_: CompletedExercise, i: number) => {
    movedInSheet.current = false;
    setChangingExIdx(i);
  };
  const removeFromSheet = (_: CompletedExercise, i: number) => {
    movedInSheet.current = false;
    startCollapseEx(i);
  };
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const closeReorder = useCallback(() => {
    setReorderOpen(false);
    if (movedInSheet.current) {
      movedInSheet.current = false;
      void saveRef.current();
    }
  }, []);

  const exercises = workout ? (isEditing ? editedExercises : exToDisplay(workout.exercises)) : [];
  // What the session did with its program day, read against the plan it saved
  // (utils/exerciseChanges.ts): a line under each exercise it moved, swapped or
  // added, and a dashed row where it left one out. Off the list as shown, so an
  // edit reads straight away; the skipped rows wait until the edit is done,
  // since the list itself is what's being changed then.
  const changes = workout ? sessionChanges({ dayId: workout.dayId, plan: workout.plan, exercises }) : null;
  const skippedBefore = (i: number) =>
    !isEditing && changes ? changes.skipped.filter(s => s.before === i) : [];

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Blush glow — carries the Journal flow's tint into this detail screen */}
      <AuroraBackdrop dark={isDark} tint="blush" />
      {/* Top gradient blur */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      {/* Back button */}
      <BackButton />

      {/* Action buttons (none on a client's workout: a trainer only reads it) */}
      <View style={{ position: "absolute", top: insets.top + BACK_TOP, right: 20, zIndex: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
        {readOnly ? null : isEditing ? (
          <>
            <GlassButton onPress={handleCancel} size={BACK_SIZE} accessibilityLabel="Cancel editing">
              <Ionicons name="close" size={22} color={t.tp} />
            </GlassButton>
            <GlassButton tint={ACCT} onPress={handleSave} size={BACK_SIZE} accessibilityLabel="Save changes" solidStyle={[styles.saveGlow, darkGlow(styles.saveGlow, isDark)]}>
              <Ionicons name="checkmark" size={22} color="#fff" />
            </GlassButton>
          </>
        ) : (
          <>
            <GlassButton onPress={() => setIsEditing(true)} size={BACK_SIZE} accessibilityLabel="Edit workout">
              <Ionicons name="create-outline" size={20} color={t.tp} />
            </GlassButton>
            <GlassButton onPress={handleDelete} size={BACK_SIZE} accessibilityLabel="Delete workout">
              <TrashIcon size={18} color={DANGER_BRIGHT} />
            </GlassButton>
          </>
        )}
      </View>

      {/* The list shrinks above the keyboard (so a field low on the page has
          room to scroll up to), and the field itself is scrolled clear by
          handleInputFocus, as on the Workout tab and the Journal's log. */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + BACK_TOP, paddingBottom: scrollEndPadding(insets.bottom + (isEditing ? 100 + pinnedLift : 40), barsReach), paddingHorizontal: 20 }}
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
              <Text style={[styles.title, { color: t.tp }]}>{displayWorkoutName(workout.workoutName)}</Text>
              {isEditing ? (
                // A bounce, not a fade: glass draws wrongly under a fading parent.
                <BounceButton
                  onPress={() => setTimeSheetOpen(true)}
                  style={{ alignSelf: "flex-start" }}
                  accessibilityLabel="Edit start and end time"
                  accessibilityRole="button"
                >
                  <WorkoutMetaRow dateYMD={workout.date} completedIso={editedCompletedAt || workout.completedAt} durationSeconds={editedDurationSeconds} isDark={isDark} editable />
                </BounceButton>
              ) : (
                <WorkoutMetaRow dateYMD={workout.date} completedIso={workout.completedAt} durationSeconds={workout.durationSeconds} isDark={isDark} />
              )}
              {clientIsKg !== undefined && clientIsKg !== ownIsKg && (
                <Text style={[styles.unitNote, { color: t.ts }]}>
                  Weights in {unitLabel(unitOf(clientIsKg))}, the unit this client logs in
                </Text>
              )}
            </View>

            {/* What this session earned, first thing under its name. Not while
                editing: the numbers it's about are the ones being changed. */}
            {!isEditing && <WorkoutAchievements achievements={earned} isDark={isDark} isKg={isKg} />}

            {/* Session Notes — workout-level, same button style as the live workout
                page. On a client's workout: their notes if they wrote any, not
                tappable, and no "Add" row when they didn't. */}
            {!(readOnly && !editedSessionNotes.trim()) && (
            <View style={{ marginBottom: 20 }}>
              {showSessionNotes ? (
                <NeuCard dark={isDark} style={{ borderRadius: 16 }}>
                  <View style={styles.sessionNotesInner}>
                    <View style={styles.sessionNotesHeader}>
                      <Text style={[styles.sessionNotesTitle, { color: t.tp }]}>Session Notes</Text>
                      <BounceButton onPress={closeSessionNotes} accessibilityLabel="Save session notes">
                        <View style={[styles.notesTickBtn, darkGlow(styles.notesTickBtn, isDark)]}>
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
                      onFocus={() => handleInputFocus(null, null)}
                      onBlur={() => void persistSessionNotes(editedSessionNotes)}
                      textAlignVertical="top"
                    />
                  </View>
                </NeuCard>
              ) : editedSessionNotes.trim() ? (
                <TouchableOpacity activeOpacity={0.85} onPress={openSessionNotes} disabled={readOnly}>
                  <NeuCard dark={isDark} style={{ borderRadius: 16 }}>
                    <View style={styles.sessionNotesInner}>
                      <View style={styles.sessionNotesHeader}>
                        <Text style={[styles.sessionNotesTitle, { color: t.tp }]}>Session Notes</Text>
                        {!readOnly && <Ionicons name="pencil" size={15} color={t.ts} />}
                      </View>
                      <Text style={[styles.sessionNotesText, { color: t.ts }]}>{editedSessionNotes.trim()}</Text>
                    </View>
                  </NeuCard>
                </TouchableOpacity>
              ) : (
                <BounceButton onPress={openSessionNotes} accessibilityLabel="Add session notes">
                  <View style={styles.sessionNotesAddRow}>
                    <View style={styles.notesToggleBtn}>
                      {/* The Workout tab's button (glass on iOS 26), not a
                          raised NeuCard, with the green + pinned to its corner.
                          The row bounces as one with its words, so the glass
                          takes no press of its own. */}
                      <GlassSurface style={styles.notesIconBtn} solidStyle={PILL_SHADOW}>
                        <Ionicons name="document-text-outline" size={20} color={t.tp} />
                      </GlassSurface>
                      <View style={styles.notesTogglePlus}>
                        <Text style={styles.notesTogglePlusText}>+</Text>
                      </View>
                    </View>
                    <Text style={[styles.sessionNotesAddLabel, { color: t.ts }]}>Add session notes</Text>
                  </View>
                </BounceButton>
              )}
            </View>
            )}

            {/* Exercises */}
            {exercises.map((ex, ei) => {
              let workingCounter = 0;
              const isIsometric = editedIsIsometric[ei] ?? false;
              const cue = changes?.cues[ei] ?? null;
              return (
                <Fragment key={editedKeys[ei] ?? ei}>
                {skippedBefore(ei).map(s => <SkippedRow key={s.id} name={s.name} isDark={isDark} style={styles.skippedGap} />)}
                <CollapsibleCard
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
                      <NumberBadge n={ei + 1} isDark={isDark} />
                      {isEditing ? (
                        <TextInput
                          style={[styles.exName, { color: t.tp, flex: 1, padding: 0 }]}
                          value={ex.name}
                          onChangeText={name => updateExName(ei, name.replace(/\n/g, ""))}
                          onFocus={() => handleInputFocus(null, null)}
                          returnKeyType="default"
                          multiline
                          scrollEnabled={false}
                        />
                      ) : (
                        // Out of editing, the name opens the exercise's page,
                        // as on the Workout tab (user request, 2026-10-30): a
                        // client's own, on a trainer's view of their session.
                        <TouchableOpacity
                          style={{ flex: 1 }}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            router.navigate({ pathname: "/exercise-summary", params: exercisePageParams({ name: ex.name, customId: ex.customId }, clientId) });
                          }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`View ${ex.name} summary`}
                        >
                          <Text style={[styles.exName, { color: t.tp }]}>{ex.name}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {cue ? <SessionCueLine cue={cue} isDark={isDark} style={styles.changeCue} /> : null}

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
                                // The trophy hangs off the number's own left
                                // edge (components/PrTrophy.tsx).
                                <View>
                                  <Text style={[styles.setText, { color: isWU ? WARMUP_ORANGE : t.tp }]}>{label}</Text>
                                  <PrTrophy show={!!prSets?.[ei]?.[j]} />
                                </View>
                              )}
                            </View>
                            <View style={{ width: 32 }} />
                            <View style={styles.inputCell}>
                              <View style={[styles.inputBox, inputSurface]}>
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
                              <View style={[styles.inputBox, inputSurface]}>
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
                                <View style={[styles.removeSetBtn, darkGlow(styles.removeSetBtn, isDark)]}>
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
                            onFocus={() => handleInputFocus(null, null)}
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
                          {/* Icon AND label in one target — see workout.tsx. */}
                          <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setReorderOpen(true); }}
                            activeOpacity={0.7}
                            style={styles.exReorderBtn}
                            accessibilityLabel="Reorder exercises"
                            accessibilityRole="button"
                          >
                            <View style={styles.exReorderIcon}>
                              <DragHandleIcon color={t.ts} />
                            </View>
                            <Text style={[styles.editMoveLabel, { color: t.ts }]}>Move exercise</Text>
                          </TouchableOpacity>
                          <View style={{ flex: 1 }} />
                          <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); addSet(ei); }}
                            activeOpacity={0.8}
                            style={[styles.editChip, cardButton(t), { flex: 0, paddingHorizontal: 14 - CARD_BUTTON_BORDER }]}
                          >
                            <Ionicons name="add" size={13} color={ACCT} />
                            <Text style={[styles.editChipText, { color: ACCT }]}>Add Set</Text>
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
                              icon: <TrashIcon size={13} color={DANGER_BRIGHT} />,
                              label: "Remove",
                              color: DANGER_BRIGHT,
                            },
                          ].map(({ onPress, icon, label, color }) => (
                            <TouchableOpacity key={label} onPress={onPress} activeOpacity={0.8} style={{ flex: 1 }}>
                              <View style={[styles.editChip, cardButton(t)]}>
                                {icon}
                                <Text style={[styles.editChipText, { color }]}>{label}</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    </ExpandablePanel>

                  </View>
                </NeuCard>
                </CollapsibleCard>
                </Fragment>
              );
            })}
            {skippedBefore(exercises.length).map(s => <SkippedRow key={s.id} name={s.name} isDark={isDark} style={styles.skippedGap} />)}

          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Add an exercise to this logged workout — the same floating round green
          + used by the workout / log-workout screens, pinned bottom-left while
          editing. History edits never touch the program — only this
          CompletedWorkout. */}
      {isEditing && (
        <Reanimated.View style={[{ position: "absolute", left: 20, bottom: insets.bottom + 24, zIndex: 6 }, pinnedStyle]}>
          <GlassButton
            tint={ACCT}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddingExercise(true); }}
            size={ADD_SIZE}
            accessibilityLabel="Add exercise"
            solidStyle={[styles.addGlow, darkGlow(styles.addGlow, isDark)]}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </GlassButton>
        </Reanimated.View>
      )}
      <ExercisePicker
        visible={changingExIdx !== null || addingExercise}
        subtitle={addingExercise ? "ADD EXERCISES" : "CHANGE EXERCISE"}
        changing={addingExercise ? undefined : (changingExIdx !== null ? editedExercises[changingExIdx]?.name : undefined) ?? ""}
        customExercises={customExercises}
        onSelectMultiple={(names, _sets, customIds) => {
          if (addingExercise) {
            addExercises(names, customIds);
            setAddingExercise(false);
          } else {
            if (names.length > 0 && changingExIdx !== null) changeExercise(changingExIdx, names[0], customIds[0]);
            setChangingExIdx(null);
          }
        }}
        // Deleted everywhere it's used, its logged sessions kept
        // (utils/customExerciseStore.ts).
        onDeleteCustom={name => { deleteCustomEverywhere(name).then(setCustomExercises).catch(() => {}); }}
        onEditCustom={() => {}}
        onCreateCustom={() => {}}
        onClose={() => { setChangingExIdx(null); setAddingExercise(false); }}
        isDark={isDark}
      />
      {/* Keyed by the edit's own keys (a logged exercise has no id), which
          handleReorder moves with each exercise. */}
      <ReorderExercisesSheet
        visible={reorderOpen}
        subtitle={workout ? displayWorkoutName(workout.workoutName) : undefined}
        items={editedExercises}
        keyOf={(_, i) => editedKeys[i] ?? String(i)}
        nameOf={ex => ex.name}
        onReorder={handleReorder}
        onChange={changeFromSheet}
        onRemove={removeFromSheet}
        closeOnRemove
        onClose={closeReorder}
      />
      {workout && editedCompletedAt !== "" && (
        <TimeEditSheet
          visible={timeSheetOpen}
          isDark={isDark}
          title={displayWorkoutName(workout.workoutName)}
          subtitle="Start & End Time"
          confirmLabel="Save Time"
          startDate={new Date(new Date(editedCompletedAt).getTime() - editedDurationSeconds * 1000)}
          endDate={new Date(editedCompletedAt)}
          onConfirm={(start, end) => {
            // Read against the start as it stands (utils/sessionTime.ts).
            const stamped = new Date(new Date(editedCompletedAt).getTime() - editedDurationSeconds * 1000);
            const times = stampSession(workout.date, start, end, stamped);
            setEditedCompletedAt(times.completedAt);
            setEditedDurationSeconds(times.durationSeconds);
            setTimeSheetOpen(false);
          }}
          onClose={() => setTimeSheetOpen(false)}
        />
      )}
      {kbHeight > 0 && Platform.OS === "ios" && (
        <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, flexDirection: "row", gap: 8, zIndex: 999 }}>
          {/* Arrows only where there's a set input to step to, as on the
              Workout tab: notes and the exercise name get the dismiss key alone. */}
          {(hasPrev || hasNext) && (
            <>
              <TouchableOpacity onPress={() => prevFnRef.current?.()} activeOpacity={hasPrev ? 0.75 : 1} disabled={!hasPrev} style={[styles.kbDismissBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff", opacity: hasPrev ? 1 : 0.35 }]}>
                <Ionicons name="chevron-back" size={24} color={isDark ? "#fff" : "#333"} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => nextFnRef.current?.()} activeOpacity={hasNext ? 0.75 : 1} disabled={!hasNext} style={[styles.kbDismissBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff", opacity: hasNext ? 1 : 0.35 }]}>
                <Ionicons name="chevron-forward" size={24} color={isDark ? "#fff" : "#333"} />
              </TouchableOpacity>
            </>
          )}
          {/* Typing session notes, this is the card's tick (as on the Workout
              tab): save them, put the keyboard away and close the card. */}
          <TouchableOpacity onPress={() => (showSessionNotes && sessionNotesRef.current?.isFocused() ? closeSessionNotes() : Keyboard.dismiss())} activeOpacity={0.75} style={[styles.kbDismissBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}>
            <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        </View>
      )}
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  // The solid tick's and +'s glows: the glass ones are lit by the glass.
  saveGlow:    haloGlow(ACCT),
  addGlow:     haloGlow(ACCT, 0.6, 12),

  title: { fontFamily: FontFamily.bold, fontSize: 26, marginBottom: 4 },
  unitNote: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 6 },
  metaRow:      { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 },
  metaChip:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  // Glass takes its radius exactly as given (never clamped to half its
  // height), so the Edit chip is the grey chips' height, set, not 999 round.
  metaEditChip: { height: META_CHIP_H, borderRadius: META_CHIP_H / 2, paddingVertical: 0 },
  metaText:     { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },

  exHeader:    { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  exName:{ fontFamily: FontFamily.bold, fontSize: 22 },
  // Under the name, past the number badge (32 + the header's gap of 10), 4
  // below it: the header's margin is 12.
  changeCue:   { marginTop: -8, marginBottom: 12, paddingLeft: 42 },
  // A Skipped row keeps the gap the exercise cards keep.
  skippedGap:  { marginBottom: 20 },

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
  removeSetBtn: { width: 24, height: 24, borderRadius: 13, backgroundColor: DANGER_BRIGHT, alignItems: "center", justifyContent: "center", shadowColor: DANGER_BRIGHT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },

  inputBox:  { width: 80, height: 40, borderRadius: 10, justifyContent: "center" },
  inputText: { fontFamily: FontFamily.bold, fontSize: 15, textAlign: "center", flex: 1, paddingVertical: 0 },

  notes:        { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", paddingTop: 10, marginTop: 8, borderTopWidth: 1 },
  notesEditRow: { flexDirection: "row", alignItems: "flex-start", borderTopWidth: 1, marginTop: 8, paddingTop: 10, paddingBottom: 10, gap: 6 },
  notesInput:   { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", flex: 1, paddingVertical: 0 },

  editMoveRow:  { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 10 },
  editMoveLabel: { fontFamily: FontFamily.regular, fontSize: 12, marginLeft: 2 },
  exReorderBtn: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36, paddingRight: 14 },
  exReorderIcon:{ width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  editChipsRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 6 },
  // A button inside the exercise card (cardButton), a point less padding for
  // its hairline.
  editChip:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10 - CARD_BUTTON_BORDER, paddingHorizontal: 8 - CARD_BUTTON_BORDER, borderRadius: PILL_RADIUS },
  editChipText: { fontFamily: FontFamily.semibold, fontSize: 12 },

  scrollTitleRow: { flexDirection: "row", alignItems: "center", height: BACK_SIZE, marginBottom: 16 },
  navTitle:       { flex: 1, textAlign: "center", fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase" },

  kbDismissBtn:  { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
  notesLabel:    { fontFamily: FontFamily.semibold, fontSize: 13, marginBottom: 6 },

  // Session notes — button + card styling mirrors the live workout page.
  notesToggleBtn:      { width: 40, height: 40 },
  // The workout page's topIconBtn: the circle the button draws in t.ctrl.
  notesIconBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
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
