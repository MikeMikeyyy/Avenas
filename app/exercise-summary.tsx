import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import FadeScreen from "../components/FadeScreen";
import ExerciseImage from "../components/ExerciseImage";
import VideoDemo from "../components/VideoDemo";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { useTheme } from "../contexts/ThemeContext";
import { getJSON } from "../utils/storage";
import { exerciseByName, exerciseIdByName } from "../utils/exerciseLookup";

// "middle back" → "Middle Back". Catalogue secondary muscles are free-text
// lowercase; title-case them so they read as labels alongside the primary chip.
function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

export default function ExerciseSummaryScreen() {
  const router = useRouter();
  const { exerciseName } = useLocalSearchParams<{ exerciseName: string }>();
  const name = exerciseName ?? "";
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const imgSize = Math.min(width - 40, 340);

  // Bundled catalogue entry (muscles/equipment/instructions) resolves
  // synchronously. Custom exercises aren't in the catalogue, so we fall back to
  // the user's saved list for muscles/description/photo.
  const bundled = exerciseByName(name);
  const [custom, setCustom] = useState<CustomExercise | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (bundled) return;            // catalogue entry already has everything
      let cancelled = false;
      (async () => {
        const list = await getJSON<CustomExercise[]>(CUSTOM_KEY, []);
        if (cancelled) return;
        const key = name.trim().toLowerCase();
        setCustom((Array.isArray(list) ? list : []).find(c => c.name.trim().toLowerCase() === key) ?? null);
      })();
      return () => { cancelled = true; };
    }, [bundled, name]),
  );

  const primaryMuscle = bundled?.primaryMuscle ?? custom?.muscles?.[0];
  const otherCustomMuscles = !bundled ? (custom?.muscles ?? []).slice(1) : [];
  const equipment = bundled?.equipment;
  const secondary = bundled?.secondaryMuscles ?? [];
  // Numbered how-to: catalogue instructions for bundled exercises, the user's
  // own steps for custom ones. Both render through the same numbered-circle list.
  const instructions = bundled?.instructions ?? custom?.steps ?? [];
  const description = custom?.description?.trim();
  const imageId = exerciseIdByName(name) ?? `custom:${name}`;

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Top gradient blur — mirrors exercise-history / program-history-detail. */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 14, left: 20, zIndex: 10 }}
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
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          // Back button spans insets.top+14 → insets.top+54 (40px tall); start the
          // hero image a little below it so the button never sits on the photo.
          paddingTop: insets.top + 66,
          paddingBottom: insets.bottom + 40,
          alignItems: "center",
        }}
      >
        {/* Hero — animated GIF when bundled, the user's photo for a custom
            exercise, else the neutral fallback tile (handled by ExerciseImage). */}
        {!bundled && custom?.imageUri ? (
          <Image
            source={{ uri: custom.imageUri }}
            style={{ width: imgSize, height: imgSize, borderRadius: 20, backgroundColor: t.div }}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <ExerciseImage
            exerciseId={imageId}
            variant="full"
            size={imgSize}
            radius={20}
            backgroundColor={t.div}
            fallbackColor={t.ts}
          />
        )}

        {/* Name — full header, wraps to 2 lines instead of truncating. */}
        <Text style={[styles.title, { color: t.tp }]} numberOfLines={2}>
          {name}
        </Text>

        {/* Primary muscle + equipment chips */}
        {(primaryMuscle || equipment) && (
          <View style={styles.chipRow}>
            {primaryMuscle && (
              <View style={[styles.chip, { backgroundColor: ACCT + "22", borderColor: ACCT }]}>
                <Ionicons name="body-outline" size={13} color={ACCT} />
                <Text style={[styles.chipText, { color: ACCT }]}>{primaryMuscle}</Text>
              </View>
            )}
            {equipment && (
              <View style={[styles.chip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: t.div }]}>
                <Ionicons name="barbell-outline" size={13} color={t.ts} />
                <Text style={[styles.chipText, { color: t.ts }]}>{equipment}</Text>
              </View>
            )}
          </View>
        )}

        {/* History CTA — same primary ACCT button as the Progress page chart. */}
        <BounceButton
          style={styles.historyBtnWrap}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: "/exercise-history", params: { exerciseName: name } });
          }}
          accessibilityRole="button"
          accessibilityLabel={`See full history for ${name}`}
        >
          <View style={styles.historyBtn}>
            <Ionicons name="time-outline" size={18} color="#fff" />
            <Text style={styles.historyBtnLabel} numberOfLines={1}>See Exercise History</Text>
            <Ionicons name="chevron-forward" size={16} color="#fff" />
          </View>
        </BounceButton>

        {/* Video demo — custom exercises only. Tap the play button to watch. */}
        {custom?.videoUri ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>VIDEO DEMO</Text>
            <View style={{ alignItems: "center" }}>
              <VideoDemo uri={custom.videoUri} size={imgSize} radius={16} muted={custom.muted ?? false} />
            </View>
          </View>
        ) : null}

        {/* Secondary muscles */}
        {secondary.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>ALSO WORKS</Text>
            <View style={styles.muscleWrap}>
              {secondary.map(m => (
                <View key={m} style={[styles.muscleChip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}>
                  <Text style={[styles.muscleChipText, { color: t.tp }]}>{titleCase(m)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Custom-exercise secondary muscles (no catalogue secondaries) */}
        {otherCustomMuscles.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>ALSO WORKS</Text>
            <View style={styles.muscleWrap}>
              {otherCustomMuscles.map(m => (
                <View key={m} style={[styles.muscleChip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}>
                  <Text style={[styles.muscleChipText, { color: t.tp }]}>{m}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* How-to: catalogue steps, or the custom exercise's description. */}
        {instructions.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>HOW TO PERFORM</Text>
            <NeuCard dark={isDark} radius={16}>
              <View style={styles.instructions}>
                {instructions.map((step, i) => (
                  <View key={i} style={[styles.stepRow, i > 0 && { marginTop: 14 }]}>
                    <View style={[styles.stepNum, { backgroundColor: ACCT + "22" }]}>
                      <Text style={[styles.stepNumText, { color: ACCT }]}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.stepText, { color: t.tp }]}>{step}</Text>
                  </View>
                ))}
              </View>
            </NeuCard>
          </View>
        ) : description ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>ABOUT</Text>
            <NeuCard dark={isDark} radius={16}>
              <Text style={[styles.aboutText, { color: t.tp }]}>{description}</Text>
            </NeuCard>
          </View>
        ) : null}
      </ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },

  title: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    textAlign: "center",
    marginTop: 18,
  },

  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 13 },

  historyBtnWrap: { alignSelf: "stretch", marginTop: 20 },
  historyBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 10,
    borderRadius: 20,
    backgroundColor: ACCT,
    shadowColor: ACCT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 8,
  },
  historyBtnLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 15,
    color: "#fff",
    flex: 1,
    textAlign: "center",
  },

  section: { alignSelf: "stretch", marginTop: 24 },
  sectionLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 12,
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 2,
  },

  muscleWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muscleChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  muscleChipText: { fontFamily: FontFamily.semibold, fontSize: 13 },

  instructions: { paddingHorizontal: 16, paddingVertical: 16 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepNum: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  stepNumText: { fontFamily: FontFamily.bold, fontSize: 13 },
  stepText: { flex: 1, fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 21 },

  aboutText: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 21, padding: 16 },
});
