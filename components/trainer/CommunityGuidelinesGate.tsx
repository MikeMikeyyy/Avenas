// Full-screen agreement gate (Apple Guideline 1.2, Safety / UGC), in front of
// everything with other people in it: the Trainer tab, and every screen
// components/CommunityGate.tsx stands in front of, however it was opened. It
// has two faces:
//   - the agreement prompt (Accept / Decline + link to the full guidelines)
//   - a locked screen shown after Decline, with a "Review guidelines" path back
// Accepting calls onAccept (the parent records it for this account and opens
// what was behind it). Decline is UI-only: it never persists, so the user can
// change their mind any time. In front of a pushed screen (`pushed`) it has a
// back button, so leaving without agreeing is always there.

import { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import Reanimated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import BounceButton from "../BounceButton";
import BackButton, { BACK_SIZE, BACK_TOP } from "../BackButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { darkGlow, pill, PILL_H_SM } from "../../constants/buttons";
import { NO_TAB_BAR_GAP } from "../../constants/floatingBars";
import { useTheme } from "../../contexts/ThemeContext";
import { usePinnedLift } from "../../hooks/useFloatingBars";
import { useTabBar } from "../../hooks/useTabBar";
import { COMMUNITY_GUIDELINES } from "../../constants/community";
import CommunityPledge from "./CommunityPledge";

export default function CommunityGuidelinesGate({ onAccept, pushed = false }: {
  onAccept: () => void;
  /** In front of a screen pushed over the tabs: a back button to leave by,
   *  and no tab bar under its buttons. */
  pushed?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [declined, setDeclined] = useState(false);
  const tabBar = useTabBar();

  const accept = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAccept();
  };

  // The buttons at the foot stand on the tab bar on the Trainer tab, above the
  // home indicator in front of a pushed screen, and on the workout bar while a
  // workout runs (usePinnedLift), where under it they couldn't be pressed.
  const actionsBottomPad = pushed ? insets.bottom + NO_TAB_BAR_GAP : tabBar.clearance;
  const { lift, liftStyle } = usePinnedLift(actionsBottomPad);
  // In front of a pushed screen, everything starts under the back button.
  const topPad = pushed ? insets.top + BACK_TOP + BACK_SIZE + 12 : insets.top + 28;

  if (declined) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg, paddingTop: pushed ? topPad : insets.top + 40, paddingBottom: actionsBottomPad }]}>
        <View style={styles.lockedInner}>
          <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
            <Ionicons name="lock-closed-outline" size={30} color={t.ts} />
          </View>
          <Text style={[styles.title, { color: t.tp }]}>Community features locked</Text>
          <Text style={[styles.body, { color: t.ts }]}>
            You need to accept the Community Guidelines to message trainers, share programs, and use the Trainer hub. The rest of Avenas stays available.
          </Text>
        </View>
        <Reanimated.View style={liftStyle}>
          <BounceButton onPress={() => setDeclined(false)} accessibilityLabel="Review the community guidelines">
            <View style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }, darkGlow(styles.primaryBtn, isDark)]}>
              <Text style={styles.primaryText}>Review guidelines</Text>
            </View>
          </BounceButton>
        </Reanimated.View>
        {pushed ? <BackButton /> : null}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: topPad, paddingBottom: actionsBottomPad }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 16 + lift }]}>
        <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.16)" }]}>
          <Ionicons name="people-outline" size={30} color={ACCT} />
        </View>
        <Text style={[styles.title, { color: t.tp }]}>Welcome to the community</Text>
        <CommunityPledge style={styles.pledge} />
        <Text style={[styles.intro, { color: t.ts }]}>
          The Trainer hub lets you message and share programs with real people. Before you start, please agree to keep it safe:
        </Text>

        <View style={styles.list}>
          {COMMUNITY_GUIDELINES.map(s => (
            <View key={s.heading} style={styles.listRow}>
              <Ionicons name="checkmark-circle" size={18} color={ACCT} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.listHeading, { color: t.tp }]}>{s.heading}</Text>
                <Text style={[styles.listBody, { color: t.ts }]}>{s.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text
          style={[styles.link, { color: ACCT }]}
          onPress={() => router.navigate("/community-guidelines")}
          accessibilityRole="link"
        >
          Read the full guidelines
        </Text>
      </ScrollView>

      <Reanimated.View style={[styles.actions, liftStyle]}>
        <BounceButton onPress={accept} accessibilityLabel="Agree to the community guidelines">
          <View style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }, darkGlow(styles.primaryBtn, isDark)]}>
            <Text style={styles.primaryText}>I agree</Text>
          </View>
        </BounceButton>
        <BounceButton style={{ marginTop: 10 }} onPress={() => setDeclined(true)} accessibilityLabel="Decline the community guidelines">
          <View style={[styles.secondaryBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
            <Text style={[styles.secondaryText, { color: t.tp }]}>Not now</Text>
          </View>
        </BounceButton>
      </Reanimated.View>
      {pushed ? <BackButton /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, paddingHorizontal: 24 },
  scroll:        { alignItems: "center" },
  lockedInner:   { flex: 1, justifyContent: "center", alignItems: "center" },
  iconWrap:      { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title:         { fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center", marginBottom: 8 },
  pledge:        { marginTop: 6, marginBottom: 16 },
  intro:         { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 22, paddingHorizontal: 4 },
  body:          { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", lineHeight: 21, paddingHorizontal: 8 },
  list:          { alignSelf: "stretch", gap: 16, marginBottom: 20 },
  listRow:       { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  listHeading:   { fontFamily: FontFamily.semibold, fontSize: 15, marginBottom: 3 },
  listBody:      { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  link:          { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: "center", paddingVertical: 6 },
  actions:       { paddingTop: 12 },
  primaryBtn:    { ...pill(), shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  primaryText:   { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  secondaryBtn:  { ...pill(PILL_H_SM) },
  secondaryText: { fontFamily: FontFamily.bold, fontSize: 14 },
});
