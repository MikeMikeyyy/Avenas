import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "../contexts/ThemeContext";
import { useUserProfile } from "../contexts/UserProfileContext";
import NeuCard from "../components/NeuCard";
import PrimaryButton from "../components/PrimaryButton";
import { setJSON } from "../utils/storage";
import { TERMS_ACCEPTED_KEY, TERMS_VERSION } from "../constants/onboarding";
import { APP_DARK, APP_LIGHT, ACCT, FontFamily } from "../constants/theme";

const POINTS = [
  "Avenas is free to use. Pro is optional and only unlocks extra features.",
  "Your workout data stays on your device.",
  "Be respectful when using community and trainer features.",
  "You can edit or delete your details anytime in Settings.",
];

export default function AcceptTermsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { completeOnboarding } = useUserProfile();
  const params = useLocalSearchParams<{ name?: string; email?: string }>();

  const [agreed, setAgreed] = useState(false);

  const onAgree = () => {
    if (!agreed) return;
    setJSON(TERMS_ACCEPTED_KEY, TERMS_VERSION);
    const name = (params.name ?? "").trim();
    const email = (params.email ?? "").trim();
    completeOnboarding(name && email ? { name, email } : undefined);
    router.navigate("/account-created");
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={[styles.backBtn, { top: insets.top + 12, backgroundColor: isDark ? t.div : "#ffffff" }]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={t.tp} />
      </TouchableOpacity>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 64, paddingBottom: 24 }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: ACCT + "1A" }]}>
          <Ionicons name="shield-checkmark-outline" size={30} color={ACCT} />
        </View>
        <Text style={[styles.title, { color: t.tp }]}>Terms & Privacy</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>One last step. Please review and accept to finish creating your account.</Text>

        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.cardInner}>
            {POINTS.map((point, i) => (
              <View key={i} style={[styles.point, i > 0 && styles.pointGap]}>
                <Ionicons name="checkmark-circle" size={18} color={ACCT} style={styles.pointIcon} />
                <Text style={[styles.pointText, { color: t.tp }]}>{point}</Text>
              </View>
            ))}
          </View>
        </NeuCard>

        <NeuCard dark={isDark} style={styles.card}>
          <View>
            <TouchableOpacity
              style={styles.linkRow}
              activeOpacity={0.7}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.navigate("/terms-of-service"); }}
              accessibilityRole="button"
              accessibilityLabel="Read the Terms of Service"
            >
              <Ionicons name="document-text-outline" size={20} color={t.icon} />
              <Text style={[styles.linkText, { color: t.tp }]}>Terms of Service</Text>
              <Ionicons name="chevron-forward" size={18} color={t.ts} />
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: t.div }]} />
            <TouchableOpacity
              style={styles.linkRow}
              activeOpacity={0.7}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.navigate("/privacy-policy"); }}
              accessibilityRole="button"
              accessibilityLabel="Read the Privacy Policy"
            >
              <Ionicons name="shield-outline" size={20} color={t.icon} />
              <Text style={[styles.linkText, { color: t.tp }]}>Privacy Policy</Text>
              <Ionicons name="chevron-forward" size={18} color={t.ts} />
            </TouchableOpacity>
          </View>
        </NeuCard>

        <TouchableOpacity
          style={styles.agreeRow}
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAgreed((v) => !v); }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
        >
          <View style={[styles.box, { borderColor: agreed ? ACCT : t.div }, agreed && { backgroundColor: ACCT }]}>
            {agreed && <Ionicons name="checkmark" size={15} color="#fff" />}
          </View>
          <Text style={[styles.agreeText, { color: t.tp }]}>
            I have read and agree to the Terms of Service and Privacy Policy.
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <PrimaryButton label="Agree & Continue" dark={isDark} disabled={!agreed} onPress={onAgree} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1 },
  backBtn:   { position: "absolute", left: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scroll:    { paddingHorizontal: 28 },
  iconWrap:  { alignSelf: "center", width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title:     { fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  subtitle:  { fontFamily: FontFamily.regular, fontSize: 15, textAlign: "center", marginTop: 8, marginBottom: 24, lineHeight: 21 },
  card:      { borderRadius: 18, marginBottom: 16 },
  cardInner: { padding: 16 },
  point:     { flexDirection: "row", alignItems: "flex-start" },
  pointGap:  { marginTop: 12 },
  pointIcon: { marginTop: 1 },
  pointText: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20, flex: 1, marginLeft: 10 },
  linkRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 15 },
  linkText:  { fontFamily: FontFamily.semibold, fontSize: 15, flex: 1 },
  divider:   { height: 1, marginHorizontal: 16 },
  agreeRow:  { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, marginTop: 8 },
  box:       { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  agreeText: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20, flex: 1 },
  footer:    { paddingHorizontal: 28, paddingTop: 12 },
});
