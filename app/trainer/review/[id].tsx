// Trainer review screen for a SentProgram (gym user → trainer).
// Shows the program snapshot, lets the trainer leave overall comments
// and "Send Back" the program. Send Back stamps returnedAtISO + comments,
// flipping status to "returned" so the gym user sees the feedback.

import { useCallback, useEffect, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Path } from "react-native-svg";

import NeuCard from "../../../components/NeuCard";
import BounceButton from "../../../components/BounceButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../../constants/theme";
import { useTheme } from "../../../contexts/ThemeContext";
import { loadSentPrograms, updateSentProgram, type SentProgram } from "../../../utils/trainerStore";

// Matches the floating dismiss button used in workout.tsx / log-workout.tsx /
// new-program.tsx — single canonical SVG kept local to each screen.
function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4"/>
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const [entry, setEntry] = useState<SentProgram | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      const list = await loadSentPrograms();
      if (cancelled) return;
      const found = list.find(s => s.id === id) ?? null;
      setEntry(found);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [id]));

  const handleSendBack = useCallback(() => {
    if (!entry) return;
    Alert.alert(
      "Send Back",
      "Are you sure all changes have been made?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Back",
          onPress: async () => {
            await updateSentProgram(entry.id, {
              status: "returned",
              returnedAtISO: new Date().toISOString(),
              appliedAtISO: undefined,
            });
            router.back();
          },
        },
      ]
    );
  }, [entry, router]);

  const handleSendUpdate = useCallback(() => {
    if (!entry) return;
    Alert.alert(
      "Send Update",
      "Send the latest edits to your client? They'll get a tick to accept the new version into their programs.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Update",
          onPress: async () => {
            await updateSentProgram(entry.id, {
              returnedAtISO: new Date().toISOString(),
              appliedAtISO: undefined,
            });
            router.back();
          },
        },
      ]
    );
  }, [entry, router]);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  }

  if (!entry) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Text style={{ fontFamily: FontFamily.semibold, fontSize: 16, color: t.tp }}>Review not found</Text>
        <BounceButton style={{ marginTop: 16 }} onPress={() => router.back()}>
          <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: ACCT }}>
            <Text style={{ color: "#fff", fontFamily: FontFamily.bold }}>Back</Text>
          </View>
        </BounceButton>
      </View>
    );
  }

  const snap = entry.programSnapshot;
  const isReturned = entry.status === "returned";
  // Trainer made edits in the program builder AFTER the last Send Back —
  // surface a "Send Update to Client" CTA so they can push the new version.
  const hasUnsentEdits =
    isReturned &&
    !!entry.lastEditedAtISO &&
    (!entry.returnedAtISO || entry.lastEditedAtISO > entry.returnedAtISO);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.iconBtn, { backgroundColor: isDark ? t.div : "#fff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFillObject} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.titleRow}>
            <View style={{ width: 66 }} />
            <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>REVIEW PROGRAM</Text>
            <View style={{ width: 66 }} />
          </View>
          <NeuCard dark={isDark} radius={20}>
            <View style={styles.programInner}>
              <View style={styles.programHeader}>
                <Text style={[styles.label, { color: t.ts }]}>PROGRAM NAME</Text>
                <Text style={[styles.nameDisplay, { color: t.tp }]} numberOfLines={2}>
                  {entry.programSnapshot?.name ?? entry.programName}
                </Text>
              </View>
              {snap ? (
                <>
                  <View style={styles.metaRow}>
                    <Ionicons name="calendar-outline" size={13} color={t.ts} />
                    <Text style={[styles.metaText, { color: t.ts }]}>{snap.totalWeeks} weeks</Text>
                  </View>
                  <View style={styles.cycleGrid}>
                    {snap.cyclePattern.map((day, i) => {
                      const isTraining = day !== "Rest" && day !== "";
                      return (
                        <View
                          key={i}
                          style={[
                            styles.cycleChip,
                            isTraining
                              ? { backgroundColor: ACCT + "22", borderColor: ACCT, borderWidth: 1 }
                              : { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div },
                          ]}
                        >
                          <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                            {day || "Rest"}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={[styles.daysList, { borderTopColor: t.div }]}>
                    <Text style={[styles.label, { color: t.ts, marginBottom: 8 }]}>EXERCISES</Text>
                    {Object.entries(snap.workouts).map(([key, exercises], i) => {
                      const dayName = key.split(":").slice(1).join(":") || key;
                      return (
                        <View key={key} style={[styles.daySection, i > 0 && { marginTop: 14 }]}>
                          <Text style={[styles.dayName, { color: t.tp }]}>{dayName}</Text>
                          {exercises.length === 0 ? (
                            <Text style={[styles.exerciseRow, { color: t.ts, fontStyle: "italic" }]}>No exercises</Text>
                          ) : (
                            exercises.map(ex => (
                              <Text key={ex.id} style={[styles.exerciseRow, { color: t.ts }]} numberOfLines={1}>
                                · {ex.name}
                              </Text>
                            ))
                          )}
                        </View>
                      );
                    })}
                  </View>
                  <BounceButton style={{ marginTop: 12 }} onPress={() => router.push({ pathname: "/new-program", params: { reviewId: entry.id } })}>
                    <NeuCard dark={isDark} radius={14} innerStyle={styles.editBtnInner}>
                      <Ionicons name="create-outline" size={16} color={t.tp} />
                      <Text style={[styles.editBtnText, { color: t.tp }]}>Open in Program Builder</Text>
                    </NeuCard>
                  </BounceButton>
                </>
              ) : (
                <Text style={[styles.noSnap, { color: t.ts }]}>This entry has no program snapshot.</Text>
              )}
            </View>
          </NeuCard>

          {!isReturned ? (
            <BounceButton style={{ marginTop: 16 }} onPress={handleSendBack}>
              <View style={[styles.sendBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                <Text style={styles.sendBtnText}>Send Back to Client</Text>
              </View>
            </BounceButton>
          ) : hasUnsentEdits ? (
            <>
              <View style={[styles.returnedBanner, { backgroundColor: `${ACCT}1a` }]}>
                <Ionicons name="checkmark-circle" size={18} color={ACCT} />
                <Text style={[styles.returnedText, { color: ACCT }]}>
                  Already sent back to the client.
                </Text>
              </View>
              <BounceButton style={{ marginTop: 12 }} onPress={handleSendUpdate}>
                <View style={[styles.sendBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                  <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                  <Text style={styles.sendBtnText}>Send Update to Client</Text>
                </View>
              </BounceButton>
            </>
          ) : (
            <View style={[styles.returnedBanner, { backgroundColor: `${ACCT}1a` }]}>
              <Ionicons name="checkmark-circle" size={18} color={ACCT} />
              <Text style={[styles.returnedText, { color: ACCT }]}>
                Already sent back to the client.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {kbHeight > 0 && Platform.OS === "ios" && (
        <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, zIndex: 999 }}>
          <TouchableOpacity
            onPress={() => Keyboard.dismiss()}
            activeOpacity={0.75}
            style={[styles.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}
            accessibilityLabel="Dismiss keyboard"
            accessibilityRole="button"
          >
            <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topGradient:    { position: "absolute", left: 0, right: 0, zIndex: 5 },
  iconBtn:        { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  titleRow:       { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 24 },
  screenTitle:    { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1 },
  programInner:   { padding: 18, gap: 10 },
  programHeader:  { gap: 6 },
  label:          { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.9 },
  nameDisplay:    { fontFamily: FontFamily.bold, fontSize: 18 },
  metaRow:        { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText:       { fontFamily: FontFamily.regular, fontSize: 13 },
  cycleGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  cycleChip:      { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:  { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  daysList:       { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  daySection:     { gap: 2 },
  dayName:        { fontFamily: FontFamily.bold, fontSize: 14, marginBottom: 4 },
  exerciseRow:    { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, paddingLeft: 4 },
  noSnap:         { fontFamily: FontFamily.regular, fontSize: 13, padding: 8 },
  editBtnInner:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, minHeight: 44 },
  editBtnText:    { fontFamily: FontFamily.bold, fontSize: 14 },
  sendBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  sendBtnText:    { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  returnedBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, padding: 14, borderRadius: 14 },
  returnedText:   { fontFamily: FontFamily.semibold, fontSize: 13 },
  kbFloatBtn:     { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
});
