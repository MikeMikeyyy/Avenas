import { useState, useCallback, useRef, useMemo, Fragment } from "react";
import { View, Text, StyleSheet, Image, Animated } from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Circle, Defs, Filter, FeGaussianBlur } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../../components/NeuCard";
import FlameIcon from "../../components/FlameIcon";
import FadeScreen from "../../components/FadeScreen";
import { APP_LIGHT, APP_DARK, NEU_BG, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../../constants/theme";
import BounceButton from "../../components/BounceButton";
import { useTheme } from "../../contexts/ThemeContext";
import { useStreak } from "../../contexts/StreakContext";
import { useWorkoutTimer } from "../../contexts/WorkoutTimerContext";
import { useUnit } from "../../contexts/UnitContext";
import {
  STREAK_TIERS,
  FLAME_PREF_KEY,
  MAX_TIER_DAYS,
  getTier,
} from "../../constants/streakTiers";
import { PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, SavedProgram, CompletedWorkout, getCurrentWeek } from "../../constants/programs";
import ActivityCalendar from "../../components/ActivityCalendar";

const AVATAR_BG = "#ffffffff"; // change this to restyle the settings button independently

const RING_SIZE          = 110;
const RING_STROKE        = 5;
const RING_RADIUS        = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_GLOW_PAD      = 12;
const SVG_SIZE           = RING_SIZE + RING_GLOW_PAD * 2;
const RING_CENTER        = SVG_SIZE / 2;

function formatVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}k`;
  return Math.round(kg).toString();
}

const REST_DAY_QUOTES = [
  "Recovery is where the gains are actually made.",
  "Your muscles grow while you rest, not while you lift.",
  "Champions are built on rest days too.",
  "Rest is not weakness, it's part of the work.",
  "Sleep, eat, recover. Tomorrow you come back stronger.",
  "Even the best athletes in the world take rest days.",
  "Today your body is quietly doing its best work.",
  "Consistency over time beats intensity without recovery.",
  "A rested body lifts heavier than a tired one.",
  "Growth happens in the quiet moments between the grind.",
  "You earned this. Recover well.",
  "Progress doesn't pause on rest days, it accelerates.",
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_ABBR       = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getOrdinal(n: number): string {
  const s = ["th","st","nd","rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function formatTodayDate(): string {
  const now = new Date();
  return `${DAY_ABBR[now.getDay()]} ${getOrdinal(now.getDate())} ${FULL_MONTHS[now.getMonth()]}`;
}

function parseStoredDate(dateStr: string): Date {
  // Format: "09 Apr 2026"
  const parts = dateStr.split(" ");
  const day = parseInt(parts[0], 10);
  const month = MONTH_NAMES.indexOf(parts[1]);
  const year = parseInt(parts[2], 10);
  return new Date(year, month < 0 ? 0 : month, day);
}

function getTodaysWorkout(program: SavedProgram): { name: string; exerciseCount: number } | null {
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
  return { name: dayName, exerciseCount: exercises.length };
}


function getWorkoutForDate(program: SavedProgram, date: Date): string | null {
  const start = parseStoredDate(program.startDate);
  start.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const daysPassed = Math.floor((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (daysPassed < 0) return null;
  const dayIndex = (((daysPassed + (program.cycleOffset ?? 0)) % program.cycleDays) + program.cycleDays) % program.cycleDays;
  const dayName = program.cyclePattern[dayIndex];
  if (!dayName || dayName === "Rest") return null;
  return dayName;
}

// Static colours for StyleSheet (must be literals, not dynamic theme values)
const TP   = APP_LIGHT.tp;
const TS   = APP_LIGHT.ts;
const ICON = APP_LIGHT.icon;

type QuickAction = {
  id: string;
  label: string;
  route?: string;
  renderIcon: (c: string) => React.ReactElement;
};

const QUICK_ACTIONS: QuickAction[] = [
  { id: "log",      label: "New\nProgram",  route: "/new-program", renderIcon: (c: string) => <Ionicons name="add-outline" size={26} color={c} /> },
  { id: "programs", label: "My\nPrograms",  route: "/programs", renderIcon: (c: string) => <Ionicons name="list-outline" size={22} color={c} /> },
  { id: "journal",  label: "View\nJournal", route: "/journal",  renderIcon: (c: string) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9 7h6M9 11h4" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  ) },
];

const MONTH_SHORT_J = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_FULL_J    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (secs < 3600) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function ordinal(n: number): string {
  if (n === 11 || n === 12 || n === 13) return `${n}th`;
  const mod = n % 10;
  if (mod === 1) return `${n}st`;
  if (mod === 2) return `${n}nd`;
  if (mod === 3) return `${n}rd`;
  return `${n}th`;
}

function formatWorkoutDate(completedIso: string, durationSeconds: number): string {
  const d = new Date(completedIso);
  const dateStr = `${DAY_FULL_J[d.getDay()]} ${d.getDate()} ${MONTH_SHORT_J[d.getMonth()]}`;
  const endTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (durationSeconds > 0) {
    const startTime = new Date(d.getTime() - durationSeconds * 1000)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    return `${dateStr}  ·  ${startTime} – ${endTime}  ·  ${fmtDuration(durationSeconds)}`;
  }
  return `${dateStr}  ·  ${endTime}`;
}

function SessionTrack({ current, total, accent, track }: {
  current: number; total: number; accent: string; track: string;
}) {
  if (total <= 12) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {Array.from({ length: total }).map((_, i) => {
          const isCurrent = i === current - 1;
          const isFuture  = i > current - 1;
          const isDone    = i < current - 1;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <View style={{
                  flex: 1, height: 2,
                  backgroundColor: isFuture ? track : accent,
                  shadowColor: isFuture ? "transparent" : accent,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: isFuture ? 0 : 0.7,
                  shadowRadius: 2,
                }} />
              )}
              <View style={{
                width: isCurrent ? 9 : 7, height: isCurrent ? 9 : 7, borderRadius: 999,
                backgroundColor: isFuture ? "transparent" : accent,
                borderWidth: isFuture ? 1.5 : 0, borderColor: track,
                shadowColor: isFuture ? "transparent" : accent,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: isCurrent ? 0.95 : isDone ? 0.55 : 0,
                shadowRadius: isCurrent ? 3 : 2,
              }} />
            </Fragment>
          );
        })}
      </View>
    );
  }
  const pct = Math.min(1, current / total);
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: track, overflow: "hidden" }}>
      <View style={{
        width: `${Math.round(pct * 100)}%`, height: "100%", backgroundColor: accent, borderRadius: 2,
        shadowColor: accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6,
      }} />
    </View>
  );
}

function fmtElapsed(secs: number): string {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

function StartButton() {
  const { isDark } = useTheme();
  const router = useRouter();
  const { isRunning, elapsedSeconds, startTimer } = useWorkoutTimer();
  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const contentColor = isDark ? APP_DARK.bg : "#fff";
  const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!isRunning) startTimer();
    router.push("/(tabs)/workout");
  };

  const arrow = (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M14.4302 5.92969L20.5002 11.9997L14.4302 18.0697" stroke={contentColor} strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3.5 12H20.33" stroke={contentColor} strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );

  return (
    <BounceButton onPress={handlePress}>
      <View style={[styles.startBtnDark, { backgroundColor: btnBg, shadowColor: btnShadow }]}>
        <View style={[styles.startBtn, { backgroundColor: btnBg }]}>
          {isRunning ? (
            <View style={styles.startBtnContent}>
              <Text style={[styles.continueTimer, { color: contentColor }]}>{fmtElapsed(elapsedSeconds)}</Text>
              <View style={[styles.continueDivider, { backgroundColor: contentColor }]} />
              <Text style={[styles.startBtnText, { color: contentColor }]}>Continue Workout</Text>
              {arrow}
            </View>
          ) : (
            <View style={styles.startBtnContent}>
              <Text style={[styles.startBtnText, { color: contentColor }]}>Start Workout</Text>
              {arrow}
            </View>
          )}
        </View>
      </View>
    </BounceButton>
  );
}



export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  const { streakDays } = useStreak();
  const isMax = streakDays >= MAX_TIER_DAYS;
  const { isRunning } = useWorkoutTimer();
  const { isKg } = useUnit();
  const [flameName, setFlameName] = useState<string | null>(null);
  const [activeProgram, setActiveProgram] = useState<SavedProgram | null>(null);
  const [workoutDates, setWorkoutDates] = useState<string[]>([]);
  const [workoutHistory, setWorkoutHistory] = useState<CompletedWorkout[]>([]);
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const scrollY = useRef(new Animated.Value(0)).current;

  // Re-read the preference and active program every time this screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (isMax) {
        AsyncStorage.getItem(FLAME_PREF_KEY)
          .then((saved: string | null) => { if (saved) setFlameName(saved); })
          .catch(() => {});
      }
      AsyncStorage.getItem(PROGRAMS_KEY)
        .then((raw) => {
          if (!raw) return;
          const progs: SavedProgram[] = JSON.parse(raw);
          setPrograms(progs);
          setActiveProgram(progs.find((p) => p.status === "active") ?? null);
        })
        .catch(() => {});
      AsyncStorage.getItem(WORKOUT_DATES_KEY)
        .then((raw) => { if (raw) setWorkoutDates(JSON.parse(raw)); })
        .catch(() => {});
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY)
        .then((raw) => { if (raw) setWorkoutHistory(JSON.parse(raw)); })
        .catch(() => {});
    }, [isMax])
  );

  const restDayQuote = useMemo(() => {
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    return REST_DAY_QUOTES[seed % REST_DAY_QUOTES.length];
  }, []);

  const programLookup = useMemo(() => {
    const map: Record<string, { programName: string; totalSessions: number }> = {};
    const sorted = [...programs].sort((a, b) => a.status === "active" ? -1 : b.status === "active" ? 1 : 0);
    for (const prog of sorted) {
      for (const name of prog.cyclePattern) {
        if (!name || name.toLowerCase() === "rest" || map[name]) continue;
        const perCycle = prog.cyclePattern.filter(n => n === name).length;
        const totalCycles = Math.ceil(prog.totalWeeks * 7 / prog.cycleDays);
        map[name] = { programName: prog.name, totalSessions: perCycle * totalCycles };
      }
    }
    return map;
  }, [programs]);

  const sessionNumbers = useMemo(() => {
    const result: Record<string, number> = {};
    const byName: Record<string, CompletedWorkout[]> = {};
    for (const w of workoutHistory) {
      if (!byName[w.workoutName]) byName[w.workoutName] = [];
      byName[w.workoutName].push(w);
    }
    for (const group of Object.values(byName)) {
      group.sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
      group.forEach((w, i) => { result[w.id] = i + 1; });
    }
    return result;
  }, [workoutHistory]);

  const recentWorkouts = useMemo(() =>
    [...workoutHistory].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()).slice(0, 5),
    [workoutHistory]
  );

  const weeklyStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);

    const mondayStr = toYMD(weekStart);
    const todayStr  = toYMD(today);
    const completedThisWeek = workoutHistory.filter(w => w.date >= mondayStr && w.date <= todayStr);
    const completedCount    = completedThisWeek.length;
    const completedDates    = new Set(completedThisWeek.map(w => w.date));

    let plannedCount = 0;
    if (activeProgram) {
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        if (getWorkoutForDate(activeProgram, d) !== null) plannedCount++;
      }
    }

    const totalMinutes = Math.round(
      completedThisWeek.reduce((sum, w) => sum + w.durationSeconds, 0) / 60
    );
    const totalVolumeKg = completedThisWeek.reduce((sum, w) =>
      sum + w.exercises.reduce((es, ex) =>
        es + ex.sets.reduce((ss, s) =>
          ss + (s.type === "working" && s.done ? (parseFloat(s.weight) || 0) * (parseFloat(s.reps) || 0) : 0), 0), 0), 0);

    type WeekDay = { date: Date; label: string; workoutName: string; completed: boolean; isToday: boolean; isRest: boolean };
    const weekDays: WeekDay[] = [];
    if (activeProgram) {
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const name = getWorkoutForDate(activeProgram, d);
        const dateStr = toYMD(d);
        weekDays.push({
          date: d,
          label: SHORT_DAY_NAMES[d.getDay()],
          workoutName: name ?? "Rest",
          completed: name !== null && completedDates.has(dateStr),
          isToday: dateStr === todayStr,
          isRest: name === null,
        });
      }
    }

    return { completedCount, plannedCount, totalMinutes, totalVolumeKg, weekDays };
  }, [workoutHistory, activeProgram]);

  const activeColor = (isMax && flameName
    ? STREAK_TIERS.find(t2 => t2.name === flameName)?.color
    : null) ?? getTier(streakDays).color;

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Gradient blur — sits behind all header elements. Blur is strongest at the top (opaque mask) and fades to nothing at the bottom (transparent mask). Content scrolling into this zone blurs out naturally. */}
      <Animated.View
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
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 50, paddingBottom: insets.bottom + 120 }]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        <View style={styles.header}>
          <Text style={[styles.name, { color: t.tp }]}>{greeting}</Text>
          <Text style={[styles.todayDate, { color: t.ts, marginTop: 4 }]}>{formatTodayDate()}</Text>
        </View>

        {(() => {
          const todaysWorkout = activeProgram ? getTodaysWorkout(activeProgram) : null;
          return (
            <NeuCard dark={isDark} style={styles.workoutCard}>
    <View style={styles.workoutCardInner}>
                <Text style={[styles.sectionLabel, { color: t.ts }]}>TODAY'S WORKOUT</Text>
                {todaysWorkout ? (
                  <>
                    <Text style={[styles.workoutName, { color: t.tp }]}>{todaysWorkout.name.toUpperCase()}</Text>
                    <View style={[styles.metaRow, { marginTop: -10 }]}>
                      <View style={styles.metaItem}>
                        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                          <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={t.ts} strokeWidth="1.5" />
                          <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={t.ts} strokeWidth="1.5" />
                          <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={t.ts} strokeWidth="1.5" />
                        </Svg>
                        <Text style={[styles.metaText, { color: t.ts }]}>{todaysWorkout.exerciseCount} exercise{todaysWorkout.exerciseCount !== 1 ? "s" : ""}</Text>
                      </View>
                    </View>
                    <StartButton />
                  </>
                ) : isRunning ? (
                  <>
                    <Text style={[styles.workoutName, { color: t.tp }]}>WORKOUT IN PROGRESS</Text>
                    <StartButton />
                  </>
                ) : activeProgram ? (
                  <>
                    <Text style={[styles.workoutName, { color: t.tp }]}>REST DAY</Text>
                    <Text style={[styles.metaText, { color: t.ts, fontStyle: "italic", marginTop: -8 }]}>{restDayQuote}</Text>
                  </>
                ) : (
                  <Text style={[styles.metaText, { color: t.ts }]}>No active program. Set one in My Programs.</Text>
                )}
              </View>
            </NeuCard>
          );
        })()}

        {activeProgram && (
          <NeuCard dark={isDark} style={styles.programCard}>
            <View style={styles.programCardInner}>
              <View style={styles.programHeader}>
                <View>
                  <Text style={[styles.sectionLabel, { color: t.ts }]}>ACTIVE PROGRAM</Text>
                  <Text style={[styles.programName, { color: t.tp }]}>{activeProgram.name.toUpperCase()}</Text>
                </View>
                <Text style={[styles.programWeek, { color: t.ts }]}>Week {getCurrentWeek(activeProgram)} of {activeProgram.totalWeeks}</Text>
              </View>
              <View style={styles.progressRow}>
                {Array.from({ length: activeProgram.totalWeeks }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.progressSegment,
                      { backgroundColor: i < getCurrentWeek(activeProgram) ? ACCT : isDark ? "rgba(255,255,255,0.1)" : t.div },
                      i < getCurrentWeek(activeProgram) && { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 },
                    ]}
                  />
                ))}
              </View>
            </View>
          </NeuCard>
        )}

        <View style={styles.quickRow}>
          {QUICK_ACTIONS.map((a) => (
            <View key={a.id} style={{ flex: 1 }}>
              <NeuCard dark={isDark} style={styles.quickCard}>
                <View style={styles.quickInner}>
                  <BounceButton
                    onPress={a.route !== undefined ? () => router.push(a.route as Parameters<typeof router.push>[0]) : undefined}
                    accessibilityLabel={a.label.replace("\n", " ")}
                    accessibilityRole="button"
                  >
                    <NeuCard dark={isDark} radius={28} style={styles.quickIcon}>
                      <View style={styles.quickIconInner}>
                        {a.renderIcon(t.icon)}
                      </View>
                    </NeuCard>
                  </BounceButton>
                  <Text style={[styles.quickLabel, { color: t.ts }]}>{a.label}</Text>
                </View>
              </NeuCard>
            </View>
          ))}
        </View>

        <ActivityCalendar isDark={isDark} workoutDates={workoutDates} activeProgram={activeProgram} />

        <Text style={[styles.sectionTitle, { color: t.tp, marginTop: 16 }]}>This Week</Text>
        <View style={styles.weekRow}>
          {/* Left card: stats + all workout days */}
          <View style={{ flex: 1 }}>
          <NeuCard dark={isDark} fill style={styles.weekStatCard}>
            {weeklyStats.weekDays.map((day, i) => (
              <View key={toYMD(day.date)} style={[styles.weekDayRow, i === 0 && { paddingTop: 12 }, i === 6 && { paddingBottom: 12 }]}>
                <Text style={[styles.weekDayLabel, { color: day.isToday ? t.tp : t.ts, fontFamily: day.isToday ? FontFamily.bold : FontFamily.semibold }]}>
                  {day.label}
                </Text>
                <Text style={[styles.weekDayName, { color: day.isRest ? t.ts : day.completed ? t.ts : t.tp, opacity: day.isRest ? 0.4 : day.completed ? 0.4 : 1 }]}>
                  {day.workoutName}
                </Text>
                {day.completed
                  ? <Ionicons name="checkmark-circle" size={14} color={ACCT} />
                  : day.isToday && !day.isRest && <View style={[styles.weekTodayDot, { backgroundColor: ACCT }]} />}
              </View>
            ))}
          </NeuCard>
          </View>

          {/* Right card: circular progress */}
          <View style={{ flex: 1 }}>
          <NeuCard dark={isDark} fill style={styles.weekCircleCard}>
            <View style={styles.weekCircleCardInner}>
              <Text style={[styles.weekCircleLabelTop, { color: t.ts }]}>Workouts This Week</Text>
              <View style={styles.weekCircleWrap}>
                <Svg width={SVG_SIZE} height={SVG_SIZE} style={{ transform: [{ rotate: "-90deg" }] }}>
                  <Defs>
                    <Filter id="ringGlow" x="-40%" y="-40%" width="180%" height="180%">
                      <FeGaussianBlur in="SourceGraphic" stdDeviation="3.5" />
                    </Filter>
                  </Defs>
                  <Circle
                    cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS}
                    stroke={t.ts} strokeWidth={RING_STROKE} fill="none"
                    opacity={0.18}
                  />
                  {activeProgram && weeklyStats.plannedCount > 0 && weeklyStats.completedCount > 0 && (() => {
                    const offset = RING_CIRCUMFERENCE * (1 - Math.min(1, weeklyStats.completedCount / weeklyStats.plannedCount));
                    return (
                      <>
                        <Circle
                          cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS}
                          stroke={ACCT} strokeWidth={RING_STROKE} fill="none"
                          strokeDasharray={RING_CIRCUMFERENCE}
                          strokeDashoffset={offset}
                          strokeLinecap="round"
                          filter="url(#ringGlow)"
                          opacity={0.9}
                        />
                        <Circle
                          cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS}
                          stroke={ACCT} strokeWidth={RING_STROKE} fill="none"
                          strokeDasharray={RING_CIRCUMFERENCE}
                          strokeDashoffset={offset}
                          strokeLinecap="round"
                        />
                      </>
                    );
                  })()}
                </Svg>
                <View style={styles.weekCircleCenter}>
                  <Text style={[styles.weekCircleCount, { color: t.tp }]}>
                    {activeProgram
                      ? `${weeklyStats.completedCount}/${weeklyStats.plannedCount}`
                      : String(weeklyStats.completedCount)}
                  </Text>
                </View>
              </View>
              <View style={styles.weekStatGrid}>
                <View style={styles.weekStatItem}>
                  <Text style={[styles.weekStatValue, { color: t.tp }]}>{weeklyStats.totalMinutes}</Text>
                  <Text style={[styles.weekStatLabel, { color: t.ts }]}>Total Mins</Text>
                </View>
                <View style={[styles.weekStatVDivider, { backgroundColor: t.div }]} />
                <View style={styles.weekStatItem}>
                  <Text style={[styles.weekStatValue, { color: t.tp }]}>{formatVolume(weeklyStats.totalVolumeKg)}</Text>
                  <Text style={[styles.weekStatLabel, { color: t.ts }]}>{isKg ? "kg Lifted" : "Lbs Lifted"}</Text>
                </View>
              </View>
            </View>
          </NeuCard>
          </View>
        </View>

        {recentWorkouts.length > 0 && (
          <Text style={[styles.sectionTitle, { color: t.tp }]}>Recent Activity</Text>
        )}

        {recentWorkouts.map((w) => {
          const progInfo   = programLookup[w.workoutName] ?? null;
          const sessionNum = sessionNumbers[w.id] ?? 1;
          return (
            <BounceButton key={w.id} style={{ marginBottom: 12 }} onPress={() => router.push({ pathname: "/workout-detail", params: { id: w.id } })}>
              <NeuCard dark={isDark} style={[styles.activityCard, { marginBottom: 0 }]}>
                <View style={styles.workoutCardInner}>
                  <View style={styles.workoutTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.activityName, { color: t.tp }]}>{w.workoutName}</Text>
                      <Text style={[styles.activitySub, { color: t.ts }]}>{formatWorkoutDate(w.completedAt, w.durationSeconds)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={t.ts} />
                  </View>
                  {progInfo && (
                    <View style={styles.workoutProgRow}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                        <Text style={[styles.workoutProgName, { color: t.tp }]}>{progInfo.programName.toUpperCase()}</Text>
                        <Text style={[styles.workoutProgSession, { color: t.tp }]}>{ordinal(sessionNum)} session</Text>
                      </View>
                      <SessionTrack
                        current={sessionNum}
                        total={progInfo.totalSessions}
                        accent={ACCT}
                        track={isDark ? "rgba(255,255,255,0.1)" : t.div}
                      />
                    </View>
                  )}
                </View>
              </NeuCard>
            </BounceButton>
          );
        })}
      </Animated.ScrollView>

      {/* AV logo — fixed in top bar */}
      <Image source={require("../../assets/images/logo.png")} style={[styles.logo, { position: "absolute", top: insets.top, left: 20, zIndex: 10 }]} resizeMode="contain" />

      {/* Streak badge — fixed, always visible */}
      <View style={[styles.streakFloat, { top: insets.top + 6 }]}>
        <BounceButton onPress={() => router.push("/streak")}>
          <View style={styles.streakBadge}>
            <FlameIcon size={36} color={activeColor} />
            <Text style={[styles.streakBadgeText, { color: t.ts }]}>{streakDays}</Text>
          </View>
        </BounceButton>
      </View>

      <BounceButton style={[styles.avatar, { top: insets.top, right: 20 }]} onPress={() => router.push("/settings")}>
        <View style={[styles.avatarHighlight, { shadowColor: isDark ? "#4d5363" : "#FFFFFF" }]}>
          <View style={[styles.avatarShadow, { shadowColor: isDark ? "#4d5363" : "#a3afc0" }]}>
            <BlurView intensity={90} tint="extraLight" style={styles.avatarBorder}>
              <View style={styles.avatarInner}>
                <Text style={styles.avatarText}>MB</Text>
              </View>
            </BlurView>
          </View>
        </View>
      </BounceButton>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NEU_BG },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "column", marginBottom: 20 },
  greeting: { fontFamily: FontFamily.regular, fontSize: 16, color: TS },
  name: { fontFamily: FontFamily.bold, fontSize: 28, color: TP, marginTop: 2 },
  logo: { width: 56, height: 56, marginBottom: 20 },
  avatar: { position: "absolute", zIndex: 10 },
  avatarHighlight: { borderRadius: 24, backgroundColor: AVATAR_BG, shadowColor: "#FFFFFF", shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.9, shadowRadius: 6 },
  avatarShadow: { borderRadius: 24, backgroundColor: AVATAR_BG, shadowColor: "#a3afc0", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.7, shadowRadius: 7 },
  avatarBorder: { width: 48, height: 48, borderRadius: 24, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarInner: { width: 44, height: 44, borderRadius: 22, backgroundColor: AVATAR_BG, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 16, color: ICON },
  topSolid:    { position: "absolute", top: 0, left: 0, right: 0, zIndex: 5 },
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  todayFloat:  { position: "absolute", left: 0, right: 0, zIndex: 9, alignItems: "center" },
  todayLabel:  { fontFamily: FontFamily.bold, fontSize: 17, color: TP },
  todayDate:   { fontFamily: FontFamily.regular, fontSize: 17, color: TS, marginTop: 1 },
  streakFloat:     { position: "absolute", right: 80, zIndex: 10 },
  streakBadge:     { flexDirection: "row", alignItems: "center", gap: 2 },
  streakBadgeText: { fontFamily: FontFamily.semibold, fontSize: 18, color: TS },
  streakDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: TS, opacity: 0.4 },
  workoutCard: { marginBottom: 20, borderRadius: 24 },
  workoutCardInner: { padding: 20, gap: 18 },
  workoutRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 13, color: TS, letterSpacing: 1.2, textTransform: "uppercase" },
  badge: { borderRadius: 10 },
  badgeText: { fontFamily: FontFamily.semibold, fontSize: 12, color: ICON, paddingHorizontal: 10, paddingVertical: 5 },
  workoutName: { fontFamily: FontFamily.bold, fontSize: 23, color: TP },
  metaRow: { flexDirection: "row", gap: 20 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: FontFamily.regular, fontSize: 14, color: TS },
  startBtnDark: { borderRadius: 16, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  startBtn: { borderRadius: 16, backgroundColor: ACCT, paddingVertical: 16, justifyContent: "center", overflow: "hidden" },
  startBtnContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  startBtnText: { fontFamily: FontFamily.bold, fontSize: 16, color: "#FFFFFF", letterSpacing: 0.3 },
  continueTimer: { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 0.3, opacity: 0.7 },
  continueDivider: { width: 1, height: 16, opacity: 0.4 },
  quickRow: { flexDirection: "row", gap: 12, marginBottom: 28 },
  quickCard: { borderRadius: 20 },
  quickInner: { alignItems: "center", paddingVertical: 18, paddingHorizontal: 8, gap: 10 },
  quickIcon: { width: 56, height: 56, borderRadius: 28 },
  quickIconInner: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, textAlign: "center", lineHeight: 18 },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 18, color: TP, marginBottom: 12 },
  weekRow:             { flexDirection: "row", gap: 12, marginBottom: 28 },
  weekStatCard:        { borderRadius: 20 },
  weekStatGrid:        { flexDirection: "row", alignItems: "center" },
  weekStatItem:        { flex: 1, alignItems: "center", paddingVertical: 6, gap: 3 },
  weekStatVDivider:    { width: 1, height: 30, alignSelf: "center" },
  weekStatValue:       { fontFamily: FontFamily.bold, fontSize: 20, color: TP },
  weekStatLabel:       { fontFamily: FontFamily.regular, fontSize: 12, color: TS },
  weekHDivider:        { height: 1, marginHorizontal: 14, marginBottom: 2 },
  weekDayRow:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 7, gap: 8 },
  weekDayLabel:        { fontFamily: FontFamily.semibold, fontSize: 12, width: 34 },
  weekDayName:         { flex: 1, fontFamily: FontFamily.regular, fontSize: 13, color: TP },
  weekTodayDot:        { width: 6, height: 6, borderRadius: 3 },
  weekCircleCard:      { borderRadius: 20 },
  weekCircleCardInner: { alignItems: "center", paddingVertical: 12, gap: 0 },
  weekCircleLabelTop:  { fontFamily: FontFamily.regular, fontSize: 11, color: TS, textAlign: "center" },
  weekCircleWrap:      { width: SVG_SIZE, height: SVG_SIZE, alignItems: "center", justifyContent: "center" },
  weekCircleCenter:    { position: "absolute", alignItems: "center", justifyContent: "center" },
  weekCircleCount:     { fontFamily: FontFamily.bold, fontSize: 26, color: TP },
  recentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  seeAllRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  seeAll: { fontFamily: FontFamily.semibold, fontSize: 14, color: ICON },
  activityCard: { marginBottom: 12, borderRadius: 18 },
  activityName: { fontFamily: FontFamily.bold, fontSize: 16, color: TP, marginBottom: 2 },
  activitySub:  { fontFamily: FontFamily.regular, fontSize: 12, color: TS },
  workoutTopRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  workoutProgRow:    { paddingTop: 10 },
  workoutProgName:   { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.9 },
  workoutProgSession:{ fontFamily: FontFamily.semibold, fontSize: 12 },
  programCard: { marginBottom: 20, borderRadius: 20 },
  programCardInner: { padding: 20, gap: 14 },
  programHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  programName: { fontFamily: FontFamily.bold, fontSize: 16, color: TP, marginTop: 4 },
  programWeek: { fontFamily: FontFamily.regular, fontSize: 14, color: TS },
  progressRow: { flexDirection: "row", gap: 5 },
  progressSegment: { flex: 1, height: 6, borderRadius: 3 },
});
