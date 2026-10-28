// An import, looked over before it's saved (from Settings > Import & Export,
// which read the file into utils/importStore.ts's pendingImport). What's in it,
// what's left out (a day already logged in Avenas, user decision 2026-10-23),
// the unit its weights are in when the file doesn't say (Strong's older
// export), and what each of its exercises becomes.
//
// Exercises are matched as utils/exerciseMatch.ts says: sure ones under
// Matched, guesses under To Check, the rest under No Match, which come in under
// their own names: in the Journal and their history, never in the picker (user
// decision, 2026-10-23). A tap on any changes it in the exercise picker
// (changing={its name}), or keeps its own name. A custom exercise made from the
// picker comes back to the same exercise's picker, as the builder's swap does.
//
// Import plans against the history as it is then (utils/workoutImport.ts
// planImport) and saves through utils/importStore.ts, which can undo it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "../components/MaskedView";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "../components/NeuCard";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";
import GlassButton from "../components/GlassButton";
import ExercisePicker from "../components/ExercisePicker";
import SegmentedControl from "../components/SegmentedControl";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, ON_FILL, accentTextColor } from "../constants/theme";
import { PILL_H, darkGlow, pillGlow } from "../constants/buttons";
import { BAR_STACK_GAP, scrollEndPadding } from "../constants/floatingBars";
import { useFloatingBarsReach } from "../hooks/useFloatingBars";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { WORKOUT_HISTORY_KEY, type CompletedWorkout } from "../constants/programs";
import { getJSON } from "../utils/storage";
import { MONTH_NAMES, fromYMD } from "../utils/dates";
import type { WeightUnit } from "../utils/units";
import { exercisesIn, planImport, SOURCE_NAMES, type ExerciseChoice } from "../utils/workoutImport";
import { matchExerciseName, type ExerciseMatch } from "../utils/exerciseMatch";
import { ANDROID_HISTORY_LIMIT_CHARS, ImportTooLargeError, pendingImport, saveImport, setPendingImport } from "../utils/importStore";
import { liveCustoms } from "../utils/customExercises";
import { deleteCustomExercise as deleteCustomEverywhere } from "../utils/customExerciseStore";
import { ALERT_SETTLE_MS } from "../lib/photoPicker";
import { scheduleCloudPush } from "../lib/syncManager";

/** One exercise of the file: how it was first matched (its group, which it
 *  stays in so the list doesn't move under a finger) and what it becomes now. */
type Row = { name: string; sets: number; found: ExerciseMatch["kind"]; choice: ExerciseChoice };

const UNITS = [{ key: "kg", label: "kg" }, { key: "lb", label: "lbs" }] as const;

/** "18 Mar 2023" */
function fmtDay(ymd: string | null): string {
  const d = ymd ? fromYMD(ymd) : null;
  return d ? `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` : "";
}

export default function ImportReviewScreen() {
  const insets = useSafeAreaInsets();
  const barsReach = useFloatingBarsReach();
  const router = useRouter();
  const { isDark } = useTheme();
  const { isKg } = useUnit();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [pending] = useState(pendingImport);
  const parsed = pending?.parsed ?? null;
  const [customs, setCustoms] = useState<CustomExercise[] | null>(null);
  const [history, setHistory] = useState<CompletedWorkout[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unit, setUnit] = useState<WeightUnit>(parsed?.weightUnit ?? (isKg ? "kg" : "lb"));
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The exercise whose picker was open when a custom exercise was being made
  // from it: its picker opens again on the way back.
  const pendingPick = useRef<string | null>(null);

  // Nothing to look over (the app was reloaded on this page): back to the
  // page that chooses a file.
  useEffect(() => { if (!parsed) router.back(); }, [parsed, router]);
  // Leaving without importing drops the file; choosing it again reads it again.
  useEffect(() => () => setPendingImport(null), []);

  useFocusEffect(useCallback(() => {
    void getJSON<CustomExercise[]>(CUSTOM_KEY, []).then(raw => {
      const list = Array.isArray(raw) ? raw : [];
      setCustoms(list);
      // Matched once, on the first read, against your own exercises as well
      // as the catalogue.
      setRows(prev => prev ?? (parsed ? exercisesIn(parsed).map(({ name, sets }): Row => {
        const m = matchExerciseName(name, list);
        return { name, sets, found: m.kind, choice: m.kind === "none" ? null : { name: m.name, ...(m.customId ? { customId: m.customId } : {}) } };
      }) : null));
    });
    void getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []).then(setHistory);
    if (pendingPick.current) {
      setPickingFor(pendingPick.current);
      pendingPick.current = null;
    }
  }, [parsed]));

  /** What each exercise becomes, a custom exercise under its name now (it may
   *  have been renamed from the picker) and one deleted since as its own name. */
  const choices = useMemo(() => {
    const live = liveCustoms(customs ?? []);
    const out: Record<string, ExerciseChoice> = {};
    for (const r of rows ?? []) {
      if (!r.choice?.customId) { out[r.name] = r.choice; continue; }
      const c = live.find(x => x.id === r.choice!.customId);
      out[r.name] = c ? { name: c.name, customId: r.choice.customId } : null;
    }
    return out;
  }, [rows, customs]);

  const summary = useMemo(() => {
    const taken = new Set((history ?? []).map(w => w.date));
    let adding = 0;
    let skipped = 0;
    let sets = 0;
    let first: string | null = null;
    let last: string | null = null;
    for (const w of parsed?.workouts ?? []) {
      if (taken.has(w.date)) { skipped++; continue; }
      adding++;
      for (const e of w.exercises) sets += e.sets.length;
      if (!first || w.date < first) first = w.date;
      if (!last || w.date > last) last = w.date;
    }
    return { adding, skipped, sets, first, last };
  }, [parsed, history]);

  const setChoice = (name: string, choice: ExerciseChoice) =>
    setRows(prev => prev?.map(r => (r.name === name ? { ...r, choice } : r)) ?? prev);

  const onRow = (r: Row) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = choices[r.name];
    if (!now) { setPickingFor(r.name); return; }
    Alert.alert(r.name, `Comes in as ${now.name}.`, [
      { text: "Change Exercise", onPress: () => setTimeout(() => setPickingFor(r.name), ALERT_SETTLE_MS) },
      { text: "Keep Its Own Name", onPress: () => setChoice(r.name, null) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const onImport = async () => {
    if (!parsed || saving || summary.adding === 0) return;
    setSaving(true);
    try {
      // Against the history as it is now: something may have been logged
      // since this page opened.
      const latest = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
      const plan = planImport(parsed, { weightUnit: unit, choices, history: latest });
      await saveImport(plan.workouts, parsed.source, Platform.OS === "android" ? { maxHistoryChars: ANDROID_HISTORY_LIMIT_CHARS } : {});
      scheduleCloudPush();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (e instanceof ImportTooLargeError) {
        Alert.alert("Too Much to Import", "That's more workout history than Avenas can keep on an Android phone yet, so nothing was imported.");
      } else {
        if (__DEV__) console.warn("[avenas]", "saveImport", e);
        Alert.alert("Couldn't Import", "Something went wrong saving it, so nothing was changed. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (!parsed) return <View style={[styles.root, { backgroundColor: t.bg }]} />;

  const groups = [
    { key: "check", label: "To Check", note: "Avenas's closest guess for each. Tap one to change it.", rows: (rows ?? []).filter(r => r.found === "check") },
    { key: "none", label: "No Match", note: "These come in under their own names: in your Journal and their history, but not in the exercise picker. Tap one to choose an Avenas exercise instead.", rows: (rows ?? []).filter(r => r.found === "none") },
    { key: "matched", label: "Matched", note: null, rows: (rows ?? []).filter(r => r.found === "matched") },
  ].filter(g => g.rows.length > 0);

  // The Import button stands over the page, above the workout bar while that shows.
  const buttonBottom = barsReach > 0 ? barsReach + BAR_STACK_GAP : insets.bottom + 16;
  const source = SOURCE_NAMES[parsed.source];
  const ready = rows !== null && history !== null;
  const nothingNew = ready && summary.adding === 0;

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
        contentContainerStyle={[styles.scroll, {
          paddingTop: insets.top + BACK_TOP,
          paddingBottom: scrollEndPadding(buttonBottom + PILL_H + 24, barsReach),
        }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Review Import</Text>
          <View style={{ width: 40 }} />
        </View>

        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.cardInner}>
            <Text style={[styles.from, { color: t.ts }]} numberOfLines={1}>
              FROM {source.toUpperCase()}{pending?.fileName ? `  ·  ${pending.fileName}` : ""}
            </Text>
            {!ready ? (
              <ActivityIndicator color={t.ts} style={styles.loading} />
            ) : (
              <>
                <View style={styles.stats}>
                  <View>
                    <Text style={[styles.statValue, { color: t.tp }]}>{summary.adding.toLocaleString()}</Text>
                    <Text style={[styles.statLabel, { color: t.ts }]}>{summary.adding === 1 ? "workout" : "workouts"}</Text>
                  </View>
                  <View>
                    <Text style={[styles.statValue, { color: t.tp }]}>{summary.sets.toLocaleString()}</Text>
                    <Text style={[styles.statLabel, { color: t.ts }]}>sets</Text>
                  </View>
                </View>
                {summary.adding > 0 && (
                  <Text style={[styles.body, { color: t.tp }]}>
                    {summary.first === summary.last ? fmtDay(summary.first) : `${fmtDay(summary.first)} to ${fmtDay(summary.last)}`}
                  </Text>
                )}
                {summary.skipped > 0 && (
                  <View style={styles.noteRow}>
                    <Ionicons name="information-circle-outline" size={18} color={t.ts} />
                    <Text style={[styles.body, { color: t.ts, flex: 1 }]}>
                      {nothingNew
                        ? "Every workout in this file is on a day you've already logged in Avenas, so there's nothing new to import."
                        : `${summary.skipped} ${summary.skipped === 1 ? "workout is" : "workouts are"} on days you've already logged in Avenas, so ${summary.skipped === 1 ? "it'll" : "they'll"} be skipped.`}
                    </Text>
                  </View>
                )}
                {parsed.futureWorkouts > 0 && (
                  <Text style={[styles.body, { color: t.ts }]}>
                    {parsed.futureWorkouts} dated after today {parsed.futureWorkouts === 1 ? "is" : "are"} left out.
                  </Text>
                )}
              </>
            )}
          </View>
        </NeuCard>

        {parsed.weightUnit === null && (
          <>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>Weights</Text>
            <NeuCard dark={isDark} style={styles.card}>
              <View style={styles.cardInner}>
                <Text style={[styles.body, { color: t.ts }]}>
                  {`${source}'s file doesn't say which unit its weights are in. Choose the one ${source} was set to.`}
                </Text>
                <SegmentedControl options={UNITS} value={unit} onChange={setUnit} />
              </View>
            </NeuCard>
          </>
        )}

        {ready && groups.map(g => (
          <View key={g.key}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>{g.label} ({g.rows.length})</Text>
            {g.note && <Text style={[styles.groupNote, { color: t.ts }]}>{g.note}</Text>}
            <NeuCard dark={isDark} style={styles.card}>
              {g.rows.map((r, i) => {
                const now = choices[r.name];
                return (
                  <View key={r.name}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
                    <TouchableOpacity
                      onPress={() => onRow(r)}
                      activeOpacity={0.6}
                      style={styles.row}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.name}, ${r.sets} sets, comes in ${now ? `as ${now.name}` : "under its own name"}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rowSource, { color: t.tp }]} numberOfLines={2}>{r.name}</Text>
                        <Text style={[styles.rowTarget, { color: now ? accentTextColor(isDark) : t.ts }]} numberOfLines={1}>
                          {now ? `→ ${now.name}` : "Its own name"}
                        </Text>
                      </View>
                      <Text style={[styles.rowSets, { color: t.ts }]}>{r.sets} {r.sets === 1 ? "set" : "sets"}</Text>
                      <Ionicons name="chevron-forward" size={16} color={t.ts} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </NeuCard>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.importRow, { bottom: buttonBottom }]} pointerEvents="box-none">
        <GlassButton
          pill
          size={PILL_H}
          tint={ACCT}
          onPress={onImport}
          disabled={!ready || saving || nothingNew}
          contentStyle={styles.importContent}
          solidStyle={[styles.importGlow, darkGlow(styles.importGlow, isDark)]}
          accessibilityLabel={`Import ${summary.adding} workouts`}
        >
          {saving
            ? <ActivityIndicator color={ON_FILL} />
            : <>
                <Ionicons name="download-outline" size={18} color={ON_FILL} />
                <Text style={[styles.importText, { color: ON_FILL }]}>
                  {ready ? `Import ${summary.adding.toLocaleString()} ${summary.adding === 1 ? "Workout" : "Workouts"}` : "Import"}
                </Text>
              </>}
        </GlassButton>
      </View>

      {pickingFor !== null && customs && (
        <ExercisePicker
          visible
          subtitle="IMPORT"
          changing={pickingFor}
          customExercises={customs}
          onSelectMultiple={(names, _sets, customIds) => {
            if (names.length > 0) setChoice(pickingFor, { name: names[0], ...(customIds[0] ? { customId: customIds[0] } : {}) });
            setPickingFor(null);
          }}
          onDeleteCustom={name => { void deleteCustomEverywhere(name).then(setCustoms).catch(() => {}); }}
          onCreateCustom={query => {
            pendingPick.current = pickingFor;
            setPickingFor(null);
            router.navigate({ pathname: "/create-custom-exercise", params: { name: query || pickingFor } });
          }}
          onEditCustom={name => {
            pendingPick.current = pickingFor;
            setPickingFor(null);
            router.navigate({ pathname: "/create-custom-exercise", params: { edit: name } });
          }}
          onClose={() => setPickingFor(null)}
          isDark={isDark}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },
  topGradient:   { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:        { paddingHorizontal: 20 },
  header:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, height: BACK_SIZE },
  title:         { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", flex: 1 },
  // Same section label as Settings.
  sectionLabel:  { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginLeft: 4 },
  groupNote:     { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, marginTop: -4, marginBottom: 10, marginHorizontal: 4 },
  card:          { borderRadius: 18, marginBottom: 24 },
  cardInner:     { padding: 18, gap: 12 },
  from:          { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1 },
  loading:       { paddingVertical: 18 },
  stats:         { flexDirection: "row", gap: 32 },
  statValue:     { fontFamily: FontFamily.bold, fontSize: 28 },
  statLabel:     { fontFamily: FontFamily.semibold, fontSize: 13 },
  body:          { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  noteRow:       { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  divider:       { height: 1, marginHorizontal: 16 },
  row:           { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 13, minHeight: 58 },
  rowSource:     { fontFamily: FontFamily.semibold, fontSize: 15 },
  rowTarget:     { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 2 },
  rowSets:       { fontFamily: FontFamily.regular, fontSize: 12 },
  importRow:     { position: "absolute", left: 20, right: 20, gap: 8 },
  importContent: { gap: 8 },
  importGlow:    pillGlow(ACCT, 0.35),
  importText:    { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 0.3 },
});
