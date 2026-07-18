// Privacy & Security — reached from Settings > Account. Today this is where you
// change your password. We re-verify the current password before updating (see
// lib/cloud.changePassword). Accounts that only sign in with Google/Apple have
// no password here, so they get an explanation instead of the form.

import { useEffect, useState } from "react";
import { Alert, View, Text, StyleSheet, Switch, TextInput, TouchableOpacity } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../contexts/AuthContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import { ACCT, APP_DARK, APP_LIGHT, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";
import { changePassword } from "../lib/cloud";
import { getShareActivity, setShareActivity } from "../lib/connections";

const MIN_PASSWORD = 8;

function titleCase(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export default function PrivacySecurityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const btnContent = isDark ? APP_DARK.bg : "#fff";
  const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";

  const { session } = useAuth();
  const identities = session?.user?.identities ?? [];
  // Email/password accounts carry an "email" identity. If a user only has social
  // identities (e.g. Google), there's no password on this account to change.
  const oauthOnly = identities.length > 0 && !identities.some(i => i.provider === "email");
  const providerName = titleCase(identities[0]?.provider ?? "your provider");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  // Activity-status privacy (profiles.share_activity, migration 0009). The
  // switch stays disabled until the server value loads so a blind flip can't
  // fight the fetch; writes are optimistic with revert + alert on failure —
  // a silently-failed "hide me" would leave the user wrongly believing
  // they're hidden.
  const [shareActivity, setShareActivityState] = useState(true);
  const [shareLoaded, setShareLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getShareActivity()
      .then(v => { if (!cancelled) { setShareActivityState(v); setShareLoaded(true); } })
      .catch(() => { /* offline / signed out — leave the toggle disabled */ });
    return () => { cancelled = true; };
  }, []);
  const onToggleShareActivity = (value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShareActivityState(value);
    setShareActivity(value).catch(() => {
      setShareActivityState(!value);
      Alert.alert("Couldn't update", "Your activity status setting wasn't saved. Check your connection and try again.");
    });
  };

  const longEnough = next.length >= MIN_PASSWORD;
  const matches = next.length > 0 && next === confirm;
  const isNew = next.length > 0 && next !== current;
  const canSave = current.length > 0 && longEnough && matches && isNew && !busy;

  const onSave = async () => {
    if (!canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      Alert.alert("Password updated", "Your password has been changed.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert("Couldn't change password", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
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
        <Text style={[styles.title, { color: t.tp }]}>Privacy & Security</Text>

        <Text style={[styles.label, { color: t.ts }]}>ACTIVITY</Text>
        <NeuCard dark={isDark} radius={16}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleTitle, { color: t.tp }]}>Show Activity Status</Text>
              <Text style={[styles.toggleBody, { color: t.ts }]}>
                People you&apos;re connected with can see when you were last active on Avenas. When this is off, they see nothing at all.
              </Text>
            </View>
            <Switch
              value={shareActivity}
              onValueChange={onToggleShareActivity}
              disabled={!shareLoaded}
              trackColor={{ false: t.div, true: ACCT }}
              thumbColor="#fff"
            />
          </View>
        </NeuCard>

        {oauthOnly ? (
          <NeuCard dark={isDark} radius={18} style={{ marginTop: 24 }}>
            <View style={styles.noteInner}>
              <Ionicons name="shield-checkmark-outline" size={26} color={t.ts} />
              <Text style={[styles.noteTitle, { color: t.tp }]}>No password to change</Text>
              <Text style={[styles.noteBody, { color: t.ts }]}>
                You sign in to Avenas with {providerName}, so there is no password stored here. Manage your password in your {providerName} account.
              </Text>
            </View>
          </NeuCard>
        ) : (
          <>
            <Text style={[styles.intro, { color: t.ts }]}>
              Change the password you use to sign in to Avenas.
            </Text>

            <Text style={[styles.label, { color: t.ts }]}>CURRENT PASSWORD</Text>
            <NeuCard dark={isDark} radius={16} style={styles.field}>
              <TextInput
                style={[styles.input, { color: t.tp }]}
                placeholder="Your current password"
                placeholderTextColor={t.ts}
                value={current}
                onChangeText={setCurrent}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="next"
                textContentType="password"
              />
            </NeuCard>

            <Text style={[styles.label, { color: t.ts }]}>NEW PASSWORD</Text>
            <NeuCard dark={isDark} radius={16} style={styles.field}>
              <TextInput
                style={[styles.input, { color: t.tp }]}
                placeholder="New password"
                placeholderTextColor={t.ts}
                value={next}
                onChangeText={setNext}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="next"
                textContentType="newPassword"
              />
            </NeuCard>
            <Text style={[styles.hint, { color: t.ts }]}>At least {MIN_PASSWORD} characters.</Text>

            <Text style={[styles.label, { color: t.ts }]}>CONFIRM NEW PASSWORD</Text>
            <NeuCard dark={isDark} radius={16} style={styles.field}>
              <TextInput
                style={[styles.input, { color: t.tp }]}
                placeholder="Re-enter new password"
                placeholderTextColor={t.ts}
                value={confirm}
                onChangeText={setConfirm}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="done"
                textContentType="newPassword"
                onSubmitEditing={onSave}
              />
            </NeuCard>
            {confirm.length > 0 && !matches ? (
              <Text style={[styles.hint, { color: t.ts }]}>Passwords don&apos;t match yet.</Text>
            ) : null}

            <BounceButton style={{ marginTop: 32 }} onPress={onSave} accessibilityRole="button" accessibilityLabel="Update password">
              <View style={[styles.ctaWrap, { backgroundColor: btnBg, shadowColor: btnShadow }, !canSave && styles.ctaDisabled]}>
                <View style={[styles.cta, { backgroundColor: btnBg }]}>
                  <Text style={[styles.ctaText, { color: btnContent }]}>{busy ? "Updating…" : "Update password"}</Text>
                </View>
              </View>
            </BounceButton>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  backBtn:     { position: "absolute", left: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scroll:      { paddingHorizontal: 28 },
  title:       { fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  intro:       { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", marginTop: 10, marginBottom: 8 },
  label:       { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4, marginTop: 18 },
  field:       { borderRadius: 16 },
  input:       { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 16, paddingHorizontal: 18 },
  hint:        { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 8, marginLeft: 4 },
  ctaWrap:     { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  ctaDisabled: { opacity: 0.4 },
  cta:         { borderRadius: 28, paddingVertical: 17, alignItems: "center", justifyContent: "center" },
  ctaText:     { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3 },
  toggleRow:   { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  toggleTitle: { fontFamily: FontFamily.semibold, fontSize: 15 },
  toggleBody:  { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 17, marginTop: 4 },
  noteInner:   { padding: 24, alignItems: "center", gap: 8 },
  noteTitle:   { fontFamily: FontFamily.bold, fontSize: 17 },
  noteBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
