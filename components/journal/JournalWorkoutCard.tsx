// A workout on a journal: its name, when and how long, and for a session from a
// program, the program, which session of that day it was, and the session
// track. The user's own Journal and a trainer's view of a client's journal both
// draw it, from that person's history and programs, so the card a trainer sees
// is the card the client sees. Each used to carry its own, and the trainer's
// had dropped the program row for "4 exercises · 12 sets".

import { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import SessionTrack from "../SessionTrack";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import type { CompletedWorkout, SavedProgram } from "../../constants/programs";
import { fmtDuration } from "../../utils/dates";
import { indexOfDayId } from "../../utils/programDays";
import { workoutBelongsToProgram } from "../../utils/progressStats";
import { buildSessionTracks } from "../../utils/sessionTrack";
import { getEffectiveToday } from "../../utils/workout";
import { ordinal } from "../../utils/workoutSummary";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_FULL    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function formatWorkoutDate(completedIso: string, durationSeconds: number): string {
  const d = new Date(completedIso);
  const dateStr = `${DAY_FULL[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
  const endTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (durationSeconds > 0) {
    const startTime = new Date(d.getTime() - durationSeconds * 1000)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    return `${dateStr}  ·  ${startTime} – ${endTime}  ·  ${fmtDuration(durationSeconds)}`;
  }
  return `${dateStr}  ·  ${endTime}`;
}

/** The program row under a workout, or null for a session no program owns. */
export type JournalWorkoutInfo = {
  programName: string;
  /** How many sessions of this day the program schedules in total (0 for an
   *  extra, which hides the track). */
  totalSessions: number;
  /** Which session of the day it was: how many were DONE. */
  sessionNum: number;
  /** Where its dot sits: which scheduled occurrence it was. */
  position: number;
  /** Occurrences that came round with nothing logged. */
  missed?: number[];
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
 * days you did train and the days you didn't stay in step. Derived off the
 * same effective day as Home. Numbered within the owning program AND the day,
 * so two programs reusing a name don't share a counter, and neither do two
 * same-named days of one program. Anything the schedule can't place keeps the
 * rank among completed sessions and no grey dots.
 */
export function useJournalWorkoutInfo(
  history: CompletedWorkout[],
  programs: SavedProgram[],
): (w: CompletedWorkout) => JournalWorkoutInfo | null {
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

  return useCallback((w: CompletedWorkout) => {
    const prog = owningProgramByWorkoutId[w.id];
    if (!prog) return null;
    // A dayId names ONE slot, so the program schedules it once per cycle. The
    // name count is the fallback for sessions with no dayId, and it reads 0
    // once the day has been renamed, which is why the id is preferred.
    const perCycle =
      w.dayId && indexOfDayId(prog, w.dayId) >= 0
        ? 1
        : prog.cyclePattern.filter(n => n === w.workoutName).length;
    const totalCycles = Math.ceil(prog.totalWeeks * 7 / prog.cycleDays);
    const sessionNum = sessionTracks.numberById[w.id] ?? 1;
    return {
      programName: prog.name,
      totalSessions: perCycle * totalCycles,
      sessionNum,
      // The dot is where this sits in the PROGRAM, which is past the session
      // count whenever a week was missed.
      position: sessionTracks.positionById[w.id] ?? sessionNum,
      missed: sessionTracks.missedById[w.id],
    };
  }, [owningProgramByWorkoutId, sessionTracks]);
}

function JournalWorkoutCard({ workout, info, isDark, onPress }: {
  workout: CompletedWorkout;
  info: JournalWorkoutInfo | null;
  isDark: boolean;
  onPress: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <BounceButton
      style={styles.wrap}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${workout.workoutName}`}
    >
      <NeuCard dark={isDark} style={styles.card}>
        <View style={styles.inner}>
          <View style={styles.topRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: t.tp }]}>{workout.workoutName}</Text>
              <Text style={[styles.date, { color: t.ts }]}>{formatWorkoutDate(workout.completedAt, workout.durationSeconds)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.ts} />
          </View>
          {info && (
            <View style={styles.progRow}>
              <View style={styles.progHead}>
                <Text style={[styles.progName, { color: t.tp }]}>{info.programName.toUpperCase()}</Text>
                <Text style={[styles.progSession, { color: t.tp }]}>{ordinal(info.sessionNum)} session</Text>
              </View>
              {info.totalSessions > 0 && (
                <SessionTrack
                  current={info.position}
                  total={info.totalSessions}
                  missed={info.missed}
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
  progRow:     { paddingTop: 10 },
  progHead:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 7 },
  progName:    { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.9 },
  progSession: { fontFamily: FontFamily.semibold, fontSize: 12 },
});
