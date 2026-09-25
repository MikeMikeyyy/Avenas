// Edit your account profile: profile photo, display name, and email. The photo
// is uploaded to the Supabase "avatars" Storage bucket (migration 0005) and its
// public URL is stored on the profile so it syncs across the user's devices.

import { useCallback, useState } from "react";
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
import { useAccountType, type AccountType } from "../contexts/AccountTypeContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import SegmentedControl from "../components/SegmentedControl";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import { ACCT, APP_DARK, APP_LIGHT, BTN_SLATE, BTN_SLATE_DARK, DANGER, FontFamily } from "../constants/theme";
import { clearCoachingData, pushAccountType, updateContactEmail, updateEmail, updateProfileName, uploadAvatar, updateAvatarUrl } from "../lib/cloud";
import { isApplePrivateEmail } from "../lib/auth";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";

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

  // Apple "Hide My Email" accounts log in with a relay address Apple never
  // resolves back to a real inbox. Showing it as "your email" is meaningless to
  // the user and it can't be changed here (it's the login identifier), so it's
  // labelled instead and a separate contact address is offered.
  const usesAppleRelay = isApplePrivateEmail(currentEmail);
  const [contactEmail, setContactEmail] = useState(profile.contactEmail ?? "");
  const [accountTypeDraft, setAccountTypeDraft] = useState<AccountType>(accountType);
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
  // The login email is read-only for relay accounts, so it can never be "changed".
  const emailChanged = !usesAppleRelay && trimmedEmail !== currentEmail;
  const nameChanged = trimmedName !== profile.name;
  const trimmedContact = contactEmail.trim();
  const contactChanged = usesAppleRelay && trimmedContact !== (profile.contactEmail ?? "");
  const contactValid = trimmedContact === "" || EMAIL_RE.test(trimmedContact);
  const accountTypeChanged = accountTypeDraft !== accountType;
  // Trainer → Gym User is the destructive direction: it removes clients, groups
  // and sent programs. The other way round only unlocks the hub.
  const isDowngrade = accountTypeChanged && accountTypeDraft === "gym_user";
  const canSave =
    trimmedName.length > 0 &&
    (!emailChanged || EMAIL_RE.test(trimmedEmail)) &&
    contactValid &&
    (nameChanged || emailChanged || photoChanged || contactChanged || accountTypeChanged);

  /** Alert as a promise, so the save flow can await a confirmation inline. */
  const confirmDowngrade = useCallback(
    () =>
      new Promise<boolean>(resolve => {
        Alert.alert(
          "Switch to Gym User?",
          "You'll stop being a trainer, and your coaching data is deleted:\n\n" +
            "• Your client list and everything saved against each client\n" +
            "• Any groups you created, removed for every member\n" +
            "• Programs you've sent (clients keep copies they already accepted)\n\n" +
            "Your own workouts, programs and trainers are not affected. This can't be undone.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Switch and delete", style: "destructive", onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      }),
    [],
  );

  const onSave = async () => {
    if (!userId || busy || !canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Gate the destructive switch before anything else is written, so cancelling
    // here leaves the whole form untouched.
    if (isDowngrade && !(await confirmDowngrade())) return;
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
      if (contactChanged) {
        await updateContactEmail(userId, trimmedContact || null);
      }
      if (nameChanged || photoChanged || contactChanged) {
        setProfile({
          ...profile,
          name: nameChanged ? trimmedName : profile.name,
          photoUri: nextPhotoUri,
          contactEmail: trimmedContact || undefined,
        });
      }
      setPhotoChange(null);

      // Role last, and the server write BEFORE the local teardown: if the push
      // fails we bail with the coaching data still intact, rather than deleting
      // clients for a switch that never took.
      let roleNote = "";
      if (accountTypeChanged) {
        await pushAccountType(userId, accountTypeDraft);
        if (isDowngrade) {
          await clearCoachingData();
          roleNote = " Your coaching data has been removed.";
        } else {
          roleNote = " The trainer hub is now available, and any trainers you're connected with are under My Trainers.";
        }
        setAccountType(accountTypeDraft);
      }

      let emailNote = "";
      if (emailChanged) {
        await updateEmail(trimmedEmail);
        emailNote = ` A confirmation link was sent to ${trimmedEmail}. Open it to finish changing your email.`;
      }
      Alert.alert("Saved", `Your profile has been updated.${roleNote}${emailNote}`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Staged like name/email/photo: picking a role only moves the segmented
  // control, and nothing happens until Save changes. Switching to Gym User
  // destroys the coaching side of the account, so it must not fire on a stray tap.
  const onChangeAccountType = useCallback((next: AccountType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAccountTypeDraft(next);
  }, []);

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
      <BackButton />

      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + BACK_TOP + BACK_SIZE + 12, paddingBottom: insets.bottom + 32 }]}
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

        {usesAppleRelay ? (
          <>
            <Text style={[styles.label, { color: t.ts }]}>SIGN IN</Text>
            <NeuCard dark={isDark} radius={16} style={styles.field}>
              <View style={styles.lockedRow}>
                <Ionicons name="logo-apple" size={20} color={t.tp} />
                <Text style={[styles.lockedText, { color: t.tp }]} numberOfLines={1}>
                  Apple, with your email hidden
                </Text>
                <Ionicons name="lock-closed" size={15} color={t.ts} />
              </View>
            </NeuCard>
            <Text style={[styles.hint, { color: t.ts }]}>
              You chose to hide your email when you signed in with Apple. Apple gave us a private
              address that forwards to your Apple Account, so we never see your real one.
            </Text>

            <Text style={[styles.label, { color: t.ts }]}>CONTACT EMAIL</Text>
            <NeuCard dark={isDark} radius={16} style={styles.field}>
              <TextInput
                style={[styles.input, { color: t.tp }]}
                placeholder="Optional"
                placeholderTextColor={t.ts}
                value={contactEmail}
                onChangeText={setContactEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="done"
                textContentType="emailAddress"
              />
            </NeuCard>
            <Text style={[styles.hint, { color: t.ts }]}>
              {contactChanged && !contactValid
                ? "That doesn't look like a valid email address."
                : "Add an address if you'd rather we reach you somewhere other than your Apple Account. It doesn't change how you sign in."}
            </Text>
          </>
        ) : (
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
                returnKeyType="done"
                textContentType="emailAddress"
              />
            </NeuCard>
            {emailChanged ? (
              <Text style={[styles.hint, { color: t.ts }]}>Changing your email needs a confirmation link sent to the new address.</Text>
            ) : null}
          </>
        )}

        {/* Staged behind Save changes, like everything else on this screen. It
            used to apply on tap, which meant a stray tap could silently switch
            the account and (now) delete the coaching side of it. */}
        <Text style={[styles.label, { color: t.ts }]}>ACCOUNT TYPE</Text>
        <SegmentedControl
          options={[
            { key: "gym_user", label: "Gym User" },
            { key: "pt", label: "Trainer" },
          ]}
          value={accountTypeDraft}
          onChange={onChangeAccountType}
        />
        <Text style={[styles.hint, { color: isDowngrade ? DANGER : t.ts }]}>
          {isDowngrade
            ? "Switching to Gym User deletes your clients, groups and sent programs. You'll be asked to confirm when you save."
            : accountTypeChanged
              ? "Tap Save changes to switch to a trainer account."
              : "Trainers get a coaching hub with clients, program sharing, and messaging."}
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
  hint:          { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 8, marginLeft: 4, lineHeight: 17 },
  lockedRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, paddingHorizontal: 18 },
  lockedText:    { flex: 1, fontFamily: FontFamily.regular, fontSize: 16 },
  ctaWrap:       { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  ctaDisabled:   { opacity: 0.4 },
  cta:           { borderRadius: 28, paddingVertical: 17, alignItems: "center", justifyContent: "center" },
  ctaText:       { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3 },
});
