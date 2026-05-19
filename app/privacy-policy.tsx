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
import { APP_LIGHT, APP_DARK, FontFamily } from "../constants/theme";

const TP = APP_LIGHT.tp;

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "1. Data We Collect",
    body: "Avenas collects only the data you enter yourself: workouts, exercises, programs, journal entries, body-weight measurements, and unit/theme preferences. We do not collect analytics, advertising identifiers, or location data.",
  },
  {
    heading: "2. How We Use Your Data",
    body: "Your data is used solely to power the features of the app — showing your history, suggesting previous sets, tracking your streak, and so on. It is never sold or shared with advertisers.",
  },
  {
    heading: "3. Where Your Data Is Stored",
    body: "All of your fitness data is stored locally on your device. We do not run a cloud backend that holds your workouts. If you delete the app, your data is removed with it — there is no copy on our servers.",
  },
  {
    heading: "4. Third-Party Services",
    body: "Avenas uses standard platform services from Apple (App Store rating prompts) and Expo (the framework the app is built on). These services have their own privacy policies and may collect basic device information when invoked.",
  },
  {
    heading: "5. Your Rights",
    body: "Because your data lives on your device, you can delete any workout, program, or journal entry at any time directly from the app. Uninstalling Avenas removes everything.",
  },
  {
    heading: "6. Children",
    body: "Avenas is not directed at children under 13 and we do not knowingly collect data from them.",
  },
  {
    heading: "7. Changes to This Policy",
    body: "We may update this policy from time to time. The “Last updated” date at the top of this screen will always reflect the most recent revision.",
  },
  {
    heading: "8. Contact",
    body: "Questions about your privacy? Reach us at privacy@avenas.com.",
  },
];

export default function PrivacyPolicyScreen() {
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
          <Text style={[styles.title, { color: t.tp }]}>Privacy Policy</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.updated, { color: t.ts }]}>Last updated: May 2026</Text>

        <NeuCard dark={isDark} style={styles.card}>
          {SECTIONS.map((s, i) => (
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
  title:        { fontFamily: FontFamily.bold, fontSize: 18, color: TP },
  updated:      { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", marginBottom: 20 },
  card:         { borderRadius: 18, marginBottom: 24 },
  section:      { paddingHorizontal: 18, paddingVertical: 18 },
  heading:      { fontFamily: FontFamily.bold, fontSize: 15, marginBottom: 8 },
  body:         { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 21 },
  divider:      { height: 1, marginHorizontal: 16 },
});
