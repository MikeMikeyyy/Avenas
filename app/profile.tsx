// Edit your account profile: profile photo, display name, and email. The photo
// is uploaded to the Supabase "avatars" Storage bucket (migration 0005) and its
// public URL is stored on the profile so it syncs across the user's devices.

import { useState } from "react";
import { Alert, View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";

import { useTheme } from "../contexts/ThemeContext";
import { useUserProfile, initialsFromName } from "../contexts/UserProfileContext";
import { useAuth } from "../contexts/AuthContext";
import { useAccountType } from "../contexts/AccountTypeContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import SegmentedControl from "../components/SegmentedControl";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import { ACCT, APP_DARK, APP_LIGHT, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";
import { updateEmail, updateProfileName, uploadAvatar, updateAvatarUrl } from "../lib/cloud";

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
  const { accountType, setAccountType } = useAccountType();
  const userId = session?.user.id;
  const currentEmail = session?.user.email ?? profile.email;

  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(currentEmail);
  const [busy, setBusy] = useState(false);
  // Photo changes are STAGED — picking/removing only updates this local preview;
  // nothing uploads or persists until the user taps Save changes (mirrors how
  // name/email commit). null = no pending photo change.
  const [photoChange, setPhotoChange] = useState<
    { type: "set"; uri: string; mimeType?: string } | { type: "remove" } | null
  >(null);
  const shownPhoto =
    photoChange?.type === "set" ? photoChange.uri
    : photoChange?.type === "remove" ? null
    : profile.photoUri ?? null;
  const photoChanged = photoChange !== null;

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const emailChanged = trimmedEmail !== currentEmail;
  const nameChanged = trimmedName !== profile.name;
  const canSave = trimmedName.length > 0 && (!emailChanged || EMAIL_RE.test(trimmedEmail)) && (nameChanged || emailChanged || photoChanged);

  const onSave = async () => {
    if (!userId || busy || !canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      // Commit the staged photo first (upload new / clear) so the new URL is
      // ready to fold into the single local profile update below.
      let nextPhotoUri = profile.photoUri;
      if (photoChange?.type === "set") {
        const url = await uploadAvatar(userId, photoChange.uri, photoChange.mimeType);
        await updateAvatarUrl(userId, url);
        nextPhotoUri = url;
      } else if (photoChange?.type === "remove") {
        await updateAvatarUrl(userId, null);
        nextPhotoUri = undefined;
      }
      if (nameChanged) {
        await updateProfileName(userId, trimmedName);
      }
      if (nameChanged || photoChanged) {
        setProfile({ ...profile, name: nameChanged ? trimmedName : profile.name, photoUri: nextPhotoUri });
      }
      setPhotoChange(null);
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

  // Pick from the library and STAGE it as a preview. The upload + persist happen
  // in onSave, so the photo only sticks once the user taps Save changes.
  const pickPhoto = async () => {
    if (busy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access needed", "Allow photo library access in Settings to choose a profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhotoChange({ type: "set", uri: asset.uri, mimeType: asset.mimeType });
  };

  const stageRemovePhoto = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhotoChange({ type: "remove" });
  };

  const onPhotoPress = () => {
    if (busy) return;
    if (shownPhoto) {
      Alert.alert("Profile photo", undefined, [
        { text: "Change Photo", onPress: () => void pickPhoto() },
        { text: "Remove Photo", style: "destructive", onPress: stageRemovePhoto },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      void pickPhoto();
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
          <TouchableOpacity
            onPress={onPhotoPress}
            activeOpacity={0.85}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={shownPhoto ? "Change profile photo" : "Add profile photo"}
          >
            <NeuCard dark={isDark} radius={48} style={styles.avatar}>
              <View style={styles.avatarInner}>
                {shownPhoto
                  ? <Image source={{ uri: shownPhoto }} style={styles.avatarImage} contentFit="cover" transition={150} />
                  : initials
                    ? <Text style={[styles.avatarText, { color: t.icon }]}>{initials}</Text>
                    : <Ionicons name="person-outline" size={36} color={t.ts} />}
              </View>
            </NeuCard>
            <View style={[styles.cameraBadge, { backgroundColor: ACCT, borderColor: t.bg }]}>
              <Ionicons name="camera" size={16} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.photoNote, { color: t.ts }]}>
            {photoChanged ? "Tap Save changes to apply your photo" : shownPhoto ? "Tap to change your photo" : "Tap to add a profile photo"}
          </Text>
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

        {/* Applies immediately (not staged behind Save) — it's a local mode
            switch, same behavior it had on the Settings screen. */}
        <Text style={[styles.label, { color: t.ts }]}>ACCOUNT TYPE</Text>
        <SegmentedControl
          options={[
            { key: "gym_user", label: "Gym User" },
            { key: "pt", label: "Trainer" },
          ]}
          value={accountType}
          onChange={setAccountType}
        />
        <Text style={[styles.hint, { color: t.ts }]}>
          Trainers get a coaching hub with clients, program sharing, and messaging.
        </Text>

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
  avatarInner:   { width: 96, height: 96, alignItems: "center", justifyContent: "center", borderRadius: 48, overflow: "hidden" },
  avatarImage:   { width: 96, height: 96, borderRadius: 48 },
  avatarText:    { fontFamily: FontFamily.bold, fontSize: 32 },
  cameraBadge:   { position: "absolute", bottom: 0, right: 0, width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
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
