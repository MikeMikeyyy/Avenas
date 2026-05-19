import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, LayoutAnimation, Platform, UIManager } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import NeuCard from "../components/NeuCard";
import { useTheme } from "../contexts/ThemeContext";
import { APP_LIGHT, APP_DARK, FontFamily } from "../constants/theme";

type ThemeColors = { bg: string; tp: string; ts: string; icon: string; div: string };

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TP = APP_LIGHT.tp;

const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I start a workout?",
    a: "From Home, tap today's workout card to begin. If you don't have an active program, you can start a free workout from the same screen and (optionally) save it to your active program.",
  },
  {
    q: "How do I create a program?",
    a: "Go to Programs, tap New Program, set the cycle length and a workout for each day in the cycle, then save. Mark it active to make it appear on Home.",
  },
  {
    q: "How do I switch between kg and lbs?",
    a: "Settings → App → Units. The toggle changes weights everywhere in the app instantly.",
  },
  {
    q: "How do I log a past workout?",
    a: "From the Journal screen, pick the date you missed and choose Log Workout. The entry will appear in your history and count toward your streak.",
  },
  {
    q: "How do I edit or delete a journal entry?",
    a: "Open the entry from Journal, then use the edit or delete action. Workouts themselves are managed from the workout detail screen — Journal only edits the journal note.",
  },
  {
    q: "Where is my data stored?",
    a: "All of your workouts, programs, and journal entries are stored locally on your device. Uninstalling the app removes them. See Privacy Policy for details.",
  },
  {
    q: "How do I switch between Gym User and Trainer?",
    a: "Settings → Account Type → tap the side you want. The app's home screen and navigation will adapt to that role.",
  },
];

function FAQItem({ q, a, isFirst, t }: { q: string; a: string; isFirst: boolean; t: ThemeColors }) {
  const [open, setOpen] = useState(false);
  const rot = useSharedValue(0);

  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    rot.value = withTiming(open ? 0 : 180, { duration: 180 });
    setOpen(o => !o);
  };

  return (
    <View>
      {!isFirst && <View style={[styles.divider, { backgroundColor: t.div }]} />}
      <TouchableOpacity activeOpacity={0.7} onPress={toggle} style={styles.row}>
        <Text style={[styles.question, { color: t.tp }]} numberOfLines={2}>{q}</Text>
        <Reanimated.View style={chevronStyle}>
          <Ionicons name="chevron-down" size={18} color={t.ts} />
        </Reanimated.View>
      </TouchableOpacity>
      {open && (
        <View style={styles.answerWrap}>
          <Text style={[styles.answer, { color: t.tp }]}>{a}</Text>
        </View>
      )}
    </View>
  );
}

export default function HelpFaqScreen() {
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
          <Text style={[styles.title, { color: t.tp }]}>Help & FAQ</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.subtitle, { color: t.ts }]}>Answers to common questions</Text>

        <NeuCard dark={isDark} style={styles.card}>
          {FAQ.map((item, i) => (
            <FAQItem key={item.q} q={item.q} a={item.a} isFirst={i === 0} t={t} />
          ))}
        </NeuCard>

        <Text style={[styles.footer, { color: t.ts }]}>
          Still need help? Use Report a Bug or Request a Feature in Settings to get in touch.
        </Text>
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
  subtitle:     { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", marginBottom: 20 },
  card:         { borderRadius: 18, marginBottom: 16 },
  row:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 18, gap: 12 },
  question:     { fontFamily: FontFamily.semibold, fontSize: 15, flex: 1 },
  answerWrap:   { paddingHorizontal: 18, paddingBottom: 18, marginTop: -6 },
  answer:       { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 21 },
  divider:      { height: 1, marginHorizontal: 16 },
  footer:       { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", marginTop: 8, marginBottom: 16, paddingHorizontal: 24, lineHeight: 19 },
});
