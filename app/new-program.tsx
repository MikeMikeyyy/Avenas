import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Modal,
  Alert,
  Platform,
  Keyboard,
  Animated,
  Easing,
  PanResponder,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useNavigation, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { PROGRAMS_KEY, type SavedProgram, type Exercise, type WorkoutMap } from "../constants/programs";
import NeuCard from "../components/NeuCard";
import TrashIcon from "../components/TrashIcon";
import BounceButton from "../components/BounceButton";
import ExercisePicker from "../components/ExercisePicker";
import { useTheme } from "../contexts/ThemeContext";

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAFT_KEY = "@avenas/new_program_draft";

// ─── Icons ────────────────────────────────────────────────────────────────────

function DumbbellIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={color} strokeWidth="1.5" />
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

// ─── Exercise Row ─────────────────────────────────────────────────────────────


interface ExerciseRowProps {
  exercise: Exercise;
  isFirst: boolean;
  isLast: boolean;
  isDark: boolean;
  onUpdate: (field: keyof Exercise, value: string | number) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
  onEdit: () => void;
}

function ExerciseRow({ exercise, isFirst, isLast, isDark, onUpdate, onRemove, onMove, onEdit }: ExerciseRowProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.exRowWrap}>
      {/* Sub-row 1: name + reorder + delete */}
      <View style={styles.exTopRow}>
        <TouchableOpacity onPress={onEdit} activeOpacity={0.7} style={styles.exNameBtn}>
          <Text style={[styles.exName, { color: t.tp }]} numberOfLines={1} ellipsizeMode="tail">{exercise.name}</Text>
        </TouchableOpacity>
        <View style={styles.exArrows}>
          {isLast ? (
            // Last exercise: show only up arrow in the down-arrow slot to avoid empty left space
            <>
              <View style={styles.exArrowPlaceholder} />
              <TouchableOpacity onPress={() => onMove("up")} activeOpacity={0.7}>
                <Ionicons name="chevron-up" size={18} color={t.ts} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              {isFirst
                ? <View style={styles.exArrowPlaceholder} />
                : <TouchableOpacity onPress={() => onMove("up")} activeOpacity={0.7}>
                    <Ionicons name="chevron-up" size={18} color={t.ts} />
                  </TouchableOpacity>
              }
              <TouchableOpacity onPress={() => onMove("down")} activeOpacity={0.7}>
                <Ionicons name="chevron-down" size={18} color={t.ts} />
              </TouchableOpacity>
            </>
          )}
        </View>
        <TouchableOpacity
          onPress={() =>
            Alert.alert("Remove Exercise", `Remove "${exercise.name}"?`, [
              { text: "Cancel", style: "cancel" },
              { text: "Remove", style: "destructive", onPress: onRemove },
            ])
          }
          activeOpacity={0.7}
        >
          <TrashIcon size={16} color={t.ts} />
        </TouchableOpacity>
      </View>

      {/* Sub-row 2: warmup sets, working sets, reps */}
      <View style={[styles.exBottomRow, { borderTopColor: t.div }]}>
        {/* Warmup sets */}
        <View style={styles.exSetGroup}>
          <Text style={[styles.exSetLabel, { color: t.ts }]}>Warmup Sets</Text>
          <View style={styles.exMiniStepper}>
            <TouchableOpacity onPress={() => onUpdate("warmupSets", clamp(exercise.warmupSets - 1, 0, 10))} activeOpacity={0.7}>
              <Ionicons name="remove-circle-outline" size={20} color={t.ts} />
            </TouchableOpacity>
            <Text style={[styles.exSetCount, { color: t.tp }]}>{exercise.warmupSets}</Text>
            <TouchableOpacity onPress={() => onUpdate("warmupSets", clamp(exercise.warmupSets + 1, 0, 10))} activeOpacity={0.7}>
              <Ionicons name="add-circle-outline" size={20} color={t.ts} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.exSetDivider, { backgroundColor: t.div }]} />

        {/* Working sets */}
        <View style={styles.exSetGroup}>
          <Text style={[styles.exSetLabel, { color: t.ts }]}>Working Sets</Text>
          <View style={styles.exMiniStepper}>
            <TouchableOpacity onPress={() => onUpdate("workingSets", clamp(exercise.workingSets - 1, 1, 20))} activeOpacity={0.7}>
              <Ionicons name="remove-circle-outline" size={20} color={t.ts} />
            </TouchableOpacity>
            <Text style={[styles.exSetCount, { color: t.tp }]}>{exercise.workingSets}</Text>
            <TouchableOpacity onPress={() => onUpdate("workingSets", clamp(exercise.workingSets + 1, 1, 20))} activeOpacity={0.7}>
              <Ionicons name="add-circle-outline" size={20} color={t.ts} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.exSetDivider, { backgroundColor: t.div }]} />

        {/* Reps */}
        <View style={styles.exSetGroup}>
          <Text style={[styles.exSetLabel, { color: t.ts }]}>Rep Range</Text>
          <TextInput
            style={[styles.exRepsInput, { color: t.tp }]}
            value={exercise.reps}
            onChangeText={v => onUpdate("reps", v)}
            placeholder="8-12"
            placeholderTextColor={t.ts}
            returnKeyType="done"
            selectTextOnFocus
          />
        </View>
      </View>
    </View>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({
  label, value, onDecrement, onIncrement, isDark,
}: {
  label: string; value: number;
  onDecrement: () => void; onIncrement: () => void; isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <NeuCard dark={isDark} style={styles.stepperCard}>
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

function StepIndicator({ step, isDark }: { step: 1 | 2; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.stepIndicatorWrap}>
      <View style={[styles.stepLine, { backgroundColor: step === 2 ? ACCT : t.div }]} />
      <View style={styles.stepIndicatorRow}>
        <View style={styles.stepItem}>
          <View style={[styles.stepDot, { backgroundColor: ACCT }]}>
            <Text style={styles.stepDotText}>1</Text>
          </View>
          <Text style={[styles.stepDotLabel, { color: ACCT }]}>Setup</Text>
        </View>
        <View style={styles.stepItem}>
          <View style={[styles.stepDot, { backgroundColor: step === 2 ? ACCT : t.div }]}>
            <Text style={[styles.stepDotText, { color: step === 2 ? "#fff" : t.ts }]}>2</Text>
          </View>
          <Text style={[styles.stepDotLabel, { color: step === 2 ? ACCT : t.ts }]}>Workouts</Text>
        </View>
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
  const dayInputRefs = useRef<Array<TextInput | null>>([]);
  const trainingIndices = cyclePattern.map((_, i) => i).filter(i => isTrainingDay[i]);
  const canProceed =
    name.trim().length > 0 &&
    isTrainingDay.some(Boolean) &&
    isTrainingDay.every((isTraining, i) => !isTraining || cyclePattern[i].trim().length > 0);

  return (
    <>
      <Text style={[styles.fieldLabel, { color: t.ts }]}>PROGRAM NAME</Text>
      <NeuCard dark={isDark} style={styles.inputCard}>
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
            onDecrement={() => onCycleDaysChange(cycleDays - 1)}
            onIncrement={() => onCycleDaysChange(cycleDays + 1)}
            isDark={isDark}
          />
        </View>
      </View>

      <Text style={[styles.fieldLabel, { color: t.ts }]}>CYCLE PATTERN</Text>
      <NeuCard dark={isDark} style={styles.cycleCard}>
        <View style={styles.cycleCardInner}>
          {cyclePattern.map((day, i) => {
            const isTraining = isTrainingDay[i];
            return (
              <View
                key={i}
                style={[
                  styles.dayRow,
                  i < cyclePattern.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.div },
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
                  style={[styles.togglePill, { backgroundColor: isTraining ? ACCT + "22" : t.div }, isTraining && { borderWidth: 1, borderColor: ACCT }]}
                  activeOpacity={0.7}
                >
                  {isTraining
                    ? <DumbbellIcon size={13} color={t.tp} />
                    : <Ionicons name="moon-outline" size={13} color={t.ts} />
                  }
                  <Text style={[styles.togglePillText, { color: isTraining ? t.tp : t.ts }]}>
                    {isTraining ? "Training" : "Rest"}
                  </Text>
                </TouchableOpacity>
              </View>
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
        <View style={styles.primaryBtnWrap}>
          <View style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </View>
        </View>
      </BounceButton>
    </>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────

function Step2({
  workouts, onOpenPicker, onEditExercise, onUpdateExercise, onRemoveExercise, onMoveExercise, isDark, onFinish, isEditMode,
}: {
  workouts: WorkoutMap;
  onOpenPicker: (day: string) => void;
  onEditExercise: (day: string, id: string) => void;
  onUpdateExercise: (day: string, id: string, field: keyof Exercise, value: string | number) => void;
  onRemoveExercise: (day: string, id: string) => void;
  onMoveExercise: (day: string, id: string, dir: "up" | "down") => void;
  isDark: boolean;
  onFinish: () => void;
  isEditMode: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const days = Object.keys(workouts);

  return (
    <>
      {days.map((day) => (
        <View key={day} style={{ marginBottom: 20 }}>
          <Text style={[styles.dayHeading, { color: t.tp }]}>{dayLabel(day).toUpperCase()}</Text>
          <NeuCard dark={isDark} style={styles.workoutDayCard}>
            {workouts[day].length === 0 && (
              <Text style={[styles.emptyHint, { color: t.ts }]}>No exercises yet. Tap below to add.</Text>
            )}
            {workouts[day].map((ex, i) => (
              <View
                key={ex.id}
                style={i < workouts[day].length - 1 ? { borderBottomWidth: 1, borderBottomColor: t.div } : undefined}
              >
                <ExerciseRow
                  exercise={ex}
                  isFirst={i === 0}
                  isLast={i === workouts[day].length - 1}
                  isDark={isDark}
                  onUpdate={(field, value) => onUpdateExercise(day, ex.id, field, value)}
                  onRemove={() => onRemoveExercise(day, ex.id)}
                  onMove={(dir) => onMoveExercise(day, ex.id, dir)}
                  onEdit={() => onEditExercise(day, ex.id)}
                />
              </View>
            ))}
            <TouchableOpacity
              onPress={() => onOpenPicker(day)}
              style={[styles.addExBtn, workouts[day].length > 0 && { borderTopWidth: 1, borderTopColor: t.div }]}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={18} color={ACCT} />
              <Text style={[styles.addExText, { color: ACCT }]}>Add Exercise</Text>
            </TouchableOpacity>
          </NeuCard>
        </View>
      ))}

      <BounceButton onPress={onFinish} accessibilityLabel={isEditMode ? "Save changes" : "Create program"} accessibilityRole="button">
        <View style={styles.primaryBtnWrap}>
          <View style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{isEditMode ? "Save Changes" : "Create Program"}</Text>
          </View>
        </View>
      </BounceButton>
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
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const isEditMode = !!editId;

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(8);
  const [cycleDays, setCycleDays] = useState(7);
  const [cyclePattern, setCyclePattern] = useState<string[]>(Array(7).fill(""));
  const [isTrainingDay, setIsTrainingDay] = useState<boolean[]>([true, true, true, false, false, false, false]);
  const [workouts, setWorkouts] = useState<WorkoutMap>({});
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [pickerState, setPickerState] = useState<{ day: string; replaceId?: string } | null>(null);

  // Tracks whether the draft has been loaded — prevents auto-save overwriting it before load completes
  const isDraftLoaded = useRef(false);
  // Set to true before intentional navigation so beforeRemove skips the dialog
  const isLeavingIntentionally = useRef(false);
  // Snapshot of the program state as it was loaded in edit mode
  const originalEdit = useRef<{ name: string; totalWeeks: number; cycleDays: number; isTrainingDay: boolean[]; cyclePattern: string[]; workouts: WorkoutMap } | null>(null);
  // Remembers which day's picker was open before navigating to create-custom-exercise
  const pendingPickerDay = useRef<string | null>(null);

  // Reload custom exercises and re-open picker when returning from create-custom-exercise
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] !== "string") {
        setCustomExercises(parsed as CustomExercise[]);
      }
    }).catch(() => {});

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
        AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(migrated)).catch(() => {});
      } else {
        setCustomExercises(parsed as CustomExercise[]);
      }
    }).catch(() => {});

    (async () => {
      try {
        if (editId) {
          // Edit mode — load the existing program
          const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
          const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
          const program = programs.find(p => p.id === editId);
          if (program) {
            const isTraining = program.cyclePattern.map(d => d !== "Rest");
            const names = program.cyclePattern.map(d => d === "Rest" ? "" : d);
            setName(program.name);
            setTotalWeeks(program.totalWeeks);
            setCycleDays(program.cycleDays);
            setIsTrainingDay(isTraining);
            setCyclePattern(names);
            setWorkouts(program.workouts ?? {});
            originalEdit.current = {
              name: program.name,
              totalWeeks: program.totalWeeks,
              cycleDays: program.cycleDays,
              isTrainingDay: isTraining,
              cyclePattern: names,
              workouts: program.workouts ?? {},
            };
          }
        } else {
          // Create mode — load draft
          const raw = await AsyncStorage.getItem(DRAFT_KEY);
          if (raw) {
            const draft = JSON.parse(raw) as ProgramDraft;
            if (draft.step) setStep(draft.step);
            if (draft.name !== undefined) setName(draft.name);
            if (draft.totalWeeks) setTotalWeeks(draft.totalWeeks);
            if (draft.cycleDays) setCycleDays(draft.cycleDays);
            if (draft.cyclePattern) setCyclePattern(draft.cyclePattern);
            if (draft.isTrainingDay) setIsTrainingDay(draft.isTrainingDay);
            if (draft.workouts) setWorkouts(draft.workouts);
          }
        }
      } catch { /* corrupt data — use defaults */ }
      isDraftLoaded.current = true;
    })();
  }, []);

  // Auto-save draft on every state change (create mode only)
  useEffect(() => {
    if (!isDraftLoaded.current || isEditMode) return;
    const draft: ProgramDraft = { step, name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts };
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
  }, [step, name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts, isEditMode]);

  // Intercept back navigation — prompt save or discard
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e: any) => {
      if (isLeavingIntentionally.current) return;

      if (isEditMode) {
        const orig = originalEdit.current;
        if (!orig) return;
        const hasChanges =
          name !== orig.name ||
          totalWeeks !== orig.totalWeeks ||
          cycleDays !== orig.cycleDays ||
          JSON.stringify(isTrainingDay) !== JSON.stringify(orig.isTrainingDay) ||
          JSON.stringify(cyclePattern) !== JSON.stringify(orig.cyclePattern) ||
          JSON.stringify(workouts) !== JSON.stringify(orig.workouts);
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
              AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
              navigation.dispatch(e.data.action);
            },
          },
          {
            text: "Save Draft",
            onPress: () => {
              isLeavingIntentionally.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, name, step, workouts, isEditMode, totalWeeks, cycleDays, isTrainingDay, cyclePattern]);

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
      const next: WorkoutMap = {};
      days.forEach((d: string) => { next[d] = prev[d] ?? []; });
      return next;
    });
    setStep(2);
  }, [cyclePattern, isTrainingDay]);

  const addExercise = useCallback((day: string, exName: string) => {
    setWorkouts(prev => ({
      ...prev,
      [day]: [...(prev[day] ?? []), { id: Date.now().toString(), name: exName, warmupSets: 0, workingSets: 3, reps: "8-12" }],
    }));
  }, []);

  const updateExercise = useCallback((day: string, id: string, field: keyof Exercise, value: string | number) => {
    setWorkouts(prev => ({
      ...prev,
      [day]: prev[day].map(e => e.id === id ? { ...e, [field]: value } : e),
    }));
  }, []);

  const removeExercise = useCallback((day: string, id: string) => {
    setWorkouts(prev => ({ ...prev, [day]: prev[day].filter(e => e.id !== id) }));
  }, []);

  const moveExercise = useCallback((day: string, id: string, dir: "up" | "down") => {
    setWorkouts(prev => {
      const arr = [...prev[day]];
      const idx = arr.findIndex(e => e.id === id);
      const target = dir === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= arr.length) return prev;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...prev, [day]: arr };
    });
  }, []);

  const deleteCustomExercise = useCallback((exName: string) => {
    const next = customExercises.filter(e => e.name !== exName);
    setCustomExercises(next);
    AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next)).catch(() => {});
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
    const today = new Date();
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const startDate = `${String(today.getDate()).padStart(2, "0")} ${months[today.getMonth()]} ${today.getFullYear()}`;

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
          updated = updated.map(p => ({
            ...p,
            status: p.id === newProgram.id ? "active" : p.status === "active" ? "paused" : p.status,
            currentWeek: p.id === newProgram.id ? 1 : p.currentWeek,
          })) as SavedProgram[];
        }
        await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
      } catch (e) {
        Alert.alert("Save failed", e instanceof Error ? e.message : String(e));
        return;
      }
      isLeavingIntentionally.current = true;
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
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
  }, [name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts, router, isEditMode, editId]);

  const handleBack = () => { if (step === 2) setStep(1); else router.back(); };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: t.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
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

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      >
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>{isEditMode ? "EDIT PROGRAM" : "NEW PROGRAM"}</Text>
          <View style={{ width: 66 }} />
        </View>

        <StepIndicator step={step} isDark={isDark} />

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
            onOpenPicker={day => setPickerState({ day })}
            onEditExercise={(day, id) => setPickerState({ day, replaceId: id })}
            onUpdateExercise={updateExercise}
            onRemoveExercise={removeExercise}
            onMoveExercise={moveExercise}
            isDark={isDark}
            onFinish={handleFinish}
            isEditMode={isEditMode}
          />
        )}
      </ScrollView>

      {/* Exercise picker — rendered above ScrollView so it's never clipped */}
      {pickerState !== null && (
        <ExercisePicker
          visible
          subtitle={dayLabel(pickerState.day).toUpperCase()}
          customExercises={customExercises}
          onSelect={exName => {
            if (pickerState.replaceId) {
              updateExercise(pickerState.day, pickerState.replaceId, "name", exName);
            } else {
              addExercise(pickerState.day, exName);
            }
            setPickerState(null);
          }}
          onCreateCustom={() => {
            pendingPickerDay.current = pickerState?.day ?? null;
            setPickerState(null);
            router.push("/create-custom-exercise");
          }}
          onDeleteCustom={deleteCustomExercise}
          onClose={() => setPickerState(null)}
          isDark={isDark}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:             { flex: 1 },
  backBtn:          { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  header:           { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 20 },
  screenTitle:      { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textAlign: "center", flex: 1 },

  // Step indicator
  stepIndicatorWrap: { marginBottom: 28, position: "relative" },
  stepLine:          { position: "absolute", left: "32%", right: "32%", top: 13, height: 2 },
  stepIndicatorRow:  { flexDirection: "row" },
  stepItem:          { flex: 1, alignItems: "center", gap: 6, zIndex: 1 },
  stepDot:           { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
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

  // Primary button
  primaryBtnWrap:   { borderRadius: 16, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  primaryBtn:       { borderRadius: 16, backgroundColor: ACCT, paddingVertical: 18, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  primaryBtnText:   { fontFamily: FontFamily.bold, fontSize: 16, color: "#FFFFFF", letterSpacing: 0.3 },

  // Step 2 — workout days
  dayHeading:       { fontFamily: FontFamily.bold, fontSize: 13, letterSpacing: 1.2, marginBottom: 8 },
  workoutDayCard:   { borderRadius: 16 },
  emptyHint:        { fontFamily: FontFamily.regular, fontSize: 14, paddingHorizontal: 16, paddingVertical: 16 },
  addExBtn:         { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 14 },
  addExText:        { fontFamily: FontFamily.semibold, fontSize: 14 },

  // Exercise row
  exRowWrap:        { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0 },
  exTopRow:           { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 10 },
  exArrows:           { flexDirection: "row", alignItems: "center", gap: 14 },
  exArrowPlaceholder: { width: 18, height: 18 },
  exNameBtn:        { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  exName:           { fontFamily: FontFamily.semibold, fontSize: 14, flexShrink: 1 },
  exBottomRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, marginBottom: 2 },
  exSetGroup:       { flex: 1, alignItems: "center", gap: 4 },
  exSetLabel:       { fontFamily: FontFamily.regular, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" },
  exMiniStepper:    { flexDirection: "row", alignItems: "center", gap: 6 },
  exSetCount:       { fontFamily: FontFamily.bold, fontSize: 16, minWidth: 20, textAlign: "center" },
  exSetDivider:     { width: 1, height: 36, marginHorizontal: 4 },
  exRepsInput:      { fontFamily: FontFamily.bold, fontSize: 16, minWidth: 44, textAlign: "center" },

});
