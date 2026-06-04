// Standalone Community Guidelines page — the full text behind the agreement the
// user accepts before using the Trainer hub (Apple Guideline 1.2). Reachable from
// the agreement prompt ("Read the full guidelines") and from Settings.

import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import NeuCard from "../components/NeuCard";
import { useTheme } from "../contexts/ThemeContext";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import { COMMUNITY_GUIDELINES, COMMUNITY_PLEDGE } from "../constants/community";

const TP = APP_LIGHT.tp;

export default function CommunityGuidelinesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
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

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFillObject} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Community Guidelines</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.pledge, { color: ACCT }]}>{COMMUNITY_PLEDGE}</Text>

        <NeuCard dark={isDark} style={styles.card}>
          {COMMUNITY_GUIDELINES.map((s, i) => (
            <View key={s.heading}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
              <View style={styles.section}>
                <Text style={[styles.heading, { color: t.tp }]}>{s.heading}</Text>
                <Text style={[styles.body, { color: t.tp }]}>{s.body}</Text>
              </View>
            </View>
          ))}
        </NeuCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1 },
  topGradient:  { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:       { paddingHorizontal: 20 },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, height: 40 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  title:        { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center", flex: 1 },
  pledge:       { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: "center", marginBottom: 20, lineHeight: 20, paddingHorizontal: 12 },
  card:         { borderRadius: 18, marginBottom: 24 },
  section:      { paddingHorizontal: 18, paddingVertical: 18 },
  heading:      { fontFamily: FontFamily.bold, fontSize: 15, marginBottom: 8 },
  body:         { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 21 },
  divider:      { height: 1, marginHorizontal: 16 },
});
