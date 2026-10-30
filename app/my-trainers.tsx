// "My Trainers" — standalone page reached from the My Trainers pill on a gym
// user's Trainer tab (MyPTHome). Every trainer they're connected with, who's
// messaged them, and which one is on their Trainer tab; tapping one puts them
// there. The connect button at the top right (the person with a plus, with a
// count of the requests waiting) adds a trainer, as Connect does from anywhere;
// "Remove a trainer" is at the foot of the list.

import { StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { BlurView } from "expo-blur";
import MaskedView from "../components/MaskedView";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ABOVE_KEYBOARD_TOOLS, scrollEndPadding } from "../constants/floatingBars";
import { useFloatingBarsReach } from "../hooks/useFloatingBars";
import { useRouter } from "expo-router";

import FadeScreen from "../components/FadeScreen";
import GlassButton from "../components/GlassButton";
import UnreadBadge from "../components/UnreadBadge";
import OfflineBanner from "../components/OfflineBanner";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import UserRoundPlusIcon from "../components/icons/UserRoundPlusIcon";
import MyTrainersSection from "../components/trainer/MyTrainersSection";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { useConnectionPresence } from "../hooks/useConnectionPresence";
import { useUnreadMessages } from "../hooks/useUnreadMessages";
import BackButton, { BACK_LEFT, BACK_SIZE, BACK_TOP } from "../components/BackButton";

export default function MyTrainersScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  // Read here and handed down, so the page polls connections once: the
  // connect button's count, and each trainer's presence line.
  const { presenceById, pendingIncoming } = useConnectionPresence();
  const { byPerson } = useUnreadMessages();

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

      {/* The connect button the Trainer tab's top bar had, and the trainer's
          hub has on Clients: Connect, where requests are accepted, with how
          many are waiting (user decision, 2026-10-21; it was a "+" opening an
          Add / Remove menu). */}
      <GlassButton
        onPress={() => router.navigate("/connect")}
        size={BACK_SIZE}
        style={[styles.connect, { top: insets.top + BACK_TOP }]}
        badge={<UnreadBadge count={pendingIncoming} style={styles.badge} />}
        accessibilityLabel={pendingIncoming > 0 ? `Connect with a trainer, ${pendingIncoming} waiting` : "Connect with a trainer"}
      >
        <UserRoundPlusIcon size={20} color={t.tp} />
      </GlassButton>

      {/* Searching, the keyboard's height goes under the page, so every
          trainer scrolls clear of it (user request, 2026-10-30). */}
      <KeyboardAwareScrollView
        bottomOffset={ABOVE_KEYBOARD_TOOLS}
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

        <MyTrainersSection presenceById={presenceById} unreadByPerson={byPerson} />
      </KeyboardAwareScrollView>

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
    marginBottom: 18,
  },
  screenTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    textAlign: "center",
    flex: 1,
  },
});
