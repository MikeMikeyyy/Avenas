import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../components/NeuCard";
import FadeScreen from "../components/FadeScreen";
import TrashIcon from "../components/TrashIcon";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import {
  WORKOUT_HISTORY_KEY,
  WORKOUT_DATES_KEY,
  type CompletedWorkout,
  type CompletedExercise,
} from "../constants/programs";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_FULL    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (secs < 3600) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function formatWorkoutDate(completedIso: string, durationSeconds: number): string {
  const d = new Date(completedIso);
  const dateStr = `${DAY_FULL[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
  const endTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (durationSeconds > 0) {
    const startTime = new Date(d.getTime() - durationSeconds * 1000)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    return `${dateStr}  ·  ${startTime} – ${endTime}  ·  ${fmtDuration(durationSeconds)}`;
  }
  return `${dateStr}  ·  ${endTime}`;
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const { isKg } = useUnit();
  const insets = useSafeAreaInsets();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [workout, setWorkout] = useState<CompletedWorkout | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedExercises, setEditedExercises] = useState<CompletedExercise[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(WORKOUT_HISTORY_KEY).then(raw => {
      if (!raw) return;
      const history: CompletedWorkout[] = JSON.parse(raw);
      const found = history.find(w => w.id === id) ?? null;
      setWorkout(found);
      if (found) setEditedExercises(JSON.parse(JSON.stringify(found.exercises)));
    }).catch(() => {});
  }, [id]);

  const handleSave = async () => {
    if (!workout) return;
    const updated = { ...workout, exercises: editedExercises };
    const raw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
    const history: CompletedWorkout[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(
      WORKOUT_HISTORY_KEY,
      JSON.stringify(history.map(w => w.id === updated.id ? updated : w))
    );
    setWorkout(updated);
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (workout) setEditedExercises(JSON.parse(JSON.stringify(workout.exercises)));
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
            router.back();
          },
        },
      ]
    );
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

  const exercises = workout ? (isEditing ? editedExercises : workout.exercises) : [];
  const inputBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
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
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      {/* Action buttons */}
      <View style={{ position: "absolute", top: insets.top + 14, right: 20, zIndex: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
        {isEditing ? (
          <>
            <TouchableOpacity onPress={handleCancel} activeOpacity={0.7}>
              <View style={[styles.cancelBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
                <Text style={[styles.cancelBtnText, { color: t.tp }]}>Cancel</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} activeOpacity={0.8}>
              <View style={styles.updateBtn}>
                <Text style={styles.updateBtnText}>Update</Text>
              </View>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={() => setIsEditing(true)} activeOpacity={0.8}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView glassEffectStyle="regular" style={styles.actionBtn}>
                  <Ionicons name="create-outline" size={20} color={t.tp} />
                </GlassView>
              ) : (
                <View style={[styles.actionBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
                  <Ionicons name="create-outline" size={20} color={t.tp} />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} activeOpacity={0.8}>
              {isGlassEffectAPIAvailable() ? (
                <GlassView glassEffectStyle="regular" style={styles.actionBtn}>
                  <TrashIcon size={18} color={t.tp} />
                </GlassView>
              ) : (
                <View style={[styles.actionBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
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
        contentContainerStyle={{ paddingTop: insets.top + 70, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }}
      >
        {workout && (
          <>
            {/* Header */}
            <View style={{ marginBottom: 24 }}>
              <Text style={[styles.title, { color: t.tp }]}>{workout.workoutName}</Text>
              <Text style={[styles.meta, { color: t.ts }]}>{formatWorkoutDate(workout.completedAt, workout.durationSeconds)}</Text>
            </View>

            {/* Exercises */}
            {exercises.map((ex, ei) => {
              let wi = 0, si = 0;
              return (
                <NeuCard key={ei} dark={isDark} style={{ borderRadius: 20, marginBottom: 12 }}>
                  <View style={{ padding: 18 }}>
                    {isEditing ? (
                      <TextInput
                        style={[styles.exName, { color: t.tp, borderBottomWidth: 1, borderBottomColor: t.div, paddingBottom: 6, marginBottom: 12 }]}
                        value={ex.name}
                        onChangeText={name => updateExName(ei, name)}
                        returnKeyType="done"
                      />
                    ) : (
                      <Text style={[styles.exName, { color: t.tp, marginBottom: 12 }]}>{ex.name}</Text>
                    )}
                    <View style={{ gap: 8 }}>
                      {ex.sets.map((set, j) => {
                        const label = set.type === "warmup" ? `W${++wi}` : `${++si}`;
                        const wt = set.weight?.trim() || "—";
                        const r  = set.reps?.trim()   || "—";
                        return (
                          <View key={j} style={[styles.setRow, { opacity: set.done ? 1 : 0.35 }]}>
                            <View style={[styles.setLabel, {
                              backgroundColor: set.type === "warmup"
                                ? "rgba(255,191,15,0.12)"
                                : isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                            }]}>
                              <Text style={[styles.setLabelText, { color: set.type === "warmup" ? "#FFBF0F" : t.ts }]}>{label}</Text>
                            </View>
                            {isEditing ? (
                              <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 6 }}>
                                <TextInput
                                  style={[styles.editInput, { color: t.tp, backgroundColor: inputBg }]}
                                  value={set.weight}
                                  onChangeText={v => updateSet(ei, j, "weight", v)}
                                  keyboardType="decimal-pad"
                                  placeholder="—"
                                  placeholderTextColor={t.ts}
                                  returnKeyType="done"
                                />
                                <Text style={[styles.unit, { color: t.ts }]}>{isKg ? "kg" : "lbs"}</Text>
                                <Text style={[styles.unit, { color: t.ts, marginHorizontal: 2 }]}>×</Text>
                                <TextInput
                                  style={[styles.editInput, { color: t.tp, backgroundColor: inputBg }]}
                                  value={set.reps}
                                  onChangeText={v => updateSet(ei, j, "reps", v)}
                                  keyboardType="number-pad"
                                  placeholder="—"
                                  placeholderTextColor={t.ts}
                                  returnKeyType="done"
                                />
                                <Text style={[styles.unit, { color: t.ts }]}>reps</Text>
                              </View>
                            ) : (
                              <Text style={[styles.setValue, { color: t.tp }]}>
                                {wt}<Text style={{ color: t.ts }}> {isKg ? "kg" : "lbs"}</Text>
                                {"  ×  "}
                                {r}<Text style={{ color: t.ts }}> reps</Text>
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                    {ex.notes?.trim() ? (
                      <Text style={[styles.notes, { color: t.ts }]}>"{ex.notes.trim()}"</Text>
                    ) : null}
                  </View>
                </NeuCard>
              );
            })}
          </>
        )}
      </ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  actionBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },

  title:  { fontFamily: FontFamily.bold, fontSize: 26, marginBottom: 4 },
  meta:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },

  exName:       { fontFamily: FontFamily.semibold, fontSize: 15 },
  setRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  setLabel:     { width: 32, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  setLabelText: { fontFamily: FontFamily.semibold, fontSize: 11 },
  setValue:     { fontFamily: FontFamily.regular, fontSize: 14, flex: 1 },
  notes:        { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", paddingLeft: 4, paddingTop: 10 },

  cancelBtn:     { height: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  cancelBtnText: { fontFamily: FontFamily.semibold, fontSize: 14 },
  updateBtn:     { height: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.65, shadowRadius: 8 },
  updateBtnText: { fontFamily: FontFamily.bold, fontSize: 14, color: "#FFFFFF", letterSpacing: 0.3 },

  editInput: { fontFamily: FontFamily.regular, fontSize: 14, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, minWidth: 52, textAlign: "center" },
  unit:      { fontFamily: FontFamily.regular, fontSize: 13 },
});
