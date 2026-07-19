// Full-screen agreement gate shown the first time a user enters the Trainer hub
// (Apple Guideline 1.2 — Safety / UGC). It has two faces:
//   - the agreement prompt (Accept / Decline + link to the full guidelines)
//   - a locked screen shown after Decline, with a "Review guidelines" path back
// Accepting calls onAccept (the parent persists it and renders the hub). Decline
// is UI-only: it never persists, so the user can change their mind any time.

import { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import BounceButton from "../BounceButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { COMMUNITY_GUIDELINES, COMMUNITY_PLEDGE } from "../../constants/community";

export default function CommunityGuidelinesGate({ onAccept }: { onAccept: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [declined, setDeclined] = useState(false);

  const accept = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAccept();
  };

  // This gate renders inside the tab layout, so the floating tab bar overlays
  // the bottom of the screen; the pinned action buttons need to clear it (same
  // reason PTHome/MyPTHome pad their scroll content by insets.bottom + 140).
  const actionsBottomPad = insets.bottom + 72;

  if (declined) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 40, paddingBottom: actionsBottomPad }]}>
        <View style={styles.lockedInner}>
          <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
            <Ionicons name="lock-closed-outline" size={30} color={t.ts} />
          </View>
          <Text style={[styles.title, { color: t.tp }]}>Community features locked</Text>
          <Text style={[styles.body, { color: t.ts }]}>
            You need to accept the Community Guidelines to message trainers, share programs, and use the Trainer hub. The rest of Avenas stays available.
          </Text>
        </View>
        <BounceButton onPress={() => setDeclined(false)} accessibilityLabel="Review the community guidelines">
          <View style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
            <Text style={styles.primaryText}>Review guidelines</Text>
          </View>
        </BounceButton>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 28, paddingBottom: actionsBottomPad }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.iconWrap, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.16)" }]}>
          <Ionicons name="people-outline" size={30} color={ACCT} />
        </View>
        <Text style={[styles.title, { color: t.tp }]}>Welcome to the community</Text>
        <Text style={[styles.pledge, { color: ACCT }]}>{COMMUNITY_PLEDGE}</Text>
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

      <View style={styles.actions}>
        <BounceButton onPress={accept} accessibilityLabel="Agree to the community guidelines">
          <View style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
            <Text style={styles.primaryText}>I agree</Text>
          </View>
        </BounceButton>
        <BounceButton style={{ marginTop: 10 }} onPress={() => setDeclined(true)} accessibilityLabel="Decline the community guidelines">
          <View style={[styles.secondaryBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
            <Text style={[styles.secondaryText, { color: t.tp }]}>Not now</Text>
          </View>
        </BounceButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, paddingHorizontal: 24 },
  scroll:        { paddingBottom: 16, alignItems: "center" },
  lockedInner:   { flex: 1, justifyContent: "center", alignItems: "center" },
  iconWrap:      { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title:         { fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center", marginBottom: 8 },
  pledge:        { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: "center", marginBottom: 14, lineHeight: 20 },
  intro:         { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 22, paddingHorizontal: 4 },
  body:          { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", lineHeight: 21, paddingHorizontal: 8 },
  list:          { alignSelf: "stretch", gap: 16, marginBottom: 20 },
  listRow:       { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  listHeading:   { fontFamily: FontFamily.semibold, fontSize: 15, marginBottom: 3 },
  listBody:      { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  link:          { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: "center", paddingVertical: 6 },
  actions:       { paddingTop: 12 },
  primaryBtn:    { borderRadius: 14, paddingVertical: 15, alignItems: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  primaryText:   { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  secondaryBtn:  { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  secondaryText: { fontFamily: FontFamily.bold, fontSize: 14 },
});
