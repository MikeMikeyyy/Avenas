import { useState, useCallback, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  Alert, Animated, InputAccessoryView, Keyboard, Modal, AppState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import NeuCard, { NEU_BG, NEU_BG_DARK } from "../../components/NeuCard";
import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import BounceButton from "../../components/BounceButton";
import ExercisePicker from "../../components/ExercisePicker";
import TrashIcon from "../../components/TrashIcon";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { PROGRAMS_KEY, type SavedProgram, type Exercise } from "../../constants/programs";
import { CUSTOM_KEY, type CustomExercise } from "../../constants/exercises";

// ─── Constants ─────────────────────────────────────────────────────────────────

const WARMUP_ORANGE = "#FF9500";
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NOTES_INPUT_ID = "workout-notes-input";

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

function parseStoredDate(dateStr: string): Date {
  const parts = dateStr.split(" ");
  const day = parseInt(parts[0], 10);
  const month = MONTH_NAMES.indexOf(parts[1]);
  const year = parseInt(parts[2], 10);
  return new Date(year, month < 0 ? 0 : month, day);
}

function getTodaysWorkout(program: SavedProgram): { name: string; exercises: Exercise[] } | null {
  const start = parseStoredDate(program.startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  const daysPassed = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const dayIndex = ((daysPassed % program.cycleDays) + program.cycleDays) % program.cycleDays;
  const dayName = program.cyclePattern[dayIndex];
  if (!dayName || dayName === "Rest") return null;
  const workoutKey = `${dayIndex}:${dayName}`;
  const exercises = program.workouts[workoutKey] ?? [];
  return { name: dayName, exercises };
}

// ─── Log types ─────────────────────────────────────────────────────────────────

type SetLog = { weight: string; reps: string; done: boolean; fillKey: number };
type ExerciseLog = { warmup: SetLog[]; working: SetLog[] };
type WorkoutLog = Record<string, ExerciseLog>;

function makeSet(): SetLog {
  return { weight: "", reps: "", done: false, fillKey: 0 };
}

function initLog(exercises: Exercise[]): WorkoutLog {
  const log: WorkoutLog = {};
  for (const ex of exercises) {
    log[ex.id] = {
      warmup: Array.from({ length: ex.warmupSets }, makeSet),
      working: Array.from({ length: ex.workingSets }, makeSet),
    };
  }
  return log;
}

// ─── DumbbellIcon ──────────────────────────────────────────────────────────────

function DumbbellIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={color} strokeWidth="1.5" />
    </Svg>
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

  const neuBg = isDark ? NEU_BG_DARK : NEU_BG;

  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        {done ? (
          <View style={{
            borderRadius: 8, backgroundColor: ACCT,
            shadowColor: ACCT,
            shadowOffset: { width: 2, height: 2 },
            shadowOpacity: 0.55,
            shadowRadius: 5,
          }}>
            <View style={[styles.checkbox, { backgroundColor: ACCT, overflow: "hidden" }]}>
              <Ionicons name="checkmark" size={13} color="#fff" />
            </View>
          </View>
        ) : (
          <View style={{
            borderRadius: 8, backgroundColor: neuBg,
            shadowColor: isDark ? "#090B13" : "#a3afc0",
            shadowOffset: { width: 3, height: 3 },
            shadowOpacity: isDark ? 0.9 : 0.7,
            shadowRadius: 5,
          }}>
            <View style={{
              borderRadius: 8, backgroundColor: neuBg,
              shadowColor: isDark ? "#262A40" : "#FFFFFF",
              shadowOffset: { width: -2, height: -2 },
              shadowOpacity: 1,
              shadowRadius: 3,
            }}>
              <View style={[styles.checkbox, { backgroundColor: neuBg, overflow: "hidden" }]} />
            </View>
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── ExerciseCard ──────────────────────────────────────────────────────────────

interface ExerciseCardProps {
  exercise: Exercise;
  exIndex: number;
  exLog: ExerciseLog;
  isDark: boolean;
  isFirst: boolean;
  isLast: boolean;
  onUpdateSet: (type: "warmup" | "working", idx: number, field: "weight" | "reps", value: string) => void;
  onToggleDone: (type: "warmup" | "working", idx: number) => void;
  onAddSet: () => void;
  onRemoveSet: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeExercise: () => void;
  onRemoveExercise: () => void;
  isIsometric: boolean;
  onToggleIsometric: () => void;
}

function ExerciseCard({ exercise, exIndex, exLog, isDark, isFirst, isLast, onUpdateSet, onToggleDone, onAddSet, onRemoveSet, onMoveUp, onMoveDown, onChangeExercise, onRemoveExercise, isIsometric, onToggleIsometric }: ExerciseCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [editing, setEditing] = useState(false);
  const weightRefs = useRef<(TextInput | null)[]>([]);
  const repsRefs = useRef<(TextInput | null)[]>([]);

  // Flatten all sets: warmup first, then working
  const allSets = [
    ...exLog.warmup.map((s, i) => ({ ...s, type: "warmup" as const, localIdx: i, isWarmup: true })),
    ...exLog.working.map((s, i) => ({ ...s, type: "working" as const, localIdx: i, isWarmup: false })),
  ];
  const workingCounter = { count: 0 };

  return (
    <NeuCard dark={isDark} style={styles.exCard}>
      <View style={styles.exCardInner}>

        {/* ── Header ── */}
        <View style={styles.exHeader}>
          <View style={[styles.exNumBadge, { backgroundColor: ACCT + "22", borderColor: ACCT + "55" }]}>
            <Text style={[styles.exNumText, { color: t.tp }]}>{exIndex + 1}</Text>
          </View>
          <Text style={[styles.exName, { color: t.tp }]} numberOfLines={1}>{exercise.name}</Text>
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
        </View>

        {/* ── Column headers ── */}
        <View style={styles.colHeaderRow}>
          <Text style={[styles.colHeaderText, styles.setCol, { color: t.ts }]}>SET</Text>
          <View style={styles.prevCol}>
            <Text style={[styles.colHeaderText, { color: t.ts }]}>PREV</Text>
          </View>
          <View style={styles.inputHeaderCol}>
            <Text style={[styles.colHeaderText, { color: t.ts }]}>WEIGHT (KG)</Text>
          </View>
          <View style={styles.inputHeaderCol}>
            <Text style={[styles.repRangeHeader, { color: t.ts, opacity: (!isIsometric && !!exercise.reps) ? 1 : 0 }]}>
              {exercise.reps || " "}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 }}>
              <Text style={[styles.colHeaderText, { color: t.ts }]}>
                {isIsometric ? "HOLD" : "REPS"}
              </Text>
              {isIsometric && (
                <Text style={[styles.colHeaderText, { color: t.ts }]}>(S)</Text>
              )}
            </View>
          </View>
          <View style={styles.checkCol} />
        </View>

        {/* ── Divider ── */}
        <View style={[styles.headerDivider, { backgroundColor: t.div }]} />

        {/* ── Set rows ── */}
        {allSets.map((set, flatIdx) => {
          if (!set.isWarmup) workingCounter.count += 1;
          const setLabel = set.isWarmup ? "W" : workingCounter.count;
          const isLast = flatIdx === allSets.length - 1;

          return (
            <View key={`${set.type}-${set.localIdx}`} style={styles.dataRow}>
              {/* SET label */}
              {editing ? (
                <View style={[
                  styles.setCol,
                  { alignItems: "center", justifyContent: "center" },
                ]}>
                  <View style={[
                    styles.setEditBadge,
                    { borderColor: set.isWarmup ? WARMUP_ORANGE : t.div },
                  ]}>
                    <Text style={[styles.setText, { color: set.isWarmup ? WARMUP_ORANGE : t.tp }]}>
                      {setLabel}
                    </Text>
                  </View>
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
                <Text style={[styles.prevText, { color: t.ts }]}>—</Text>
              </View>

              {/* WEIGHT input */}
              <View style={styles.inputCell}>
                <View style={[styles.inputBox, { backgroundColor: t.div }]}>
                  <TextInput
                    key={`w-${set.type}-${set.localIdx}-${set.fillKey}`}
                    ref={r => { weightRefs.current[flatIdx] = r; }}
                    style={[styles.inputBoxText, { color: t.tp }]}
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => setTimeout(() => repsRefs.current[flatIdx]?.focus(), 50)}
                    placeholder="—"
                    placeholderTextColor={t.ts}
                    value={set.weight}
                    onChangeText={v => onUpdateSet(set.type, set.localIdx, "weight", v)}
                    selectTextOnFocus
                  />
                </View>
              </View>

              {/* REPS input */}
              <View style={styles.inputCell}>
                <View style={[styles.inputBox, { backgroundColor: t.div }]}>
                  <TextInput
                    key={`r-${set.type}-${set.localIdx}-${set.fillKey}`}
                    ref={r => { repsRefs.current[flatIdx] = r; }}
                    style={[styles.inputBoxText, { color: t.tp }]}
                    keyboardType="decimal-pad"
                    returnKeyType={flatIdx < allSets.length - 1 ? "next" : "done"}
                    submitBehavior={flatIdx === allSets.length - 1 ? "blurAndSubmit" : "submit"}
                    onSubmitEditing={() => {
                      if (flatIdx < allSets.length - 1) {
                        setTimeout(() => weightRefs.current[flatIdx + 1]?.focus(), 50);
                      } else {
                        Keyboard.dismiss();
                      }
                    }}
                    placeholder="—"
                    placeholderTextColor={t.ts}
                    value={set.reps}
                    onChangeText={v => onUpdateSet(set.type, set.localIdx, "reps", v)}
                    selectTextOnFocus
                  />
                </View>
              </View>

              {/* Checkbox or remove-set button */}
              <View style={styles.checkCol}>
                {editing && isLast && allSets.length > 1 ? (
                  <TouchableOpacity onPress={onRemoveSet} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <View style={styles.removeSetBtn}>
                      <Ionicons name="remove" size={13} color="#fff" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <CheckboxCell
                    done={set.done}
                    isDark={isDark}
                    onToggle={() => onToggleDone(set.type, set.localIdx)}
                  />
                )}
              </View>
            </View>
          );
        })}

        {/* ── Edit mode controls ── */}
        {editing && (
          <>
            {/* Move row + Add Set */}
            <View style={[styles.editMoveRow, { borderTopColor: t.div }]}>
              <TouchableOpacity
                onPress={onMoveUp}
                disabled={isFirst}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ opacity: isFirst ? 0.3 : 1 }}
              >
                <Ionicons name="chevron-up" size={18} color={t.ts} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onMoveDown}
                disabled={isLast}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ opacity: isLast ? 0.3 : 1 }}
              >
                <Ionicons name="chevron-down" size={18} color={t.ts} />
              </TouchableOpacity>
              <Text style={[styles.editMoveLabel, { color: t.ts }]}>Move exercise</Text>
              <TouchableOpacity onPress={onAddSet} activeOpacity={0.8} style={{ marginLeft: "auto" }}>
                <View style={[styles.editChipWrap, { shadowColor: ACCT }]}>
                  <View style={[styles.editChip, { backgroundColor: ACCT }]}>
                    <Ionicons name="add" size={13} color="#fff" />
                    <Text style={[styles.editChipText, { color: "#fff" }]}>Add Set</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>

            {/* Three chip buttons */}
            <View style={styles.editChipsRow}>
              {[
                {
                  onPress: onToggleIsometric,
                  icon: <Ionicons name="timer-outline" size={13} color={isIsometric ? ACCT : t.ts} />,
                  label: isIsometric ? "Hold" : "Reps",
                  color: isIsometric ? ACCT : t.ts,
                },
                {
                  onPress: onChangeExercise,
                  icon: <Ionicons name="swap-horizontal" size={13} color={t.ts} />,
                  label: "Change",
                  color: t.ts,
                },
                {
                  onPress: () => Alert.alert(
                    "Remove Exercise",
                    `Remove "${exercise.name}" from today's workout?`,
                    [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: onRemoveExercise }]
                  ),
                  icon: <TrashIcon size={13} color="#FF4D4F" />,
                  label: "Remove",
                  color: "#FF4D4F",
                },
              ].map(({ onPress, icon, label, color }) => {
                const bg = isDark ? NEU_BG_DARK : NEU_BG;
                return (
                  <TouchableOpacity key={label} onPress={onPress} activeOpacity={0.8} style={{ flex: 1 }}>
                    {/* Dark shadow layer */}
                    <View style={{
                      borderRadius: 12, backgroundColor: bg,
                      shadowColor: isDark ? "#090B13" : "#a3afc0",
                      shadowOffset: { width: 4, height: 4 },
                      shadowOpacity: isDark ? 0.9 : 0.7,
                      shadowRadius: 7,
                    }}>
                      {/* White highlight layer */}
                      <View style={{
                        borderRadius: 12, backgroundColor: bg,
                        shadowColor: isDark ? "#262A40" : "#FFFFFF",
                        shadowOffset: { width: -2, height: -2 },
                        shadowOpacity: 1,
                        shadowRadius: 3,
                      }}>
                        {/* Content */}
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
        )}

      </View>
    </NeuCard>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function WorkoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [activeProgram, setActiveProgram] = useState<SavedProgram | null>(null);
  const [workoutInfo, setWorkoutInfo] = useState<{ name: string; exercises: Exercise[] } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [log, setLog] = useState<WorkoutLog>({});
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [changingExId, setChangingExId] = useState<string | null>(null);
  const [isometricExIds, setIsometricExIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");

  // ── Timer modal ──────────────────────────────────────────────────────────────
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [timerMode, setTimerMode] = useState<"timer" | "stopwatch">("timer");
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

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(PROGRAMS_KEY)
      .then(raw => {
        const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
        const found = programs.find(p => p.status === "active") ?? null;
        setActiveProgram(found);
        if (found) {
          const workout = getTodaysWorkout(found);
          setWorkoutInfo(workout);
          if (workout) {
            setLog(prev => {
              const existingIds = Object.keys(prev).sort().join(",");
              const newIds = workout.exercises.map(e => e.id).sort().join(",");
              return existingIds === newIds ? prev : initLog(workout.exercises);
            });
          }
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setCustomExercises(parsed as CustomExercise[]);
    }).catch(() => {});

    if (pendingChangingExId.current) {
      setChangingExId(pendingChangingExId.current);
      pendingChangingExId.current = null;
    }
  }, []));

  const updateSet = (exId: string, type: "warmup" | "working", idx: number, field: "weight" | "reps", value: string) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      const sets = [...exLog[type]];
      sets[idx] = { ...sets[idx], [field]: value };
      return { ...prev, [exId]: { ...exLog, [type]: sets } };
    });
  };

  const toggleDone = (exId: string, type: "warmup" | "working", idx: number) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      const sets = [...exLog[type]];
      sets[idx] = { ...sets[idx], done: !sets[idx].done };
      return { ...prev, [exId]: { ...exLog, [type]: sets } };
    });
  };

  const addSet = (exId: string) => {
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      return { ...prev, [exId]: { ...exLog, working: [...exLog.working, makeSet()] } };
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

  const changeExercise = (exId: string, newName: string) => {
    setWorkoutInfo(prev => prev ? {
      ...prev,
      exercises: prev.exercises.map(e => e.id === exId ? { ...e, name: newName } : e),
    } : prev);
    setLog(prev => {
      const exLog = prev[exId];
      if (!exLog) return prev;
      return { ...prev, [exId]: { warmup: exLog.warmup.map(() => makeSet()), working: exLog.working.map(() => makeSet()) } };
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
  };

  const allDone = !!workoutInfo && workoutInfo.exercises.length > 0 &&
    workoutInfo.exercises.every((ex: Exercise) => {
      const exLog = log[ex.id];
      if (!exLog) return false;
      return [...exLog.warmup, ...exLog.working].every(s => s.done);
    });

  const handleFinish = () => {
    const doFinish = () => Alert.alert(
      "Workout Complete!",
      "Great session. Rest up and come back stronger.",
      [{ text: "Done", onPress: () => { if (workoutInfo) setLog(initLog(workoutInfo.exercises)); } }]
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

  const deleteCustomExercise = (exName: string) => {
    const next = customExercises.filter(e => e.name !== exName);
    setCustomExercises(next);
    AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next)).catch(() => {});
  };

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (!loaded) return <View style={[styles.root, { backgroundColor: t.bg }]} />;

  // ─── No active program ──────────────────────────────────────────────────────
  if (!activeProgram) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        <View style={[styles.emptyWrap, { paddingTop: insets.top + 60 }]}>
          <NeuCard dark={isDark} radius={40} style={styles.emptyIconCard}>
            <View style={styles.emptyIconInner}><DumbbellIcon size={34} color={t.ts} /></View>
          </NeuCard>
          <Text style={[styles.emptyTitle, { color: t.tp }]}>No Active Program</Text>
          <Text style={[styles.emptySub, { color: t.ts }]}>
            Set a program as active in My Programs to start logging workouts.
          </Text>
          <BounceButton onPress={() => router.push("/programs")} style={{ marginTop: 8 }}>
            <View style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>Go to My Programs</Text>
            </View>
          </BounceButton>
        </View>
      </View>
    );
  }

  // ─── Rest day ───────────────────────────────────────────────────────────────
  if (!workoutInfo) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg }]}>
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
      </View>
    );
  }

  // ─── Workout ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 140 }]}
      >
        {/* Header scrolls with content */}
        <View style={styles.header}>
          <Text style={[styles.headerLabel, { color: t.ts }]}>TODAY'S WORKOUT</Text>
          <Text style={[styles.headerName, { color: t.tp }]}>{workoutInfo.name.toUpperCase()}</Text>
          <Text style={[styles.headerSub, { color: t.ts }]}>
            {activeProgram.name} · Week {activeProgram.currentWeek} of {activeProgram.totalWeeks}
          </Text>
        </View>

        {workoutInfo.exercises.length === 0 ? (
          <NeuCard dark={isDark} style={{ borderRadius: 20 }}>
            <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
              <Text style={[styles.emptyTitle, { color: t.tp, fontSize: 16 }]}>No exercises added</Text>
              <Text style={[styles.emptySub, { color: t.ts, fontSize: 13 }]}>
                Edit your program to add exercises to {workoutInfo.name}.
              </Text>
            </View>
          </NeuCard>
        ) : (
          workoutInfo.exercises.map((exercise: Exercise, i: number) => {
            const exLog = log[exercise.id] ?? { warmup: [], working: [] };
            return (
              <ExerciseCard
                key={exercise.id}
                exercise={exercise}
                exIndex={i}
                exLog={exLog}
                isDark={isDark}
                isFirst={i === 0}
                isLast={i === workoutInfo.exercises.length - 1}
                onUpdateSet={(type, idx, field, value) => updateSet(exercise.id, type, idx, field, value)}
                onToggleDone={(type, idx) => toggleDone(exercise.id, type, idx)}
                onAddSet={() => addSet(exercise.id)}
                onRemoveSet={() => removeSet(exercise.id)}
                onMoveUp={() => moveExercise(exercise.id, "up")}
                onMoveDown={() => moveExercise(exercise.id, "down")}
                onChangeExercise={() => setChangingExId(exercise.id)}
                onRemoveExercise={() => removeExercise(exercise.id)}
                isIsometric={isometricExIds.has(exercise.id)}
                onToggleIsometric={() => setIsometricExIds(prev => {
                  const next = new Set(prev);
                  next.has(exercise.id) ? next.delete(exercise.id) : next.add(exercise.id);
                  return next;
                })}
              />
            );
          })
        )}

        {/* Notes — only shown when there are exercises */}
        {workoutInfo.exercises.length > 0 && (
          <NeuCard dark={isDark} style={{ marginTop: 4, marginBottom: 4, borderRadius: 16 }}>
            <View style={styles.notesInner}>
              <Text style={[styles.colHeaderText, { color: t.ts, textAlign: "left", marginBottom: 8 }]}>NOTES</Text>
              <TextInput
                style={[styles.notesInput, { color: t.tp }]}
                placeholder="How's the session going? Anything to note..."
                placeholderTextColor={t.ts}
                multiline
                value={notes}
                onChangeText={setNotes}
                textAlignVertical="top"
                inputAccessoryViewID={Platform.OS === "ios" ? NOTES_INPUT_ID : undefined}
              />
            </View>
          </NeuCard>
        )}

        {/* Finish button */}
        {workoutInfo.exercises.length > 0 && (
          <BounceButton onPress={handleFinish} style={{ marginTop: 16 }}>
            <View style={[styles.finishWrap, styles.finishWrapActive]}>
              <View style={[styles.finishBtn, styles.finishBtnActive]}>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.finishBtnText}>Complete Workout</Text>
              </View>
            </View>
          </BounceButton>
        )}
      </ScrollView>

      {/* Timer button — fixed top-right, always visible */}
      <TouchableOpacity
        onPress={() => setShowTimerModal(true)}
        activeOpacity={0.8}
        style={{ position: "absolute", top: insets.top + 16, right: 20 }}
      >
        <View style={{
          width: 44, height: 44, borderRadius: 22,
          backgroundColor: isDark ? "rgba(255,255,255,0.15)" : t.bg,
          shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDark ? 0.35 : 0.1, shadowRadius: 8,
          alignItems: "center", justifyContent: "center",
        }}>
          <Ionicons name="timer-outline" size={22} color={isDark ? "#FFFFFF" : t.ts} />
        </View>
      </TouchableOpacity>

      {/* ── Timer Modal ── */}
      <Modal visible={showTimerModal} transparent animationType="fade" onRequestClose={() => setShowTimerModal(false)}>
        <TouchableOpacity style={styles.timerBackdrop} activeOpacity={1} onPress={() => { Keyboard.dismiss(); setShowTimerModal(false); }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: "100%" }}>
            <NeuCard dark={isDark} style={styles.timerCard}>

              {/* Header */}
              <View style={[styles.timerCardHeader, { justifyContent: "flex-end" }]}>
                <TouchableOpacity onPress={() => setShowTimerModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={22} color={t.ts} />
                </TouchableOpacity>
              </View>

              {/* Tabs */}
              <View style={[styles.timerTabs, { backgroundColor: t.div }]}>
                {(["timer", "stopwatch"] as const).map(mode => (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => setTimerMode(mode)}
                    style={[styles.timerTab, timerMode === mode && { backgroundColor: ACCT }]}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.timerTabText, { color: timerMode === mode ? "#fff" : t.ts }]}>
                      {mode === "timer" ? "Timer" : "Stopwatch"}
                    </Text>
                  </TouchableOpacity>
                ))}
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
                        style={[styles.timerEditConfirm, { backgroundColor: ACCT }]}
                        onPress={() => {
                          const m = Math.min(99, Math.max(0, parseInt(editMins) || 0));
                          const s = Math.min(59, Math.max(0, parseInt(editSecs) || 0));
                          const total = Math.max(5, m * 60 + s);
                          setCountdownDuration(total); setCountdownRemaining(total);
                          setEditMins(String(Math.floor(total / 60)).padStart(2, "0"));
                          setEditSecs(String(total % 60).padStart(2, "0"));
                          setEditingDuration(false); Keyboard.dismiss();
                        }}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="checkmark" size={18} color="#fff" />
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
                          <TouchableOpacity
                            style={[styles.timerAdjust, { backgroundColor: t.div, opacity: showAdj ? 1 : 0 }]}
                            onPress={showAdj ? () => {
                              const v = Math.max(5, countdownDuration - 15);
                              setCountdownDuration(v); setCountdownRemaining(v);
                              setEditMins(String(Math.floor(v / 60)).padStart(2, "0"));
                              setEditSecs(String(v % 60).padStart(2, "0"));
                            } : undefined}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.timerAdjustText, { color: t.ts }]}>-15s</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => {
                              if (showAdj) {
                                setEditMins(String(Math.floor(countdownRemaining / 60)).padStart(2, "0"));
                                setEditSecs(String(countdownRemaining % 60).padStart(2, "0"));
                                setEditingDuration(true);
                              }
                            }}
                            activeOpacity={showAdj ? 0.7 : 1}
                          >
                            <Text style={[styles.timerTime, { color: t.tp }]}>
                              {timerMode === "timer" ? fmtTime(countdownRemaining) : fmtTime(swElapsed)}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.timerAdjust, { backgroundColor: t.div, opacity: showAdj ? 1 : 0 }]}
                            onPress={showAdj ? () => {
                              const v = countdownDuration + 15;
                              setCountdownDuration(v); setCountdownRemaining(v);
                              setEditMins(String(Math.floor(v / 60)).padStart(2, "0"));
                              setEditSecs(String(v % 60).padStart(2, "0"));
                            } : undefined}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.timerAdjustText, { color: t.ts }]}>+15s</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })()}

                    {/* Hint row — right under the time number */}
                    <View style={{ height: 20, justifyContent: "center", alignItems: "center", marginTop: 4 }}>
                      {timerMode === "timer" && !countdownActive && countdownRemaining === countdownDuration && (
                        <View style={styles.timerEditHint}>
                          <Ionicons name="create-outline" size={11} color={t.ts} />
                          <Text style={[styles.timerEditHintText, { color: t.ts }]}>tap to edit</Text>
                        </View>
                      )}
                    </View>
                  </>
                )}
                </View>
              </View>

              {/* Action buttons */}
              {timerMode === "timer" ? (
                countdownRemaining === 0 ? (
                  <TouchableOpacity style={[styles.timerAction, { backgroundColor: ACCT, marginHorizontal: 20, marginBottom: 20 }]}
                    onPress={() => setCountdownRemaining(countdownDuration)} activeOpacity={0.7}>
                    <Ionicons name="refresh" size={20} color="#fff" />
                    <Text style={[styles.timerActionText, { color: "#fff" }]}>Reset</Text>
                  </TouchableOpacity>
                ) : countdownActive ? (
                  <TouchableOpacity style={[styles.timerAction, { backgroundColor: t.div, marginHorizontal: 20, marginBottom: 20 }]}
                    onPress={() => setCountdownActive(false)} activeOpacity={0.7}>
                    <Ionicons name="pause" size={20} color={t.tp} />
                    <Text style={[styles.timerActionText, { color: t.tp }]}>Pause</Text>
                  </TouchableOpacity>
                ) : countdownRemaining < countdownDuration ? (
                  <View style={styles.timerButtonRow}>
                    <TouchableOpacity style={[styles.timerAction, { backgroundColor: t.div, flex: 1 }]}
                      onPress={() => setCountdownRemaining(countdownDuration)} activeOpacity={0.7}>
                      <Ionicons name="refresh" size={20} color={t.tp} />
                      <Text style={[styles.timerActionText, { color: t.tp }]}>Reset</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.timerAction, { backgroundColor: ACCT, flex: 1 }]}
                      onPress={() => { setCountdownActive(true); setEditingDuration(false); Keyboard.dismiss(); }} activeOpacity={0.7}>
                      <Ionicons name="play" size={20} color="#fff" />
                      <Text style={[styles.timerActionText, { color: "#fff" }]}>Continue</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={[styles.timerAction, { backgroundColor: ACCT, marginHorizontal: 20, marginBottom: 20 }]}
                    onPress={() => { setCountdownActive(true); setEditingDuration(false); Keyboard.dismiss(); }} activeOpacity={0.7}>
                    <Ionicons name="play" size={20} color="#fff" />
                    <Text style={[styles.timerActionText, { color: "#fff" }]}>Start</Text>
                  </TouchableOpacity>
                )
              ) : (
                swRunning ? (
                  <TouchableOpacity style={[styles.timerAction, { backgroundColor: t.div, marginHorizontal: 20, marginBottom: 20 }]}
                    onPress={() => { swOffsetRef.current = swElapsed; setSwRunning(false); }} activeOpacity={0.7}>
                    <Ionicons name="stop" size={20} color={t.tp} />
                    <Text style={[styles.timerActionText, { color: t.tp }]}>Stop</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.timerButtonRow}>
                    {swElapsed > 0 && (
                      <TouchableOpacity style={[styles.timerAction, { backgroundColor: t.div, flex: 1 }]}
                        onPress={() => { setSwElapsed(0); swOffsetRef.current = 0; swStartRef.current = null; }} activeOpacity={0.7}>
                        <Ionicons name="refresh" size={20} color={t.tp} />
                        <Text style={[styles.timerActionText, { color: t.tp }]}>Reset</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.timerAction, { backgroundColor: ACCT, flex: 1 }]}
                      onPress={() => setSwRunning(true)} activeOpacity={0.7}>
                      <Ionicons name="play" size={20} color="#fff" />
                      <Text style={[styles.timerActionText, { color: "#fff" }]}>{swElapsed > 0 ? "Continue" : "Start"}</Text>
                    </TouchableOpacity>
                  </View>
                )
              )}

            </NeuCard>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Done toolbar for notes keyboard — iOS only */}
      {Platform.OS === "ios" && (
        <InputAccessoryView nativeID={NOTES_INPUT_ID} backgroundColor="transparent">
          <View style={styles.kbToolbar}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()} activeOpacity={0.8}>
              <View style={styles.kbDoneBtn}>
                {isGlassEffectAPIAvailable() ? (
                  <>
                    <GlassView
                      glassEffectStyle="regular"
                      style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
                    />
                    <Text style={[styles.kbDoneText, { color: isDark ? "#fff" : "#000" }]}>Done</Text>
                  </>
                ) : (
                  <>
                    <BlurView
                      intensity={isDark ? 55 : 45}
                      tint={isDark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterialLight"}
                      style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
                    />
                    <View style={[StyleSheet.absoluteFill, { borderRadius: 18, backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.50)" }]} />
                    <Text style={[styles.kbDoneText, { color: isDark ? "#fff" : "#000" }]}>Done</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}

      {/* Exercise picker — change exercise for current session */}
      {changingExId !== null && (
        <ExercisePicker
          visible
          subtitle="CHANGE EXERCISE"
          customExercises={customExercises}
          onSelect={name => { changeExercise(changingExId, name); setChangingExId(null); }}
          onDeleteCustom={deleteCustomExercise}
          onCreateCustom={() => {
            pendingChangingExId.current = changingExId;
            setChangingExId(null);
            router.push("/create-custom-exercise");
          }}
          onClose={() => setChangingExId(null)}
          isDark={isDark}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header:       { paddingHorizontal: 20, paddingBottom: 14, gap: 2, marginBottom: 4 },
  headerLabel:  { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.4 },
  headerName:   { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 0.3 },
  headerSub:    { fontFamily: FontFamily.regular, fontSize: 14 },

  scroll: { paddingHorizontal: 16 },

  // Exercise card
  exCard:       { marginBottom: 20, borderRadius: 20 },
  exCardInner:  { padding: 16, gap: 10 },
  exHeader:     { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 },
  exNumBadge:   { width: 28, height: 28, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  exNumText:    { fontFamily: FontFamily.bold, fontSize: 13 },
  exName:       { fontFamily: FontFamily.bold, fontSize: 16, flex: 1 },
  exDoneChip:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  exDoneText:   { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Column headers
  colHeaderRow:   { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 4, paddingBottom: 4 },
  colHeaderText:  { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 1, textAlign: "center" },
  repRangeHeader: { fontFamily: FontFamily.bold, fontSize: 10, letterSpacing: 0.5, textAlign: "center", marginBottom: 1 },
  headerDivider:  { height: StyleSheet.hairlineWidth, marginBottom: 4 },

  // Column widths — match old app exactly
  setCol:        { width: 36, textAlign: "center" },
  prevCol:       { width: 72, alignItems: "center", justifyContent: "center" },
  inputHeaderCol:{ flex: 1, alignItems: "center", justifyContent: "flex-end", marginHorizontal: 4 },
  inputCell:     { flex: 1, marginHorizontal: 4, alignItems: "center" },
  checkCol:      { width: 32, alignItems: "center", justifyContent: "center" },

  // Data rows
  dataRow:       { flexDirection: "row", alignItems: "center", paddingVertical: 3, paddingHorizontal: 4 },
  setText:       { fontFamily: FontFamily.semibold, fontSize: 15, textAlign: "center" },
  prevText:      { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
  setEditBadge:  { width: 28, height: 28, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },

  // Inputs
  inputBox:      { width: "100%", height: 40, borderRadius: 10, justifyContent: "center" },
  inputBoxText:  { fontFamily: FontFamily.bold, fontSize: 15, textAlign: "center", flex: 1, paddingVertical: 0 },

  // Checkbox
  checkbox:      { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center" },

  // Add / remove set
  addSetBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 6, marginTop: 2, borderRadius: 8, borderWidth: 1, borderStyle: "dashed" },
  addSetText:    { fontFamily: FontFamily.semibold, fontSize: 12 },
  removeSetBtn:  { width: 22, height: 22, borderRadius: 7, backgroundColor: "#FF4D4F", alignItems: "center", justifyContent: "center", shadowColor: "#FF4D4F", shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.55, shadowRadius: 5 },

  // Edit actions
  editMoveRow:   { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4 },
  editMoveLabel: { fontFamily: FontFamily.regular, fontSize: 12, marginLeft: 2 },
  editChipsRow:  { flexDirection: "row", gap: 8, marginTop: 10 },
  editChipWrap:  { alignSelf: "center", borderRadius: 12, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.28, shadowRadius: 5 },
  editChip:      { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  editChipText:  { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Notes
  notesInner:  { padding: 16 },
  notesInput:  { fontFamily: FontFamily.regular, fontSize: 14, minHeight: 72, lineHeight: 22 },

  // Finish button
  finishWrap:       { borderRadius: 16, backgroundColor: "#8896A7", shadowColor: "#4a5568", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.45, shadowRadius: 8 },
  finishWrapActive: { backgroundColor: ACCT, shadowColor: "#1a9e68" },
  finishBtn:        { borderRadius: 16, backgroundColor: "#8896A7", paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  finishBtnActive:  { backgroundColor: ACCT },
  finishBtnText:    { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff", letterSpacing: 0.3 },

  // Keyboard toolbar
kbToolbar:  { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  kbDoneBtn:  { borderRadius: 18, overflow: "hidden", paddingHorizontal: 20, paddingVertical: 8 },
  kbDoneText: { fontFamily: FontFamily.semibold, fontSize: 15 },

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
  timerTab:         { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  timerTabText:     { fontFamily: FontFamily.semibold, fontSize: 14 },
  timerDisplay:     { alignItems: "center", justifyContent: "center", minHeight: 120 },
  timerAdjust:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  timerAdjustText:  { fontFamily: FontFamily.semibold, fontSize: 14 },
  timerTime:        { fontFamily: FontFamily.bold, fontSize: 56, letterSpacing: 2 },
  timerEditRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  timerEditInput:   { fontFamily: FontFamily.bold, fontSize: 40, width: 72, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8, textAlign: "center" },
  timerEditConfirm: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  timerEditHint:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  timerEditHintText:{ fontFamily: FontFamily.regular, fontSize: 11 },
  timerAction:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  timerActionText:  { fontFamily: FontFamily.semibold, fontSize: 16 },
  timerButtonRow:   { flexDirection: "row", gap: 10, marginHorizontal: 20, marginBottom: 20 },
});
