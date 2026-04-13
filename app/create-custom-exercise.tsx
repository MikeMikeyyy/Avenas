import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  InputAccessoryView,
  Keyboard,
  Linking,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import {
  CUSTOM_KEY, MAX_CUSTOM, MUSCLE_GROUPS,
  type SelectableMuscle, type CustomExercise,
} from "../constants/exercises";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import { useTheme } from "../contexts/ThemeContext";

const SELECTABLE = MUSCLE_GROUPS.filter(g => g !== "All") as SelectableMuscle[];
const DESC_INPUT_ID = "create-exercise-description";

export default function CreateCustomExerciseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [exerciseName, setExerciseName] = useState("");
  const [selectedMuscles, setSelectedMuscles] = useState<SelectableMuscle[]>([]);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [slotCount, setSlotCount] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setSlotCount(parsed.length);
    }).catch(() => {});
  }, []);

  const toggleMuscle = useCallback((muscle: SelectableMuscle) => {
    setSelectedMuscles(prev =>
      prev.includes(muscle) ? prev.filter(m => m !== muscle) : [...prev, muscle]
    );
  }, []);

  // Returns true if permission is granted, false otherwise (shows appropriate alert)
  const ensurePhotoPermission = async (): Promise<boolean> => {
    const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status === "granted") return true;
    if (canAskAgain) {
      // Android: can prompt again — call once more
      const retry = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (retry.status === "granted") return true;
    }
    // Permanently denied — direct user to Settings
    Alert.alert(
      "Photo Library Access",
      "Avenas needs access to your photo library. Please enable it in Settings.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ]
    );
    return false;
  };

  const pickImage = async () => {
    if (!(await ensurePhotoPermission())) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled) {
        const dest = `${FileSystem.documentDirectory}exercise_icon_${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: result.assets[0].uri, to: dest });
        setImageUri(dest);
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    }
  };

  const pickVideo = async () => {
    if (!(await ensurePhotoPermission())) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
      });
      if (!result.canceled) {
        const dest = `${FileSystem.documentDirectory}exercise_video_${Date.now()}.mp4`;
        await FileSystem.copyAsync({ from: result.assets[0].uri, to: dest });
        setVideoUri(dest);
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    }
  };

  const handleSave = async () => {
    const name = exerciseName.trim();
    if (!name || selectedMuscles.length === 0) return;
    setSaving(true);
    try {
      const raw = await AsyncStorage.getItem(CUSTOM_KEY);
      const current: CustomExercise[] = raw ? JSON.parse(raw) : [];
      if (current.length >= MAX_CUSTOM) {
        Alert.alert("Limit reached", "You have used all 5 custom exercise slots.");
        setSaving(false);
        return;
      }
      const newEx: CustomExercise = {
        name,
        muscles: selectedMuscles,
        ...(imageUri ? { imageUri } : {}),
        ...(videoUri ? { videoUri } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify([...current, newEx]));
      router.back();
    } catch (e) {
      Alert.alert("Save failed", e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const canSave = exerciseName.trim().length > 0 && selectedMuscles.length > 0;

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: t.bg }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={[styles.screenTitle, { color: t.tp }]}>CREATE EXERCISE</Text>
            <Text style={[styles.slotBadge, { color: t.ts }]}>
              {slotCount} / {MAX_CUSTOM} slots used
            </Text>
          </View>
          <View style={{ width: 66 }} />
        </View>

        {/* Name */}
        <Text style={[styles.fieldLabel, { color: t.ts }]}>EXERCISE NAME</Text>
        <NeuCard dark={isDark} style={styles.inputCard}>
          <TextInput
            style={[styles.textInput, { color: t.tp }]}
            placeholder="e.g. Cable Curl"
            placeholderTextColor={t.ts}
            value={exerciseName}
            onChangeText={setExerciseName}
            returnKeyType="done"
            autoCapitalize="words"
          />
        </NeuCard>

        {/* Muscles */}
        <Text style={[styles.fieldLabel, { color: t.ts }]}>
          TARGET MUSCLES <Text style={{ color: t.ts, fontFamily: FontFamily.regular }}>— select at least one</Text>
        </Text>
        <View style={styles.muscleGrid}>
          {SELECTABLE.map(muscle => {
            const active = selectedMuscles.includes(muscle);
            return (
              <TouchableOpacity
                key={muscle}
                onPress={() => toggleMuscle(muscle)}
                activeOpacity={0.7}
                style={[
                  styles.muscleChip,
                  {
                    backgroundColor: active ? ACCT : "transparent",
                    borderColor: active ? "transparent" : t.div,
                  },
                ]}
              >
                <Text style={[styles.muscleChipText, { color: active ? "#fff" : t.ts }]}>
                  {muscle}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Icon Photo */}
        <Text style={[styles.fieldLabel, { color: t.ts }]}>ICON PHOTO <Text style={{ fontFamily: FontFamily.regular }}>— optional</Text></Text>
        <NeuCard dark={isDark} style={styles.mediaCard}>
          {imageUri ? (
            <View style={styles.mediaPreviewRow}>
              <Image source={{ uri: imageUri }} style={styles.photoThumb} contentFit="cover" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.mediaSetText, { color: t.tp }]}>Photo added</Text>
                <TouchableOpacity onPress={() => setImageUri(null)} activeOpacity={0.7}>
                  <Text style={[styles.mediaRemoveText, { color: t.ts }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={pickImage} activeOpacity={0.7} style={styles.mediaBtn}>
              <Ionicons name="image-outline" size={20} color={ACCT} />
              <Text style={[styles.mediaBtnText, { color: ACCT }]}>Add Photo</Text>
            </TouchableOpacity>
          )}
        </NeuCard>

        {/* Video Demo */}
        <Text style={[styles.fieldLabel, { color: t.ts }]}>VIDEO DEMO <Text style={{ fontFamily: FontFamily.regular }}>— optional</Text></Text>
        <NeuCard dark={isDark} style={styles.mediaCard}>
          {videoUri ? (
            <View style={styles.mediaPreviewRow}>
              <View style={[styles.videoIcon, { backgroundColor: ACCT + "22" }]}>
                <Ionicons name="play" size={20} color={ACCT} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.mediaSetText, { color: t.tp }]}>Video added</Text>
                <TouchableOpacity onPress={() => setVideoUri(null)} activeOpacity={0.7}>
                  <Text style={[styles.mediaRemoveText, { color: t.ts }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={pickVideo} activeOpacity={0.7} style={styles.mediaBtn}>
              <Ionicons name="videocam-outline" size={20} color={ACCT} />
              <Text style={[styles.mediaBtnText, { color: ACCT }]}>Add Video</Text>
            </TouchableOpacity>
          )}
        </NeuCard>

        {/* Description */}
        <Text style={[styles.fieldLabel, { color: t.ts }]}>DESCRIPTION <Text style={{ fontFamily: FontFamily.regular }}>— optional</Text></Text>
        <NeuCard dark={isDark} style={styles.inputCard}>
          <TextInput
            style={[styles.textInput, styles.descriptionInput, { color: t.tp }]}
            placeholder="How to perform this exercise..."
            placeholderTextColor={t.ts}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            inputAccessoryViewID={Platform.OS === "ios" ? DESC_INPUT_ID : undefined}
            onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300)}
          />
        </NeuCard>

        {/* Save button — inline in scroll, never moves with keyboard */}
        <BounceButton
          onPress={canSave && !saving ? handleSave : undefined}
          style={{ opacity: canSave && !saving ? 1 : 0.4, marginTop: 8 }}
        >
          <View style={styles.saveBtn}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
            <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save Exercise"}</Text>
          </View>
        </BounceButton>
      </ScrollView>

      {/* Done toolbar for description keyboard — iOS only */}
      {Platform.OS === "ios" && (
        <InputAccessoryView nativeID={DESC_INPUT_ID}>
          <View style={[styles.kbToolbar, { backgroundColor: t.bg, borderTopColor: t.div }]}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()} activeOpacity={0.7} style={styles.kbDoneBtn}>
              <Text style={[styles.kbDoneText, { color: ACCT }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:            { flex: 1 },
  backBtn:         { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  header:          { flexDirection: "row", alignItems: "center", marginBottom: 28, marginTop: 4 },
  screenTitle:     { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5 },
  slotBadge:       { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  fieldLabel:      { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginTop: 4 },
  inputCard:       { marginBottom: 20, borderRadius: 16 },
  textInput:       { fontFamily: FontFamily.regular, fontSize: 16, paddingHorizontal: 18, paddingVertical: 16 },
  descriptionInput:{ minHeight: 100 },
  muscleGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  muscleChip:      { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  muscleChipText:  { fontFamily: FontFamily.semibold, fontSize: 13 },
  mediaCard:       { marginBottom: 20, borderRadius: 16 },
  mediaBtn:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 16 },
  mediaBtnText:    { fontFamily: FontFamily.semibold, fontSize: 15 },
  mediaPreviewRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  photoThumb:      { width: 64, height: 64, borderRadius: 10 },
  videoIcon:       { width: 64, height: 64, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  mediaSetText:    { fontFamily: FontFamily.semibold, fontSize: 14 },
  mediaRemoveText: { fontFamily: FontFamily.regular, fontSize: 13 },
  saveBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: ACCT, borderRadius: 16, paddingVertical: 18 },
  saveBtnText:     { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff", letterSpacing: 0.3 },
  kbToolbar:       { flexDirection: "row", justifyContent: "flex-end", borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10 },
  kbDoneBtn:       { paddingHorizontal: 8, paddingVertical: 4 },
  kbDoneText:      { fontFamily: FontFamily.semibold, fontSize: 16 },
});
