import { useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, Image, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import LottieView from "lottie-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../../components/NeuCard";
import { APP_LIGHT, APP_DARK, NEU_BG, FontFamily } from "../../constants/theme";
import BounceButton from "../../components/BounceButton";
import { useTheme } from "../../contexts/ThemeContext";
import { useStreak } from "../../contexts/StreakContext";
import {
  STREAK_TIERS,
  FLAME_PREF_KEY,
  MAX_TIER_DAYS,
  getStreakLottie,
} from "../../constants/streakTiers";

const ACCT      = "#1deca0";
const AVATAR_BG = "#ffffffff"; // change this to restyle the settings button independently


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
  { id: "log",      label: "New\nProgram",  renderIcon: (c: string) => <Ionicons name="add-outline" size={26} color={c} /> },
  { id: "programs", label: "My\nPrograms",  route: "/programs", renderIcon: (c: string) => <Ionicons name="list-outline" size={22} color={c} /> },
  { id: "journal",  label: "View\nJournal", route: "/journal",  renderIcon: (c: string) => (
    <Svg width={22} height={22} viewBox="0 0 16 16" fill="none">
      <Path d="M5 0h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2 2 2 0 0 1-2 2H3a2 2 0 0 1-2-2h1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1H1a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1H3a2 2 0 0 1 2-2" fill={c} />
      <Path d="M1 6v-.5a.5.5 0 0 1 1 0V6h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0V9h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 2.5v.5H.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1H2v-.5a.5.5 0 0 0-1 0" fill={c} />
    </Svg>
  ) },
];

const RECENT_ACTIVITY = [
  { id: "1", name: "Push Day A", sub: "Yesterday · 6 exercises",  dur: "45 min" },
  { id: "2", name: "Pull Day B", sub: "3 days ago · 7 exercises", dur: "52 min" },
  { id: "3", name: "Leg Day",    sub: "5 days ago · 5 exercises", dur: "38 min" },
];

function StartButton() {
  return (
    <BounceButton>
      <View style={styles.startBtnDark}>
        <View style={styles.startBtn}>
          <View style={styles.startBtnContent}>
            <Text style={styles.startBtnText}>Start Workout</Text>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path d="M14.4302 5.92969L20.5002 11.9997L14.4302 18.0697" stroke="#fff" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
              <Path d="M3.5 12H20.33" stroke="#fff" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
        </View>
      </View>
    </BounceButton>
  );
}


function CalendarIcon() {
  const now = new Date();
  const day = now.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
  const date = now.getDate().toString();
  const W = 42;
  const RING_OVERHANG = 5;
  const BODY_H = 50;
  const TOTAL_H = BODY_H + RING_OVERHANG;
  const R = 9;
  const GRADIENT_H = Math.round(BODY_H * 0.53);
  const GLASS_OFFSET = Math.round(BODY_H * 0.23);
  return (
    <View style={{ width: W, height: TOTAL_H }}>
      <View style={{ position: "absolute", top: RING_OVERHANG, left: 0, right: 0, height: BODY_H, borderRadius: R, backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 6 }} />
      <LinearGradient colors={["#00E5FF", "#009DFF"]} start={{ x: 0.09, y: 0.08 }} end={{ x: 1, y: 0.75 }} style={{ position: "absolute", top: RING_OVERHANG, left: 0, right: 0, height: GRADIENT_H, borderRadius: R }} />
      <LinearGradient colors={["#00E5FF", "#0095FF"]} start={{ x: 0.09, y: 0.08 }} end={{ x: 1, y: 0.75 }} style={{ position: "absolute", top: RING_OVERHANG, left: 0, right: 0, height: GRADIENT_H, borderRadius: R, opacity: 0.8 }} />
      <LinearGradient colors={["rgba(255,255,255,0.35)", "rgba(255,255,255,0)"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: "absolute", top: RING_OVERHANG, left: 0, right: 0, height: 4, borderTopLeftRadius: R, borderTopRightRadius: R, overflow: "hidden" }} pointerEvents="none" />
      <View style={{ position: "absolute", top: RING_OVERHANG + GLASS_OFFSET, left: 0, right: 0, bottom: 0, borderRadius: R, overflow: "hidden" }}>
        <BlurView intensity={25} tint="light" style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.4)" }}>
            <Text style={{ color: "#00949E", fontSize: 9, fontWeight: "700", textAlign: "center", paddingTop: 6, letterSpacing: 0.5 }}>{day}</Text>
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#000", fontSize: 17, fontWeight: "700" }}>{date}</Text>
            </View>
            <LinearGradient colors={["rgba(255,255,255,0.55)", "rgba(255,255,255,0)"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8 }} pointerEvents="none" />
          </View>
        </BlurView>
      </View>
      {[11, 27].map((left, i) => (
        <View key={i} style={{ position: "absolute", top: 0, left, width: 5, height: RING_OVERHANG + 6, backgroundColor: "#fff", borderRadius: 2.5, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3 }} />
      ))}
    </View>
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
  const scrollY = useRef(new Animated.Value(0)).current;
  const streakOpacity = scrollY.interpolate({ inputRange: [80, 140], outputRange: [1, 0], extrapolate: "clamp" });

  // Re-read the preference every time this screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (isMax) {
        AsyncStorage.getItem(FLAME_PREF_KEY).then((saved: string | null) => {
          if (saved) setFlameName(saved);
        });
      }
    }, [isMax])
  );

  const activeLottie = isMax && flameName
    ? (STREAK_TIERS.find(t2 => t2.name === flameName)?.lottie ?? getStreakLottie(streakDays))
    : getStreakLottie(streakDays);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* Streak badge — fades out on scroll */}
      <Animated.View style={[styles.streakFloat, { top: insets.top, opacity: streakOpacity }]}>
        <BounceButton onPress={() => router.push("/streak")}>
          <View style={styles.streakBadge}>
            <LottieView source={activeLottie} autoPlay loop style={{ width: 44, height: 44 }} />
            <Text style={[styles.streakBadgeText, { color: t.ts }]}>{streakDays}</Text>
          </View>
        </BounceButton>
      </Animated.View>

      <BounceButton style={[styles.avatar, { top: insets.top, right: 20 }]} onPress={() => router.push("/settings")}>
        <View style={[styles.avatarHighlight, { shadowColor: isDark ? "#4d5363" : "#FFFFFF" }]}>
          <View style={[styles.avatarShadow, { shadowColor: isDark ? "#4d5363" : "#a3afc0" }]}>
            <BlurView intensity={90} tint="extraLight" style={styles.avatarBorder}>
              <View style={styles.avatarInner}>
                <Text style={styles.avatarText}>MM</Text>
              </View>
            </BlurView>
          </View>
        </View>
      </BounceButton>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top - 4, paddingBottom: insets.bottom + 120 }]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        <Image source={require("../../assets/images/logo.png")} style={styles.logo} resizeMode="contain" />

        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: t.ts }]}>{greeting}</Text>
            <Text style={[styles.name, { color: t.tp }]}>Michael</Text>
          </View>
        </View>

        <NeuCard dark={isDark} style={styles.workoutCard}>
          <View style={{ position: "absolute", top: 16, right: 24, zIndex: 1 }}>
            <CalendarIcon />
          </View>
          <View style={styles.workoutCardInner}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>TODAY'S WORKOUT</Text>
            <Text style={[styles.workoutName, { color: t.tp }]}>FULLBODY A</Text>

            <View style={[styles.metaRow, { marginTop: -10 }]}>
              <View style={styles.metaItem}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={t.ts} strokeWidth="1.5" />
                  <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={t.ts} strokeWidth="1.5" />
                  <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={t.ts} strokeWidth="1.5" />
                </Svg>
                <Text style={[styles.metaText, { color: t.ts }]}>6 exercises</Text>
              </View>
            </View>

            <StartButton />
          </View>
        </NeuCard>

        <NeuCard dark={isDark} style={styles.programCard}>
          <View style={styles.programCardInner}>
            <View style={styles.programHeader}>
              <View>
                <Text style={[styles.sectionLabel, { color: t.ts }]}>ACTIVE PROGRAM</Text>
                <Text style={[styles.programName, { color: t.tp }]}>2026 MESOCYCLE A</Text>
              </View>
              <Text style={[styles.programWeek, { color: t.ts }]}>Week 3 of 8</Text>
            </View>
            <View style={styles.progressRow}>
              {Array.from({ length: 8 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressSegment,
                    { backgroundColor: i < 3 ? ACCT : (isDark ? "#2e3448" : "#D8DCE0") },
                  ]}
                />
              ))}
            </View>
          </View>
        </NeuCard>

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NEU_BG },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  greeting: { fontFamily: FontFamily.regular, fontSize: 16, color: TS },
  name: { fontFamily: FontFamily.bold, fontSize: 28, color: TP, marginTop: 2 },
  logo: { width: 56, height: 56, marginBottom: 20 },
  avatar: { position: "absolute", zIndex: 10 },
  avatarHighlight: { borderRadius: 24, backgroundColor: AVATAR_BG, shadowColor: "#FFFFFF", shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.9, shadowRadius: 6 },
  avatarShadow: { borderRadius: 24, backgroundColor: AVATAR_BG, shadowColor: "#a3afc0", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.7, shadowRadius: 7 },
  avatarBorder: { width: 48, height: 48, borderRadius: 24, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarInner: { width: 44, height: 44, borderRadius: 22, backgroundColor: AVATAR_BG, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 16, color: ICON },
  streakFloat:     { position: "absolute", right: 80, zIndex: 10 },
  streakBadge:     { flexDirection: "row", alignItems: "flex-start", gap: 0 },
  streakBadgeText: { fontFamily: FontFamily.semibold, fontSize: 18, color: TS, marginLeft: -4, marginTop: 13 },
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
