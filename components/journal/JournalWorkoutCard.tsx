// A workout on a journal: its name, when and how long, what scheduled day it
// was done instead of (if any), and for a session from a program, the program,
// which session of that day it was, and the session track. The user's own Journal and a trainer's view of a client's journal both
// draw it, from that person's history and programs, so the card a trainer sees
// is the card the client sees. Each used to carry its own, and the trainer's
// had dropped the program row for "4 exercises · 12 sets".

import { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import SessionTrack from "../SessionTrack";
import { ChangesSummaryLine } from "../ChangeCue";
import { changesSummary, sessionChanges } from "../../utils/exerciseChanges";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, replacedTextColor } from "../../constants/theme";
import type { CompletedWorkout, SavedProgram } from "../../constants/programs";
import { fmtDuration, fromYMD } from "../../utils/dates";
import { displayWorkoutName } from "../../utils/programDays";
import { workoutBelongsToProgram } from "../../utils/progressStats";
import { buildSessionTracks } from "../../utils/sessionTrack";
import { getEffectiveToday } from "../../utils/workout";
import { ordinal } from "../../utils/workoutSummary";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_FULL    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/** The day is the session's TRAINING day (`date`), never completedAt's: a
 *  session finished after midnight is the day before's, and completedAt is
 *  the real finish (utils/sessionTime.ts). */
function formatWorkoutDate(dateYMD: string, completedIso: string, durationSeconds: number): string {
  const d = new Date(completedIso);
  const day = fromYMD(dateYMD) ?? d;
  const dateStr = `${DAY_FULL[day.getDay()]} ${day.getDate()} ${MONTH_SHORT[day.getMonth()]}`;
  const endTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (durationSeconds > 0) {
    const startTime = new Date(d.getTime() - durationSeconds * 1000)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    return `${dateStr}  ·  ${startTime} – ${endTime}  ·  ${fmtDuration(durationSeconds)}`;
  }
  return `${dateStr}  ·  ${endTime}`;
}

/** What a workout card says beyond its name and date. */
export type JournalWorkoutInfo = {
  /** The program row, or null for a session no program owns. */
  program: JournalProgramRow | null;
  /** The scheduled day this session was done in place of ("Instead of Push"),
   *  the other end of the orange dot on that day's track. Null when it
   *  replaced nothing, which is every ordinary session. */
  insteadOf: string | null;
  /** What the session changed about its program day, in a few words ("Order
   *  changed · 1 swap"), or null when it was done as planned
   *  (utils/exerciseChanges.ts). */
  changes: string | null;
};

/** The program row under a workout. */
export type JournalProgramRow = {
  programName: string;
  /** How many sessions of this day the program schedules in total (0 for an
   *  extra, which hides the track). */
  totalSessions: number;
  /** Which session of the day it was, the scheduled occurrence it filled:
   *  what the words say and where its dot sits. */
  sessionNum: number;
  /** Occurrences that came round with nothing logged. */
  missed?: number[];
  /** Occurrences trained with something else on their date (orange). */
  replaced?: number[];
  /** Occurrences logged, after this one as well as before (green). */
  done?: number[];
};

/**
 * What each workout's card says under its title, for one person's history.
 *
 * Attribution goes through the canonical workoutBelongsToProgram
 * (utils/progressStats): exact programId for new-style records ("" = a free
 * workout, owned by nothing), day name within the program's dates for legacy
 * ones, the active program winning a legacy tie. The same rules the Progress
 * page applies, so the two can't disagree.
 *
 * The session number counts SCHEDULED occurrences, not completions
 * (utils/sessionTrack.ts): a week you were ill still costs its number, so the
 * days you did train and the days you didn't stay in step, and the words are
 * the number of the dot they sit over. Derived off the same effective day as
 * Home. Numbered within the owning program, its run AND the day, so two
 * programs reusing a name don't share a counter, neither do two same-named
 * days of one program, and a program run again counts again. Every card's
 * track is drawn as it stands today, its own session marked. Anything the
 * schedule can't place keeps the rank among completed sessions and no grey
 * dots.
 *
 * `insteadOf` comes from the same tracks as the orange dots, so a session that
 * says "Instead of Push" is exactly the one Push's orange dot is about.
 */
export function useJournalWorkoutInfo(
  history: CompletedWorkout[],
  programs: SavedProgram[],
): (w: CompletedWorkout) => JournalWorkoutInfo {
  const activeProgram = useMemo(() => programs.find(p => p.status === "active") ?? null, [programs]);

  const owningProgramByWorkoutId = useMemo(() => {
    const activeFirst = [...programs].sort((a, b) =>
      a.status === "active" ? -1 : b.status === "active" ? 1 : 0
    );
    const map: Record<string, SavedProgram | null> = {};
    for (const w of history) {
      map[w.id] = activeFirst.find(p => workoutBelongsToProgram(w, p)) ?? null;
    }
    return map;
  }, [history, programs]);

  const effectiveToday = getEffectiveToday(activeProgram, history);
  const sessionTracks = useMemo(
    () => buildSessionTracks(history, programs, effectiveToday),
    [history, programs, effectiveToday],
  );

  return useCallback((w: CompletedWorkout): JournalWorkoutInfo => {
    const insteadOf = sessionTracks.insteadOfById[w.id] ?? null;
    const changes = changesSummary(sessionChanges(w));
    const prog = owningProgramByWorkoutId[w.id];
    if (!prog) return { program: null, insteadOf, changes };
    return {
      program: {
        programName: prog.name,
        // Of the run it was in: a program run again may have changed length.
        totalSessions: sessionTracks.totalById[w.id] ?? 0,
        sessionNum: sessionTracks.numberById[w.id] ?? 1,
        missed: sessionTracks.missedById[w.id],
        replaced: sessionTracks.replacedById[w.id],
        done: sessionTracks.doneById[w.id],
      },
      insteadOf,
      changes,
    };
  }, [owningProgramByWorkoutId, sessionTracks]);
}

function JournalWorkoutCard({ workout, info, isDark, onPress }: {
  workout: CompletedWorkout;
  info: JournalWorkoutInfo;
  isDark: boolean;
  onPress: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const prog = info.program;
  return (
    <BounceButton
      style={styles.wrap}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${displayWorkoutName(workout.workoutName)}${info.insteadOf ? `, done instead of ${info.insteadOf}` : ""}`}
    >
      <NeuCard dark={isDark} style={styles.card}>
        <View style={styles.inner}>
          <View style={styles.topRow}>
            <View style={{ flex: 1 }}>
              {/* A custom workout saved as "Custom WorkoutLegs" reads as "Legs". */}
              <Text style={[styles.name, { color: t.tp }]}>{displayWorkoutName(workout.workoutName)}</Text>
              <Text style={[styles.date, { color: t.ts }]}>{formatWorkoutDate(workout.date, workout.completedAt, workout.durationSeconds)}</Text>
              {/* In the orange of the dot it explains (its text shade, deeper
                  on a light card): that day's track shows this date orange,
                  and this is what stood in for it. */}
              {info.insteadOf ? (
                <Text style={[styles.insteadOf, { color: replacedTextColor(isDark) }]} numberOfLines={1}>
                  Instead of {info.insteadOf}
                </Text>
              ) : null}
              {/* What it changed about its day, in grey: the workout's own
                  page says which exercises. */}
              {info.changes ? (
                <ChangesSummaryLine summary={info.changes} isDark={isDark} style={styles.changes} />
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.ts} />
          </View>
          {prog && (
            <View style={styles.progRow}>
              <View style={styles.progHead}>
                <Text style={[styles.progName, { color: t.tp }]}>{prog.programName.toUpperCase()}</Text>
                <Text style={[styles.progSession, { color: t.tp }]}>{ordinal(prog.sessionNum)} session</Text>
              </View>
              {prog.totalSessions > 0 && (
                <SessionTrack
                  current={prog.sessionNum}
                  total={prog.totalSessions}
                  missed={prog.missed}
                  replaced={prog.replaced}
                  done={prog.done}
                  accent={ACCT}
                  track={t.div}
                  missedColor={t.ts}
                />
              )}
            </View>
          )}
        </View>
      </NeuCard>
    </BounceButton>
  );
}

export default memo(JournalWorkoutCard);

const styles = StyleSheet.create({
  // The gap sits on the BounceButton so the bounce scales the card alone.
  wrap:        { marginBottom: 12 },
  card:        { borderRadius: 20 },
  inner:       { padding: 18, gap: 10 },
  topRow:      { flexDirection: "row", alignItems: "center", gap: 12 },
  name:        { fontFamily: FontFamily.bold, fontSize: 16 },
  date:        { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  insteadOf:   { fontFamily: FontFamily.semibold, fontSize: 12, marginTop: 4 },
  changes:     { marginTop: 4 },
  progRow:     { paddingTop: 10 },
  progHead:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 7 },
  progName:    { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.9 },
  progSession: { fontFamily: FontFamily.semibold, fontSize: 12 },
});
