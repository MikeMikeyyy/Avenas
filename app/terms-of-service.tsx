import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import NeuCard from "../components/NeuCard";
import { useTheme } from "../contexts/ThemeContext";
import { APP_LIGHT, APP_DARK, FontFamily } from "../constants/theme";

const TP = APP_LIGHT.tp;

// Written to match the app as it ships: accounts with cloud backup, trainer and
// group features, and the zero-tolerance community rules users also accept in
// constants/community.ts (Apple Guideline 1.2), which section 6 must agree with.
// Bump TERMS_VERSION (constants/onboarding.ts) to have everyone re-accept after
// a material change. No em dashes in the copy.
const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "1. Agreement",
    body: "These Terms are an agreement between you and Avenas. By creating an account or using the app, you agree to them and to our Privacy Policy. If you don't agree, please don't use Avenas.",
  },
  {
    heading: "2. Who Can Use Avenas",
    body: "You must be at least 13 years old to use Avenas. If you're under the age of adulthood where you live, you need permission from a parent or guardian.",
  },
  {
    heading: "3. Your Account",
    body: "You're responsible for your account and for keeping your sign in details secure. Keep your details accurate, and contact us if you think someone else has used your account. You can delete your account at any time with Delete Account in Settings.",
  },
  {
    heading: "4. Using the App",
    body: "Avenas is for tracking your own training and, if you choose, working with trainers, clients and groups. Please don't misuse it. That includes breaking the law, trying to access other people's accounts or data, interfering with how the app works, sending spam or unwanted connection requests, or copying or reselling the app.",
  },
  {
    heading: "5. Your Content",
    body: "You own the programs, workouts, journal entries, custom exercises, messages and photos you create. You give Avenas permission to store, back up and display that content only as needed to run the app for you, including showing it to the people you choose to share it with. You're responsible for what you share and for having the right to share it.",
  },
  {
    heading: "6. Community Rules",
    body: "Messaging, groups and program sharing connect you with other people, so our Community Guidelines apply whenever you use them. There is zero tolerance for objectionable content or abusive behaviour. You can report or block anyone, and we review every report and act within 24 hours. We may remove content and suspend or permanently remove accounts that break these rules.",
  },
  {
    heading: "7. Trainers and Clients",
    body: "Avenas connects people but doesn't employ, vet or endorse trainers. Any coaching relationship is between you and the other person, and trainers are responsible for the programs and advice they give. Use your own judgement before following a program from anyone.",
  },
  {
    heading: "8. Health and Safety",
    body: "Avenas doesn't give medical advice and isn't a substitute for a doctor or qualified professional. Check with one before starting a new exercise program, especially if you have an injury or health condition. Stop and get help if you feel pain, dizziness or discomfort while training. You train at your own risk.",
  },
  {
    heading: "9. Changes to the App",
    body: "We're always improving Avenas, so features may be added, changed or removed, and sometimes you'll need to update the app to keep using it. We aim to keep things running smoothly but can't promise the app will always be available or free of errors. We back up your training data while you're signed in, but please don't rely on Avenas as your only record.",
  },
  {
    heading: "10. Ending Your Use",
    body: "You can stop using Avenas and delete your account at any time. We may suspend or close accounts that break these Terms or the Community Guidelines, or when the law requires us to.",
  },
  {
    heading: "11. Disclaimers and Liability",
    body: "Avenas is provided “as is” and “as available”, without warranties of any kind. To the fullest extent the law allows, Avenas isn't liable for any injury, loss of data or indirect loss arising from your use of the app, or for anything another user says, shares or does. Nothing in these Terms limits rights you have under consumer law that can't be excluded.",
  },
  {
    heading: "12. Apple",
    body: "These Terms are between you and Avenas, not Apple. Apple isn't responsible for the app or its content, and your use of Avenas must also follow the App Store's usage rules.",
  },
  {
    heading: "13. Changes to These Terms",
    body: "We may update these Terms from time to time. The date at the top of this page shows the latest version, and if a change is significant we'll ask you to review it in the app. Continuing to use Avenas after an update means you accept the new Terms.",
  },
  {
    heading: "14. Contact",
    body: "Questions about these Terms? Email support@avenas.com.",
  },
];

export default function TermsOfServiceScreen() {
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
        <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
          <Ionicons name="chevron-back" size={22} color={t.tp} />
        </View>
      </TouchableOpacity>

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Terms of Service</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.updated, { color: t.ts }]}>Last updated: September 2026</Text>

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
