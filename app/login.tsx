import { useState } from "react";
import { Alert, View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "../contexts/ThemeContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import GoogleIcon from "../components/icons/GoogleIcon";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import { APP_DARK, APP_LIGHT, ACCT, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";
import { oauthOnlyProvidersForEmail, signInWithEmail, signInWithProvider, signOut } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { pullProfile } from "../lib/cloud";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SocialButton({
  icon, label, dark, onPress,
}: { icon: React.ReactNode; label: string; dark: boolean; onPress: () => void }) {
  const t = dark ? APP_DARK : APP_LIGHT;
  return (
    <BounceButton onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <NeuCard dark={dark} radius={28} style={styles.social}>
        <View style={styles.socialInner}>
          {icon}
          <Text style={[styles.socialText, { color: t.tp }]}>{label}</Text>
        </View>
      </NeuCard>
    </BounceButton>
  );
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const btnContent = isDark ? APP_DARK.bg : "#fff";
  const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = EMAIL_RE.test(email.trim()) && password.length > 0;

  // After auth, the profile step loads this account's saved profile and goes Home.
  // `from` lets that screen's back button return here (this screen was replaced,
  // so it's no longer on the back stack).
  const afterAuth = () => router.replace({ pathname: "/complete-profile", params: { from: "login" } });

  const onSubmit = async () => {
    if (!canSubmit || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      await signInWithEmail(email.trim(), password);
      afterAuth();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/invalid login/i.test(msg)) {
        // A Google/Apple-created account has no password, and Supabase's
        // invalid-credentials error is identical to "no such account". Ask
        // the server whether this email is an OAuth-only account so we can
        // point at the right button instead of claiming it doesn't exist.
        const providers = await oauthOnlyProvidersForEmail(email);
        if (providers.length > 0) {
          const label = providers.map(p => (p === "google" ? "Google" : "Apple")).join(" or ");
          Alert.alert(
            `Use ${label} to log in`,
            `This account was created with ${label}, so it doesn't have a password. Log in with the "Continue with ${label}" button instead.`,
            providers.includes("google")
              ? [
                  { text: "Cancel", style: "cancel" },
                  { text: "Continue with Google", onPress: () => { void onGoogle(); } },
                ]
              : [{ text: "OK" }],
          );
        } else {
          Alert.alert(
            "Account not found",
            "We couldn't log you in with that email and password. If you're new to Avenas, sign up to create an account.",
            [
              { text: "Try again", style: "cancel" },
              { text: "Sign up", onPress: () => router.replace("/signup") },
            ],
          );
        }
      } else {
        Alert.alert("Couldn't log in", msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      await signInWithProvider("google");
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      const profile = uid ? await pullProfile(uid) : null;
      if (profile && !profile.complete) {
        // No finished account exists for this Google account yet — treat as sign-up.
        // Cancelling must sign out the half-created session so the user isn't stuck signed in.
        Alert.alert(
          "New here?",
          "There's no Avenas account for that Google account yet — let's get you set up.",
          [
            { text: "Cancel", style: "cancel", onPress: () => { void signOut({ force: true }); } },
            { text: "Continue", onPress: afterAuth },
          ],
        );
      } else {
        afterAuth();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) Alert.alert("Google sign-in failed", msg);
    } finally {
      setBusy(false);
    }
  };

  const onApple = () => {
    Alert.alert("Apple sign-in", "Apple sign-in turns on in the next build. For now, use Google or email.");
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

      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 90, paddingBottom: insets.bottom + 32 }]}
      >
        <Text style={[styles.title, { color: t.tp }]}>Welcome back</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>Log in to pick up where you left off.</Text>

        <Text style={[styles.label, { color: t.ts }]}>EMAIL</Text>
        <NeuCard dark={isDark} radius={16} style={styles.field}>
          <TextInput
            style={[styles.input, { color: t.tp }]}
            placeholder="you@email.com"
            placeholderTextColor={t.ts}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            textContentType="emailAddress"
          />
        </NeuCard>

        <Text style={[styles.label, { color: t.ts }]}>PASSWORD</Text>
        <NeuCard dark={isDark} radius={16} style={styles.field}>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput, { color: t.tp }]}
              placeholder="Your password"
              placeholderTextColor={t.ts}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              textContentType="password"
            />
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowPassword(v => !v); }}
              style={styles.eyeBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            >
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={t.ts} />
            </TouchableOpacity>
          </View>
        </NeuCard>

        <View style={styles.ctaSection}>
          <BounceButton onPress={onSubmit} accessibilityRole="button" accessibilityLabel="Log in">
            <View style={[styles.ctaWrap, { backgroundColor: btnBg, shadowColor: btnShadow }, (!canSubmit || busy) && styles.ctaDisabled]}>
              <View style={[styles.cta, { backgroundColor: btnBg }]}>
                <Text style={[styles.ctaText, { color: btnContent }]}>{busy ? "Please wait…" : "Log in"}</Text>
              </View>
            </View>
          </BounceButton>

          <View style={styles.orRow}>
            <View style={[styles.orLine, { backgroundColor: t.div }]} />
            <Text style={[styles.orText, { color: t.ts }]}>or continue with</Text>
            <View style={[styles.orLine, { backgroundColor: t.div }]} />
          </View>

          <SocialButton
            icon={<Ionicons name="logo-apple" size={20} color={t.tp} style={styles.appleIcon} />}
            label="Continue with Apple"
            dark={isDark}
            onPress={onApple}
          />
          <SocialButton
            icon={<GoogleIcon size={18} />}
            label="Continue with Google"
            dark={isDark}
            onPress={onGoogle}
          />

          <TouchableOpacity onPress={() => router.replace("/signup")} style={styles.switchRow} accessibilityRole="button">
            <Text style={[styles.switchText, { color: t.ts }]}>
              Don&apos;t have an account? <Text style={{ color: ACCT, fontFamily: FontFamily.bold }}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>

      <KeyboardDismissButton />
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },
  backBtn:       { position: "absolute", left: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scroll:        { paddingHorizontal: 28 },
  title:         { fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  subtitle:      { fontFamily: FontFamily.regular, fontSize: 15, textAlign: "center", marginTop: 8, marginBottom: 16 },
  label:         { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4, marginTop: 18 },
  field:         { borderRadius: 16 },
  input:         { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 16, paddingHorizontal: 18 },
  passwordRow:   { flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, paddingRight: 8 },
  eyeBtn:        { paddingHorizontal: 16, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  ctaSection:    { marginTop: 28, gap: 16 },
  ctaWrap:       { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  ctaDisabled:   { opacity: 0.4 },
  cta:           { borderRadius: 28, paddingVertical: 17, alignItems: "center", justifyContent: "center" },
  ctaText:       { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3 },
  orRow:         { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  orLine:        { flex: 1, height: 1 },
  orText:        { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.3 },
  social:        { borderRadius: 28 },
  socialInner:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 15 },
  appleIcon:     { transform: [{ translateY: -1 }] },
  socialText:    { fontFamily: FontFamily.bold, fontSize: 16 },
  switchRow:     { alignItems: "center", paddingVertical: 8, marginTop: 4 },
  switchText:    { fontFamily: FontFamily.semibold, fontSize: 14 },
});
