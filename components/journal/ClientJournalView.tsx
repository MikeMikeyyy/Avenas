// Read-only journal view used by the PT to see a client's journal:
// monthly activity calendar + recent timeline of journal entries and workouts.
// Mirrors the look of the user's own Journal screen but without create/delete.

import { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import NeuCard from "../NeuCard";
import JournalCalendar from "../JournalCalendar";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { fmtDuration } from "../../utils/dates";
import type { CompletedWorkout, SavedProgram } from "../../constants/programs";
import type { JournalEntry } from "../../constants/journal";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBR    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_FULL    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w ago`;
  return formatEntryDate(iso);
}

function formatWorkoutDate(completedIso: string, durationSeconds: number): string {
  const d = new Date(completedIso);
  const dateStr = `${DAY_FULL[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
  return durationSeconds > 0 ? `${dateStr}  ·  ${fmtDuration(durationSeconds)}` : dateStr;
}

interface ClientJournalViewProps {
  entries: JournalEntry[];
  workoutHistory: CompletedWorkout[];
  programs: SavedProgram[];
  /** Bottom padding override. */
  bottomPadding?: number;
}

export default function ClientJournalView({ entries, workoutHistory, programs, bottomPadding }: ClientJournalViewProps) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const activeProgram = useMemo(() => programs.find(p => p.status === "active") ?? null, [programs]);

  const workoutDates = useMemo(
    () => Array.from(new Set(workoutHistory.map(w => w.date))).sort(),
    [workoutHistory],
  );

  const timeline = useMemo(() => {
    type JItem = { kind: "journal"; data: JournalEntry; ts: number };
    type WItem = { kind: "workout"; data: CompletedWorkout; ts: number };
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const items: (JItem | WItem)[] = [
      ...entries.map(e => ({ kind: "journal" as const, data: e, ts: new Date(e.createdAt).getTime() })).filter(i => i.ts >= cutoff),
      ...workoutHistory.map(w => ({ kind: "workout" as const, data: w, ts: new Date(w.completedAt).getTime() })).filter(i => i.ts >= cutoff),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [entries, workoutHistory]);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding ?? insets.bottom + 40 }]}
    >
      <JournalCalendar
        isDark={isDark}
        workoutDates={workoutDates}
        workoutHistory={workoutHistory}
        activeProgram={activeProgram}
        onDayPress={() => { /* read-only for PT view */ }}
      />

      {timeline.length > 0 && (
        <Text style={[styles.sectionHeading, { color: t.tp }]}>Recent Activity</Text>
      )}

      {timeline.length === 0 && (
        <NeuCard dark={isDark} style={styles.emptyCard}>
          <View style={styles.emptyInner}>
            <Ionicons name="book-outline" size={28} color={ACCT} />
            <Text style={[styles.emptyTitle, { color: t.tp }]}>No recent activity</Text>
            <Text style={[styles.emptyBody, { color: t.ts }]}>Client journal entries and completed workouts will appear here.</Text>
          </View>
        </NeuCard>
      )}

      {timeline.map(item => {
        if (item.kind === "workout") {
          const w = item.data;
          return (
            <NeuCard key={w.id} dark={isDark} style={styles.card}>
              <View style={styles.inner}>
                <View style={styles.topRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.workoutName, { color: t.tp }]}>{w.workoutName}</Text>
                    <Text style={[styles.workoutDate, { color: t.ts }]}>{formatWorkoutDate(w.completedAt, w.durationSeconds)}</Text>
                  </View>
                  <View style={[styles.tag, { backgroundColor: isDark ? `${ACCT}22` : `${ACCT}18` }]}>
                    <Text style={[styles.tagText, { color: ACCT }]}>Workout</Text>
                  </View>
                </View>
                <View style={[styles.metricsRow, { borderTopColor: t.div }]}>
                  <Text style={[styles.metric, { color: t.ts }]}>
                    {w.exercises.length} exercise{w.exercises.length === 1 ? "" : "s"}
                  </Text>
                  <Text style={[styles.metricDot, { color: t.div }]}>·</Text>
                  <Text style={[styles.metric, { color: t.ts }]}>
                    {w.exercises.reduce((sum, ex) => sum + ex.sets.filter(s => s.done).length, 0)} sets
                  </Text>
                </View>
              </View>
            </NeuCard>
          );
        }
        const entry = item.data;
        return (
          <NeuCard key={entry.id} dark={isDark} style={styles.card}>
            <View style={styles.inner}>
              <View style={styles.topRow}>
                <Text style={[styles.entryTitle, { color: t.tp }]} numberOfLines={1}>{entry.title}</Text>
                <View style={[styles.tag, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }]}>
                  <Text style={[styles.tagText, { color: t.ts }]}>Journal</Text>
                </View>
              </View>
              {entry.body.length > 0 && (
                <Text style={[styles.entryBody, { color: t.ts }]} numberOfLines={4}>{entry.body}</Text>
              )}
              <View style={[styles.metricsRow, { borderTopColor: t.div }]}>
                <Ionicons name="time-outline" size={12} color={t.ts} />
                <Text style={[styles.metric, { color: t.ts }]}>{formatTimeAgo(entry.createdAt)}</Text>
                <Text style={[styles.metricDot, { color: t.div }]}>·</Text>
                <Text style={[styles.metric, { color: t.ts }]}>{formatEntryDate(entry.createdAt)}</Text>
              </View>
            </View>
          </NeuCard>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:         { paddingHorizontal: 20, paddingTop: 34 },
  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18, marginTop: 24, marginBottom: 12 },
  emptyCard:      { borderRadius: 20, marginTop: 12 },
  emptyInner:     { padding: 28, alignItems: "center", gap: 10 },
  emptyTitle:     { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  emptyBody:      { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
  card:           { borderRadius: 20, marginBottom: 12 },
  inner:          { padding: 18, gap: 8 },
  topRow:         { flexDirection: "row", alignItems: "center", gap: 8 },
  workoutName:    { fontFamily: FontFamily.bold, fontSize: 16 },
  workoutDate:    { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  entryTitle:     { fontFamily: FontFamily.semibold, fontSize: 16, flex: 1 },
  entryBody:      { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20 },
  tag:            { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  tagText:        { fontFamily: FontFamily.bold, fontSize: 11, letterSpacing: 0.4 },
  metricsRow:     { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 10, borderTopWidth: 1 },
  metric:         { fontFamily: FontFamily.regular, fontSize: 12 },
  metricDot:      { fontFamily: FontFamily.regular, fontSize: 12 },
});
