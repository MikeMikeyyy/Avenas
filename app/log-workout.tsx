import { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Animated, Easing, KeyboardAvoidingView,
  Platform, TouchableWithoutFeedback,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import FadeScreen from "../components/FadeScreen";
import TrashIcon from "../components/TrashIcon";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY,
  normaliseSets, type SavedProgram, type CompletedWorkout,
} from "../constants/programs";
import { useTheme } from "../contexts/ThemeContext";

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

type WorkingSet = { type: "warmup" | "working"; weight: string; reps: string; done: boolean };
type LogExercise = { id: string; name: string; sets: WorkingSet[]; notes: string };

function makeId(): string {
  return `lex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultSet(type: "warmup" | "working" = "working"): WorkingSet {
  return { type, weight: "", reps: "", done: true };
}

// ─── ExerciseCard ─────────────────────────────────────────────────────────────

function ExerciseCard({ ex, isDark, onUpdateSet, onToggleDone, onToggleType, onAddSet, onRemoveLastSet, onRemoveExercise }: {
  ex: LogExercise;
  isDark: boolean;
  onUpdateSet: (setIdx: number, field: "weight" | "reps", value: string) => void;
  onToggleDone: (setIdx: number) => void;
  onToggleType: (setIdx: number) => void;
  onAddSet: () => void;
  onRemoveLastSet: () => void;
  onRemoveExercise: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.1)" : t.div;
  let workingCounter = 0;

  return (
    <NeuCard dark={isDark} style={s.exCard}>
      <View style={s.exInner}>

        {/* Header */}
        <View style={s.exHeader}>
          <Text style={[s.exName, { color: t.tp }]} numberOfLines={1}>{ex.name}</Text>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRemoveExercise(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <TrashIcon size={18} color={t.ts} />
          </TouchableOpacity>
        </View>

        {/* Column headers */}
        <View style={[s.colHeaderRow, { borderBottomColor: divider }]}>
          <Text style={[s.colText, s.setCol, { color: t.ts }]}>SET</Text>
          <Text style={[s.colText, s.inputCol, { color: t.ts }]}>KG</Text>
          <Text style={[s.colText, s.inputCol, { color: t.ts }]}>REPS</Text>
          <View style={s.checkCol} />
        </View>

        {/* Set rows */}
        {ex.sets.map((set, idx) => {
          const isWU = set.type === "warmup";
          if (!isWU) workingCounter++;
          const label = isWU ? "WU" : String(workingCounter);
          return (
            <View key={idx} style={s.setRow}>
              {/* Type badge — tap to toggle warmup / working */}
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggleType(idx); }}
                style={[s.typeBadge, isWU
                  ? { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }
                  : { backgroundColor: isDark ? "rgba(29,236,160,0.15)" : "rgba(29,236,160,0.1)" }
                ]}
                activeOpacity={0.7}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <Text style={[s.typeBadgeText, { color: isWU ? t.ts : ACCT }]}>{label}</Text>
              </TouchableOpacity>

              {/* Weight */}
              <View style={[s.inputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderColor: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.07)" }]}>
                <TextInput
                  style={[s.inputText, { color: isDark ? "#fff" : t.tp }]}
                  keyboardType="decimal-pad"
                  value={set.weight}
                  onChangeText={v => onUpdateSet(idx, "weight", v)}
                  placeholder="—"
                  placeholderTextColor={`${t.tp}55`}
                />
              </View>

              {/* Reps */}
              <View style={[s.inputBox, { backgroundColor: isDark ? "#343759" : t.bg, borderColor: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.07)" }]}>
                <TextInput
                  style={[s.inputText, { color: isDark ? "#fff" : t.tp }]}
                  keyboardType="decimal-pad"
                  value={set.reps}
                  onChangeText={v => onUpdateSet(idx, "reps", v)}
                  placeholder="—"
                  placeholderTextColor={`${t.tp}55`}
                />
              </View>

              {/* Done checkbox */}
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(set.done ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium); onToggleDone(idx); }}
                style={s.checkWrap}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <View style={[s.checkCircle,
                  set.done
                    ? { backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }
                    : { backgroundColor: "transparent", borderWidth: 1.5, borderColor: isDark ? "rgba(255,255,255,0.5)" : t.ts }
                ]}>
                  {set.done && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Footer: remove last / add set */}
        <View style={[s.setFooter, { borderTopColor: divider }]}>
          {ex.sets.length > 1 && (
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRemoveLastSet(); }}
              style={[s.setFooterBtn, { borderColor: "rgba(255,77,79,0.3)" }]}
              activeOpacity={0.7}
            >
              <Ionicons name="remove" size={14} color="#FF4D4F" />
              <Text style={[s.setFooterText, { color: "#FF4D4F" }]}>Remove</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onAddSet(); }}
            style={[s.setFooterBtn, { flex: 1, borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.13)" }]}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={14} color={t.ts} />
            <Text style={[s.setFooterText, { color: t.ts }]}>Add Set</Text>
          </TouchableOpacity>
        </View>

      </View>
    </NeuCard>
  );
}

// ─── Add Exercise Sheet ───────────────────────────────────────────────────────

function AddExerciseSheet({ visible, isDark, onAdd, onClose }: {
  visible: boolean; isDark: boolean;
  onAdd: (name: string) => void; onClose: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [name, setName] = useState("");

  useEffect(() => {
    if (visible) {
      setName("");
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 400, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(400); backdropOpacity.setValue(0); onClose(); });
  }, [onClose]);

  const confirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    dismiss();
    onAdd(trimmed);
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)", opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismiss} />
        <Animated.View style={[s.addExSheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 8, transform: [{ translateY: slideY }] }]}>
          <View style={s.handleArea}><View style={s.handle} /></View>
          <Text style={[s.addExTitle, { color: t.tp }]}>Add Exercise</Text>
          <View style={{ paddingHorizontal: 20, paddingBottom: 16, gap: 16 }}>
            <TextInput
              style={[s.addExInput, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", color: t.tp, borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" }]}
              placeholder="Exercise name"
              placeholderTextColor={t.ts}
              value={name}
              onChangeText={setName}
              onSubmitEditing={confirm}
              returnKeyType="done"
              autoFocus
            />
            <BounceButton onPress={confirm}>
              <View style={[s.addExConfirm, !name.trim() && { opacity: 0.4 }]}>
                <Text style={s.addExConfirmText}>Add Exercise</Text>
              </View>
            </BounceButton>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
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
  const [addExVisible, setAddExVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load exercise template from program if programId provided
  useEffect(() => {
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
          sets: sets.map(ps => ({ type: ps.type, weight: ps.weightKg ?? "", reps: ps.reps ?? ps.repsMin ?? "", done: true })),
          notes: "",
        };
      });
      setExercises(loaded);
    }).catch(() => {});
  }, [programId, workoutName]);

  // ── Exercise mutations ──

  const updateSet = useCallback((exId: string, setIdx: number, field: "weight" | "reps", value: string) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const sets = ex.sets.map((s, i) => i === setIdx ? { ...s, [field]: value } : s);
      return { ...ex, sets };
    }));
  }, []);

  const toggleDone = useCallback((exId: string, setIdx: number) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const sets = ex.sets.map((s, i) => i === setIdx ? { ...s, done: !s.done } : s);
      return { ...ex, sets };
    }));
  }, []);

  const toggleType = useCallback((exId: string, setIdx: number) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exId) return ex;
      const sets = ex.sets.map((s, i) => i === setIdx ? { ...s, type: (s.type === "warmup" ? "working" : "warmup") as "warmup" | "working" } : s);
      return { ...ex, sets };
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setExercises(prev => prev.filter(ex => ex.id !== exId));
  }, []);

  const addExercise = useCallback((name: string) => {
    setExercises(prev => [...prev, {
      id: makeId(),
      name,
      sets: [defaultSet("working")],
      notes: "",
    }]);
  }, []);

  // ── Save ──

  const saveWorkout = async () => {
    if (saving) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const completed: CompletedWorkout = {
      id: `workout_${Date.now()}`,
      date: date ?? "",
      completedAt: new Date(`${date}T12:00:00`).toISOString(),
      workoutName: workoutName ?? "",
      durationSeconds: 0,
      exercises: exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets.map(s => ({ type: s.type, weight: s.weight, reps: s.reps, done: s.done })),
        notes: ex.notes,
      })),
    };

    try {
      // Prepend to history
      const histRaw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
      const history: CompletedWorkout[] = histRaw ? JSON.parse(histRaw) : [];
      await AsyncStorage.setItem(WORKOUT_HISTORY_KEY, JSON.stringify([completed, ...history]));

      // Add date to workout dates
      const datesRaw = await AsyncStorage.getItem(WORKOUT_DATES_KEY);
      const dates: string[] = datesRaw ? JSON.parse(datesRaw) : [];
      if (!dates.includes(date)) {
        await AsyncStorage.setItem(WORKOUT_DATES_KEY, JSON.stringify([...dates, date]));
      }

      // Add custom workout name to program if requested
      const addPid = addToProgramId && addToProgramId.length > 0 ? addToProgramId : null;
      if (addPid && workoutName) {
        const progsRaw = await AsyncStorage.getItem(PROGRAMS_KEY);
        const progs: SavedProgram[] = progsRaw ? JSON.parse(progsRaw) : [];
        const updated = progs.map(p => {
          if (p.id !== addPid) return p;
          const extras = p.extraWorkouts ?? [];
          if (extras.includes(workoutName)) return p;
          return { ...p, extraWorkouts: [...extras, workoutName] };
        });
        await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
      }
    } catch (_) {}

    router.back();
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

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 120 }]}
        >
          {/* Page header */}
          <View style={s.pageHeader}>
            <Text style={[s.workoutTitle, { color: t.tp }]}>{workoutName}</Text>
            <Text style={[s.dateLabel, { color: t.ts }]}>{dateLabel}</Text>
          </View>

          {/* Exercise cards */}
          {exercises.map(ex => (
            <ExerciseCard
              key={ex.id}
              ex={ex}
              isDark={isDark}
              onUpdateSet={(setIdx, field, value) => updateSet(ex.id, setIdx, field, value)}
              onToggleDone={setIdx => toggleDone(ex.id, setIdx)}
              onToggleType={setIdx => toggleType(ex.id, setIdx)}
              onAddSet={() => addSet(ex.id)}
              onRemoveLastSet={() => removeLastSet(ex.id)}
              onRemoveExercise={() => removeExercise(ex.id)}
            />
          ))}

          {/* Add Exercise */}
          <BounceButton onPress={() => setAddExVisible(true)}>
            <View style={[s.addExBtn, { borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.13)" }]}>
              <Ionicons name="add-circle-outline" size={18} color={t.ts} />
              <Text style={[s.addExBtnText, { color: t.ts }]}>Add Exercise</Text>
            </View>
          </BounceButton>
        </ScrollView>

        {/* Save button pinned above bottom */}
        <View style={[s.saveRow, { paddingBottom: insets.bottom + 16, backgroundColor: t.bg }]}>
          <BounceButton onPress={saveWorkout} style={{ flex: 1 }}>
            <View style={[s.saveBtn, saving && { opacity: 0.6 }]}>
              <Text style={s.saveBtnText}>Save Workout</Text>
            </View>
          </BounceButton>
        </View>
      </KeyboardAvoidingView>

      <AddExerciseSheet
        visible={addExVisible}
        isDark={isDark}
        onAdd={addExercise}
        onClose={() => setAddExVisible(false)}
      />
    </FadeScreen>
  );
}

const s = StyleSheet.create({
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 5 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scroll:      { paddingHorizontal: 20 },

  pageHeader:    { marginBottom: 28 },
  workoutTitle:  { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 0.2 },
  dateLabel:     { fontFamily: FontFamily.regular, fontSize: 15, marginTop: 4 },

  // Exercise card
  exCard:      { marginBottom: 20, borderRadius: 20 },
  exInner:     { padding: 16 },
  exHeader:    { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  exName:      { fontFamily: FontFamily.bold, fontSize: 18, flex: 1 },

  // Column headers
  colHeaderRow:  { flexDirection: "row", alignItems: "center", paddingBottom: 8, marginBottom: 4, borderBottomWidth: 1 },
  colText:       { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.5, textAlign: "center" },
  setCol:        { width: 40 },
  inputCol:      { flex: 1 },
  checkCol:      { width: 32 },

  // Set rows
  setRow:        { flexDirection: "row", alignItems: "center", height: 52, gap: 6 },
  typeBadge:     { width: 36, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  typeBadgeText: { fontFamily: FontFamily.bold, fontSize: 11 },
  inputBox:      { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, justifyContent: "center" },
  inputText:     { fontFamily: FontFamily.bold, fontSize: 15, textAlign: "center", paddingVertical: 0 },
  checkWrap:     { width: 32, alignItems: "center", justifyContent: "center" },
  checkCircle:   { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  // Set footer
  setFooter:     { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  setFooterBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                   paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderStyle: "dashed" },
  setFooterText: { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Add exercise button
  addExBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  paddingVertical: 16, borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", marginBottom: 12 },
  addExBtnText: { fontFamily: FontFamily.semibold, fontSize: 14 },

  // Save bar
  saveRow:  { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(128,128,128,0.15)" },
  saveBtn:  { borderRadius: 16, paddingVertical: 16, alignItems: "center", backgroundColor: ACCT,
              shadowColor: ACCT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
  saveBtnText: { fontFamily: FontFamily.bold, fontSize: 17, color: "#fff" },

  // Add exercise sheet
  addExSheet:      { borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handleArea:      { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  handle:          { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  addExTitle:      { fontFamily: FontFamily.bold, fontSize: 20, paddingHorizontal: 20, paddingBottom: 12 },
  addExInput:      { fontFamily: FontFamily.regular, fontSize: 16, borderWidth: 1, borderRadius: 12,
                     paddingHorizontal: 16, paddingVertical: 13 },
  addExConfirm:    { borderRadius: 14, paddingVertical: 15, alignItems: "center", backgroundColor: ACCT,
                     shadowColor: ACCT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
  addExConfirmText:{ fontFamily: FontFamily.bold, fontSize: 16, color: "#fff" },
});
