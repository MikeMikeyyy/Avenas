// Forgot Password, opened from the log-in screen. Two steps on one page:
// the email (Supabase sends a reset code to it), then the code and a new
// password. The code signs the user in, so a finished reset carries on exactly
// as a log-in does. See lib/auth.ts for why it's a code and not a link.

import { useEffect, useRef, useState } from "react";
import { Alert, View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "../contexts/ThemeContext";
import { useOffline } from "../contexts/ConnectivityContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";
import { ABOVE_KEYBOARD_TOOLS } from "../constants/floatingBars";
import { APP_DARK, APP_LIGHT, ACCT, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";
import { pill, PILL_H } from "../constants/buttons";
import { oauthOnlyProvidersForEmail, sendPasswordResetCode, setNewPassword, verifyPasswordResetCode } from "../lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
/** Supabase sends one reset email a minute to an address. */
const RESEND_SECONDS = 60;
/** The code's length is a project setting (6 by default, up to 10). */
const CODE_RE = /^\d{6,10}$/;

/** What went wrong, in words for the user. */
function resetErrorMessage(e: unknown): string {
  const err = e as { code?: string; status?: number; message?: string };
  const msg = err?.message ?? String(e);
  if (err?.code === "otp_expired" || (/expired|invalid/i.test(msg) && /token|otp|code/i.test(msg))) {
    return "That code is wrong or has expired. Check the latest email, or send a new code.";
  }
  if (err?.status === 429 || /rate limit|security purposes/i.test(msg)) {
    return "Too many emails have been sent to this address. Wait a minute and try again.";
  }
  if (err?.code === "weak_password") {
    return "Choose a stronger password.";
  }
  if (/network|fetch/i.test(msg)) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return msg;
}

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const offline = useOffline();
  const params = useLocalSearchParams<{ email?: string }>();

  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const btnContent = isDark ? APP_DARK.bg : APP_LIGHT.ctrl;
  const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";

  const [email, setEmail] = useState(params.email ?? "");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // A code works once: after it's taken, only the password is retried.
  const [verified, setVerified] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const emailOk = EMAIL_RE.test(email.trim());
  const codeOk = verified || CODE_RE.test(code.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const canSend = emailOk && !busy;
  const canReset = codeOk && passwordOk && !busy;

  const sendCode = async (): Promise<boolean> => {
    // A Google/Apple account has no password to reset.
    const providers = await oauthOnlyProvidersForEmail(email);
    if (providers.length > 0) {
      const label = providers.map(p => (p === "google" ? "Google" : "Apple")).join(" or ");
      Alert.alert(
        `Use ${label} to log in`,
        `This account was created with ${label}, so it doesn't have a password to reset. Log in with the "Continue with ${label}" button instead.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
      return false;
    }
    await sendPasswordResetCode(email);
    setResendIn(RESEND_SECONDS);
    return true;
  };

  const onSend = async () => {
    if (!canSend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      if (await sendCode()) {
        setStep("code");
        setTimeout(() => codeRef.current?.focus(), 250);
      }
    } catch (e) {
      Alert.alert("Couldn't send the code", resetErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (busy || resendIn > 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      if (await sendCode()) {
        setCode("");
        Alert.alert("Code sent", `We've sent a new code to ${email.trim()}.`);
      }
    } catch (e) {
      Alert.alert("Couldn't send the code", resetErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!canReset) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      if (!verified) {
        await verifyPasswordResetCode(email, code);
        setVerified(true);
      }
      await setNewPassword(password);
      Alert.alert(
        "Password changed",
        "You're logged in with your new password.",
        [{ text: "OK", onPress: () => router.replace({ pathname: "/complete-profile", params: { from: "login" } }) }],
      );
    } catch (e) {
      Alert.alert("Couldn't reset your password", resetErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const changeEmail = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep("email");
    setCode("");
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <BackButton />

      <KeyboardAwareScrollView
        bottomOffset={ABOVE_KEYBOARD_TOOLS}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + BACK_TOP + BACK_SIZE + 38, paddingBottom: insets.bottom + 32 }]}
      >
        <Text style={[styles.title, { color: t.tp }]}>Reset password</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>
          {step === "email"
            ? "Enter your account's email and we'll send you a code to set a new password."
            : `Enter the code we sent to ${email.trim()}, then choose a new password.`}
        </Text>

        {step === "email" ? (
          <>
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
                returnKeyType="send"
                onSubmitEditing={onSend}
                textContentType="emailAddress"
              />
            </NeuCard>

            <View style={styles.ctaSection}>
              <BounceButton onPress={onSend} needsConnection accessibilityRole="button" accessibilityLabel="Send code">
                <View style={[styles.ctaWrap, { backgroundColor: btnBg, shadowColor: btnShadow }, (!canSend || offline) && styles.ctaDisabled]}>
                  <View style={[styles.cta, { backgroundColor: btnBg }]}>
                    <Text style={[styles.ctaText, { color: btnContent }]}>{busy ? "Please wait…" : "Send code"}</Text>
                  </View>
                </View>
              </BounceButton>
            </View>
          </>
        ) : (
          <>
            {!verified && (
              <>
                <Text style={[styles.label, { color: t.ts }]}>CODE</Text>
                <NeuCard dark={isDark} radius={16} style={styles.field}>
                  <TextInput
                    ref={codeRef}
                    style={[styles.input, styles.codeInput, { color: t.tp }]}
                    placeholder="123456"
                    placeholderTextColor={t.ts}
                    value={code}
                    onChangeText={s => setCode(s.replace(/\D/g, ""))}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    maxLength={10}
                  />
                </NeuCard>
              </>
            )}

            <Text style={[styles.label, { color: t.ts }]}>NEW PASSWORD</Text>
            <NeuCard dark={isDark} radius={16} style={styles.field}>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput, { color: t.tp }]}
                  placeholder={`At least ${MIN_PASSWORD} characters`}
                  placeholderTextColor={t.ts}
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={onReset}
                  textContentType="newPassword"
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
              <BounceButton onPress={onReset} needsConnection accessibilityRole="button" accessibilityLabel="Set new password">
                <View style={[styles.ctaWrap, { backgroundColor: btnBg, shadowColor: btnShadow }, (!canReset || offline) && styles.ctaDisabled]}>
                  <View style={[styles.cta, { backgroundColor: btnBg }]}>
                    <Text style={[styles.ctaText, { color: btnContent }]}>{busy ? "Please wait…" : "Set new password"}</Text>
                  </View>
                </View>
              </BounceButton>

              {!verified && (
                <>
                  <Text style={[styles.hint, { color: t.ts }]}>
                    No email? Check your junk folder. It can take a minute to arrive.
                  </Text>
                  <TouchableOpacity onPress={onResend} disabled={resendIn > 0 || busy} style={styles.linkRow} accessibilityRole="button">
                    <Text style={[styles.linkText, { color: resendIn > 0 ? t.ts : ACCT }]}>
                      {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={changeEmail} style={styles.linkRow} accessibilityRole="button">
                    <Text style={[styles.linkText, { color: t.ts }]}>Use a different email</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </>
        )}
      </KeyboardAwareScrollView>

      <KeyboardDismissButton />
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },
  scroll:        { paddingHorizontal: 28 },
  title:         { fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  subtitle:      { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 8, marginBottom: 16 },
  label:         { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4, marginTop: 18 },
  field:         { borderRadius: 16 },
  input:         { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 16, paddingHorizontal: 18 },
  codeInput:     { fontFamily: FontFamily.bold, fontSize: 20, letterSpacing: 4 },
  passwordRow:   { flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, paddingRight: 8 },
  eyeBtn:        { paddingHorizontal: 16, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  ctaSection:    { marginTop: 28, gap: 16 },
  ctaWrap:       { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  ctaDisabled:   { opacity: 0.4 },
  cta:           { ...pill(PILL_H) },
  ctaText:       { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3 },
  hint:          { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: 4 },
  linkRow:       { alignItems: "center", paddingVertical: 4 },
  linkText:      { fontFamily: FontFamily.semibold, fontSize: 14 },
});
