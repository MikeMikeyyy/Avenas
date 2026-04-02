import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import Svg, { Path } from "react-native-svg";
import NeuCard, { NEU_BG } from "../../components/NeuCard";
import { FontFamily } from "../../constants/theme";

const DumbbellIcon = ({ size }: { size: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke="#000000" strokeWidth="1.5" />
    <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke="#000000" strokeWidth="1.5" />
    <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke="#000000" strokeWidth="1.5" />
  </Svg>
);

const TP   = "#2D3748";
const TS   = "#8896A7";
const ACCT = "#1deca0";
const ICON = "#3a3f47";
const STRK = "#FF6B4A";
const DIV  = "#D8DCE0";

const QUICK_ACTIONS = [
  { id: "log",      label: "New\nProgram",  renderIcon: (c: string) => <Ionicons name="add-outline" size={26} color={c} /> },
  { id: "programs", label: "My\nPrograms",  renderIcon: (c: string) => <Ionicons name="list-outline" size={22} color={c} /> },
  { id: "journal",  label: "View\nJournal", renderIcon: (c: string) => (
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
  const scale = useRef(new Animated.Value(1)).current;
  const onIn  = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 2 }).start();
  const onOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 20, bounciness: 8 }).start();

  return (
    <TouchableOpacity activeOpacity={1} onPressIn={onIn} onPressOut={onOut}>
      <Animated.View style={{ transform: [{ scale }] }}>
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
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  return (
    <View style={styles.root}>
      <NeuCard radius={24} style={[styles.avatar, { top: insets.top, right: 20 }]}>
        <View style={styles.avatarInner}>
          <Text style={styles.avatarText}>MM</Text>
        </View>
      </NeuCard>

      <ScrollView
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top - 4, paddingBottom: insets.bottom + 120 }]}
      >
        <Image source={require("../../assets/images/logo.png")} style={styles.logo} resizeMode="contain" />

        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.name}>Michael</Text>
          </View>
        </View>

        <NeuCard style={styles.streak}>
          <View style={styles.streakInner}>
            <Text style={styles.streakText}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).replace(/^(\w+)/, "$1,")}</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="flame" size={20} color={STRK} />
            <Text style={styles.streakText}>7 Day Streak</Text>
          </View>
        </NeuCard>

        <NeuCard style={styles.workoutCard}>
          <View style={styles.workoutCardInner}>
            <View style={{ position: "absolute", top: 20, right: 20, alignItems: "flex-end", gap: 6, maxWidth: "50%" }}>
              <Text style={styles.sectionLabel}>ACTIVE PROGRAM</Text>
              <NeuCard radius={10} style={styles.badge}>
                <Text style={[styles.badgeText, { flexShrink: 1 }]}>2026 MESOCYCLE A</Text>
              </NeuCard>
            </View>

            <Text style={styles.sectionLabel}>TODAY'S WORKOUT</Text>
            <Text style={[styles.workoutName, { marginTop: 10, paddingRight: 155 }]}>FULLBODY A</Text>

            <View style={[styles.metaRow, { marginTop: -8 }]}>
              <View style={styles.metaItem}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={TS} strokeWidth="1.5" />
                  <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={TS} strokeWidth="1.5" />
                  <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={TS} strokeWidth="1.5" />
                </Svg>
                <Text style={styles.metaText}>6 exercises</Text>
              </View>
            </View>

            <StartButton />
          </View>
        </NeuCard>

        <View style={styles.quickRow}>
          {QUICK_ACTIONS.map((a) => (
            <TouchableOpacity key={a.id} style={{ flex: 1 }} activeOpacity={0.85}>
              <NeuCard style={styles.quickCard}>
                <View style={styles.quickInner}>
                  <NeuCard radius={24} style={styles.quickIcon}>
                    <View style={styles.quickIconInner}>
                      {a.renderIcon(ICON)}
                    </View>
                  </NeuCard>
                  <Text style={styles.quickLabel}>{a.label}</Text>
                </View>
              </NeuCard>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>This Week</Text>
        <NeuCard style={styles.statsCard}>
          <View style={styles.statsRow}>
            {[
              { value: "4",      label: "Workouts"  },
              { value: "12,400", label: "Volume kg" },
              { value: "44 min", label: "Avg Time"  },
            ].map((s, i) => (
              <View key={s.label} style={styles.statCell}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.statContent}>
                  <Text style={styles.statValue}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              </View>
            ))}
          </View>
        </NeuCard>

        <View style={styles.recentHeader}>
          <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Recent Activity</Text>
          <TouchableOpacity activeOpacity={0.7} style={styles.seeAllRow}>
            <Text style={styles.seeAll}>See All</Text>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke={ICON} strokeWidth="2.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
              <Path d="M10.7402 15.5297L14.2602 11.9997L10.7402 8.46973" stroke={ICON} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        </View>

        {RECENT_ACTIVITY.map((item) => (
          <NeuCard key={item.id} style={styles.activityCard}>
            <View style={styles.activityInner}>
              <NeuCard radius={24} style={styles.activityIcon}>
                <View style={styles.activityIconInner}>
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                    <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke="#000000" strokeWidth="1.5" />
                    <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke="#000000" strokeWidth="1.5" />
                    <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke="#000000" strokeWidth="1.5" />
                  </Svg>
                </View>
              </NeuCard>
              <View style={{ flex: 1 }}>
                <Text style={styles.activityName}>{item.name}</Text>
                <Text style={styles.activitySub}>{item.sub}</Text>
              </View>
              <Text style={styles.activityDur}>{item.dur}</Text>
            </View>
          </NeuCard>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NEU_BG },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  greeting: { fontFamily: FontFamily.regular, fontSize: 14, color: TS },
  name: { fontFamily: FontFamily.bold, fontSize: 28, color: TP, marginTop: 2 },
  logo: { width: 56, height: 56, marginBottom: 20 },
  avatar: { position: "absolute", width: 48, height: 48, borderRadius: 24, zIndex: 10 },
  avatarInner: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 16, color: ICON },
  streak: { marginBottom: 16, borderRadius: 16 },
  streakInner: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 5 },
  streakText: { fontFamily: FontFamily.semibold, fontSize: 14, color: TP },
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
});
