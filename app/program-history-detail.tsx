import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import FadeScreen from "../components/FadeScreen";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  getCurrentWeek,
  type SavedProgram,
  type CompletedWorkout,
} from "../constants/programs";
import { useTheme } from "../contexts/ThemeContext";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function parseStoredDate(dateStr: string): Date {
  const parts = dateStr.split(" ");
  const day = parseInt(parts[0], 10);
  const month = MONTH_NAMES.indexOf(parts[1]);
  const year = parseInt(parts[2], 10);
  return new Date(year, month < 0 ? 0 : month, day);
}

function formatWorkoutDate(completedIso: string, durationSeconds: number): string {
  const d = new Date(completedIso);
  const dateStr = `${DAY_FULL[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  const endTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (durationSeconds > 0) {
    const startTime = new Date(d.getTime() - durationSeconds * 1000)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    const mins = Math.floor(durationSeconds / 60);
    const dur = durationSeconds < 3600
      ? `${mins}m`
      : `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}m` : ""}`;
    return `${dateStr}  ·  ${startTime} – ${endTime}  ·  ${dur}`;
  }
  return `${dateStr}  ·  ${endTime}`;
}

function workoutsForProgram(prog: SavedProgram, history: CompletedWorkout[]): CompletedWorkout[] {
  const dayNames = new Set(
    Object.keys(prog.workouts)
      .map(k => k.split(":")[1])
      .filter(n => n && n.toLowerCase() !== "rest")
  );
  const start = parseStoredDate(prog.startDate);
  start.setHours(0, 0, 0, 0);
  const endMs = prog.status === "active"
    ? Date.now()
    : start.getTime() + prog.totalWeeks * 7 * 86400 * 1000;

  return history.filter(w => {
    if (!dayNames.has(w.workoutName)) return false;
    const d = new Date(w.date).getTime();
    return d >= start.getTime() && d <= endMs;
  });
}

function getWeekNumber(workoutDate: string, startDate: Date): number {
  const d = new Date(workoutDate);
  d.setHours(0, 0, 0, 0);
  const daysDiff = Math.floor((d.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.floor(daysDiff / 7) + 1;
}

const TP = APP_LIGHT.tp;
const TS = APP_LIGHT.ts;

export default function ProgramHistoryDetailScreen() {
  const router = useRouter();
  const { programId } = useLocalSearchParams<{ programId: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const [program, setProgram] = useState<SavedProgram | null>(null);
  const [history, setHistory] = useState<CompletedWorkout[]>([]);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(PROGRAMS_KEY)
        .then(raw => {
          if (!raw) return;
          const progs: SavedProgram[] = JSON.parse(raw);
          setProgram(progs.find(p => p.id === programId) ?? null);
        })
        .catch(() => {});
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY)
        .then(raw => { if (raw) setHistory(JSON.parse(raw)); })
        .catch(() => {});
    }, [programId])
  );

  const { weekSections, startDate } = useMemo(() => {
    if (!program) return { weekSections: [], startDate: new Date() };

    const start = parseStoredDate(program.startDate);
    start.setHours(0, 0, 0, 0);

    const matched = workoutsForProgram(program, history);
    const byWeek: Record<number, CompletedWorkout[]> = {};
    for (const w of matched) {
      const wk = Math.min(Math.max(getWeekNumber(w.date, start), 1), program.totalWeeks);
      if (!byWeek[wk]) byWeek[wk] = [];
      byWeek[wk].push(w);
    }
    // Sort each week's workouts oldest-first
    for (const wk of Object.keys(byWeek)) {
      byWeek[Number(wk)].sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
    }

    const currentWeek = getCurrentWeek(program);
    const sections: { week: number; workouts: CompletedWorkout[] }[] = [];
    for (let wk = 1; wk <= currentWeek; wk++) {
      sections.push({ week: wk, workouts: byWeek[wk] ?? [] });
    }
    // Show most recent week first
    sections.reverse();

    return { weekSections: sections, startDate: start };
  }, [program, history]);

  const totalLogged = weekSections.reduce((sum, s) => sum + s.workouts.length, 0);

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

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      >
        {/* Page header */}
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>
            {program?.name.toUpperCase() ?? ""}
          </Text>
          <View style={{ width: 66 }} />
        </View>

        {/* Summary row */}
        {program && (
          <NeuCard dark={isDark} style={styles.summaryCard}>
            <View style={styles.summaryInner}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: t.tp }]}>{getCurrentWeek(program)}</Text>
                <Text style={[styles.summaryLabel, { color: t.ts }]}>of {program.totalWeeks} weeks</Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: t.div }]} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: t.tp }]}>{totalLogged}</Text>
                <Text style={[styles.summaryLabel, { color: t.ts }]}>workouts</Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: t.div }]} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: t.tp }]}>{program.totalWeeks}</Text>
                <Text style={[styles.summaryLabel, { color: t.ts }]}>total weeks</Text>
              </View>
            </View>
          </NeuCard>
        )}

        {/* No program found */}
        {!program && (
          <NeuCard dark={isDark} style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>Program not found</Text>
            </View>
          </NeuCard>
        )}

        {/* Week sections */}
        {program && weekSections.map(({ week, workouts }) => (
          <View key={week} style={styles.weekSection}>
            <Text style={[styles.weekHeading, { color: t.tp }]}>Week {week}</Text>

            {workouts.length === 0 ? (
              <NeuCard dark={isDark} style={styles.emptyWeekCard}>
                <Text style={[styles.emptyWeekText, { color: t.ts }]}>No workouts logged this week</Text>
              </NeuCard>
            ) : (
              workouts.map(w => (
                <BounceButton
                  key={w.id}
                  style={styles.workoutWrap}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push({ pathname: "/workout-detail", params: { id: w.id } });
                  }}
                >
                  <NeuCard dark={isDark} style={styles.workoutCard}>
                    <View style={styles.workoutInner}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.workoutName, { color: t.tp }]}>{w.workoutName}</Text>
                        <Text style={[styles.workoutDate, { color: t.ts }]}>
                          {formatWorkoutDate(w.completedAt, w.durationSeconds)}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={t.ts} />
                    </View>
                  </NeuCard>
                </BounceButton>
              ))
            )}
          </View>
        ))}
      </ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scroll: { paddingHorizontal: 20 },

  header: { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 24 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textAlign: "center", flex: 1, color: TP },

  summaryCard: { borderRadius: 20, marginBottom: 28 },
  summaryInner: { flexDirection: "row", alignItems: "center", padding: 18 },
  summaryItem: { flex: 1, alignItems: "center", gap: 3 },
  summaryValue: { fontFamily: FontFamily.bold, fontSize: 22, color: TP },
  summaryLabel: { fontFamily: FontFamily.regular, fontSize: 12, color: TS, textAlign: "center" },
  summaryDivider: { width: 1, height: 36, marginHorizontal: 4 },

  emptyCard: { borderRadius: 24, marginBottom: 20 },
  emptyInner: { padding: 32, alignItems: "center" },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center" },

  weekSection: { marginBottom: 24 },
  weekHeading: { fontFamily: FontFamily.bold, fontSize: 16, color: TP, marginBottom: 10, letterSpacing: 0.3 },

  emptyWeekCard: { borderRadius: 16, marginBottom: 0 },
  emptyWeekText: { padding: 16, fontFamily: FontFamily.regular, fontSize: 14, color: TS, textAlign: "center" },

  workoutWrap: { marginBottom: 8 },
  workoutCard: { borderRadius: 16 },
  workoutInner: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  workoutName: { fontFamily: FontFamily.bold, fontSize: 15, color: TP },
  workoutDate: { fontFamily: FontFamily.regular, fontSize: 12, color: TS, marginTop: 2 },
});
