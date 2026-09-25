// The program page the Journal opens (and All Programs): the program's
// progress at the top, then one card per week, Monday to Sunday, newest first,
// numbered from the week the program started in.
//
// A week's card says what each of its days was (a dot per day: trained,
// missed, another workout instead, still to come), how much of its plan got
// done (the ring), and what it added up to; then its sessions as rows, each
// with its numbers and anything it earned.
//
// One card per week, sessions as rows inside it: the weeks used to be headings
// on the page with a card per session, a chip row and a card per achievement,
// and with nothing drawing a line round a week it was hard to see where one
// ended and the next began.
//
// Everything is read off utils/programHistory.ts, which scripts/
// verify-program-history.ts pins. A session's "3rd" and "Instead of Push" come
// from the Journal's own maths (useJournalWorkoutInfo), so the two pages can't
// tell one session's story differently.

import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "../components/NeuCard";
import FadeScreen from "../components/FadeScreen";
import AuroraBackdrop from "../components/AuroraBackdrop";
import DumbbellIcon from "../components/DumbbellIcon";
import { useJournalWorkoutInfo, type JournalWorkoutInfo } from "../components/journal/JournalWorkoutCard";
import {
  ACCT,
  ACCT_DEEP,
  APP_DARK,
  APP_LIGHT,
  AURORA,
  FontFamily,
  GOLD,
  GOLD_DARK,
  PAUSED_ORANGE,
  REPLACED_ORANGE,
} from "../constants/theme";
import { PILL_RADIUS } from "../constants/buttons";
import { TROPHY_ICON } from "../constants/icons";
import type { Achievement } from "../constants/achievements";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  getCurrentWeek,
  programFinishDate,
  type CompletedWorkout,
  type SavedProgram,
} from "../constants/programs";
import { fmtDuration, fromYMD, MONTH_NAMES, parseStoredDate } from "../utils/dates";
import { getJSON } from "../utils/storage";
import { toDisplayWeight } from "../utils/units";
import { getEffectiveToday } from "../utils/workout";
import { ordinal } from "../utils/workoutSummary";
import {
  buildProgramHistory,
  sessionStats,
  type ProgramHistory,
  type ProgramWeek,
  type WeekDay,
} from "../utils/programHistory";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";

const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "14 Sep", with the year only when it isn't this one. */
function shortDate(d: Date): string {
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}${year}`;
}

/** "12.4k" / "850": kilos or pounds, whichever the user reads in. */
function formatVolume(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toString();
}

/** "6:02 – 7:10pm · 1h 8m", or just the finish time when there's no duration. */
function timeLine(w: CompletedWorkout): string {
  const end = new Date(w.completedAt);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (!(w.durationSeconds > 0)) return fmt(end);
  const start = new Date(end.getTime() - w.durationSeconds * 1000);
  return `${fmt(start)} – ${fmt(end)}  ·  ${fmtDuration(w.durationSeconds)}`;
}

// ─── The program at a glance ─────────────────────────────────────────────────

/**
 * Home's active-program card, for any program: its status, the week bar, where
 * it ends, and what it has added up to so far.
 */
function OverviewCard({ program, totals, isDark, isKg }: {
  program: SavedProgram;
  totals: ProgramHistory["totals"];
  isDark: boolean;
  isKg: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  // A held program keeps status "active", so the bar keys off pausedAt or it
  // stays green and reads as running (Home's rule).
  const held = program.status === "active" && !!program.pausedAt;
  const accent = held ? PAUSED_ORANGE : ACCT;
  // Accent green washes out as small text on the light card; the chip takes
  // the deeper green there (see theme.ts).
  const ink = isDark ? accent : held ? PAUSED_ORANGE : ACCT_DEEP;
  const week = getCurrentWeek(program);

  const label = held ? "PROGRAM PAUSED"
    : program.status === "active" ? "ACTIVE PROGRAM"
    : program.status === "completed" ? "COMPLETED"
    : program.status === "paused" ? "INACTIVE"
    : "NOT STARTED";
  const labelColor = held ? PAUSED_ORANGE : program.status === "completed" ? ink : t.tp;

  // Where the timeline ends, or where it stopped.
  const chip = (() => {
    if (held) {
      const since = fromYMD(program.pausedAt!);
      return since ? { icon: "pause" as const, text: `On hold since ${shortDate(since)}` } : null;
    }
    if (program.status === "completed") {
      const done = parseStoredDate(program.completedDate);
      return done ? { icon: "checkmark-circle" as const, text: `Completed ${shortDate(done)}` } : null;
    }
    if (program.status === "active") {
      const finish = programFinishDate(program);
      return finish ? { icon: "flag" as const, text: `Finishes ${shortDate(finish)}` } : null;
    }
    return null;
  })();
  const started = parseStoredDate(program.startDate);

  const stats = [
    { value: String(totals.sessions), label: totals.sessions === 1 ? "session" : "sessions" },
    { value: formatVolume(toDisplayWeight(totals.volumeKg, isKg)), label: isKg ? "kg lifted" : "lbs lifted" },
  ];

  return (
    <NeuCard dark={isDark} radius={20} style={styles.overviewCard}>
      <View style={styles.overviewInner}>
        <View style={styles.overviewHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionLabel, { color: labelColor }]}>{label}</Text>
            {started && (
              <Text style={[styles.overviewStarted, { color: t.ts }]}>Started {shortDate(started)}</Text>
            )}
          </View>
          <Text style={[styles.overviewWeek, { color: t.ts }]}>Week {week} of {program.totalWeeks}</Text>
        </View>

        <View style={styles.progressRow}>
          {Array.from({ length: program.totalWeeks }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                { backgroundColor: i < week ? accent : t.div },
                i < week && { shadowColor: accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 },
              ]}
            />
          ))}
        </View>

        {/* At the END of the bar, as the finish line it is (Home's chip). */}
        {chip && (
          <View style={[styles.finishChip, { backgroundColor: `${accent}26` }]}>
            <Ionicons name={chip.icon} size={11} color={ink} />
            <Text style={[styles.finishChipText, { color: ink }]}>{chip.text}</Text>
          </View>
        )}

        <View style={[styles.statGrid, { borderTopColor: t.div }]}>
          {stats.map((s, i) => (
            <View key={s.label} style={styles.statGridCell}>
              {i > 0 && <View style={[styles.statGridDivider, { backgroundColor: t.div }]} />}
              <View style={styles.statGridItem}>
                <Text style={[styles.statGridValue, { color: t.tp }]}>{s.value}</Text>
                <Text style={[styles.statGridLabel, { color: t.ts }]} numberOfLines={1}>{s.label}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </NeuCard>
  );
}

// ─── A week ──────────────────────────────────────────────────────────────────

const RING = 46;
const RING_STROKE = 4;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

/** How much of the week's plan got done, as a ring with "3/4" in it. A week
 *  that did it all glows. */
function WeekRing({ week, isDark }: { week: ProgramWeek; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const pct = week.planned > 0 ? Math.min(1, week.done / week.planned) : 0;
  const complete = week.planned > 0 && week.done >= week.planned;
  return (
    <View style={[styles.ring, complete && styles.ringGlow]}>
      <Svg width={RING} height={RING} style={styles.ringSvg}>
        <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={t.ts} strokeWidth={RING_STROKE} fill="none" opacity={0.18} />
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
      <Text style={[styles.ringText, { color: t.tp }]}>
        {week.planned > 0 ? `${week.done}/${week.planned}` : "–"}
      </Text>
    </View>
  );
}

/** One dot per day of the week, under its weekday letter. */
function DayStrip({ days, todayYMD, isDark }: { days: WeekDay[]; todayYMD: string; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.strip}>
      {days.map(d => {
        const date = fromYMD(d.ymd);
        const isToday = d.ymd === todayYMD;
        return (
          <View key={d.ymd} style={styles.stripDay}>
            <Text style={[styles.stripLetter, { color: isToday ? (isDark ? ACCT : ACCT_DEEP) : t.ts }]}>
              {date ? WEEKDAY_LETTER[date.getDay()] : ""}
            </Text>
            <DayDot state={d.state} isDark={isDark} />
          </View>
        );
      })}
    </View>
  );
}

/** A day's dot. Rest is a solid grey circle, a day that's meant to be empty;
 *  missed is the small faded dot, a day that came to nothing (Home's calendar
 *  uses the same pairing). Outside the program there's no dot at all, so the
 *  days before a mid-week start can't be mistaken for missed ones. */
function DayDot({ state, isDark }: { state: WeekDay["state"]; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  switch (state) {
    case "trained":
      return <View style={[styles.dot, styles.dotGlow, { backgroundColor: ACCT, shadowColor: ACCT }]} />;
    case "missed":
      return <View style={styles.dot}><View style={[styles.smallDot, { backgroundColor: t.div }]} /></View>;
    case "replaced":
      return <View style={[styles.dot, { backgroundColor: REPLACED_ORANGE }]} />;
    case "today":
      return <View style={[styles.dot, styles.dotRing, { borderColor: ACCT, borderWidth: 2 }]} />;
    case "upcoming":
      return <View style={[styles.dot, styles.dotRing, { borderColor: t.ts }]} />;
    case "held":
      return <View style={[styles.dot, styles.dotRing, { borderColor: PAUSED_ORANGE }]} />;
    case "rest":
      return <View style={[styles.dot, { backgroundColor: t.ts }]} />;
    case "off":
      return <View style={styles.dot} />;
  }
}

/** What the dots mean, once, above the weeks. "Other" rather than "Other
 *  Workout" so all five fit on one line on the smallest iPhones. */
function DotLegend({ isDark }: { isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const items: { state: WeekDay["state"]; label: string }[] = [
    { state: "trained", label: "Trained" },
    { state: "rest", label: "Rest" },
    { state: "replaced", label: "Other" },
    { state: "upcoming", label: "Planned" },
    { state: "missed", label: "Missed" },
  ];
  return (
    <View style={styles.legend}>
      {items.map(i => (
        <View key={i.state} style={styles.legendItem}>
          <DayDot state={i.state} isDark={isDark} />
          <Text style={[styles.legendText, { color: t.ts }]}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── A session ───────────────────────────────────────────────────────────────

/** One session, as a row in its week's card. Tapping opens the workout. */
function SessionRow({ workout, info, earned, isDark, isKg, onPress }: {
  workout: CompletedWorkout;
  info: JournalWorkoutInfo;
  /** What this session earned (its PRs, a workout milestone). */
  earned: Achievement[];
  isDark: boolean;
  isKg: boolean;
  onPress: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const ink = isDark ? ACCT : ACCT_DEEP;
  // The PR gold, lighter on dark (as the star and Home's PR badge use it).
  const gold = isDark ? GOLD_DARK : GOLD;
  const date = fromYMD(workout.date);
  const stats = sessionStats(workout);
  const sessionNum = info.program?.sessionNum;
  const prs = earned.flatMap(a => (a.category === "pr" ? a.prs : []));
  const milestone = earned.find(a => a.category === "workouts");

  const statsLine = [
    `${stats.exercises} ${stats.exercises === 1 ? "exercise" : "exercises"}`,
    `${stats.sets} ${stats.sets === 1 ? "set" : "sets"}`,
    `${formatVolume(toDisplayWeight(stats.volumeKg, isKg))} ${isKg ? "kg" : "lbs"}`,
  ].join("  ·  ");

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={`Open ${workout.workoutName}${date ? `, ${WEEKDAY_SHORT[date.getDay()]} ${shortDate(date)}` : ""}`}
      style={[styles.sessionRow, { borderTopColor: t.div }]}
    >
      {/* The day it was done, as a calendar tile: says "when" before anything
          is read. */}
      <View style={[styles.dateTile, { backgroundColor: `${ACCT}1f` }]}>
        <Text style={[styles.dateTileDay, { color: ink }]}>{date ? WEEKDAY_SHORT[date.getDay()].toUpperCase() : ""}</Text>
        <Text style={[styles.dateTileNum, { color: t.tp }]}>{date ? date.getDate() : ""}</Text>
      </View>

      <View style={styles.sessionBody}>
        <View style={styles.sessionNameRow}>
          <Text style={[styles.sessionName, { color: t.tp }]} numberOfLines={1}>{workout.workoutName}</Text>
          {sessionNum ? (
            <View style={[styles.sessionTag, { backgroundColor: `${ACCT}1f` }]}>
              <Text style={[styles.sessionTagText, { color: ink }]}>{ordinal(sessionNum)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.sessionMeta, { color: t.ts }]} numberOfLines={1}>{timeLine(workout)}</Text>
        <Text style={[styles.sessionMeta, { color: t.ts }]} numberOfLines={1}>{statsLine}</Text>
        {/* In the orange of the dot it explains, as on the Journal. */}
        {info.insteadOf ? (
          <Text style={[styles.insteadOf, { color: REPLACED_ORANGE }]} numberOfLines={1}>
            Instead of {info.insteadOf}
          </Text>
        ) : null}
        {/* PRs in a gold pill, so a record stands out from the grey lines
            above it at a glance. Just the count: which lifts, and by how
            much, is the first thing the workout's own screen shows. */}
        {prs.length > 0 && (
          <View style={[styles.prPill, { backgroundColor: `${gold}2e`, borderColor: `${gold}8c` }]}>
            <Image source={TROPHY_ICON} style={styles.earnedIcon} contentFit="contain" />
            <Text style={[styles.earnedText, { color: t.tp }]} numberOfLines={1}>
              {`${prs.length} New ${prs.length === 1 ? "PR" : "PRs"}`}
            </Text>
          </View>
        )}
        {milestone && milestone.category === "workouts" && (
          <View style={styles.earnedRow}>
            <DumbbellIcon size={14} color={ink} />
            <Text style={[styles.earnedText, { color: t.tp }]} numberOfLines={1}>
              {`${ordinal(milestone.count)} workout logged`}
            </Text>
          </View>
        )}
      </View>

      <Ionicons name="chevron-forward" size={16} color={t.ts} />
    </TouchableOpacity>
  );
}

/** A week, as one card: its header and days, then a row per session. */
function WeekCard({ week, program, todayYMD, isDark, isKg, infoOf, onOpenWorkout }: {
  week: ProgramWeek;
  program: SavedProgram;
  todayYMD: string;
  isDark: boolean;
  isKg: boolean;
  infoOf: (w: CompletedWorkout) => JournalWorkoutInfo;
  onOpenWorkout: (id: string) => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const earnedById = new Map<string, Achievement[]>();
  for (const a of week.achievements) {
    if (!("workoutId" in a)) continue;
    earnedById.set(a.workoutId, [...(earnedById.get(a.workoutId) ?? []), a]);
  }
  const finished = week.achievements.some(a => a.category === "program");

  // "3 of 4 sessions · 18.4k kg · 3h 12m": the week in one line.
  const summary = [
    week.planned > 0
      ? `${week.done} of ${week.planned} ${week.planned === 1 ? "session" : "sessions"}`
      : "Nothing planned",
    ...(week.sessions.length > 0
      ? [`${formatVolume(toDisplayWeight(week.volumeKg, isKg))} ${isKg ? "kg" : "lbs"}`]
      : []),
    ...(week.durationSeconds > 0 ? [fmtDuration(week.durationSeconds)] : []),
  ].join("  ·  ");

  return (
    <NeuCard dark={isDark} radius={20} style={styles.weekCard}>
      <View style={styles.weekInner}>
        <View style={styles.weekHeader}>
          <WeekRing week={week} isDark={isDark} />
          <View style={{ flex: 1 }}>
            <View style={styles.weekTitleRow}>
              <Text style={[styles.weekTitle, { color: t.tp }]} numberOfLines={1}>Week {week.number}</Text>
              {week.isCurrent && (
                <View style={[styles.thisWeekPill, { backgroundColor: ACCT }]}>
                  <Text style={styles.thisWeekText}>This week</Text>
                </View>
              )}
            </View>
            <Text style={[styles.weekSub, { color: t.ts }]} numberOfLines={1}>{summary}</Text>
          </View>
        </View>

        <DayStrip days={week.days} todayYMD={todayYMD} isDark={isDark} />
      </View>

      {week.sessions.length === 0 ? (
        <View style={[styles.emptyRow, { borderTopColor: t.div }]}>
          <Text style={[styles.emptyRowText, { color: t.ts }]}>
            {week.isCurrent ? "Nothing logged yet this week" : "No workouts logged this week"}
          </Text>
        </View>
      ) : (
        // First to last, top to bottom, in the order of the day dots above.
        week.sessions.map(s => (
          <SessionRow
            key={s.id}
            workout={s}
            info={infoOf(s)}
            earned={earnedById.get(s.id) ?? []}
            isDark={isDark}
            isKg={isKg}
            onPress={() => onOpenWorkout(s.id)}
          />
        ))
      )}

      {finished && (
        <View style={[styles.finishedRow, { borderTopColor: t.div }]}>
          <Ionicons name="ribbon" size={16} color={AURORA.aqua} />
          <Text style={[styles.finishedText, { color: t.tp }]} numberOfLines={1}>Finished {program.name}</Text>
        </View>
      )}
    </NeuCard>
  );
}

// ─── The page ────────────────────────────────────────────────────────────────

export default function ProgramHistoryDetailScreen() {
  const router = useRouter();
  const { programId } = useLocalSearchParams<{ programId: string }>();
  const { isDark } = useTheme();
  const { isKg } = useUnit();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [history, setHistory] = useState<CompletedWorkout[]>([]);
  // "Program not found" only once we've looked; it used to flash on arrival.
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void Promise.all([
        getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
        getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
      ]).then(([progs, hist]) => {
        if (!live) return;
        setPrograms(Array.isArray(progs) ? progs : []);
        setHistory(Array.isArray(hist) ? hist : []);
        setLoaded(true);
      });
      return () => { live = false; };
    }, []),
  );

  const program = useMemo(() => programs.find(p => p.id === programId) ?? null, [programs, programId]);
  const activeProgram = useMemo(() => programs.find(p => p.status === "active") ?? null, [programs]);
  // The day Home and the Journal are on (before 3am, still yesterday while
  // yesterday's workout is unfinished).
  const todayYMD = useMemo(() => getEffectiveToday(activeProgram, history), [activeProgram, history]);
  const model = useMemo(
    () => (program ? buildProgramHistory(program, history, todayYMD) : null),
    [program, history, todayYMD],
  );
  const infoOf = useJournalWorkoutInfo(history, programs);

  const openWorkout = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/workout-detail", params: { id } });
  }, [router]);

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Blush glow — carries the Journal flow's tint into this history screen */}
      <AuroraBackdrop dark={isDark} tint="blush" />
      {/* Top gradient blur */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      {/* Back button */}
      <BackButton />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + BACK_TOP, paddingBottom: insets.bottom + 40 }]}
      >
        {/* Page header */}
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>
            {program?.name.toUpperCase() ?? ""}
          </Text>
          <View style={{ width: 66 }} />
        </View>

        {program && model && (
          <OverviewCard program={program} totals={model.totals} isDark={isDark} isKg={isKg} />
        )}

        {loaded && !program && (
          <NeuCard dark={isDark} radius={24} style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>Program not found</Text>
            </View>
          </NeuCard>
        )}

        {program && model && model.weeks.length === 0 && (
          <NeuCard dark={isDark} radius={20} style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                {program.status === "created" ? "This program hasn't started yet." : "Nothing logged on this program yet."}
              </Text>
            </View>
          </NeuCard>
        )}

        {model && model.weeks.length > 0 && <DotLegend isDark={isDark} />}

        {program && model?.weeks.map(w => (
          <WeekCard
            key={w.startYMD}
            week={w}
            program={program}
            todayYMD={todayYMD}
            isDark={isDark}
            isKg={isKg}
            infoOf={infoOf}
            onOpenWorkout={openWorkout}
          />
        ))}
      </ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll: { paddingHorizontal: 20 },

  header: { flexDirection: "row", alignItems: "center", height: BACK_SIZE, marginBottom: 24 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textAlign: "center", flex: 1 },

  // The program at a glance — Home's program card, plus totals.
  overviewCard: { marginBottom: 18 },
  overviewInner: { padding: 20, gap: 14 },
  overviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase" },
  overviewStarted: { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 5 },
  overviewWeek: { fontFamily: FontFamily.regular, fontSize: 14 },
  progressRow: { flexDirection: "row", gap: 5 },
  progressSegment: { flex: 1, height: 6, borderRadius: 3 },
  finishChip: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: PILL_RADIUS, marginTop: -2 },
  finishChipText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  statGrid: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
  statGridCell: { flex: 1, flexDirection: "row", alignItems: "center" },
  statGridDivider: { width: 1, height: 28 },
  statGridItem: { flex: 1, alignItems: "center", gap: 2 },
  statGridValue: { fontFamily: FontFamily.bold, fontSize: 19 },
  statGridLabel: { fontFamily: FontFamily.regular, fontSize: 11 },

  legend: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", columnGap: 14, rowGap: 6, marginBottom: 18 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontFamily: FontFamily.regular, fontSize: 11 },

  emptyCard: { marginBottom: 20 },
  emptyInner: { padding: 28, alignItems: "center" },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center" },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center" },

  // A week: one card, with a clear gap before the next.
  weekCard: { marginBottom: 22 },
  weekInner: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14 },
  weekHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  ring: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
  ringGlow: { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 6 },
  // Starts the arc at 12 o'clock.
  ringSvg: { position: "absolute", transform: [{ rotate: "-90deg" }] },
  ringText: { fontFamily: FontFamily.bold, fontSize: 12 },
  weekTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  weekTitle: { fontFamily: FontFamily.bold, fontSize: 16, flexShrink: 1 },
  thisWeekPill: { borderRadius: PILL_RADIUS, paddingHorizontal: 9, paddingVertical: 3, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.45, shadowRadius: 6 },
  thisWeekText: { fontFamily: FontFamily.bold, fontSize: 11, color: "#fff", letterSpacing: 0.3 },
  weekSub: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 3 },

  strip: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6, marginTop: 14 },
  stripDay: { alignItems: "center", gap: 6, minWidth: 22 },
  stripLetter: { fontFamily: FontFamily.semibold, fontSize: 11 },
  dot: { width: 12, height: 12, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  dotGlow: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 },
  dotRing: { borderWidth: 1.5, backgroundColor: "transparent" },
  smallDot: { width: 5, height: 5, borderRadius: 2.5 },

  // A session, as a row under a hairline.
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  dateTile: { width: 42, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dateTileDay: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.8 },
  dateTileNum: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: -1 },
  sessionBody: { flex: 1, gap: 2 },
  sessionNameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sessionName: { fontFamily: FontFamily.bold, fontSize: 15, flexShrink: 1 },
  sessionTag: { borderRadius: PILL_RADIUS, paddingHorizontal: 7, paddingVertical: 2 },
  sessionTagText: { fontFamily: FontFamily.bold, fontSize: 10 },
  sessionMeta: { fontFamily: FontFamily.regular, fontSize: 12 },
  insteadOf: { fontFamily: FontFamily.semibold, fontSize: 12 },
  earnedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  // Hugs its text (alignSelf) rather than spanning the row, so it reads as a
  // badge on the session, not a bar across it.
  prPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", maxWidth: "100%", marginTop: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: PILL_RADIUS, borderWidth: 1 },
  earnedIcon: { width: 14, height: 14 },
  earnedText: { fontFamily: FontFamily.semibold, fontSize: 12, flexShrink: 1 },

  emptyRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14, alignItems: "center" },
  emptyRowText: { fontFamily: FontFamily.regular, fontSize: 13 },

  finishedRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  finishedText: { fontFamily: FontFamily.semibold, fontSize: 13, flexShrink: 1 },
});
