import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withSpring, interpolateColor, type SharedValue,
} from "react-native-reanimated";

import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { useAccountType, type AccountType } from "../contexts/AccountTypeContext";
import { initialsFromName } from "../contexts/UserProfileContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import GoogleIcon from "../components/icons/GoogleIcon";
import { APP_DARK, APP_LIGHT, ACCT, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SPRING = { damping: 22, stiffness: 300, mass: 0.9 } as const;

// ─── Animated segmented control (sliding pill, matches the Settings toggle) ───
interface SegOption<T extends string> {
  label: string;
  val: T;
}

function SegmentItem<T extends string>({
  label, index, offset, dark, onPress,
}: { label: string; index: number; offset: SharedValue<number>; dark: boolean; onPress: () => void }) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const textStyle = useAnimatedStyle(() => {
    const dist = Math.min(Math.abs(offset.value - index), 1);
    return { color: interpolateColor(dist, [0, 1], ["#ffffff", t.ts]) };
  });
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.segBtn}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Reanimated.Text style={[styles.segText, textStyle]}>{label}</Reanimated.Text>
    </TouchableOpacity>
  );
}

function Segmented<T extends string>({
  options, value, onChange, dark,
}: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; dark: boolean }) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const n = options.length;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.val === value));
  const offset = useSharedValue(selectedIndex);
  const trackW = useSharedValue(0);
  const userTriggered = useRef(false);

  // Snap (no animation) when the value changes externally, e.g. an async
  // AsyncStorage load resolving after mount. User taps animate via withSpring.
  useEffect(() => {
    if (!userTriggered.current) offset.value = selectedIndex;
    userTriggered.current = false;
  }, [selectedIndex]);

  const pillStyle = useAnimatedStyle(() => ({
    width: trackW.value / n,
    transform: [{ translateX: offset.value * (trackW.value / n) }],
  }));

  return (
    <View
      style={[styles.segment, { backgroundColor: dark ? "rgba(255,255,255,0.08)" : t.div }]}
      onLayout={(e) => { trackW.value = e.nativeEvent.layout.width - 6; }}
    >
      <Reanimated.View style={[styles.segPill, pillStyle]} />
      {options.map((o, i) => (
        <SegmentItem
          key={o.val}
          label={o.label}
          index={i}
          offset={offset}
          dark={dark}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            userTriggered.current = true;
            onChange(o.val);
            offset.value = withSpring(i, SPRING);
          }}
        />
      ))}
    </View>
  );
}

// ─── Social sign-in button (temporary local stub, no real OAuth yet) ──────────
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

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Grey slate CTA, matching the home "Start Workout" and onboarding buttons.
  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const btnContent = isDark ? APP_DARK.bg : "#fff";
  const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";

  const { isKg, setIsKg } = useUnit();
  const { accountType, setAccountType } = useAccountType();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const trimmedName = name.trim();
  const emailOk = EMAIL_RE.test(email.trim());
  const canSubmit = trimmedName.length > 0 && emailOk;
  const initials = initialsFromName(name);

  // Hand off to the Terms step, which records acceptance, completes onboarding,
  // and continues to the celebration screen before Home.
  const onSubmit = () => {
    if (!canSubmit) return;
    router.push({ pathname: "/accept-terms", params: { name: trimmedName, email: email.trim() } });
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
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 32 }]}
      >
        {/* Avatar preview — fills with the user's initials as they type */}
        <View style={styles.avatarSection}>
          <NeuCard dark={isDark} radius={44} style={styles.avatar}>
            <View style={styles.avatarInner}>
              {initials ? (
                <Text style={[styles.avatarText, { color: t.icon }]}>{initials}</Text>
              ) : (
                <Ionicons name="person-outline" size={34} color={t.ts} />
              )}
            </View>
          </NeuCard>
        </View>

        <Text style={[styles.title, { color: t.tp }]}>Create your account</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>A few details and you're ready to train.</Text>

        {/* Reassurance: free to use, no paywall after signing up */}
        <View style={[styles.freeBadge, { backgroundColor: ACCT + "1A" }]}>
          <Ionicons name="sparkles" size={14} color={ACCT} />
          <Text style={[styles.freeBadgeText, { color: t.tp }]}>Free to use. No paywall after sign up.</Text>
        </View>

        {/* Name */}
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
            returnKeyType="next"
            textContentType="name"
          />
        </NeuCard>

        {/* Email */}
        <Text style={[styles.label, { color: t.ts }]}>EMAIL</Text>
        <NeuCard dark={isDark} radius={16} style={styles.field}>
          <TextInput
            style={[styles.input, { color: t.tp }]}
            placeholder="you@example.com"
            placeholderTextColor={t.ts}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="done"
            textContentType="emailAddress"
          />
        </NeuCard>

        {/* Role */}
        <Text style={[styles.label, { color: t.ts }]}>I AM A</Text>
        <Segmented<AccountType>
          dark={isDark}
          value={accountType}
          onChange={setAccountType}
          options={[
            { label: "Gym User", val: "gym_user" },
            { label: "Trainer", val: "pt" },
          ]}
        />

        {/* Units */}
        <Text style={[styles.label, { color: t.ts }]}>UNITS</Text>
        <Segmented<"kg" | "lbs">
          dark={isDark}
          value={isKg ? "kg" : "lbs"}
          onChange={(v) => setIsKg(v === "kg")}
          options={[
            { label: "Kilograms (kg)", val: "kg" },
            { label: "Pounds (lbs)", val: "lbs" },
          ]}
        />

        <View style={styles.ctaSection}>
          <BounceButton onPress={onSubmit} accessibilityRole="button" accessibilityLabel="Create account">
            <View style={[styles.ctaWrap, { backgroundColor: btnBg, shadowColor: btnShadow }, !canSubmit && styles.ctaDisabled]}>
              <View style={[styles.cta, { backgroundColor: btnBg }]}>
                <Text style={[styles.ctaText, { color: btnContent }]}>Create account</Text>
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
            onPress={() => router.push("/accept-terms")}
          />
          <SocialButton
            icon={<GoogleIcon size={18} />}
            label="Continue with Google"
            dark={isDark}
            onPress={() => router.push("/accept-terms")}
          />

          <Text style={[styles.fineprint, { color: t.ts }]}>
            Avenas is free. A Pro plan will add extra features later, but everything here stays free. Your details stay on this device.
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },
  backBtn:       { position: "absolute", left: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scroll:        { paddingHorizontal: 28 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatar:        { width: 88, height: 88, borderRadius: 44 },
  avatarInner:   { width: 88, height: 88, alignItems: "center", justifyContent: "center" },
  avatarText:    { fontFamily: FontFamily.bold, fontSize: 30 },
  title:         { fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  subtitle:      { fontFamily: FontFamily.regular, fontSize: 15, textAlign: "center", marginTop: 8, marginBottom: 16 },
  freeBadge:     { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: 7, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  freeBadgeText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  label:         { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4, marginTop: 18 },
  field:         { borderRadius: 16 },
  input:         { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 16, paddingHorizontal: 18 },
  segment:       { flexDirection: "row", borderRadius: 18, padding: 3 },
  segPill:       { position: "absolute", top: 3, left: 3, bottom: 3, borderRadius: 15, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6 },
  segBtn:        { flex: 1, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  segText:       { fontFamily: FontFamily.semibold, fontSize: 14 },
  ctaSection:    { marginTop: 36, gap: 16 },
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
  fineprint:     { fontFamily: FontFamily.regular, fontSize: 12, textAlign: "center", lineHeight: 17, paddingHorizontal: 12, marginTop: 4 },
});
