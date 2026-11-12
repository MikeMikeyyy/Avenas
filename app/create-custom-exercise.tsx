// Making (or editing) a custom exercise, laid out as option D of the Custom
// Exercise Redesign canvas (user picks, 2026-11-12): the exercise as it shows
// in your exercise list at the top, then The basics (its name and muscles, the
// two it needs), Make it yours (a photo, a demo video, Assisted) and How to do
// it (steps you can move and swipe away), with Save floating at the foot.
//
// Save floats over the page, standing on the workout bar while it shows, with
// how many of your custom exercise slots are used above it while creating (an
// edit takes no slot). Both sit on a blur that rises from the foot, the page
// top's own (MaskedView + LinearGradient + BlurView), so the cards' words
// passing under them blur away rather than run into the line.

import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { BlurView } from "expo-blur";
import MaskedView from "../components/MaskedView";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { Image } from "expo-image";
import Reanimated from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFloatingBarsReach, usePinnedLift } from "../hooks/useFloatingBars";
import { useRouter, useLocalSearchParams } from "expo-router";
import { scheduleCloudPush } from "../lib/syncManager";
import { EXERCISE_PHOTO, pickFromLibrary, pickSquarePhoto } from "../lib/photoPicker";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  APP_LIGHT, APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK, ON_FILL,
  accentTextColor, dangerTextColor, tipFill,
} from "../constants/theme";
import { cardButton, PILL_H, PILL_SHADOW } from "../constants/buttons";
import {
  CUSTOM_KEY, MAX_CUSTOM, MAX_MEDIA_BYTES, MAX_VIDEO_SECONDS, MUSCLE_GROUPS,
  type SelectableMuscle, type CustomExercise,
} from "../constants/exercises";
import { customNameTaken, liveCustoms, liveIndexOf, newCustomId } from "../utils/customExercises";
import { renameCustomExercise } from "../utils/customExerciseStore";
import { refreshAssisted } from "../utils/assistedStore";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import GlassButton from "../components/GlassButton";
import ExerciseImage from "../components/ExerciseImage";
import StepsEditor, { newStep, type Step } from "../components/StepsEditor";
import { useTheme } from "../contexts/ThemeContext";
import AppSwitch from "../components/AppSwitch";
import { alertMessage } from "../utils/errors";
import { exerciseByName } from "../utils/exerciseLookup";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import { ABOVE_KEYBOARD_TOOLS, scrollEndPadding } from "../constants/floatingBars";

const SELECTABLE = MUSCLE_GROUPS.filter(g => g !== "All") as SelectableMuscle[];

/** The picker's search box doesn't auto-capitalise, so a search arrives as
 *  "handstand". Capitalise each word's first letter only, so "RDL" survives. */
const titleCaseWords = (s: string) => s.trim().replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1));

/** Save's gap above the home indicator. */
const SAVE_GAP = 16;
/** The slots line and its gap above Save. */
const SLOT_LINE_H = 30;
/** How far above the footer's top the blur fades in. */
const FOOT_FADE = 28;

const RING = 14;
const RING_STROKE = 2;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

/** How many custom exercise slots are taken, as a small ring beside the line. */
function SlotRing({ used, isDark }: { used: number; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const pct = Math.min(1, used / MAX_CUSTOM);
  return (
    <Svg width={RING} height={RING} style={styles.ringSvg}>
      <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={t.ts} strokeWidth={RING_STROKE} fill="none" opacity={0.22} />
      {pct > 0 && (
        <Circle
          cx={RING / 2} cy={RING / 2} r={RING_R}
          stroke={ACCT} strokeWidth={RING_STROKE} fill="none"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - pct)}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}

/** A section's heading, with "Required" or "Optional" across from it. */
function SectionLabel({ title, note, required, isDark }: { title: string; note: string; required?: boolean; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.labelRow}>
      <Text style={[styles.sectionLabel, { color: t.ts }]}>{title}</Text>
      <Text style={[required ? styles.labelRequired : styles.labelNote, { color: required ? accentTextColor(isDark) : t.ts }]}>{note}</Text>
    </View>
  );
}

/** One of Make it yours' rows: an icon in a tile, what it is, and its control. */
function OptionRow({ icon, title, sub, isDark, children }: {
  icon: ReactNode;
  title: string;
  sub?: string;
  isDark: boolean;
  children: ReactNode;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.optRow}>
      <View style={[styles.optIcon, { backgroundColor: t.field }]}>{icon}</View>
      <View style={styles.optText}>
        <Text style={[styles.optTitle, { color: t.tp }]}>{title}</Text>
        {sub ? <Text style={[styles.optSub, { color: t.ts }]}>{sub}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** A small button in a card (cardButton): Add, Change, Remove. */
function CardPill({ label, onPress, isDark, accessibilityLabel }: {
  label: string;
  onPress: () => void;
  isDark: boolean;
  accessibilityLabel: string;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <BounceButton onPress={onPress} accessibilityLabel={accessibilityLabel} accessibilityRole="button">
      <View style={[styles.cardPill, cardButton(t)]}>
        <Text style={[styles.cardPillText, { color: t.tp }]}>{label}</Text>
      </View>
    </BounceButton>
  );
}

export default function CreateCustomExerciseScreen() {
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const accent = accentTextColor(isDark);
  // `name` is what the user was searching for in the exercise picker when they
  // tapped Create Custom Exercise, so they don't have to type it twice.
  const { edit: editName, name: searchedName } = useLocalSearchParams<{ edit?: string; name?: string }>();
  const isEditMode = !!editName;

  const [exerciseName, setExerciseName] = useState(() =>
    !isEditMode && typeof searchedName === "string" ? titleCaseWords(searchedName) : ""
  );
  const [selectedMuscles, setSelectedMuscles] = useState<SelectableMuscle[]>([]);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [assisted, setAssisted] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  // A step held to move it: the page holds still under it.
  const [stepsDragging, setStepsDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slotCount, setSlotCount] = useState(0);

  // Slots are taken by your live exercises: a deleted one stays in the list,
  // hidden, for the sessions logged with it (utils/customExercises.ts).
  useEffect(() => {
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) setSlotCount(liveCustoms(parsed as CustomExercise[]).length);
    }).catch(() => {});
  }, []);

  // Pre-populate fields when editing an existing exercise
  useEffect(() => {
    if (!editName) return;
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (!Array.isArray(parsed)) return;
      const list = parsed as CustomExercise[];
      const ex = list[liveIndexOf(list, editName)];
      if (!ex) return;
      setExerciseName(ex.name);
      setSelectedMuscles(ex.muscles);
      setImageUri(ex.imageUri ?? null);
      setVideoUri(ex.videoUri ?? null);
      setMuted(ex.muted ?? false);
      setAssisted(ex.assisted === true);
      // Prefer saved steps; otherwise seed the editor from a legacy description
      // (one step per line) so old exercises convert cleanly when re-saved.
      const words = ex.steps && ex.steps.length > 0
        ? ex.steps
        : ex.description
          ? ex.description.split("\n").map(s => s.trim()).filter(Boolean)
          : [];
      setSteps(words.map(text => newStep(text)));
    }).catch(() => {});
  }, [editName]);

  const toggleMuscle = useCallback((muscle: SelectableMuscle) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedMuscles(prev =>
      prev.includes(muscle) ? prev.filter(m => m !== muscle) : [...prev, muscle]
    );
  }, []);

  // Both through lib/photoPicker, which every photo pick in the app shares (no
  // permission prompt first, one picker at a time); the photo framed on its
  // Move and Scale.
  const pickImage = async () => {
    try {
      const photo = await pickSquarePhoto(EXERCISE_PHOTO);
      if (photo) {
        const dest = `${FileSystem.documentDirectory}exercise_icon_${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: photo.uri, to: dest });
        setImageUri(dest);
      }
    } catch (e) {
      Alert.alert("Couldn't add photo", alertMessage(e, "Please try again."));
    }
  };

  const pickVideo = async () => {
    try {
      const asset = await pickFromLibrary({
        mediaTypes: ["videos"],
        // Cap the export at 720p so a 4K source is re-encoded down on pick,
        // keeping demo clips small. iOS only; Android has no transcode hook here.
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });
      if (asset) {
        // Checked before the copy, so a long video never lands in the app's
        // folder (or later in the upload). The picker's own duration limit
        // only applies to recording, so the check is here.
        if ((asset.duration ?? 0) > (MAX_VIDEO_SECONDS + 0.5) * 1000) {
          Alert.alert(
            "Video too long",
            `Demo videos can be up to ${MAX_VIDEO_SECONDS} seconds. Trim it in your Photos app, then add it again.`,
          );
          return;
        }
        let bytes = asset.fileSize;
        if (bytes == null) {
          const info = await FileSystem.getInfoAsync(asset.uri);
          bytes = info.exists ? info.size : 0;
        }
        if (bytes > MAX_MEDIA_BYTES) {
          Alert.alert(
            "Video too large",
            `Demo videos can be up to ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))} MB. Try a shorter clip.`,
          );
          return;
        }
        const dest = `${FileSystem.documentDirectory}exercise_video_${Date.now()}.mp4`;
        await FileSystem.copyAsync({ from: asset.uri, to: dest });
        setVideoUri(dest);
      }
    } catch (e) {
      Alert.alert("Couldn't add video", alertMessage(e, "Please try again."));
    }
  };

  const handleSave = async () => {
    const name = exerciseName.trim();
    if (!name || selectedMuscles.length === 0) return;
    // A name in the exercise list, or one it used to have, would be read as that
    // exercise everywhere (its muscles, history and records). A removed one's
    // name is free: making it your own brings it back. An existing custom whose
    // name isn't changing is left alone.
    const taken = exerciseByName(name);
    if (taken && !taken.hidden && (!isEditMode || name !== editName)) {
      Alert.alert("That name is taken", `"${taken.name}" is already in the exercise list. Pick it from there, or give yours a different name.`);
      return;
    }
    setSaving(true);
    try {
      const raw = await AsyncStorage.getItem(CUSTOM_KEY);
      const current: CustomExercise[] = raw ? JSON.parse(raw) : [];
      const idx = isEditMode ? liveIndexOf(current, editName) : -1;
      if (isEditMode && idx === -1) { Alert.alert("Error", "Original exercise not found."); setSaving(false); return; }
      // Two of your exercises can't share a name. A deleted one's name is free,
      // and the new exercise is a new one: none of the old one's history.
      if (customNameTaken(name, current, idx)) {
        Alert.alert("That name is taken", `You already have an exercise called "${name}". Give this one a different name.`);
        setSaving(false);
        return;
      }
      const before = idx >= 0 ? current[idx] : null;
      // An edit keeps the exercise's id (one made before ids stays without, as
      // its history is by name); a new exercise gets its own.
      const id = before ? before.id : newCustomId();
      // In the order they stand, empty ones left out.
      const cleanSteps = steps.map(s => s.text.trim()).filter(Boolean);
      const updated: CustomExercise = {
        ...(id ? { id } : {}),
        name,
        muscles: selectedMuscles,
        ...(imageUri ? { imageUri } : {}),
        ...(videoUri ? { videoUri, ...(muted ? { muted: true } : {}) } : {}),
        ...(cleanSteps.length > 0 ? { steps: cleanSteps } : {}),
        ...(assisted ? { assisted: true } : {}),
      };
      if (before) {
        current[idx] = updated;
        await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(current));
        // A rename reaches every program, the builder's draft and the star.
        if (name !== before.name) await renameCustomExercise(before, name);
      } else {
        if (liveCustoms(current).length >= MAX_CUSTOM) {
          Alert.alert("Limit reached", `You have used all ${MAX_CUSTOM} custom exercise slots.`);
          setSaving(false);
          return;
        }
        await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify([...current, updated]));
      }
      // Its Assisted switch, for every count from here (utils/assisted.ts).
      await refreshAssisted();
      scheduleCloudPush(); // custom exercises (and cascaded program renames) are synced
      router.back();
    } catch (e) {
      Alert.alert("Save failed", alertMessage(e, "Please try again."));
      setSaving(false);
    }
  };

  const name = exerciseName.trim();
  const canSave = name.length > 0 && selectedMuscles.length > 0;
  const slotsLeft = Math.max(0, MAX_CUSTOM - slotCount);
  // The slots line is the new exercise's: an edit takes no slot.
  const showSlots = !isEditMode;
  const full = showSlots && slotsLeft === 0;
  const ready = canSave && !saving && !full;

  // The footer: Save, the slots line above it while creating, and the blur
  // under both, fading in FOOT_FADE above them. It stands on the workout bar
  // while that shows, and the page's end clears it.
  const saveBottom = insets.bottom + SAVE_GAP;
  const { lift: pinnedLift, liftStyle } = usePinnedLift(saveBottom);
  const footBody = (showSlots ? SLOT_LINE_H : 0) + PILL_H + saveBottom;
  const slate = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const slateInk = isDark ? APP_DARK.bg : ON_FILL;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* Back button */}
      <BackButton />

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

      {/* A form, so the keyboard library's scroll view, as on Profile: it
          scrolls whichever field is focused clear of the keyboard and the
          down key (a step low on the page included; a Step's focus used to
          jump to the end of the page instead). */}
      <KeyboardAwareScrollView
        bottomOffset={ABOVE_KEYBOARD_TOOLS}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!stepsDragging}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + BACK_TOP,
          paddingBottom: scrollEndPadding(footBody + 24 + pinnedLift, barsReach),
        }}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={[styles.screenTitle, { color: t.tp }]}>{isEditMode ? "EDIT EXERCISE" : "NEW EXERCISE"}</Text>
          </View>
          <View style={{ width: 66 }} />
        </View>

        {/* The exercise as your exercise list draws it: its photo (or the
            list's dumbbell until it has one), its name and its muscles, as
            they're filled in below. Only a preview: the photo is added in
            Make it yours. */}
        <Text style={[styles.sectionLabel, styles.labelAlone, { color: t.ts }]}>IN YOUR EXERCISE LIST</Text>
        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.previewRow}>
            <ExerciseImage
              exerciseId={`custom:${name}`}
              overrideUri={imageUri ?? undefined}
              variant="thumb"
              size={64}
              radius={14}
              backgroundColor={t.div}
              fallbackColor={t.ts}
            />
            <View style={styles.previewText}>
              <Text style={[styles.previewName, { color: name ? t.tp : t.ts }]}>{name || "Your exercise"}</Text>
              {selectedMuscles.length > 0 ? (
                <View style={styles.tagRow}>
                  {selectedMuscles.map(m => (
                    <View key={m} style={[styles.tag, { backgroundColor: tipFill(isDark) }]}>
                      <Text style={[styles.tagText, { color: accent }]}>{m}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.previewMeta, { color: t.ts }]}>Custom</Text>
              )}
            </View>
          </View>
        </NeuCard>

        {/* The basics: what an exercise needs to be saved. */}
        <SectionLabel title="THE BASICS" note="Required" required isDark={isDark} />
        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.nameBlock}>
            <Text style={[styles.fieldName, { color: t.ts }]}>Name</Text>
            <TextInput
              style={[styles.nameInput, { color: t.tp }]}
              placeholder="e.g. Cable Curl"
              placeholderTextColor={t.ts}
              value={exerciseName}
              onChangeText={setExerciseName}
              returnKeyType="done"
              autoCapitalize="words"
              accessibilityLabel="Exercise name"
            />
          </View>
          <View style={[styles.hairline, { backgroundColor: t.div }]} />
          <View style={styles.musclesBlock}>
            <View style={styles.fieldRow}>
              <Text style={[styles.fieldName, { color: t.ts }]}>Target muscles</Text>
              <Text style={[styles.fieldHint, { color: t.ts }]}>Pick at least one</Text>
            </View>
            {/* Rounded pills, a picked one washed green with a tick (option
                C's): a button in a card otherwise (cardButton). */}
            <View style={styles.pillWrap}>
              {SELECTABLE.map(muscle => {
                const on = selectedMuscles.includes(muscle);
                return (
                  <TouchableOpacity
                    key={muscle}
                    onPress={() => toggleMuscle(muscle)}
                    activeOpacity={0.7}
                    style={[
                      styles.musclePill,
                      on ? [styles.musclePillOn, { backgroundColor: tipFill(isDark) }] : cardButton(t),
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={muscle}
                  >
                    {on ? <Ionicons name="checkmark" size={15} color={accent} /> : null}
                    <Text style={[styles.musclePillText, on ? { color: accent, fontFamily: FontFamily.bold } : { color: t.tp }]}>
                      {muscle}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </NeuCard>

        {/* Make it yours: a photo, a demo video and Assisted, none needed. */}
        <SectionLabel title="MAKE IT YOURS" note="Optional" isDark={isDark} />
        <NeuCard dark={isDark} style={styles.card}>
          <OptionRow
            isDark={isDark}
            icon={imageUri
              ? <Image source={{ uri: imageUri }} style={styles.optThumb} contentFit="cover" />
              : <Ionicons name="image-outline" size={18} color={t.icon} />}
            title="Photo"
            sub={imageUri ? "Added" : "Shows on the exercise and in your list"}
          >
            {imageUri ? (
              <View style={styles.pillPair}>
                <CardPill label="Change" onPress={pickImage} isDark={isDark} accessibilityLabel="Change photo" />
                <CardPill label="Remove" onPress={() => setImageUri(null)} isDark={isDark} accessibilityLabel="Remove photo" />
              </View>
            ) : (
              <CardPill label="Add" onPress={pickImage} isDark={isDark} accessibilityLabel="Add photo" />
            )}
          </OptionRow>
          <View style={[styles.hairline, styles.optDivider, { backgroundColor: t.div }]} />
          <OptionRow
            isDark={isDark}
            icon={<Ionicons name={videoUri ? "play" : "videocam-outline"} size={18} color={videoUri ? accent : t.icon} />}
            title="Demo video"
            sub={videoUri ? "Added" : `A few reps, up to ${MAX_VIDEO_SECONDS} seconds`}
          >
            {videoUri ? (
              <View style={styles.pillPair}>
                <CardPill label="Change" onPress={pickVideo} isDark={isDark} accessibilityLabel="Change video" />
                <CardPill label="Remove" onPress={() => setVideoUri(null)} isDark={isDark} accessibilityLabel="Remove video" />
              </View>
            ) : (
              <CardPill label="Add" onPress={pickVideo} isDark={isDark} accessibilityLabel="Add video" />
            )}
          </OptionRow>
          {videoUri ? (
            <>
              <View style={[styles.hairline, styles.optDivider, { backgroundColor: t.div }]} />
              <OptionRow
                isDark={isDark}
                icon={<Ionicons name={muted ? "volume-mute-outline" : "volume-high-outline"} size={18} color={t.icon} />}
                title="Mute audio"
              >
                <AppSwitch value={muted} onValueChange={setMuted} accessibilityLabel="Mute audio" />
              </OptionRow>
            </>
          ) : null}
          <View style={[styles.hairline, styles.optDivider, { backgroundColor: t.div }]} />
          {/* Assisted: its weight is help, not load (user request, 2026-11-07),
              so less is harder and less is its record (utils/assisted.ts). */}
          <OptionRow
            isDark={isDark}
            icon={<Ionicons name="arrow-up-circle-outline" size={19} color={t.icon} />}
            title="Assisted"
            sub="Less weight is harder, like an assisted pull-up"
          >
            <AppSwitch value={assisted} onValueChange={setAssisted} accessibilityLabel="Assisted" />
          </OptionRow>
        </NeuCard>

        {/* How to do it: numbered steps, typed in place, moved by their
            handle and swiped away (components/StepsEditor.tsx). They show as
            numbered circles on the exercise's page, like a bundled one's. */}
        <SectionLabel title="HOW TO DO IT" note="Optional" isDark={isDark} />
        <NeuCard dark={isDark} style={styles.card}>
          <StepsEditor steps={steps} onChange={setSteps} onDragStateChange={setStepsDragging} />
        </NeuCard>
      </KeyboardAwareScrollView>

      <Reanimated.View pointerEvents="box-none" style={[styles.foot, liftStyle]}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <MaskedView style={StyleSheet.absoluteFill} maskElement={
            <LinearGradient
              colors={["transparent", "black"]}
              locations={[0, FOOT_FADE / (FOOT_FADE + footBody)]}
              style={StyleSheet.absoluteFill}
            />
          }>
            <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          </MaskedView>
        </View>
        {showSlots ? (
          <View
            style={styles.slotLine}
            accessible
            accessibilityLabel={full
              ? `All ${MAX_CUSTOM} custom exercise slots used. Delete one to add more.`
              : `${slotCount} of your ${MAX_CUSTOM} custom exercises used`}
          >
            <SlotRing used={slotCount} isDark={isDark} />
            <Text style={[styles.slotLineText, { color: full ? dangerTextColor(isDark) : t.ts }]}>
              {full
                ? `All ${MAX_CUSTOM} used. Delete one to add more.`
                : `${slotCount} of your ${MAX_CUSTOM} custom exercises used`}
            </Text>
          </View>
        ) : null}
        <View style={styles.saveWrap}>
          <GlassButton
            pill
            size={PILL_H}
            tint={slate}
            onPress={() => { void handleSave(); }}
            disabled={!ready}
            contentStyle={styles.saveContent}
            solidStyle={styles.saveLift}
            accessibilityLabel={isEditMode ? "Save changes" : "Save exercise"}
          >
            <Ionicons name="checkmark" size={18} color={slateInk} />
            <Text style={[styles.saveText, { color: slateInk }]}>{saving ? "Saving..." : "Save Exercise"}</Text>
          </GlassButton>
        </View>
        <View style={{ height: saveBottom }} />
      </Reanimated.View>

      <KeyboardDismissButton />
    </View>
  );
}

const styles = StyleSheet.create({
  root:            { flex: 1 },
  topGradient:     { position: "absolute", left: 0, right: 0, zIndex: 5 },
  header:          { flexDirection: "row", alignItems: "center", height: BACK_SIZE, marginBottom: 24 },
  screenTitle:     { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5 },

  // A section's heading, its note across from it.
  labelRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginHorizontal: 4, marginBottom: 10 },
  sectionLabel:    { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" },
  labelAlone:      { marginHorizontal: 4, marginBottom: 10 },
  labelRequired:   { fontFamily: FontFamily.bold, fontSize: 12 },
  labelNote:       { fontFamily: FontFamily.regular, fontSize: 12 },
  card:            { marginBottom: 24 },
  hairline:        { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  // The preview: the list's thumbnail, the name and the muscles' tags.
  previewRow:      { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  previewText:     { flex: 1, gap: 7 },
  previewName:     { fontFamily: FontFamily.bold, fontSize: 17 },
  previewMeta:     { fontFamily: FontFamily.regular, fontSize: 13 },
  tagRow:          { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag:             { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  tagText:         { fontFamily: FontFamily.bold, fontSize: 12 },

  // The basics.
  nameBlock:       { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 4 },
  fieldName:       { fontFamily: FontFamily.semibold, fontSize: 12 },
  fieldHint:       { fontFamily: FontFamily.regular, fontSize: 12 },
  nameInput:       { fontFamily: FontFamily.semibold, fontSize: 17, paddingVertical: 2 },
  musclesBlock:    { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  fieldRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  pillWrap:        { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  musclePill:      { flexDirection: "row", alignItems: "center", gap: 5, height: 36, paddingHorizontal: 14, borderRadius: 18 },
  // A picked muscle: the accent's edge, and less room before its tick.
  musclePillOn:    { borderWidth: 1.5, borderColor: ACCT, paddingLeft: 10 },
  musclePillText:  { fontFamily: FontFamily.semibold, fontSize: 14 },

  // Make it yours.
  optRow:          { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  optIcon:         { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  optThumb:        { width: 36, height: 36 },
  optText:         { flex: 1, gap: 1 },
  optTitle:        { fontFamily: FontFamily.semibold, fontSize: 15 },
  optSub:          { fontFamily: FontFamily.regular, fontSize: 12 },
  // Under the words, not the icons, as a list's lines run.
  optDivider:      { marginLeft: 64, marginRight: 0 },
  pillPair:        { flexDirection: "row", gap: 6 },
  cardPill:        { height: 32, paddingHorizontal: 13, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cardPillText:    { fontFamily: FontFamily.bold, fontSize: 13 },

  // The footer, its blur filling it from FOOT_FADE down.
  foot:            { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: FOOT_FADE },
  slotLine:        { height: SLOT_LINE_H - 12, marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 20 },
  // Starts the arc at 12 o'clock.
  ringSvg:         { transform: [{ rotate: "-90deg" }] },
  slotLineText:    { fontFamily: FontFamily.semibold, fontSize: 12 },
  saveWrap:        { paddingHorizontal: 20 },
  saveContent:     { gap: 8 },
  saveText:        { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 0.3 },
  // The solid slate pill's shadow, as deep as the builder's Create pill's;
  // glass is lit by the glass.
  saveLift:        { ...PILL_SHADOW, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
});
