import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedRef,
  withTiming,
  measure,
  runOnUI,
  runOnJS,
  Easing as ReEasing,
} from "react-native-reanimated";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import DumbbellIcon from "./DumbbellIcon";
import SheetPill from "./SheetPill";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import {
  collectLoggedExercisesForDay,
  groupDaysByProgram,
  sessionCountForDay,
  type ProgramDayGroup,
} from "../utils/progressStats";
import type { CompletedWorkout, ProgramDayRef, SavedProgram } from "../constants/programs";
import type { ExerciseSelection, LoggedExerciseRow } from "../constants/progress";

interface Props {
  /** Every non-Rest day of the in-scope program(s), as identified refs. Two
   *  days that share a name are two entries here, not one. */
  days: ProgramDayRef[];
  /** Workouts already filtered to the active scope. */
  workouts: CompletedWorkout[];
  /**
   * Currently selected (day, exercise) pair, or null. The day is part of the
   * identity: the same exercise under a different day row is a different
   * selection and does NOT highlight — including under a day that merely
   * shares the selected day's name.
   */
  selectedExercise: ExerciseSelection | null;
  onSelectExercise: (day: ProgramDayRef, name: string) => void;
  /** The open day row (ProgramDayRef.key), or null. Keyed by the ref, not the
   *  name, so two "Upper" rows expand independently. Held by the page, which
   *  remembers it between visits (utils/progressSession.ts). */
  expandedDay: string | null;
  onExpandedDayChange: (key: string | null) => void;
  /**
   * "All programs": one card per program, opened to show its days, instead of
   * every day of every program in one run. The programs give each card its
   * status. Off for a single program, whose days are listed directly.
   */
  groupByProgram: boolean;
  programs: SavedProgram[];
  /** The open program card (its id), or null. Remembered like `expandedDay`. */
  expandedProgram: string | null;
  onExpandedProgramChange: (programId: string | null) => void;
}

// Lowercase-trim match used across the codebase for exercise/day names.
const norm = (s: string) => s.trim().toLowerCase();

const sessionsText = (n: number) => (n === 0 ? "No sessions yet" : `${n} session${n === 1 ? "" : "s"}`);

const STATUS_LABEL: Record<SavedProgram["status"], string> = {
  active: "Active",
  created: "Not started",
  paused: "Paused",
  completed: "Completed",
};

/** Extra line under a day's name. Explains a day that has left the program, and
 *  otherwise disambiguates two days that read alike. Under a program card the
 *  program is already named, so only the day number is needed (and
 *  groupDaysByProgram only flags names repeated within that program). */
function dayQualifier(day: ProgramDayRef, underProgram: boolean): string | null {
  // Always shown for a historical day: it's the answer to "why are there two
  // Upper rows?", and it has to read even when the label happens to be unique.
  if (day.isHistorical) return underProgram ? "No longer in this program" : "No longer in your program";
  if (!day.duplicateLabel) return null;
  if (underProgram) return day.index < 0 ? "Extra" : `Day ${day.index + 1}`;
  if (day.index < 0) return `${day.programName} · extra`;
  return `${day.programName} · day ${day.index + 1}`;
}

// Accordion panel — animates height between 0 and the children's measured
// natural height. The content view is absolutely positioned, so it always lays
// out at its natural height even while the animated container clips it; its
// onLayout re-measures on EVERY content change, not just the first. That
// re-measure is load-bearing here: the Progress tab stays mounted for days
// while new workouts land, so a measure-once panel (the pattern programs.tsx
// uses for its static content) freezes at the row count it had on first render
// and clips newly logged exercises out of view.
//
// A panel that's ALREADY open when it mounts (the page coming back to a day it
// was left on) appears open: its first measurement is snapped to rather than
// animated, since nothing was tapped. Every later change animates.
function ExpandablePanel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  const height = useSharedValue(0);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const openedOnMount = useRef(expanded);

  useEffect(() => {
    if (openedOnMount.current && expanded) {
      // Wait for the content's height, then take it without animating.
      if (measuredHeight === 0) return;
      openedOnMount.current = false;
      height.value = measuredHeight;
      return;
    }
    openedOnMount.current = false;
    height.value = withTiming(expanded ? measuredHeight : 0, {
      duration: 280,
      easing: ReEasing.out(ReEasing.cubic),
    });
  }, [expanded, measuredHeight, height]);

  const style = useAnimatedStyle(() => ({ height: height.value, overflow: "hidden" as const }));

  return (
    <Reanimated.View style={style}>
      <View
        style={{ position: "absolute", left: 0, right: 0, top: 0 }}
        onLayout={e => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) setMeasuredHeight(prev => (prev === h ? prev : h));
        }}
      >
        {children}
      </View>
    </Reanimated.View>
  );
}

const RotatingChevron = ({ color, rotated }: { color: string; rotated: boolean }) => {
  const r = useSharedValue(rotated ? 1 : 0);
  useEffect(() => {
    r.value = withTiming(rotated ? 1 : 0, { duration: 180 });
  }, [rotated, r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 90}deg` }] }));
  return (
    <Reanimated.View style={style}>
      <Ionicons name="chevron-forward" size={16} color={color} />
    </Reanimated.View>
  );
};

const PROGRAM_PANEL_MS = 280;

// A program card's day list, under "All programs". Not ExpandablePanel,
// because this one holds panels of its own: a day opening inside it is a
// UI-thread height tween, which never re-fires an ancestor's onLayout, so a
// panel sized from its last measure would stay put and clip the day.
//
// So whenever it's open and still, it's a PLAIN auto-height view that reflows
// live as its days open and close. It takes an animated height only for its
// own tween and while closed, and that switch is made at the React level (the
// CollapsibleSection rule: on Fabric a Reanimated.View that has animated its
// height keeps that height even after the worklet stops returning one). Both
// ends of the tween are measured on the UI thread, which reads the list as
// drawn, open days included. The days stay mounted throughout, so closing
// slides them away rather than blanking them first.
function ProgramPanel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  const contentRef = useAnimatedRef<Reanimated.View>();
  const height = useSharedValue(0);
  // True while the panel is the plain auto-height view (open and still).
  const released = useSharedValue(expanded);
  const [constrained, setConstrained] = useState(!expanded);
  // A card that mounts open (the page coming back to it) just appears open.
  const prevExpanded = useRef(expanded);

  useLayoutEffect(() => {
    if (prevExpanded.current === expanded) return;
    prevExpanded.current = expanded;
    setConstrained(true);
    runOnUI((open: boolean) => {
      "worklet";
      // The content lays out at its full height even while clipped to less.
      const natural = measure(contentRef)?.height ?? 0;
      // Leaving the plain state: hold exactly the height it's drawn at. Mid-
      // tween, carry on from wherever the last tween got to instead.
      if (released.value) {
        height.value = natural;
        released.value = false;
      }
      height.value = withTiming(
        open ? natural : 0,
        { duration: PROGRAM_PANEL_MS, easing: ReEasing.out(ReEasing.cubic) },
        finished => {
          if (finished && open) {
            released.value = true;
            runOnJS(setConstrained)(false);
          }
        },
      );
    })(expanded);
  }, [expanded, contentRef, height, released]);

  const clipStyle = useAnimatedStyle(() => ({ height: height.value, overflow: "hidden" as const }));

  return (
    <Reanimated.View
      style={constrained ? clipStyle : null}
      // Mounted while closed, clipped to nothing: hidden from VoiceOver and
      // from taps until it opens.
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
      pointerEvents={expanded ? "auto" : "none"}
      // Unstyled while open, so Fabric would flatten it away; it has to stay a
      // real view for the style switch, and the content for measure().
      collapsable={false}
    >
      <Reanimated.View ref={contentRef} collapsable={false}>{children}</Reanimated.View>
    </Reanimated.View>
  );
}

/**
 * Drill-down list of workout days. Each day row is tappable and expands to
 * reveal the exercises that have been logged on that day name across the
 * in-scope completed workouts. Tapping an exercise selects it (the parent
 * Progress screen will render the per-exercise progression chart).
 *
 * Under "All programs" (`groupByProgram`) the days sit inside one card per
 * program, which opens to list them: a few programs of five or six days each
 * was otherwise one long run of days with nothing saying which was whose. One
 * program is open at a time, like one day.
 */
export default function DayExerciseList({
  days,
  workouts,
  selectedExercise,
  onSelectExercise,
  expandedDay,
  onExpandedDayChange,
  groupByProgram,
  programs,
  expandedProgram,
  onExpandedProgramChange,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Precompute counts per day so the row labels are stable.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) m.set(d.key, sessionCountForDay(workouts, d));
    return m;
  }, [days, workouts]);

  const groups = useMemo(
    () => (groupByProgram ? groupDaysByProgram(days, programs) : null),
    [groupByProgram, days, programs],
  );

  if (days.length === 0) {
    return (
      <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 36 }}>
        <View style={styles.empty}>
          <DumbbellIcon size={28} color={t.ts} />
          <Text style={[styles.emptyText, { color: t.ts }]}>No workout days yet.</Text>
        </View>
      </NeuCard>
    );
  }

  const renderDay = (day: ProgramDayRef, underProgram: boolean) => (
    <DayRow
      day={day}
      underProgram={underProgram}
      sessions={counts.get(day.key) ?? 0}
      open={expandedDay === day.key}
      onToggle={() => onExpandedDayChange(expandedDay === day.key ? null : day.key)}
      workouts={workouts}
      selectedExercise={selectedExercise}
      onSelectExercise={onSelectExercise}
    />
  );

  return (
    <View style={{ marginHorizontal: 20, marginTop: 36 }}>
      <Text style={[styles.sectionTitle, { color: t.tp }]}>Exercise Progress</Text>

      {groups
        ? groups.map((g, i) => (
            <ProgramCard
              key={g.programId}
              group={g}
              first={i === 0}
              sessions={g.days.reduce((n, d) => n + (counts.get(d.key) ?? 0), 0)}
              open={expandedProgram === g.programId}
              onToggle={() => onExpandedProgramChange(expandedProgram === g.programId ? null : g.programId)}
              renderDay={day => renderDay(day, true)}
            />
          ))
        : days.map((day, i) => (
            <View key={day.key} style={{ marginTop: i === 0 ? 0 : 12 }}>
              <NeuCard dark={isDark} radius={20}>{renderDay(day, false)}</NeuCard>
            </View>
          ))}
    </View>
  );
}

/** One program under "All programs": its name, status and sessions, opening to
 *  its days as rows inside the card. */
function ProgramCard({
  group,
  first,
  sessions,
  open,
  onToggle,
  renderDay,
}: {
  group: ProgramDayGroup;
  first: boolean;
  sessions: number;
  open: boolean;
  onToggle: () => void;
  renderDay: (day: ProgramDayRef) => React.ReactNode;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const status = group.status ? STATUS_LABEL[group.status] : null;
  const sub = status ? `${status} · ${sessionsText(sessions)}` : sessionsText(sessions);
  return (
    <View style={{ marginTop: first ? 0 : 12 }}>
      <NeuCard dark={isDark} radius={20}>
        <BounceButton
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${group.programName}, ${sub}`}
        >
          <View style={styles.programRow}>
            <View style={styles.programNameCol}>
              <View style={styles.programTitleLine}>
                {/* The same accent dot the program picker marks the running program with. */}
                {group.status === "active" ? <View style={[styles.activeDot, { backgroundColor: ACCT }]} /> : null}
                <Text style={[styles.programName, { color: t.tp }]} numberOfLines={1}>{group.programName}</Text>
              </View>
              <Text style={[styles.programSub, { color: t.ts }]} numberOfLines={1}>{sub}</Text>
            </View>
            <RotatingChevron color={t.ts} rotated={open} />
          </View>
        </BounceButton>

        <ProgramPanel expanded={open}>
          {group.days.map(day => (
            <View key={day.key} style={[styles.dayInProgram, { borderTopColor: t.div }]}>
              {renderDay(day)}
            </View>
          ))}
        </ProgramPanel>
      </NeuCard>
    </View>
  );
}

/** A day's row and, opened, the exercises logged on it. Drawn inside its own
 *  card for a single program, or as a row of a program card under "All programs". */
function DayRow({
  day,
  underProgram,
  sessions,
  open,
  onToggle,
  workouts,
  selectedExercise,
  onSelectExercise,
}: {
  day: ProgramDayRef;
  underProgram: boolean;
  sessions: number;
  open: boolean;
  onToggle: () => void;
  workouts: CompletedWorkout[];
  selectedExercise: ExerciseSelection | null;
  onSelectExercise: (day: ProgramDayRef, name: string) => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const qualifier = dayQualifier(day, underProgram);
  return (
    <>
      <BounceButton
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${day.label}${qualifier ? `, ${qualifier}` : ""}, ${sessions} session${sessions === 1 ? "" : "s"} logged`}
      >
        <View style={styles.dayRow}>
          <View style={styles.dayNameCol}>
            <Text style={[styles.dayName, { color: t.tp }]} numberOfLines={1}>{day.label}</Text>
            {qualifier ? (
              <Text style={[styles.dayQualifier, { color: t.ts }]} numberOfLines={1}>{qualifier}</Text>
            ) : null}
          </View>
          <Text style={[styles.daySub, { color: t.ts }]} numberOfLines={1}>{sessionsText(sessions)}</Text>
          <View style={{ flex: 1 }} />
          <RotatingChevron color={t.ts} rotated={open} />
        </View>
      </BounceButton>

      <ExpandablePanel expanded={open}>
        <ExpandedExercises
          workouts={workouts}
          day={day}
          selectedExercise={selectedExercise}
          onSelectExercise={onSelectExercise}
          textSecondary={t.ts}
          divider={t.div}
          isDark={isDark}
        />
      </ExpandablePanel>
    </>
  );
}

function ExpandedExercises({
  workouts,
  day,
  selectedExercise,
  onSelectExercise,
  textSecondary,
  divider,
  isDark,
}: {
  workouts: CompletedWorkout[];
  day: ProgramDayRef;
  selectedExercise: ExerciseSelection | null;
  onSelectExercise: (day: ProgramDayRef, name: string) => void;
  textSecondary: string;
  divider: string;
  isDark: boolean;
}) {
  const rows: LoggedExerciseRow[] = useMemo(
    () => collectLoggedExercisesForDay(workouts, day),
    [workouts, day],
  );

  if (rows.length === 0) {
    return (
      <View style={[styles.expandedBody, { borderTopColor: divider }]}>
        <Text style={[styles.placeholder, { color: textSecondary }]}>
          No exercises logged on this day yet.
        </Text>
      </View>
    );
  }

  // Highlight only within the selection's own day row — the same exercise
  // name under another day is a different (day, exercise) pair, and so is the
  // same name under a day that merely reads the same.
  const selKey =
    selectedExercise && selectedExercise.dayKey === day.key
      ? norm(selectedExercise.name)
      : "";

  // Each exercise is a pill, the white control-surface button the Trainer page
  // puts inside its cards; the one being charted is `selected` (accent ring +
  // tick).
  return (
    <View style={[styles.expandedBody, { borderTopColor: divider }]}>
      {rows.map((r, i) => {
        const k = norm(r.name);
        const selected = k === selKey;
        return (
          <SheetPill
            key={`${k}-${i}`}
            compact
            label={r.name}
            selected={selected}
            onPress={() => onSelectExercise(day, r.name)}
            accessibilityLabel={r.inProgram ? r.name : `${r.name}, swapped out of this day`}
            accessibilityState={{ selected }}
            badge={r.inProgram ? null : (
              // Logged on this day, but the program doesn't prescribe it any
              // more. Shown so a trend that stops mid-run reads as a change to
              // the programming rather than as someone quietly dropping the
              // exercise. Deliberately quiet — a soft fill and the muted text
              // colour, never the accent — so it annotates the row instead of
              // flagging it as a problem.
              <View style={[styles.swappedChip, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.05)" }]}>
                <Ionicons name="swap-horizontal" size={11} color={textSecondary} />
                <Text style={[styles.swappedText, { color: textSecondary }]}>Swapped out</Text>
              </View>
            )}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 18, marginBottom: 12 },

  programRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  programNameCol: { flex: 1 },
  programTitleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  programName: { fontFamily: FontFamily.bold, fontSize: 17, flexShrink: 1 },
  programSub: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  // A day as a row of its program's card, a line above each one (the first
  // one parts it from the program's own row).
  dayInProgram: { borderTopWidth: 1 },

  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  dayNameCol: { flexShrink: 1 },
  dayName: { fontFamily: FontFamily.bold, fontSize: 15 },
  dayQualifier: { fontFamily: FontFamily.regular, fontSize: 11, marginTop: 1 },
  daySub: { fontFamily: FontFamily.regular, fontSize: 12 },

  // Padding on all sides leaves the pills' shadows room inside the panel's
  // clipped height.
  expandedBody: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  swappedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  swappedText: { fontFamily: FontFamily.semibold, fontSize: 10 },
  placeholder: { fontFamily: FontFamily.regular, fontSize: 13, paddingVertical: 8, textAlign: "center" },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
});
