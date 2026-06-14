// Edit your account profile: display name and email. (Profile photo upload is
// the next step — it needs a Supabase Storage bucket.)

import { useState } from "react";
import { Alert, View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "../contexts/ThemeContext";
import { useUserProfile, initialsFromName } from "../contexts/UserProfileContext";
import { useAuth } from "../contexts/AuthContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import { APP_DARK, APP_LIGHT, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";
import { updateEmail, updateProfileName } from "../lib/cloud";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const btnContent = isDark ? APP_DARK.bg : "#fff";
  const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";

  const { session } = useAuth();
  const { profile, setProfile } = useUserProfile();
  const userId = session?.user.id;
  const currentEmail = session?.user.email ?? profile.email;

  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(currentEmail);
  const [busy, setBusy] = useState(false);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const emailChanged = trimmedEmail !== currentEmail;
  const nameChanged = trimmedName !== profile.name;
  const canSave = trimmedName.length > 0 && (!emailChanged || EMAIL_RE.test(trimmedEmail)) && (nameChanged || emailChanged);

  const onSave = async () => {
    if (!userId || busy || !canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      if (nameChanged) {
        await updateProfileName(userId, trimmedName);
        setProfile({ name: trimmedName, email: profile.email });
      }
      let emailNote = "";
      if (emailChanged) {
        await updateEmail(trimmedEmail);
        emailNote = ` A confirmation link was sent to ${trimmedEmail} — open it to finish changing your email.`;
      }
      Alert.alert("Saved", `Your profile has been updated.${emailNote}`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const initials = initialsFromName(name);

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
        <Text style={[styles.title, { color: t.tp }]}>Profile</Text>

        <View style={styles.avatarSection}>
          <NeuCard dark={isDark} radius={48} style={styles.avatar}>
            <View style={styles.avatarInner}>
              {initials
                ? <Text style={[styles.avatarText, { color: t.icon }]}>{initials}</Text>
                : <Ionicons name="person-outline" size={36} color={t.ts} />}
            </View>
          </NeuCard>
          <Text style={[styles.photoNote, { color: t.ts }]}>Profile photo coming soon</Text>
        </View>

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
            returnKeyType="done"
            textContentType="emailAddress"
          />
        </NeuCard>
        {emailChanged ? (
          <Text style={[styles.hint, { color: t.ts }]}>Changing your email needs a confirmation link sent to the new address.</Text>
        ) : null}

        <BounceButton style={{ marginTop: 32 }} onPress={onSave} accessibilityRole="button" accessibilityLabel="Save changes">
          <View style={[styles.ctaWrap, { backgroundColor: btnBg, shadowColor: btnShadow }, (!canSave || busy) && styles.ctaDisabled]}>
            <View style={[styles.cta, { backgroundColor: btnBg }]}>
              <Text style={[styles.ctaText, { color: btnContent }]}>{busy ? "Saving…" : "Save changes"}</Text>
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
  backBtn:       { position: "absolute", left: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scroll:        { paddingHorizontal: 28 },
  title:         { fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  avatarSection: { alignItems: "center", marginTop: 18, marginBottom: 8, gap: 8 },
  avatar:        { width: 96, height: 96, borderRadius: 48 },
  avatarInner:   { width: 96, height: 96, alignItems: "center", justifyContent: "center" },
  avatarText:    { fontFamily: FontFamily.bold, fontSize: 32 },
  photoNote:     { fontFamily: FontFamily.regular, fontSize: 12 },
  label:         { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4, marginTop: 18 },
  field:         { borderRadius: 16 },
  input:         { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 16, paddingHorizontal: 18 },
  hint:          { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 8, marginLeft: 4 },
  ctaWrap:       { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  ctaDisabled:   { opacity: 0.4 },
  cta:           { borderRadius: 28, paddingVertical: 17, alignItems: "center", justifyContent: "center" },
  ctaText:       { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3 },
});
