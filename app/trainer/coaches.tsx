// "My Trainers" (trainer side) — standalone page reached from the My Trainers
// pill on PTHome. Lets a trainer connect to senior trainers/mentors and send
// them programs; what they send back is on the Programs page, where it's
// accepted and passed on (user decision, 2026-10-29). The connect button at the
// top right (the person with a plus, with a count of the requests waiting)
// connects someone, as Connect does from anywhere; "Remove a trainer" is at the
// foot of the list (user decision, 2026-10-21, as the gym user's page has it;
// it was a "+" opening an Add / Remove alert).

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "../../components/MaskedView";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scrollEndPadding } from "../../constants/floatingBars";
import { useFloatingBarsReach } from "../../hooks/useFloatingBars";
import { useRouter } from "expo-router";

import FadeScreen from "../../components/FadeScreen";
import GlassButton from "../../components/GlassButton";
import UnreadBadge from "../../components/UnreadBadge";
import OfflineBanner from "../../components/OfflineBanner";
import KeyboardDismissButton from "../../components/KeyboardDismissButton";
import UserRoundPlusIcon from "../../components/icons/UserRoundPlusIcon";
import MyCoachesSection from "../../components/trainer/MyCoachesSection";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import BackButton, { BACK_LEFT, BACK_SIZE, BACK_TOP } from "../../components/BackButton";

export default function CoachesScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  // Read here and handed down, so the page polls connections once: the
  // connect button's count, and each trainer's presence line.
  const { presenceById, pendingIncoming } = useConnectionPresence();

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <BackButton />

      {/* Connect, where requests are accepted, with how many are waiting.
          Connecting is role-blind: someone with a trainer account lands here,
          anyone else in My Clients (utils/roster.ts). */}
      <GlassButton
        onPress={() => router.navigate("/connect")}
        size={BACK_SIZE}
        style={[styles.connect, { top: insets.top + BACK_TOP }]}
        badge={<UnreadBadge count={pendingIncoming} style={styles.badge} />}
        accessibilityLabel={pendingIncoming > 0 ? `Connect with someone, ${pendingIncoming} waiting` : "Connect with someone"}
      >
        <UserRoundPlusIcon size={20} color={t.tp} />
      </GlassButton>

      <ScrollView
        showsVerticalScrollIndicator={false}
        // A tap on a trainer fires on the first touch while the search field
        // is focused, instead of being swallowed to dismiss the keyboard.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + BACK_TOP,
          paddingBottom: scrollEndPadding(insets.bottom + 40, barsReach),
        }}
      >
        <View style={styles.header}>
          <View style={{ width: 44 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>My Trainers</Text>
          <View style={{ width: 44 }} />
        </View>

        <OfflineBanner />

        <MyCoachesSection presenceById={presenceById} />
      </ScrollView>

      <KeyboardDismissButton />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  // Mirrors the back button across the screen, as the floating archive button
  // does (components/ArchiveButton.tsx): same top, same inset, same circle,
  // and like it no shadow.
  connect: { position: "absolute", right: BACK_LEFT, zIndex: 10 },
  badge: { position: "absolute", top: -5, right: -5 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    height: BACK_SIZE,
    marginBottom: 32,
  },
  screenTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    textAlign: "center",
    flex: 1,
  },
});
