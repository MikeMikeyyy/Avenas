// Read-only journal view used by the PT to see a client's journal:
// monthly activity calendar + recent timeline of journal entries and workouts.
// Mirrors the look of the user's own Journal screen but without create/delete.
// A workout opens the same way it does there, from its card or its day on the
// calendar; a day with no workout does nothing, since logging one belongs to
// the client. Recent Activity opens with the client's achievement cards, as
// Home's does for the client (utils/clientAchievements.ts), and each workout is
// the client's own journal card (components/journal/JournalWorkoutCard.tsx).

import { useCallback, useMemo, useState, type ReactElement } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, type RefreshControlProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import NeuCard from "../NeuCard";
import JournalCalendar from "../JournalCalendar";
import AchievementCard from "../AchievementCard";
import JournalWorkoutCard, { useJournalWorkoutInfo } from "./JournalWorkoutCard";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import type { CompletedWorkout, SavedProgram } from "../../constants/programs";
import type { JournalEntry } from "../../constants/journal";
import type { Achievement } from "../../constants/achievements";
import { buildJournalFeed } from "../../utils/journalFeed";
import { deriveClientAchievements } from "../../utils/clientAchievements";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBR    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/** An entry's body is cut here until it's tapped open. */
const BODY_LINES = 4;

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

/**
 * One journal entry. The body is cut at BODY_LINES and opens in full on a tap,
 * because a trainer had no other way to read the rest of a long one.
 *
 * Whether anything IS cut is measured on an invisible, unclamped copy of the
 * text: a clamped Text doesn't report the lines it hides on every platform.
 * The card is always a (sometimes disabled) touchable, so learning that it's
 * cut never changes the shape of the tree under it.
 */
function EntryCard({ entry, isDark }: { entry: JournalEntry; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(o => !o);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={toggle}
      disabled={!clipped}
      accessibilityRole={clipped ? "button" : undefined}
      accessibilityState={clipped ? { expanded: open } : undefined}
    >
      <NeuCard dark={isDark} style={styles.card}>
        <View style={styles.inner}>
          <View style={styles.topRow}>
            <Text style={[styles.entryTitle, { color: t.tp }]} numberOfLines={1}>{entry.title}</Text>
            <View style={[styles.tag, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }]}>
              <Text style={[styles.tagText, { color: t.ts }]}>Journal</Text>
            </View>
          </View>
          {entry.body.length > 0 && (
            <View>
              <Text style={[styles.entryBody, { color: t.ts }]} numberOfLines={open ? undefined : BODY_LINES}>{entry.body}</Text>
              <View pointerEvents="none" style={styles.measure}>
                <Text
                  style={styles.entryBody}
                  onTextLayout={e => setClipped(e.nativeEvent.lines.length > BODY_LINES)}
                >
                  {entry.body}
                </Text>
              </View>
              {clipped && (
                <Text style={[styles.more, { color: ACCT }]}>{open ? "Show less" : "Show more"}</Text>
              )}
            </View>
          )}
          <View style={[styles.metricsRow, { borderTopColor: t.div }]}>
            <Ionicons name="time-outline" size={12} color={t.ts} />
            <Text style={[styles.metric, { color: t.ts }]}>{formatTimeAgo(entry.createdAt)}</Text>
            <Text style={[styles.metricDot, { color: t.div }]}>·</Text>
            <Text style={[styles.metric, { color: t.ts }]}>{formatEntryDate(entry.createdAt)}</Text>
          </View>
        </View>
      </NeuCard>
    </TouchableOpacity>
  );
}

interface ClientJournalViewProps {
  entries: JournalEntry[];
  workoutHistory: CompletedWorkout[];
  programs: SavedProgram[];
  /** Bottom padding override. */
  bottomPadding?: number;
  /** Open one of the client's workouts in full. */
  onOpenWorkout: (workoutId: string) => void;
  /** Show the client's programs (where a finished-program card leads). */
  onOpenPrograms: () => void;
  /** Pull to refresh, owned by the page. */
  refreshControl?: ReactElement<RefreshControlProps>;
}

export default function ClientJournalView({
  entries, workoutHistory, programs, bottomPadding, onOpenWorkout, onOpenPrograms, refreshControl,
}: ClientJournalViewProps) {
  const { isDark } = useTheme();
  const { isKg } = useUnit();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const activeProgram = useMemo(() => programs.find(p => p.status === "active") ?? null, [programs]);

  const workoutDates = useMemo(
    () => Array.from(new Set(workoutHistory.map(w => w.date))).sort(),
    [workoutHistory],
  );

  // Same merge as the user's own journal (utils/journalFeed.ts), over a longer
  // window: a trainer opening a client is catching up on a month, not reviewing
  // the fortnight they've just lived through.
  const timeline = useMemo(
    () => buildJournalFeed({ entries, workouts: workoutHistory, windowDays: 30 }),
    [entries, workoutHistory],
  );

  // Program, session number and track under each workout, worked out from the
  // client's history exactly as their own journal does it.
  const workoutInfoOf = useJournalWorkoutInfo(workoutHistory, programs);

  // The calendar hands over that day's latest workout, as it does on the
  // client's own journal.
  const onDayPress = useCallback((_date: string, workoutId?: string) => {
    if (!workoutId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenWorkout(workoutId);
  }, [onOpenWorkout]);

  // The cards the client has on Home this week, rebuilt from what's here. No
  // streak card: the streak never leaves the client's phone.
  const achievements = useMemo(
    () => deriveClientAchievements(workoutHistory, programs, new Date()),
    [workoutHistory, programs],
  );

  // Each card opens where it happened, like Home's: the workout, or for a
  // finished program the client's programs.
  const onAchievementPress = useCallback((a: Achievement) => {
    if (a.category === "pr" || a.category === "workouts") onOpenWorkout(a.workoutId);
    else if (a.category === "program") onOpenPrograms();
  }, [onOpenWorkout, onOpenPrograms]);

  const hasActivity = timeline.length > 0 || achievements.length > 0;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding ?? insets.bottom + 40 }]}
      refreshControl={refreshControl}
    >
      <JournalCalendar
        isDark={isDark}
        workoutDates={workoutDates}
        workoutHistory={workoutHistory}
        activeProgram={activeProgram}
        onDayPress={onDayPress}
      />

      {hasActivity && (
        <Text style={[styles.sectionHeading, { color: t.tp }]}>Recent Activity</Text>
      )}

      {achievements.length > 0 && (
        <View style={styles.achievementList}>
          {achievements.map(a => (
            <AchievementCard
              key={a.id}
              achievement={a}
              isDark={isDark}
              isKg={isKg}
              onOpenWorkout={() => onAchievementPress(a)}
            />
          ))}
        </View>
      )}

      {!hasActivity && (
        <NeuCard dark={isDark} style={styles.emptyCard}>
          <View style={styles.emptyInner}>
            <Ionicons name="book-outline" size={28} color={ACCT} />
            <Text style={[styles.emptyTitle, { color: t.tp }]}>No recent activity</Text>
            <Text style={[styles.emptyBody, { color: t.ts }]}>Client journal entries and completed workouts will appear here.</Text>
          </View>
        </NeuCard>
      )}

      {timeline.map(item => item.kind === "workout" ? (
        <JournalWorkoutCard
          key={item.data.id}
          workout={item.data}
          info={workoutInfoOf(item.data)}
          isDark={isDark}
          onPress={() => onOpenWorkout(item.data.id)}
        />
      ) : (
        <EntryCard key={item.data.id} entry={item.data} isDark={isDark} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:         { paddingHorizontal: 20, paddingTop: 34 },
  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18, marginTop: 24, marginBottom: 12 },
  // Home's spacing between the achievement cards and the first workout card.
  achievementList:{ marginBottom: 4 },
  emptyCard:      { borderRadius: 20, marginTop: 12 },
  emptyInner:     { padding: 28, alignItems: "center", gap: 10 },
  emptyTitle:     { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  emptyBody:      { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
  card:           { borderRadius: 20, marginBottom: 12 },
  inner:          { padding: 18, gap: 8 },
  topRow:         { flexDirection: "row", alignItems: "center", gap: 8 },
  entryTitle:     { fontFamily: FontFamily.semibold, fontSize: 16, flex: 1 },
  entryBody:      { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20 },
  // The unclamped copy the cut is measured on: same width, never seen.
  measure:        { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  more:           { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 6 },
  tag:            { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  tagText:        { fontFamily: FontFamily.bold, fontSize: 11, letterSpacing: 0.4 },
  metricsRow:     { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 10, borderTopWidth: 1 },
  metric:         { fontFamily: FontFamily.regular, fontSize: 12 },
  metricDot:      { fontFamily: FontFamily.regular, fontSize: 12 },
});
