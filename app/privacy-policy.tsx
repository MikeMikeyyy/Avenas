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

// Every statement here was checked against what the app and its database
// actually do (supabase/migrations, lib/cloud.ts, lib/push.ts, app.json). When a
// feature starts collecting, sharing or keeping something new, this has to
// change with it. No em dashes in the copy.
const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "1. About This Policy",
    body: "This policy explains what information Avenas collects, how it's used, who can see it and the choices you have. It applies to the Avenas app and the account you create in it.",
  },
  {
    heading: "2. Information You Give Us",
    body:
      "Account details: your name, email address and password, or the name and email Apple or Google share with us when you sign in with them. If you use Hide My Email with Apple, you can also add a contact email.\n\n" +
      "Profile: your profile photo if you add one, whether you use Avenas as a Gym User or a Trainer, and your preferred weight unit.\n\n" +
      "Training data: your programs, workout history, journal entries and custom exercises, including the weights, reps, dates and notes you record.\n\n" +
      "Messages and sharing: messages you send to your connections and groups, programs you share or send for review, and the groups you create or join.\n\n" +
      "Reports: if you report a person or a message, the reason you give and a copy of the reported message.",
  },
  {
    heading: "3. Information Collected Automatically",
    body:
      "Activity status: while you use the app, we record when you were last active. People you're connected with can only see it if Show Activity Status is on in Privacy & Security.\n\n" +
      "Notifications: if you allow push notifications, we store your device's push token and which kinds of notifications you want, so we can deliver them.\n\n" +
      "Technical information: like most online services, our service providers may process technical details such as your IP address when the app connects to them.\n\n" +
      "We don't use analytics or advertising tools, we don't track you across other apps or websites, and we don't collect your location.",
  },
  {
    heading: "4. Information That Stays on Your Device",
    body: "Some things never leave your phone: photos and videos you add to custom exercises, your favourite exercises, your display and notification settings, workouts you haven't finished yet, and your streak. The camera is only used to scan connect codes and to take photos for custom exercises.",
  },
  {
    heading: "5. How We Use Your Information",
    body:
      "We use your information to run your account and back up your training data, so it's there when you sign in on another device. It powers features like your history, previous set values, progress charts and reminders. It lets you connect with trainers, clients and groups, and delivers your messages, shared programs and notifications. We also use it to keep the community safe, including reviewing reports and preventing abuse such as spam connection requests.\n\n" +
      "We never sell your information or use it for advertising.",
  },
  {
    heading: "6. What Other People Can See",
    body:
      "People you connect with, and members of groups you join, can see your name, profile photo and account type, the messages you send them and any programs you share with them. They can see when you were last active only if Show Activity Status is on.\n\n" +
      "Trainers you connect with can also see your training data: your programs, workout history, journal entries and custom exercises, so they can follow your progress and coach you. Being in the same group doesn't share it. It stops as soon as either of you removes the connection or blocks the other. Nobody else can see your training data.\n\n" +
      "Your profile photo is stored so it can be shown in the app, which means anyone who has its web link can view it.",
  },
  {
    heading: "7. Service Providers",
    body:
      "We rely on a small number of providers to run Avenas. Supabase hosts our database, sign in and file storage. Expo delivers push notifications, which pass through Apple to reach your phone. Apple and Google provide sign in if you choose to use them.\n\n" +
      "Push notifications for messages include the sender's name and the start of the message. Each provider handles information under its own privacy policy.",
  },
  {
    heading: "8. How Long We Keep It",
    body: "We keep your information for as long as you have an account. When you delete your account, your profile, profile photo, training data, messages, connections, shared programs and the groups you own are permanently deleted, along with any reports you've made. A report someone else made about you, including any message it quotes, is kept so we can act on it.",
  },
  {
    heading: "9. Your Choices",
    body: "You can view and change your training data, name, email, photo and account type in the app at any time. You can turn off Show Activity Status in Privacy & Security, choose which notifications you get in Notifications, block people and remove connections. You can delete your account and all of its data with Delete Account in Settings. For a copy of your data or any other privacy request, contact us.",
  },
  {
    heading: "10. Security",
    body: "Your data travels over encrypted connections, and our database only lets your training data be reached by your own account and by trainers you're connected with. No system is completely secure, so please use a strong password and keep your phone locked.",
  },
  {
    heading: "11. Children",
    body: "Avenas isn't intended for children under 13, and we don't knowingly collect information from them. If you think a child has given us information, contact us and we'll delete it.",
  },
  {
    heading: "12. Changes to This Policy",
    body: "We may update this policy as Avenas changes. The date at the top of this page shows when it was last updated, and if a change is significant we'll let you know in the app.",
  },
  {
    heading: "13. Contact",
    body: "Questions or requests about your privacy? Email privacy@avenas.com.",
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
          <Text style={[styles.title, { color: t.tp }]}>Privacy Policy</Text>
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
