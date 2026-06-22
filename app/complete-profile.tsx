// Per-account profile step, shown right after sign-in (any method). A brand-new
// account fills in name + role + units here; a returning account already has a
// profile in Supabase, so this screen loads it and continues straight to Home.

import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { useAccountType, type AccountType } from "../contexts/AccountTypeContext";
import { useUserProfile, initialsFromName } from "../contexts/UserProfileContext";
import { useAuth } from "../contexts/AuthContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import { APP_DARK, APP_LIGHT, ACCT, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";
import { pullProfile, pushProfile } from "../lib/cloud";
import { signOut } from "../lib/auth";

function Choice({ label, selected, onPress, dark }: { label: string; selected: boolean; onPress: () => void; dark: boolean }) {
  const t = dark ? APP_DARK : APP_LIGHT;
  return (
    <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.85} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      <View style={[styles.choice, selected
        ? { backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6 }
        : { backgroundColor: dark ? "rgba(255,255,255,0.08)" : t.div },
      ]}>
        <Text style={[styles.choiceText, { color: selected ? "#fff" : t.tp }]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function CompleteProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const btnContent = isDark ? APP_DARK.bg : "#fff";

  const { session } = useAuth();
  const { setProfile, completeOnboarding } = useUserProfile();
  const { setAccountType } = useAccountType();
  const { setIsKg } = useUnit();

  const userId = session?.user.id;
  const email = session?.user.email ?? "";

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [role, setRole] = useState<AccountType>("gym_user");
  const [kg, setKg] = useState(true);
  const [busy, setBusy] = useState(false);

  // On mount: returning account → load profile + go straight to Home.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await pullProfile(userId);
        if (cancelled) return;
        if (profile?.complete) {
          const photoUri = profile.avatarUrl ?? undefined;
          setProfile({ name: profile.name, email, photoUri });
          setAccountType(profile.accountType);
          setIsKg(profile.unit === "kg");
          completeOnboarding({ name: profile.name, email, photoUri });
          router.replace("/home");
          return;
        }
        // New account: leave the name blank for the user to enter their own.
      } catch {
        /* fall through to the form */
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Top-right escape hatch back to the login/signup screen the user came from
  // (before they picked an email). Picking an account already created a Supabase
  // session, so sign out first — otherwise re-picking wouldn't re-prompt and this
  // half-set-up account would be sent straight to Home (no profile) on next launch.
  const onBack = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { await signOut(); } catch { /* navigate back regardless */ }
    if (from === "signup") { router.replace("/signup"); return; }
    if (from === "login") { router.replace("/login"); return; }
    // No recorded origin (e.g. deep link): fall back to the start page.
    if (router.canDismiss()) router.dismissAll();
    router.replace("/onboarding");
  };

  const onContinue = async () => {
    const trimmed = name.trim();
    if (!trimmed || !userId || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      setProfile({ name: trimmed, email });
      setAccountType(role);
      setIsKg(kg);
      await pushProfile(userId, { name: trimmed, email, accountType: role, unit: kg ? "kg" : "lb" });
      router.push({ pathname: "/accept-terms", params: { name: trimmed, email } });
    } catch (e) {
      Alert.alert("Couldn't save profile", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={ACCT} />
      </View>
    );
  }

  const initials = initialsFromName(name);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TouchableOpacity
        onPress={onBack}
        style={[styles.backBtn, { top: insets.top + 12, backgroundColor: isDark ? t.div : "#ffffff" }]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={t.tp} />
      </TouchableOpacity>

      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.avatarSection}>
          <NeuCard dark={isDark} radius={44} style={styles.avatar}>
            <View style={styles.avatarInner}>
              {initials
                ? <Text style={[styles.avatarText, { color: t.icon }]}>{initials}</Text>
                : <Ionicons name="person-outline" size={34} color={t.ts} />}
            </View>
          </NeuCard>
        </View>

        <Text style={[styles.title, { color: t.tp }]}>Set up your profile</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>A couple of details to get you training.</Text>

        <Text style={[styles.label, { color: t.ts }]}>NAME</Text>
        <NeuCard dark={isDark} radius={16} style={styles.field}>
          <TextInput
            style={[styles.input, { color: t.tp }]}
            placeholder="Your name"
            placeholderTextColor={t.ts}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            textContentType="name"
          />
        </NeuCard>

        <Text style={[styles.label, { color: t.ts }]}>I AM A</Text>
        <View style={styles.row}>
          <Choice label="Gym User" selected={role === "gym_user"} onPress={() => setRole("gym_user")} dark={isDark} />
          <Choice label="Trainer" selected={role === "pt"} onPress={() => setRole("pt")} dark={isDark} />
        </View>

        <Text style={[styles.label, { color: t.ts }]}>UNITS</Text>
        <View style={styles.row}>
          <Choice label="Kilograms (kg)" selected={kg} onPress={() => setKg(true)} dark={isDark} />
          <Choice label="Pounds (lbs)" selected={!kg} onPress={() => setKg(false)} dark={isDark} />
        </View>

        <BounceButton style={{ marginTop: 32 }} onPress={onContinue} accessibilityRole="button" accessibilityLabel="Continue">
          <View style={[styles.ctaWrap, { backgroundColor: btnBg }, (!name.trim() || busy) && styles.ctaDisabled]}>
            <View style={[styles.cta, { backgroundColor: btnBg }]}>
              <Text style={[styles.ctaText, { color: btnContent }]}>{busy ? "Saving…" : "Continue"}</Text>
            </View>
          </View>
        </BounceButton>
      </KeyboardAwareScrollView>

      <KeyboardDismissButton />
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },
  center:        { alignItems: "center", justifyContent: "center" },
  backBtn:       { position: "absolute", right: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scroll:        { paddingHorizontal: 28 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatar:        { width: 88, height: 88, borderRadius: 44 },
  avatarInner:   { width: 88, height: 88, alignItems: "center", justifyContent: "center" },
  avatarText:    { fontFamily: FontFamily.bold, fontSize: 30 },
  title:         { fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  subtitle:      { fontFamily: FontFamily.regular, fontSize: 15, textAlign: "center", marginTop: 8, marginBottom: 8 },
  label:         { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4, marginTop: 18 },
  field:         { borderRadius: 16 },
  input:         { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 16, paddingHorizontal: 18 },
  row:           { flexDirection: "row", gap: 10 },
  choice:        { borderRadius: 15, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  choiceText:    { fontFamily: FontFamily.semibold, fontSize: 14 },
  ctaWrap:       { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
  ctaDisabled:   { opacity: 0.4 },
  cta:           { borderRadius: 28, paddingVertical: 17, alignItems: "center", justifyContent: "center" },
  ctaText:       { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3 },
});
