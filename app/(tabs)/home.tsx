import { useState, useCallback, useRef, useMemo } from "react";
import { View, Text, StyleSheet, Image, Animated } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../../components/NeuCard";
import FlameIcon from "../../components/FlameIcon";
import FadeScreen from "../../components/FadeScreen";
import { APP_LIGHT, APP_DARK, NEU_BG, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../../constants/theme";
import BounceButton from "../../components/BounceButton";
import { useTheme } from "../../contexts/ThemeContext";
import { useStreak } from "../../contexts/StreakContext";
import {
  STREAK_TIERS,
  FLAME_PREF_KEY,
  MAX_TIER_DAYS,
  getTier,
} from "../../constants/streakTiers";
import { PROGRAMS_KEY, SavedProgram, getCurrentWeek } from "../../constants/programs";

const AVATAR_BG = "#ffffffff"; // change this to restyle the settings button independently

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
const DAY_ABBR    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

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


// Static colours for StyleSheet (must be literals, not dynamic theme values)
const TP   = APP_LIGHT.tp;
const TS   = APP_LIGHT.ts;
const ICON = APP_LIGHT.icon;
const DIV  = APP_LIGHT.div;

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

const RECENT_ACTIVITY = [
  { id: "1", name: "Push Day A", sub: "Yesterday · 6 exercises",  dur: "45 min" },
  { id: "2", name: "Pull Day B", sub: "3 days ago · 7 exercises", dur: "52 min" },
  { id: "3", name: "Leg Day",    sub: "5 days ago · 5 exercises", dur: "38 min" },
];

function StartButton() {
  const { isDark } = useTheme();
  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const contentColor = isDark ? APP_DARK.bg : "#fff";
  const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";
  return (
    <BounceButton>
      <View style={[styles.startBtnDark, { backgroundColor: btnBg, shadowColor: btnShadow }]}>
        <View style={[styles.startBtn, { backgroundColor: btnBg }]}>
          <View style={styles.startBtnContent}>
            <Text style={[styles.startBtnText, { color: contentColor }]}>Start Workout</Text>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path d="M14.4302 5.92969L20.5002 11.9997L14.4302 18.0697" stroke={contentColor} strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
              <Path d="M3.5 12H20.33" stroke={contentColor} strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
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
  const [flameName, setFlameName] = useState<string | null>(null);
  const [activeProgram, setActiveProgram] = useState<SavedProgram | null>(null);
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
          const programs: SavedProgram[] = JSON.parse(raw);
          const found = programs.find((p) => p.status === "active") ?? null;
          setActiveProgram(found);
        })
        .catch(() => {});
    }, [isMax])
  );

  const restDayQuote = useMemo(() => {
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    return REST_DAY_QUOTES[seed % REST_DAY_QUOTES.length];
  }, []);

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
                    <NeuCard dark={isDark} radius={24} style={styles.quickIcon}>
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

        <Text style={[styles.sectionTitle, { color: t.tp }]}>This Week</Text>
        <NeuCard dark={isDark} style={styles.statsCard}>
          <View style={styles.statsRow}>
            {[
              { value: "4",      label: "Workouts"  },
              { value: "12,400", label: "Volume kg" },
              { value: "44 min", label: "Avg Time"  },
            ].map((s, i) => (
              <View key={s.label} style={styles.statCell}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
                <View style={styles.statContent}>
                  <Text style={[styles.statValue, { color: t.tp }]}>{s.value}</Text>
                  <Text style={[styles.statLabel, { color: t.ts }]}>{s.label}</Text>
                </View>
              </View>
            ))}
          </View>
        </NeuCard>

        <Text style={[styles.sectionTitle, { color: t.tp }]}>Recent Activity</Text>

        {RECENT_ACTIVITY.map((item) => (
          <BounceButton key={item.id} style={{ marginBottom: 12 }}>
            <NeuCard dark={isDark} style={[styles.activityCard, { marginBottom: 0 }]}>
            <View style={styles.activityInner}>
              <NeuCard dark={isDark} radius={24} style={styles.activityIcon}>
                <View style={styles.activityIconInner}>
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                    <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={t.icon} strokeWidth="1.5" />
                    <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={t.icon} strokeWidth="1.5" />
                    <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={t.icon} strokeWidth="1.5" />
                  </Svg>
                </View>
              </NeuCard>
              <View style={{ flex: 1 }}>
                <Text style={[styles.activityName, { color: t.tp }]}>{item.name}</Text>
                <Text style={[styles.activitySub, { color: t.ts }]}>{item.sub}</Text>
              </View>
              <Text style={[styles.activityDur, { color: t.tp }]}>{item.dur}</Text>
            </View>
            </NeuCard>
          </BounceButton>
        ))}
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
  quickRow: { flexDirection: "row", gap: 12, marginBottom: 28 },
  quickCard: { borderRadius: 20 },
  quickInner: { alignItems: "center", paddingVertical: 18, paddingHorizontal: 8, gap: 10 },
  quickIcon: { width: 52, height: 52, borderRadius: 26 },
  quickIconInner: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, textAlign: "center", lineHeight: 18 },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 18, color: TP, marginBottom: 12 },
  statsCard: { marginBottom: 28, borderRadius: 20 },
  statsRow: { flexDirection: "row" },
  statCell: { flex: 1, flexDirection: "row" },
  divider: { width: 1, height: 40, backgroundColor: DIV, alignSelf: "center" },
  statContent: { flex: 1, alignItems: "center", paddingVertical: 20, gap: 4 },
  statValue: { fontFamily: FontFamily.bold, fontSize: 22, color: TP },
  statLabel: { fontFamily: FontFamily.regular, fontSize: 14, color: TS },
  recentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  seeAllRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  seeAll: { fontFamily: FontFamily.semibold, fontSize: 14, color: ICON },
  activityCard: { marginBottom: 12, borderRadius: 18 },
  activityInner: { flexDirection: "row", alignItems: "center", padding: 16, gap: 14 },
  activityIcon: { width: 48, height: 48, borderRadius: 24 },
  activityIconInner: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  activityName: { fontFamily: FontFamily.semibold, fontSize: 14, color: TP, marginBottom: 3 },
  activitySub: { fontFamily: FontFamily.regular, fontSize: 14, color: TS },
  activityDur: { fontFamily: FontFamily.semibold, fontSize: 14, color: TP },
  programCard: { marginBottom: 20, borderRadius: 20 },
  programCardInner: { padding: 20, gap: 14 },
  programHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  programName: { fontFamily: FontFamily.bold, fontSize: 16, color: TP, marginTop: 4 },
  programWeek: { fontFamily: FontFamily.regular, fontSize: 14, color: TS },
  progressRow: { flexDirection: "row", gap: 5 },
  progressSegment: { flex: 1, height: 6, borderRadius: 3 },
});
