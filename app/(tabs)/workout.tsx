import React, { useState, useCallback, useRef, useEffect } from "react";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, Easing as ReEasing, interpolateColor } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  Alert, Animated, Keyboard, Modal, AppState, LayoutAnimation,
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
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { PROGRAMS_KEY, type SavedProgram, type Exercise, type ProgramSet, normaliseSets, getCurrentWeek } from "../../constants/programs";
import { CUSTOM_KEY, type CustomExercise } from "../../constants/exercises";
import { useWorkoutTimer } from "../../contexts/WorkoutTimerContext";
import { useRestTimer } from "../../contexts/RestTimerContext";

// ─── Constants ─────────────────────────────────────────────────────────────────

const WARMUP_ORANGE = "#ffbf0f";
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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
        borderColor: isDark ? APP_DARK.ts : APP_LIGHT.ts,
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
  isFirst: boolean;
  isLast: boolean;
  onUpdateSet: (type: "warmup" | "working", idx: number, field: "weight" | "reps", value: string) => void;
  onToggleDone: (type: "warmup" | "working", idx: number) => void;
  onAutoTick: (type: "warmup" | "working", idx: number) => void;
  onUpdateNotes: (notes: string) => void;
  exNotes: string;
  onAddSet: () => void;
  onRemoveSet: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeExercise: () => void;
  onRemoveExercise: () => void;
  isIsometric: boolean;
  onToggleIsometric: () => void;
  onToggleSetType: (type: "warmup" | "working", localIdx: number) => void;
  onInputFocus: (nextFn: (() => void) | null) => void;
  activeSetFlatIdx: number | null;
}

function ExerciseCard({ exercise, exIndex, totalExercises, exLog, isDark, isFirst, isLast, onUpdateSet, onToggleDone, onAutoTick, onUpdateNotes, exNotes, onAddSet, onRemoveSet, onMoveUp, onMoveDown, onChangeExercise, onRemoveExercise, isIsometric, onToggleIsometric, onToggleSetType, onInputFocus, activeSetFlatIdx }: ExerciseCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;
  const [editing, setEditing] = useState(false);
  const weightRefs = useRef<(TextInput | null)[]>([]);
  const repsRefs = useRef<(TextInput | null)[]>([]);

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
            <Text style={[styles.exNumLabel, { color: t.ts }]}>EXERCISE {exIndex + 1} OF {totalExercises}</Text>
            <Text style={[styles.exName, { color: t.tp }]} numberOfLines={1}>{exercise.name}</Text>
          </View>
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
            <Text style={[styles.colHeaderText, { color: t.ts }]}>WEIGHT (KG)</Text>
          </View>
          <View style={styles.inputHeaderCol}>
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
        <View style={[styles.headerDivider, { backgroundColor: divider }]} />

        {/* ── Set rows ── */}
        <View>
        {allSets.map((set, flatIdx) => {
          if (!set.isWarmup) workingCounter.count += 1;
          const setLabel = set.isWarmup ? "W" : workingCounter.count;
          const isLast = flatIdx === allSets.length - 1;

          return (
            <CollapsibleCard
              key={`${set.type}-${set.localIdx}`}
              isCollapsing={flatIdx === collapsingSetIdx}
              onCollapsed={() => { setCollapsingSetIdx(null); onRemoveSet(); }}
              expanding={flatIdx === newlyAddedIdx}
              naturalHeight={flatIdx === newlyAddedIdx ? setRowHeight.current : undefined}
            >
            <SetRow isActive={!editing && flatIdx === activeSetFlatIdx}>
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
                <Text style={[styles.prevText, { color: t.ts }]}>—</Text>
              </View>

              {/* WEIGHT input */}
              <View style={styles.inputCell}>
                <View style={[styles.inputBox, { backgroundColor: t.bg, borderWidth: 1, borderColor: isDark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.07)" }]}>
                  <TextInput
                    key={`w-${set.type}-${set.localIdx}-${set.fillKey}`}
                    ref={r => { weightRefs.current[flatIdx] = r; }}
                    style={[styles.inputBoxText, { color: t.tp }]}
                    keyboardType="decimal-pad"
                    placeholder={set.programSet?.weightKg || "—"}
                    placeholderTextColor={set.programSet?.weightKg ? `${t.tp}70` : t.ts}
                    value={set.weight}
                    onFocus={() => onInputFocus(() => repsRefs.current[flatIdx]?.focus())}
                    onChangeText={v => onUpdateSet(set.type, set.localIdx, "weight", v)}
                    onEndEditing={() => onAutoTick(set.type, set.localIdx)}
                    selectTextOnFocus
                  />
                </View>
              </View>

              {/* REPS input */}
              <View style={styles.inputCell}>
                <View style={[styles.inputBox, { backgroundColor: t.bg, borderWidth: 1, borderColor: isDark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.07)" }]}>
                  <TextInput
                    key={`r-${set.type}-${set.localIdx}-${set.fillKey}`}
                    ref={r => { repsRefs.current[flatIdx] = r; }}
                    style={[styles.inputBoxText, { color: t.tp }]}
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
                      return hasTarget ? `${t.tp}70` : t.ts;
                    })()}
                    value={set.reps}
                    onFocus={() => {
                      if (flatIdx < allSets.length - 1) {
                        onInputFocus(() => weightRefs.current[flatIdx + 1]?.focus());
                      } else {
                        onInputFocus(null);
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
                    onToggle={() => onToggleDone(set.type, set.localIdx)}
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
                      shadowColor: isDark ? "#090B13" : "#a3afc0",
                      shadowOffset: { width: 4, height: 4 },
                      shadowOpacity: isDark ? 0.9 : 0.7,
                      shadowRadius: 7,
                    }}>
                      <View style={{
                        borderRadius: 12, backgroundColor: bg,
                        shadowColor: isDark ? "#262A40" : "#FFFFFF",
                        shadowOffset: { width: -2, height: -2 },
                        shadowOpacity: 1,
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
            placeholder="Exercise notes..."
            placeholderTextColor={t.ts}
            value={exNotes}
            onChangeText={onUpdateNotes}
            onFocus={() => onInputFocus(null)}
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
  const { startRestTimer } = useRestTimer();

  const [activeProgram, setActiveProgram] = useState<SavedProgram | null>(null);
  const [workoutInfo, setWorkoutInfo] = useState<{ name: string; exercises: Exercise[] } | null>(null);
  const [log, setLog] = useState<WorkoutLog>({});
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [changingExId, setChangingExId] = useState<string | null>(null);
  const [addingExercise, setAddingExercise] = useState(false);
  const [isometricExIds, setIsometricExIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const notesY = useRef(0);

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

  const loadData = useCallback(() => {
    AsyncStorage.getItem(PROGRAMS_KEY)
      .then(raw => {
        const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
        const found = programs.find(p => p.status === "active") ?? null;
        setActiveProgram(found);
        if (found) {
          const workout = getTodaysWorkout(found);
          setWorkoutInfo(workout);
          if (workout) {
            setIsometricExIds(new Set(workout.exercises.filter(e => e.isIsometric).map(e => e.id)));
            setLog(prev => {
              const existingIds = Object.keys(prev).sort().join(",");
              const newIds = workout.exercises.map(e => e.id).sort().join(",");
              return existingIds === newIds ? prev : initLog(workout.exercises);
            });
          }
        }
      })
      .catch(() => {});

    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setCustomExercises(parsed as CustomExercise[]);
    }).catch(() => {});
  }, []);

  // Pre-load on mount so data is ready before user navigates here
  useEffect(() => { loadData(); }, []);

  useFocusEffect(useCallback(() => {
    loadData();

    if (pendingChangingExId.current) {
      setChangingExId(pendingChangingExId.current);
      pendingChangingExId.current = null;
    }
  }, [loadData]));

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
    startTimer();
    if (willTick) startRestTimer(workoutInfo?.exercises.find(e => e.id === exId)?.restSeconds ?? 0);
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

  const handleFinish = () => {
    const doFinish = () => Alert.alert(
      "Workout Complete!",
      "Great session. Rest up and come back stronger.",
      [{ text: "Done", onPress: () => { if (workoutInfo) setLog(initLog(workoutInfo.exercises)); stopTimer(); } }]
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
          if (workoutInfo) setLog(initLog(workoutInfo.exercises));
          stopTimer();
        },
      },
    ]);
  };

  const deleteCustomExercise = (exName: string) => {
    const next = customExercises.filter(e => e.name !== exName);
    setCustomExercises(next);
    AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next)).catch(() => {});
  };

  const [kbHeight, setKbHeight] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const nextFnRef = useRef<(() => void) | null>(null);
  const handleInputFocus = useCallback((fn: (() => void) | null) => {
    nextFnRef.current = fn;
    setHasNext(fn !== null);
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
    const hide = Keyboard.addListener("keyboardWillHide", () => { setKbHeight(0); setHasNext(false); nextFnRef.current = null; });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // ─── No active program ──────────────────────────────────────────────────────
  if (!activeProgram) {
    return (
      <FadeScreen style={{ backgroundColor: t.bg }}>
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
          <Text style={[styles.headerName, { color: t.tp }]}>{workoutInfo.name.toUpperCase()}</Text>
          <Text style={[styles.headerSub, { color: t.ts }]}>
            {activeProgram.name} · Week {getCurrentWeek(activeProgram)} of {activeProgram.totalWeeks}
          </Text>
        </View>

        {workoutInfo.exercises.length === 0 ? (
          <NeuCard dark={isDark} style={{ borderRadius: 20, marginBottom: 16 }}>
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
                  isFirst={i === 0}
                  isLast={i === workoutInfo.exercises.length - 1}
                  onUpdateSet={(type, idx, field, value) => updateSet(exercise.id, type, idx, field, value)}
                  onToggleDone={(type, idx) => toggleDone(exercise.id, type, idx)}
                  onAutoTick={(type, idx) => autoTickIfComplete(exercise.id, type, idx)}
                  exNotes={log[exercise.id]?.notes ?? ""}
                  onUpdateNotes={notes => updateExNotes(exercise.id, notes)}
                  onAddSet={() => addSet(exercise.id)}
                  onRemoveSet={() => removeSet(exercise.id)}
                  onMoveUp={() => moveExercise(exercise.id, "up")}
                  onMoveDown={() => moveExercise(exercise.id, "down")}
                  onChangeExercise={() => setChangingExId(exercise.id)}
                  onRemoveExercise={() => startCollapse(exercise.id)}
                  onToggleSetType={(type, localIdx) => toggleSetType(exercise.id, type, localIdx)}
                  onInputFocus={handleInputFocus}
                  isIsometric={isometricExIds.has(exercise.id)}
                  activeSetFlatIdx={getActiveSetFlatIdx(exercise.id, workoutInfo.exercises, log)}
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

        {/* Bottom action row: notes icon left, Add Exercise centred */}
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

        {/* Session Notes — animated expand/collapse */}
        {workoutInfo.exercises.length > 0 && (
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
                  onFocus={() => handleInputFocus(null)}
                  textAlignVertical="top"
                />
              </View>
            </NeuCard>
          </ExpandablePanel>
          </View>
        )}

        {/* Finish button */}
        {workoutInfo.exercises.length > 0 && (
          <BounceButton onPress={handleFinish} style={{ marginTop: 16 }}>
            <View style={[styles.finishWrap, styles.finishWrapActive, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
              <View style={[styles.finishBtn, styles.finishBtnActive, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}>
                <Ionicons name="checkmark-circle" size={18} color={isDark ? APP_DARK.bg : "#fff"} />
                <Text style={[styles.finishBtnText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Complete Workout</Text>
              </View>
            </View>
          </BounceButton>
        )}

      </ScrollView>

      {/* Fixed top bar — workout timer + discard + rest timer */}
      <View style={[styles.topBar, { top: insets.top }]}>
        <View style={styles.topBarLeft}>
          {isRunning ? (
            <>
              <View style={styles.workoutTimerPill}>
                <Ionicons name="time-outline" size={14} color={APP_LIGHT.tp} />
                <Text style={[styles.workoutTimerText, { color: APP_LIGHT.tp }]}>{fmtTime(elapsedSeconds)}</Text>
              </View>
              <BounceButton onPress={handleDiscard}>
                <View style={[styles.topIconBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
                  <TrashIcon size={18} color={t.ts} />
                </View>
              </BounceButton>
            </>
          ) : (
            <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); startTimer(); }}>
              <View style={[styles.workoutTimerPill, { paddingHorizontal: 25 }]}>
                <Text style={[styles.workoutTimerText, { color: APP_LIGHT.tp }]}>Start</Text>
              </View>
            </BounceButton>
          )}
        </View>
        <TouchableOpacity onPress={() => setShowTimerModal(true)} activeOpacity={0.8}>
          <View style={[styles.topIconBtn, { backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 8 }]}>
            <Ionicons name="timer-outline" size={22} color="#fff" />
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
                            style={[styles.timerAdjust, { backgroundColor: t.div, opacity: showAdj ? 1 : 0 }]}
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
                            style={[styles.timerAdjust, { backgroundColor: t.div, opacity: showAdj ? 1 : 0 }]}
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
                  <View style={[styles.timerActionGlow, { marginHorizontal: 20, marginBottom: 20, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
                    <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setCountdownActive(true); setEditingDuration(false); Keyboard.dismiss(); }}>
                      <View style={styles.timerActionInner}>
                        <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                        <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Start</Text>
                      </View>
                    </BounceButton>
                  </View>
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
                ) : (
                  <View style={styles.timerButtonRow}>
                    {swElapsed > 0 && (
                      <BounceButton style={[styles.timerAction, { backgroundColor: t.div, flex: 1 }]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSwElapsed(0); swOffsetRef.current = 0; swStartRef.current = null; }}>
                        <View style={styles.timerActionInner}>
                          <Ionicons name="refresh" size={20} color={t.tp} />
                          <Text style={[styles.timerActionText, { color: t.tp }]}>Reset</Text>
                        </View>
                      </BounceButton>
                    )}
                    <View style={[styles.timerActionGlow, { flex: 1, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
                      <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSwRunning(true); }}>
                        <View style={styles.timerActionInner}>
                          <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                          <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>{swElapsed > 0 ? "Continue" : "Start"}</Text>
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
    </KeyboardAvoidingView>
    {kbHeight > 0 && Platform.OS === "ios" && (
      <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, flexDirection: "row", gap: 8, zIndex: 999 }}>
        {hasNext && (
          <TouchableOpacity
            onPress={() => nextFnRef.current?.()}
            activeOpacity={0.75}
            style={[styles.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}
          >
            <Ionicons name="chevron-forward" size={24} color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        )}
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

  // Header
  header:       { paddingBottom: 14, gap: 2, marginBottom: 4 },
  headerLabel:  { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.4 },
  headerName:   { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 0.3, marginTop: 2 },
  headerSub:        { fontFamily: FontFamily.regular, fontSize: 14 },
  topBar:           { position: "absolute", left: 20, right: 20, zIndex: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topBarLeft:       { flexDirection: "row", alignItems: "center", gap: 10 },
  topIconBtn:       { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  workoutTimerPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
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
  exNumLabel:   { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.8 },
  exName:       { fontFamily: FontFamily.bold, fontSize: 22, flex: 1 },
  exNotesRow:    { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  exNotesHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  exNotesDone:   { fontFamily: FontFamily.semibold, fontSize: 13 },
  exNotesInput:  { fontFamily: FontFamily.regular, fontSize: 13, minHeight: 36, lineHeight: 20 },
  exDoneChip:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  exDoneText:   { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Column headers
  colHeaderRow:   { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 4, paddingBottom: 4 },
  colHeaderText:  { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 1, textAlign: "center" },
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
  removeSetBtn:  { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FF4D4F", alignItems: "center", justifyContent: "center", shadowColor: "#FF4D4F", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },

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

  checkCircle:      { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  addExBtnWrap:     { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  addExBtn:         { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 10, paddingHorizontal: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  addExText:        { fontFamily: FontFamily.semibold, fontSize: 14, color: "#FFFFFF" },

  // Keyboard floating dismiss button
  kbFloatRow: { flexDirection: "row", justifyContent: "flex-end", paddingRight: 10, paddingTop: 8, paddingBottom: 4 },
  kbFloatBtn: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },

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
