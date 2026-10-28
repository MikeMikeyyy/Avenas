// Import & Export (Settings > App): every logged workout out as a CSV file,
// and another app's history in (user request, 2026-10-23; Hevy and Strong for
// now). Both work from what's on this phone, signed in or not; an import backs
// up like any logged workout.
//
//   Export   one row per set (utils/workoutExport.ts), handed to the system
//            share sheet: Files, AirDrop, Mail, Numbers.
//   Import   a CSV picked from Files and read here (utils/workoutImport.ts),
//            then looked over on app/import-review.tsx before anything's saved.
//   Undo     the last import taken back out (utils/importStore.ts), for a file
//            that came in wrong.

import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "../components/MaskedView";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, DANGER_BRIGHT, BTN_SLATE, BTN_SLATE_DARK, ON_FILL } from "../constants/theme";
import { darkGlow, haloGlow, pill, pillGlow, PILL_SHADOW } from "../constants/buttons";
import { scrollEndPadding } from "../constants/floatingBars";
import { useFloatingBarsReach } from "../hooks/useFloatingBars";
import { PROGRAMS_KEY, WORKOUT_HISTORY_KEY, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import { getJSON } from "../utils/storage";
import { MONTH_NAMES } from "../utils/dates";
import { exportFileName, workoutsToCsv } from "../utils/workoutExport";
import { readWorkoutCsv, SOURCE_NAMES } from "../utils/workoutImport";
import { loadImports, setPendingImport, undoImport, type ImportRecord } from "../utils/importStore";
import { scheduleCloudPush } from "../lib/syncManager";

/** Files the picker offers: text (CSV is), and the types Android files CSVs
 *  under. Anything else that gets through is turned away by what's in it. */
const IMPORT_TYPES = ["text/*", "application/csv", "application/vnd.ms-excel"];
/** Bigger than any export of real training (a decade of Hevy is a few MB). */
const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

/** "today, 3:05 pm", "23 Oct, 3:05 pm". */
function fmtImportedAt(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `today, ${time}`;
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}, ${time}`;
}

export default function ImportExportScreen() {
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const router = useRouter();
  const { isDark } = useTheme();
  const { isKg } = useUnit();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [workoutCount, setWorkoutCount] = useState<number | null>(null);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [exporting, setExporting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const refresh = useCallback(async () => {
    const [history, log] = await Promise.all([getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []), loadImports()]);
    setWorkoutCount(history.length);
    setImports(log);
  }, []);

  // Back from a review, the import it saved shows here with its Undo.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const onExport = async () => {
    if (exporting || !workoutCount) return;
    setExporting(true);
    try {
      const [history, programs] = await Promise.all([
        getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
        getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
      ]);
      const file = new File(Paths.cache, exportFileName());
      file.create({ overwrite: true });
      // Written in full before it's shared (SDK 58's write is async).
      await file.write(workoutsToCsv(history, programs, isKg));
      await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "Export Workouts" });
    } catch (e) {
      if (__DEV__) console.warn("[avenas]", "export", e);
      Alert.alert("Couldn't Export", "Something went wrong making the file. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const onChooseFile = async () => {
    if (choosing) return;
    setChoosing(true);
    try {
      const picked = await File.pickFileAsync({ mimeTypes: IMPORT_TYPES });
      if (picked.canceled) return;
      const file = picked.result;
      if (file.size > MAX_IMPORT_BYTES) {
        Alert.alert("File Too Big", "That file is bigger than any workout export. Check it's the CSV Hevy or Strong made.");
        return;
      }
      const read = readWorkoutCsv(await file.text());
      if (!read.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Can't Import This File", read.error);
        return;
      }
      setPendingImport({ parsed: read.data, fileName: file.name });
      router.push("/import-review");
    } catch (e) {
      if (__DEV__) console.warn("[avenas]", "import file", e);
      Alert.alert("Couldn't Open the File", "Try choosing it again.");
    } finally {
      setChoosing(false);
    }
  };

  const last = imports[0];
  const onUndo = () => {
    if (!last || undoing) return;
    const count = last.workouts.length;
    Alert.alert(
      "Undo Import?",
      `This takes out the ${count} workout${count === 1 ? "" : "s"} imported from ${SOURCE_NAMES[last.source]}. Workouts you've logged in Avenas stay.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo Import",
          style: "destructive",
          onPress: async () => {
            setUndoing(true);
            try {
              await undoImport(last.at);
              scheduleCloudPush();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) {
              if (__DEV__) console.warn("[avenas]", "undoImport", e);
              Alert.alert("Couldn't Undo", "Nothing was changed. Try again.");
            } finally {
              setUndoing(false);
              void refresh();
            }
          },
        },
      ],
    );
  };

  const slate = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const onSlate = isDark ? APP_DARK.bg : ON_FILL;
  const unit = isKg ? "kg" : "lbs";
  const noWorkouts = workoutCount === 0;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
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

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + BACK_TOP, paddingBottom: scrollEndPadding(insets.bottom + 40, barsReach) }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Import & Export</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.sectionLabel, { color: t.ts }]}>Import</Text>
        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.cardInner}>
            <View style={styles.cardHead}>
              <Ionicons name="download-outline" size={22} color={t.icon} />
              <Text style={[styles.cardTitle, { color: t.tp }]}>Import Workouts</Text>
            </View>
            <Text style={[styles.body, { color: t.ts }]}>
              {"Bring your history over from Hevy or Strong. You'll see how each exercise comes in before anything is saved."}
            </Text>
            <View style={styles.steps}>
              {[
                ["Hevy", "Settings, then Export & Import Data, then Export Data."],
                ["Strong", "Settings, then Export Data."],
              ].map(([app, how]) => (
                <Text key={app} style={[styles.step, { color: t.ts }]}>
                  <Text style={[styles.stepApp, { color: t.tp }]}>In {app}: </Text>{how}
                </Text>
              ))}
              <Text style={[styles.step, { color: t.ts }]}>
                {"Save the file to Files, then choose it here. Days you've already logged in Avenas are skipped."}
              </Text>
            </View>
            <BounceButton onPress={onChooseFile} accessibilityLabel="Choose a CSV file to import" accessibilityRole="button">
              <View style={[styles.btn, styles.accentBtn, darkGlow(styles.accentBtn, isDark), choosing && styles.disabled]}>
                {choosing
                  ? <ActivityIndicator color={ON_FILL} />
                  : <>
                      <Ionicons name="document-outline" size={18} color={ON_FILL} />
                      <Text style={[styles.btnText, { color: ON_FILL }]}>Choose CSV File</Text>
                    </>}
              </View>
            </BounceButton>
          </View>
        </NeuCard>

        {last && (
          <>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>Last Import</Text>
            <NeuCard dark={isDark} style={styles.card}>
              <View style={styles.cardInner}>
                <View>
                  <Text style={[styles.cardTitle, { color: t.tp }]}>
                    {last.workouts.length} workout{last.workouts.length === 1 ? "" : "s"} from {SOURCE_NAMES[last.source]}
                  </Text>
                  <Text style={[styles.body, { color: t.ts, marginTop: 2 }]}>Imported {fmtImportedAt(last.at)}</Text>
                </View>
                <BounceButton onPress={onUndo} accessibilityLabel="Undo import" accessibilityRole="button">
                  <View style={[styles.btn, styles.dangerBtn, darkGlow(styles.dangerBtn, isDark), undoing && styles.disabled]}>
                    {undoing
                      ? <ActivityIndicator color={ON_FILL} />
                      : <>
                          <Ionicons name="arrow-undo-outline" size={18} color={ON_FILL} />
                          <Text style={[styles.btnText, { color: ON_FILL }]}>Undo Import</Text>
                        </>}
                  </View>
                </BounceButton>
              </View>
            </NeuCard>
          </>
        )}

        <Text style={[styles.sectionLabel, { color: t.ts }]}>Export</Text>
        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.cardInner}>
            <View style={styles.cardHead}>
              <Ionicons name="share-outline" size={22} color={t.icon} />
              <Text style={[styles.cardTitle, { color: t.tp }]}>Export Workouts</Text>
            </View>
            <Text style={[styles.body, { color: t.ts }]}>
              {noWorkouts
                ? "Nothing to export yet. Once you've logged a workout, it can go here."
                : `Every set you've logged as a spreadsheet, with weights in ${unit}. Opens in Numbers, Excel and Google Sheets.`}
            </Text>
            <BounceButton
              onPress={onExport}
              accessibilityLabel="Export workouts as a CSV file"
              accessibilityRole="button"
              accessibilityState={{ disabled: noWorkouts || workoutCount === null }}
            >
              <View style={[styles.btn, styles.slateBtn, { backgroundColor: slate }, (exporting || noWorkouts || workoutCount === null) && styles.disabled]}>
                {exporting
                  ? <ActivityIndicator color={onSlate} />
                  : <>
                      <Ionicons name="share-outline" size={18} color={onSlate} />
                      <Text style={[styles.btnText, { color: onSlate }]}>Export CSV</Text>
                    </>}
              </View>
            </BounceButton>
          </View>
        </NeuCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1 },
  topGradient:  { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:       { paddingHorizontal: 20 },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, height: BACK_SIZE },
  title:        { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", flex: 1 },
  // Same section label as Settings.
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginLeft: 4 },
  card:         { borderRadius: 18, marginBottom: 24 },
  cardInner:    { padding: 18, gap: 14 },
  cardHead:     { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle:    { fontFamily: FontFamily.bold, fontSize: 16 },
  body:         { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  steps:        { gap: 6 },
  step:         { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  stepApp:      { fontFamily: FontFamily.semibold },
  btn:          { ...pill(), gap: 8 },
  accentBtn:    { backgroundColor: ACCT, ...pillGlow(ACCT) },
  slateBtn:     { ...PILL_SHADOW },
  dangerBtn:    { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) },
  btnText:      { fontFamily: FontFamily.bold, fontSize: 15 },
  disabled:     { opacity: 0.6 },
});
