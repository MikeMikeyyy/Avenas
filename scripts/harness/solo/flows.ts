// The solo side of the app: one person, Sam, on one phone. Programs made
// active, paused, resumed, re-aligned and finished; workouts logged, swapped,
// custom and deleted; days marked off, moved and put back from Home, the
// Workout tab and the Journal; and the clock moving on, the small hours
// included. Each step does what its screen does, through the app's own
// functions (the screens' few storage writes are repeated here, with where they
// come from), and after every step what Sam would see is checked against the
// rules the app is built on (CLAUDE.md).
//
// Sam starts on Thursday 1 October 2026, 10am, four days into "Strength"
// (Upper / Lower / Rest; Upper and Lower done, Wednesday's Upper missed), with
// "Push Pull" (Push / Pull / Push: no rest day, and one name twice) not
// started. Sydney time, so a run crosses the daylight-saving change on Sunday.

import { advanceDays, answerPrompts, setClock, takePrompts, tick, type Chooser } from "./env";
import { on, type Phone } from "../app";
import { getJSON, removeKey, setJSON } from "../../../utils/storage";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_DAY_OVERRIDE_KEY, WORKOUT_HISTORY_KEY,
  getCurrentWeek, programFinishDate, type CompletedWorkout, type SavedProgram,
} from "../../../constants/programs";
import { addDaysYMD, formatStoredDate, toYMD } from "../../../utils/dates";
import { getEffectiveToday, getWorkoutForDate, normalizeDriftDates, resolveWorkoutForDate, type DayOverride } from "../../../utils/workout";
import { applyRestDay, clearRestDay, type RestDayOutcome } from "../../../utils/restDay";
import { autoPauseIfIdle, pauseProgram, resumeWithPrompt } from "../../../utils/programPause";
import { activateProgram, completeProgram, deactivateProgram, programsAfterPastLog, setWorkoutDay } from "../../../utils/programLifecycle";
import { archiveProgram, restoreProgram } from "../../../utils/programArchive";
import { buildWeekSchedule, weekStartFor } from "../../../utils/weekSchedule";
import { buildSessionTracks, occurrencesOfDay } from "../../../utils/sessionTrack";
import { isDateSkipped, marksAfterEdit } from "../../../utils/skippedDates";
import { dayIdAt, programDays } from "../../../utils/programDays";

const SAM: Phone = { uid: "sam", name: "Sam", store: new Map(), offline: false };
const A = "prog_strength";
const B = "prog_pushpull";
const NAMES: Record<string, string> = { [A]: "Strength", [B]: "Push Pull" };

const exercise = (id: string, name: string) => ({ id, name, sets: [{ type: "working" as const }] });

function startingPrograms(): SavedProgram[] {
  return [
    {
      id: A, name: NAMES[A], totalWeeks: 3, currentWeek: 1, status: "active",
      startDate: formatStoredDate(new Date(2026, 8, 27)),
      trainingDays: 2, cycleDays: 3, cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["a0", "a1", "a2"],
      workouts: { "0:Upper": [exercise("a_bench", "Bench Press")], "1:Lower": [exercise("a_squat", "Squat")] },
    },
    {
      id: B, name: NAMES[B], totalWeeks: 2, currentWeek: 0, status: "created",
      startDate: formatStoredDate(new Date(2026, 9, 1)),
      trainingDays: 3, cycleDays: 3, cyclePattern: ["Push", "Pull", "Push"], dayIds: ["b0", "b1", "b2"],
      workouts: {
        "0:Push": [exercise("b_press", "Overhead Press")],
        "1:Pull": [exercise("b_row", "Row")],
        "2:Push": [exercise("b_dip", "Dips")],
      },
    },
  ];
}

const session = (id: string, date: string, workoutName: string, dayId: string): CompletedWorkout => ({
  id, date, completedAt: `${date}T08:00:00.000Z`, workoutName, programId: A, dayId, durationSeconds: 1800, exercises: [],
});

/** Each run's ids, so two sessions logged in one minute never share one. */
let nextId = 0;

/** Back to Thursday 1 October, 10am, as above. */
export async function start(): Promise<void> {
  setClock(2026, 10, 1, 10, 0);
  nextId = 0;
  SAM.store = new Map([
    ["@avenas/unit", "kg"],
    [PROGRAMS_KEY, JSON.stringify(startingPrograms())],
    [WORKOUT_HISTORY_KEY, JSON.stringify([
      session("w_lower", "2026-09-28", "Lower", "a1"),
      session("w_upper", "2026-09-27", "Upper", "a0"),
    ])],
    [WORKOUT_DATES_KEY, JSON.stringify(["2026-09-27", "2026-09-28"])],
  ]);
  takePrompts();
  answerPrompts(() => null);
}

// ─── What Sam sees ───────────────────────────────────────────────────────────

export type Snap = {
  /** The calendar day, and the training day the app is on (before 3am it can
   *  still be yesterday: getEffectiveToday). */
  calendarDay: string;
  today: string;
  time: string;
  programs: SavedProgram[];
  history: CompletedWorkout[];
  override: DayOverride | null;
  dates: string[];
};

export async function snap(): Promise<Snap> {
  return on(SAM, async () => {
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
    const now = new Date();
    return {
      calendarDay: toYMD(now),
      today: getEffectiveToday(programs.find(p => p.status === "active") ?? null, history),
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      programs,
      history,
      override: await getJSON<DayOverride | null>(WORKOUT_DAY_OVERRIDE_KEY, null),
      dates: await getJSON<string[]>(WORKOUT_DATES_KEY, []),
    };
  });
}

const activeOf = (s: Snap) => s.programs.find(p => p.status === "active") ?? null;
const programOf = (s: Snap, id: string) => s.programs.find(p => p.id === id) ?? null;
type Day = { name: string; dayId?: string; programId?: string } | null;
const dayOf = (r: { name: string; dayId?: string; programId?: string } | null): Day =>
  r ? { name: r.name, dayId: r.dayId, programId: r.programId } : null;
const sameDay = (a: Day, b: Day) => JSON.stringify(a) === JSON.stringify(b);
const say = (d: Day) => (d ? `${d.name}${d.dayId ? ` (${d.dayId})` : ""}` : "nothing");
const finishOf = (p: SavedProgram | null) => {
  const d = p ? programFinishDate(p) : null;
  return d ? toYMD(d) : null;
};

/** The Workout tab for the training day (loadData): a session logged on it, or
 *  what it resolves to. With no active program it shows "No Active Program". */
function workoutTab(s: Snap): { completed: CompletedWorkout | null; shows: Day } {
  const active = activeOf(s);
  return {
    completed: s.history.find(w => w.date === s.today) ?? null,
    shows: active ? dayOf(resolveWorkoutForDate(active, s.override, s.today, s.programs)) : null,
  };
}

/** Home's "Today's Workout" card: what today resolves to, program or not. */
const homeCard = (s: Snap): Day => dayOf(resolveWorkoutForDate(activeOf(s), s.override, s.today, s.programs));

/** Home's week strip, built exactly as Home builds it. */
function homeStrip(s: Snap) {
  const active = activeOf(s);
  return buildWeekSchedule({
    program: active,
    history: s.history,
    weekStartYMD: weekStartFor(s.today),
    effectiveToday: s.today,
    resolvedTodayName: homeCard(s)?.name ?? null,
    override: s.override,
    allPrograms: s.programs,
  });
}

/** What the strip shows for `date` (weekSchedule.ts's rule for one row, which
 *  also covers dates outside this week): today and later honour a pick. */
function planOn(s: Snap, date: string): Day {
  const active = activeOf(s);
  if (!active) return null;
  return dayOf(resolveWorkoutForDate(active, date >= s.today ? s.override : null, date, s.programs));
}

/** The program's own plan, day by day (no picks), for comparing two states. */
function planWindow(p: SavedProgram, from: string, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysYMD(from, i);
    out.push(`${date} ${say(dayOf(getWorkoutForDate(p, date)))}`);
  }
  return out;
}

function firstDifference(a: string[], b: string[]): string | null {
  const i = a.findIndex((x, k) => x !== b[k]);
  return i < 0 ? null : `was ${a[i]}, now ${b[i]}`;
}

// ─── The screens' own writes ─────────────────────────────────────────────────

/** The Workout tab's Finish (buildCompletedWorkout + persistCompletedWorkout). */
async function finishWorkout(s: Snap, day: { name: string; programId?: string; dayId?: string }): Promise<CompletedWorkout> {
  const completed: CompletedWorkout = {
    id: `workout_${Date.now()}_${nextId++}`,
    date: s.today,
    completedAt: new Date().toISOString(),
    workoutName: day.name,
    programId: day.programId ?? "",
    dayId: day.dayId,
    durationSeconds: 1800,
    exercises: [],
  };
  const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
  if (!dates.includes(completed.date)) await setJSON(WORKOUT_DATES_KEY, [...dates, completed.date]);
  const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
  await setJSON(WORKOUT_HISTORY_KEY, [completed, ...history]);
  return completed;
}

/** log-workout.tsx's save of a session on a past date, from the Journal. */
async function logFromJournal(date: string, day: { name: string; programId: string; dayId?: string }): Promise<void> {
  const completed: CompletedWorkout = {
    id: `workout_${Date.now()}_${nextId++}`,
    date,
    completedAt: `${date}T08:00:00.000Z`,
    workoutName: day.name,
    programId: day.programId,
    dayId: day.dayId,
    durationSeconds: 1800,
    exercises: [],
  };
  const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
  await setJSON(WORKOUT_HISTORY_KEY, [completed, ...history]);
  const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
  if (!dates.includes(date)) await setJSON(WORKOUT_DATES_KEY, [...dates, date]);
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  const after = programsAfterPastLog(programs, { owningProgramId: day.programId, programId: day.programId, date, workoutName: day.name });
  if (after.changed) await setJSON(PROGRAMS_KEY, after.programs);
}

const writePrograms = (programs: SavedProgram[]) => setJSON(PROGRAMS_KEY, programs);
const readPrograms = () => getJSON<SavedProgram[]>(PROGRAMS_KEY, []);

/** Press `choice` on whatever prompt `fn` puts up (cancel if it isn't offered). */
async function answering<T>(choice: Chooser, fn: () => Promise<T>): Promise<T> {
  answerPrompts(choice);
  try {
    return await fn();
  } finally {
    answerPrompts(() => null);
  }
}
const pressStartingWith = (prefix: string): Chooser => (_t, buttons) => buttons.find(b => b.startsWith(prefix)) ?? null;

/** What the app does each time it comes to the front (app/_layout.tsx). */
const appOpens = () => autoPauseIfIdle();

// ─── Steps ───────────────────────────────────────────────────────────────────

export type Step = {
  label: string;
  enabled: (s: Snap) => boolean;
  /** Runs on Sam's phone. What it returns is handed to `check`. */
  run: (s: Snap) => Promise<unknown>;
  /** What must be true of the state it left, given the one it found. */
  check?: (before: Snap, after: Snap, result: unknown) => string[];
  /** Which stored things it may change beyond the active program and today's
   *  pick: the workout history, and programs other than the active one. */
  changes?: { history?: boolean; otherPrograms?: boolean };
};

/** The paused screen is what the Workout tab shows (no Change Workout Day there). */
const pausedScreen = (s: Snap) => !!activeOf(s)?.pausedAt && !workoutTab(s).shows && !workoutTab(s).completed;

// The clock.

/** Home's strip showed this for tomorrow; tomorrow, the Workout tab shows it. */
function predictionHolds(before: Snap, after: Snap): string[] {
  const next = addDaysYMD(before.today, 1);
  if (after.today !== next) return [];
  const was = activeOf(before);
  const now = activeOf(after);
  if (!was || !now || was.id !== now.id) return [];
  if (!was.pausedAt && now.pausedAt) return []; // a week idle: the app paused it as it opened
  const predicted = planOn(before, next);
  const shown = workoutTab(after).shows;
  return sameDay(predicted, shown) ? [] : [`Home showed ${say(predicted)} for ${next}; on the day the Workout tab showed ${say(shown)}`];
}

const clockSteps: Step[] = [
  {
    label: "the next day comes (app opened at 10am)",
    enabled: () => true,
    run: async () => { advanceDays(1, 10); await appOpens(); },
    check: predictionHolds,
  },
  {
    label: "past midnight: 1am, still up",
    enabled: () => true,
    run: async () => { advanceDays(1, 1); await appOpens(); },
    check: predictionHolds,
  },
  {
    label: "a week goes by without opening the app",
    enabled: () => true,
    run: async () => { advanceDays(7, 10); await appOpens(); },
  },
];

// The Workout tab.

function sessionLandsOnToday(after: Snap, w: CompletedWorkout): string[] {
  const issues: string[] = [];
  const active = activeOf(after);
  // Its own date's row, which needn't be "today" any more: logged in the small
  // hours, the app rolls on to the calendar day (getEffectiveToday).
  const row = active ? homeStrip(after).days.find(d => d.dateYMD === w.date) : undefined;
  if (row && (!row.completed || row.workoutName !== w.workoutName)) {
    issues.push(`after logging ${w.workoutName} on ${w.date}, Home's row for it says ${row.workoutName} (${row.completed ? "done" : "not done"})`);
  }
  // A program day done on its own date is that date's occurrence: the dot for
  // today. Only inside the program: past its finish, the dots stop (a program
  // left running past its end keeps scheduling, and those sessions sit on its
  // last occurrence, by design: utils/sessionTrack.ts).
  const finish = finishOf(active);
  if (active && w.programId === active.id && w.dayId && getWorkoutForDate(active, w.date)?.dayId === w.dayId
      && finish !== null && w.date <= finish) {
    const position = buildSessionTracks(after.history, after.programs, after.today).positionById[w.id];
    const occurrences = occurrencesOfDay(active, w.dayId, after.today);
    if (position === undefined || occurrences[position - 1] !== w.date) {
      issues.push(`${w.workoutName}, logged on its own day ${w.date}, sits on ${position ? `occurrence ${position} (${occurrences[position - 1]})` : "no occurrence"}; its occurrences are ${occurrences.slice(-4).join(", ")}`);
    }
  }
  return issues;
}

const workoutSteps: Step[] = [
  {
    label: "Workout tab: log today's workout",
    enabled: s => { const w = workoutTab(s); return !w.completed && !!w.shows; },
    changes: { history: true },
    run: async s => finishWorkout(s, workoutTab(s).shows!),
    check: (_b, after, w) => sessionLandsOnToday(after, w as CompletedWorkout),
  },
  {
    label: "Workout tab: log a custom workout",
    enabled: s => !workoutTab(s).completed,
    changes: { history: true },
    run: async s => {
      // confirmCustomWorkout writes the name as today's pick; Finish drops it.
      await setJSON(WORKOUT_DAY_OVERRIDE_KEY, { date: s.today, workoutName: "Custom Workout" });
      const w = await finishWorkout(s, { name: "Custom Workout" });
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
      return w;
    },
    check: (_b, after, w) => sessionLandsOnToday(after, w as CompletedWorkout),
  },
  {
    label: "Workout tab: log a custom workout, added to the program",
    enabled: s => !!activeOf(s) && !workoutTab(s).completed,
    changes: { history: true },
    run: async s => {
      const active = activeOf(s)!;
      await setJSON(WORKOUT_DAY_OVERRIDE_KEY, { date: s.today, workoutName: "Custom Workout" });
      const w = await finishWorkout(s, { name: "Custom Workout", programId: active.id });
      const programs = await readPrograms();
      await writePrograms(programs.map(p => (p.id === active.id && !(p.extraWorkouts ?? []).includes("Custom Workout")
        ? { ...p, extraWorkouts: [...(p.extraWorkouts ?? []), "Custom Workout"] } : p)));
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
      return w;
    },
    check: (_b, after, w) => sessionLandsOnToday(after, w as CompletedWorkout),
  },
  {
    label: "Workout tab: discard today's logged workout",
    enabled: s => !!workoutTab(s).completed,
    changes: { history: true },
    run: async s => {
      const target = workoutTab(s).completed!;
      const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
      const updated = history.filter(w => w.id !== target.id);
      await setJSON(WORKOUT_HISTORY_KEY, updated);
      if (!updated.some(w => w.date === target.date)) {
        const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
        await setJSON(WORKOUT_DATES_KEY, dates.filter(d => d !== target.date));
      }
    },
  },
  // Change Workout Day: every training day of either program (the sheet lists
  // the active program's days and the other, unarchived, programs').
  ...[A, B].flatMap(pid => [0, 1, 2].map((index): Step => ({
    label: `Workout tab: change today to ${NAMES[pid]}'s day ${index + 1}`,
    enabled: s => {
      const p = programOf(s, pid);
      const active = activeOf(s);
      return !!p && !!active && (p.id === active.id || !p.archivedAt) && !workoutTab(s).completed && !pausedScreen(s)
        && programDays(p).some(d => d.index === index);
    },
    run: async s => {
      const p = programOf(s, pid)!;
      const active = activeOf(s)!;
      const day = programDays(p).find(d => d.index === index)!;
      // handleSelectDay: the pick for today, by slot; and a day marked off is
      // put back (the move a pick replaces stands).
      await setJSON(WORKOUT_DAY_OVERRIDE_KEY, { date: s.today, workoutName: day.label, programId: p.id, dayId: day.dayId });
      if (isDateSkipped(active, s.today)) await clearRestDay(active.id, s.today, false);
      return { name: day.label, dayId: day.dayId, programId: p.id };
    },
    check: (_b, after, picked) => {
      const shown = workoutTab(after).shows;
      return sameDay(shown, picked as Day) ? [] : [`picked ${say(picked as Day)} for today; the Workout tab shows ${say(shown)}`];
    },
  }))),
  {
    label: "Workout tab: change today to Rest, Make Rest Day",
    enabled: s => !!activeOf(s) && !!workoutTab(s).shows && !workoutTab(s).completed,
    run: s => markOff(s, s.today, "Make Rest Day", true),
    check: (b, a, r) => afterMarkingOff(b, a, r as MarkOff),
  },
  {
    label: "Workout tab: change today to Rest, Move to Tomorrow",
    enabled: s => !!activeOf(s) && !!workoutTab(s).shows && !workoutTab(s).completed,
    run: s => markOff(s, s.today, "Move to", true),
    check: (b, a, r) => afterMarkingOff(b, a, r as MarkOff),
  },
];

type MarkOff = { date: string; outcome: RestDayOutcome | "rest pick" };

/** Not training on `date`, from the Workout tab's Rest pick or a strip row. */
async function markOff(s: Snap, date: string, button: string, fromWorkoutTab: boolean): Promise<MarkOff> {
  const active = activeOf(s)!;
  // The Workout tab's Rest on a day already off only needs the Rest pick.
  if (fromWorkoutTab && isDateSkipped(active, date)) {
    await setJSON(WORKOUT_DAY_OVERRIDE_KEY, { date, workoutName: "Rest" });
    return { date, outcome: "rest pick" };
  }
  const outcome = await answering(pressStartingWith(button), () => applyRestDay(active.id, date, "ask"));
  return { date, outcome };
}

/** Make Rest Day empties the day and moves nothing; Move to Tomorrow empties it,
 *  puts its workout on the next day, and moves the finish only when it had no
 *  rest day to absorb it (CLAUDE.md, utils/skippedDates.ts). */
function afterMarkingOff(before: Snap, after: Snap, { date, outcome }: MarkOff): string[] {
  if (outcome === null || outcome === "rest pick") return [];
  const issues: string[] = [];
  const was = activeOf(before)!;
  const now = activeOf(after);
  const shownOnDate = planOn(after, date);
  if (shownOnDate) issues.push(`${date} still shows ${say(shownOnDate)} after ${outcome === "skip" ? "Make Rest Day" : "Move to Tomorrow"}`);
  const finishWas = finishOf(was);
  const finishNow = finishOf(now);
  if (outcome === "skip" || outcome === "moved") {
    if (finishNow !== finishWas) issues.push(`${outcome === "skip" ? "Make Rest Day" : "a move a rest day absorbed"} moved the finish from ${finishWas} to ${finishNow}`);
  }
  // (A day already past the finish, on a program left running, moves nothing.)
  // A day later, or later still past days after the old finish whose own
  // workouts had moved on: the last workout lands past them.
  if (outcome === "extended" && finishWas && date <= finishWas) {
    let expected = addDaysYMD(finishWas, 1);
    while (now && (now.pushedDates ?? []).includes(expected)) expected = addDaysYMD(expected, 1);
    if (finishNow !== expected) issues.push(`a move with no rest day to absorb it should finish later, on ${expected}; finishes ${finishNow}`);
  }
  if (outcome === "moved" || outcome === "extended") {
    // The next day, or the first after it that isn't marked off: a day whose
    // own workout was already moved on stays empty, and the move lands past it.
    let next = addDaysYMD(date, 1);
    while (now && isDateSkipped(now, next) && next <= addDaysYMD(date, 7)) next = addDaysYMD(next, 1);
    const moved = planOn(before, date);
    const there = planOn(after, next);
    // A pick dated that day (one an earlier move carried there) shows instead,
    // by design: a pick overrides the plan for its day.
    const pickedThere = after.override?.date === next;
    if (!pickedThere && !sameDay(moved, there)) issues.push(`moved ${say(moved)} on from ${date}, but ${next} shows ${say(there)}`);
  }
  return issues;
}

// Home's week strip: the row for yesterday, today or tomorrow, when it's in
// this week's strip and tapping it does something.

const ROWS: [string, number][] = [["yesterday", -1], ["today", 0], ["tomorrow", 1]];
const rowFor = (s: Snap, offset: number) => {
  if (!activeOf(s)) return null;
  const date = addDaysYMD(s.today, offset);
  return homeStrip(s).days.find(d => d.dateYMD === date && d.editable) ?? null;
};

/** Undoing a mark puts every day back as planned, and the finish with it. */
function roundTrip(before: Snap, after: Snap): string[] {
  const was = activeOf(before);
  const now = activeOf(after);
  if (!was || !now) return [];
  const from = addDaysYMD(before.today, -7);
  const diff = firstDifference(planWindow(was, from, 35), planWindow(now, from, 35));
  const issues: string[] = [];
  if (diff) issues.push(`the plan isn't back as it was: ${diff}`);
  if (finishOf(was) !== finishOf(now)) issues.push(`the finish isn't back: was ${finishOf(was)}, now ${finishOf(now)}`);
  return issues;
}

const stripSteps: Step[] = ROWS.flatMap(([name, offset]): Step[] => [
  {
    label: `Home: tap ${name}'s row, Make Rest Day`,
    enabled: s => { const r = rowFor(s, offset); return !!r && !r.isSkipped; },
    run: s => markOff(s, addDaysYMD(s.today, offset), "Make Rest Day", false),
    check: (b, a, r) => afterMarkingOff(b, a, r as MarkOff),
  },
  ...(offset >= 0 ? [{
    label: `Home: tap ${name}'s row, Move to the next day`,
    enabled: (s: Snap) => { const r = rowFor(s, offset); return !!r && !r.isSkipped; },
    run: (s: Snap) => markOff(s, addDaysYMD(s.today, offset), "Move to", false),
    check: (b: Snap, a: Snap, r: unknown) => afterMarkingOff(b, a, r as MarkOff),
  }] : []),
  {
    label: `Home: tap ${name}'s crossed-out row to put it back`,
    enabled: s => !!rowFor(s, offset)?.isSkipped,
    run: async s => clearRestDay(activeOf(s)!.id, addDaysYMD(s.today, offset)),
    check: (_b, after, _r) => {
      const date = addDaysYMD(_b.today, offset);
      return activeOf(after) && isDateSkipped(activeOf(after)!, date) ? [`${date} is still marked off after putting it back`] : [];
    },
  },
  {
    label: `Home: tap ${name}'s row, Make Rest Day, then put it back`,
    enabled: s => { const r = rowFor(s, offset); return !!r && !r.isSkipped; },
    run: async s => {
      const date = addDaysYMD(s.today, offset);
      const r = await markOff(s, date, "Make Rest Day", false);
      if (r.outcome) await clearRestDay(activeOf(s)!.id, date);
      return r;
    },
    check: roundTrip,
  },
  ...(offset >= 0 ? [{
    label: `Home: tap ${name}'s row, Move to the next day, then put it back`,
    enabled: (s: Snap) => { const r = rowFor(s, offset); return !!r && !r.isSkipped; },
    run: async (s: Snap) => {
      const date = addDaysYMD(s.today, offset);
      const r = await markOff(s, date, "Move to", false);
      if (r.outcome) await clearRestDay(activeOf(s)!.id, date);
      return r;
    },
    check: (b: Snap, a: Snap) => {
      const issues = roundTrip(b, a);
      // A pick carried with the move comes back with its day.
      if (JSON.stringify(b.override) !== JSON.stringify(a.override)) issues.push(`today's pick isn't back: was ${JSON.stringify(b.override)}, now ${JSON.stringify(a.override)}`);
      return issues;
    },
  }] : []),
]);

// My Programs.

const todayStored = () => formatStoredDate(new Date());

const programSteps: Step[] = [
  ...[A, B].map((pid): Step => ({
    label: `My Programs: make ${NAMES[pid]} active`,
    enabled: s => { const p = programOf(s, pid); return !!p && p.status !== "active" && !p.archivedAt; },
    changes: { otherPrograms: true },
    run: async () => {
      const { programs } = activateProgram(await readPrograms(), pid, todayStored());
      await writePrograms(programs);
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
    },
    check: (_b, after) => {
      const p = programOf(after, pid)!;
      const issues: string[] = [];
      if (p.status !== "active") issues.push(`${p.name} isn't active`);
      if (p.cycleOffset || p.pausedAt || p.skippedDates || p.pushedDates || p.pulledDates) issues.push(`${p.name}'s fresh run kept marks from before: ${JSON.stringify({ cycleOffset: p.cycleOffset, pausedAt: p.pausedAt, skipped: p.skippedDates, pushed: p.pushedDates, pulled: p.pulledDates })}`);
      const first = dayOf(getWorkoutForDate(p, after.calendarDay));
      const expected = p.cyclePattern[0] === "Rest" ? null : { name: p.cyclePattern[0], dayId: dayIdAt(p, 0), programId: p.id };
      if (after.today === after.calendarDay && !workoutTab(after).completed && !sameDay(first, expected)) {
        issues.push(`a fresh run starts on day 1 (${say(expected)}); today shows ${say(first)}`);
      }
      return issues;
    },
  })),
  {
    label: "My Programs: make the active program inactive",
    enabled: s => !!activeOf(s),
    run: async s => {
      await writePrograms(deactivateProgram(await readPrograms(), activeOf(s)!.id));
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
    },
  },
  {
    label: "My Programs: mark the active program complete",
    enabled: s => !!activeOf(s),
    run: async s => {
      await writePrograms(completeProgram(await readPrograms(), activeOf(s)!.id, todayStored()).programs);
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
    },
  },
  {
    label: "My Programs: pause the active program",
    enabled: s => !!activeOf(s) && !activeOf(s)!.pausedAt,
    run: async s => {
      // handlePauseProgram: held from the day the Workout tab is on.
      const active = activeOf(s)!;
      await writePrograms(pauseProgram(await readPrograms(), active.id, getEffectiveToday(active, s.history)));
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
    },
    check: (before, after) => {
      const was = activeOf(before)!;
      const now = activeOf(after)!;
      const issues: string[] = [];
      if (getCurrentWeek(now) !== getCurrentWeek(was)) issues.push(`pausing moved the week from ${getCurrentWeek(was)} to ${getCurrentWeek(now)}`);
      // Days before the hold keep what they showed: history and the strip must
      // not rewrite themselves (utils/workout.ts resolveDayIndex).
      const from = addDaysYMD(now.pausedAt!, -14);
      const diff = firstDifference(planWindow(was, from, 14), planWindow(now, from, 14));
      if (diff) issues.push(`pausing rewrote a day before the hold: ${diff}`);
      if (workoutTab(after).shows && !workoutTab(after).completed) issues.push(`paused, the Workout tab still shows ${say(workoutTab(after).shows)} today`);
      return issues;
    },
  },
  ...["Today", "Carry on"].map((choice): Step => ({
    label: `My Programs: resume, ${choice === "Today" ? "picking up today" : "carrying on where I left off"}`,
    enabled: s => !!activeOf(s)?.pausedAt,
    run: s => answering(pressStartingWith(choice), () => resumeWithPrompt(activeOf(s)!.id)),
    check: (before, after, result) => {
      if (result === null) return [];
      const was = activeOf(before)!;
      const now = activeOf(after)!;
      const issues: string[] = [];
      if (now.pausedAt) issues.push("still on hold after resuming");
      // The weeks didn't count during the hold, so it picks up in the week the
      // hold began in, on the program's timeline as it is now (a session logged
      // from the Journal meanwhile can have moved its start back).
      const [y, m, d] = was.pausedAt!.split("-").map(Number);
      const heldIn = getCurrentWeek({ ...was, pausedAt: undefined }, new Date(y, m - 1, d));
      if (getCurrentWeek(now) !== heldIn) issues.push(`resuming put it in week ${getCurrentWeek(now)}; the hold began in week ${heldIn}`);
      return issues;
    },
  })),
  // Set Workout Date: "today is day N" on the active program.
  ...[0, 1, 2].map((index): Step => ({
    label: `My Programs: Set Workout Date, today is day ${index + 1}`,
    enabled: s => {
      const active = activeOf(s);
      return !!active && !active.pausedAt && !!active.cyclePattern[index] && active.cyclePattern[index] !== "Rest";
    },
    run: async s => {
      const active = activeOf(s)!;
      const today = getEffectiveToday(active, s.history);
      const realigned = setWorkoutDay(active, index, today, s.history);
      if (!realigned) return null;
      await writePrograms((await readPrograms()).map(p => (p.id === active.id ? realigned : p)));
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
      return realigned;
    },
    check: (_b, after, realigned) => {
      if (!realigned) return [];
      const active = activeOf(after)!;
      const issues: string[] = [];
      const want = { name: active.cyclePattern[index], dayId: dayIdAt(active, index), programId: active.id };
      const shown = workoutTab(after).shows;
      if (!workoutTab(after).completed && !sameDay(shown, want)) issues.push(`set today to ${say(want)}; the Workout tab shows ${say(shown)}`);
      if (active.pushedDates || active.pulledDates) issues.push(`moves survived the reset: pushed ${JSON.stringify(active.pushedDates)}, pulled ${JSON.stringify(active.pulledDates)}`);
      return issues;
    },
  })),
  {
    // The builder's Update on the program being run (new-program.tsx doUpdate):
    // the mid-run edit that re-dates the cycle under any moves, here its last
    // day turned into a workout, or back into a rest day.
    label: "Program builder: edit the active program, its last day a workout (or a rest day again)",
    enabled: s => !!activeOf(s),
    run: async s => {
      const active = activeOf(s)!;
      const last = active.cyclePattern.length - 1;
      const toRest = active.cyclePattern[last] !== "Rest";
      const cyclePattern = active.cyclePattern.map((n, i) => (i === last ? (toRest ? "Rest" : "Arms") : n));
      const workouts = Object.fromEntries(Object.entries(active.workouts).filter(([key]) => !key.startsWith(`${last}:`)));
      if (!toRest) workouts[`${last}:Arms`] = [exercise("x_curl", "Curl")];
      const edited: SavedProgram = { ...active, cyclePattern, workouts, trainingDays: cyclePattern.filter(n => n !== "Rest").length };
      await writePrograms((await readPrograms()).map(p => (p.id === active.id ? marksAfterEdit(p, edited) : p)));
    },
  },
  ...[A, B].flatMap((pid): Step[] => [
    {
      label: `My Programs: archive ${NAMES[pid]}`,
      enabled: s => { const p = programOf(s, pid); return !!p && p.status !== "active" && !p.archivedAt; },
      changes: { otherPrograms: true },
      run: async () => writePrograms(archiveProgram(await readPrograms(), pid)),
    },
    {
      label: `My Programs: restore ${NAMES[pid]}`,
      enabled: s => !!programOf(s, pid)?.archivedAt,
      changes: { otherPrograms: true },
      run: async () => writePrograms(restoreProgram(await readPrograms(), pid)),
    },
  ]),
];

// The Journal.

const journalSteps: Step[] = [
  {
    label: "Journal: log yesterday's planned workout",
    enabled: s => {
      const active = activeOf(s);
      const y = addDaysYMD(s.today, -1);
      return !!active && !!getWorkoutForDate(active, y) && !s.history.some(w => w.date === y);
    },
    changes: { history: true },
    run: async s => {
      const active = activeOf(s)!;
      const y = addDaysYMD(s.today, -1);
      const planned = getWorkoutForDate(active, y)!;
      await logFromJournal(y, { name: planned.name, programId: active.id, dayId: planned.dayId });
    },
  },
  {
    label: "Journal: log day 1 on a date ten days ago",
    enabled: s => {
      const active = activeOf(s);
      return !!active && programDays(active).length > 0 && !s.history.some(w => w.date === addDaysYMD(s.today, -10));
    },
    changes: { history: true },
    run: async s => {
      const active = activeOf(s)!;
      const day = programDays(active)[0];
      await logFromJournal(addDaysYMD(s.today, -10), { name: day.label, programId: active.id, dayId: day.dayId });
    },
  },
];

export const STEPS: Step[] = [...clockSteps, ...workoutSteps, ...stripSteps, ...programSteps, ...journalSteps];

/** Sequences always played out, step by step: the everyday ones worth pinning
 *  whatever the explorer happens to reach. */
export const STORIES: string[][] = [
  // Not up to it two days running: moved, and moved again.
  ["Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)",
    "Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)",
    "Workout tab: log today's workout"],
  // Three days running.
  ["Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)",
    "Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)",
    "Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)",
    "Workout tab: log today's workout"],
  // Today moved, then tomorrow's moved too and that put back.
  ["Workout tab: change today to Rest, Move to Tomorrow", "Home: tap tomorrow's row, Move to the next day, then put it back"],
  // Tomorrow moved first, then today (Saturday's Upper and Sunday's Lower):
  // both days are off, and both workouts shift two days, Upper to Monday.
  // (Thursday's logged first: a week with nothing logged pauses the program.)
  ["Workout tab: log today's workout", "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Home: tap tomorrow's row, Move to the next day", "Workout tab: change today to Rest, Move to Tomorrow",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Workout tab: log today's workout"],
  // A rest day taken, then "today is Upper" after all.
  ["Workout tab: change today to Rest, Make Rest Day", "My Programs: Set Workout Date, today is day 1"],
  // A day picked, then the program set aside.
  ["Workout tab: change today to Strength's day 1", "My Programs: make the active program inactive"],
  ["Workout tab: change today to Strength's day 1", "My Programs: mark the active program complete"],
  // A move, then an earlier session logged from the Journal.
  ["Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)",
    "Journal: log day 1 on a date ten days ago"],
];

// ─── Always true ─────────────────────────────────────────────────────────────

export function alwaysTrue(s: Snap): string[] {
  const issues: string[] = [];
  const actives = s.programs.filter(p => p.status === "active");
  if (actives.length > 1) issues.push(`${actives.length} programs are active`);
  for (const p of s.programs) {
    if (p.status === "active" && p.archivedAt) issues.push(`${p.name} is active and archived`);
    // Every path that saves a program runs normalizeDriftDates (CLAUDE.md):
    // a pull must sit on a rest day, and never on a push.
    const normal = normalizeDriftDates(p);
    if (JSON.stringify(normal.pulledDates) !== JSON.stringify(p.pulledDates)) {
      issues.push(`${p.name} was saved with a pull off a rest day: ${JSON.stringify(p.pulledDates)}, should be ${JSON.stringify(normal.pulledDates)}`);
    }
    for (const d of p.pushedDates ?? []) {
      if (!(p.skippedDates ?? []).includes(d)) issues.push(`${p.name}: ${d} is pushed but not marked off`);
    }
    for (const [name, list] of [["skipped", p.skippedDates], ["pushed", p.pushedDates], ["pulled", p.pulledDates]] as const) {
      if (list && new Set(list).size !== list.length) issues.push(`${p.name}: a ${name} date is listed twice: ${JSON.stringify(list)}`);
    }
    if (p.dayIds && p.dayIds.length !== p.cyclePattern.length) issues.push(`${p.name} has ${p.dayIds.length} day ids for ${p.cyclePattern.length} days`);
  }

  // Home and the Workout tab agree about today.
  const tab = workoutTab(s);
  if (!tab.completed) {
    const card = homeCard(s);
    if (!sameDay(card, tab.shows)) issues.push(`today (${s.today}) Home's card shows ${say(card)}, the Workout tab ${tab.shows || activeOf(s) ? say(tab.shows) : "No Active Program"}`);
  }
  if (activeOf(s)) {
    const row = homeStrip(s).days.find(d => d.isToday);
    const wantName = tab.completed ? tab.completed.workoutName : tab.shows?.name ?? "Rest";
    if (row && (row.workoutName !== wantName || row.completed !== !!tab.completed)) {
      issues.push(`today's row on Home's strip says ${row.workoutName}${row.completed ? " (done)" : ""}; the Workout tab ${tab.completed ? `has ${tab.completed.workoutName} done` : `shows ${wantName}`}`);
    }
  }
  return issues;
}

/** What a step mustn't have touched. */
export function untouched(step: Step, before: Snap, after: Snap): string[] {
  const issues: string[] = [];
  if (!step.changes?.history && JSON.stringify(before.history) !== JSON.stringify(after.history)) {
    issues.push("it changed the workout history");
  }
  if (!step.changes?.otherPrograms) {
    const activeId = activeOf(before)?.id;
    for (const p of before.programs) {
      if (p.id === activeId) continue;
      const now = programOf(after, p.id);
      // Making a program inactive or complete only touches the active one.
      if (JSON.stringify(now) !== JSON.stringify(p)) issues.push(`it changed ${p.name}, which wasn't the active program`);
    }
  }
  return issues;
}

/** The active program's timeline and today's pick, for a report. */
export function describe(s: Snap): string {
  const p = activeOf(s);
  const marks = p
    ? [
        `${p.name} from ${p.startDate}`,
        p.cycleOffset ? `offset ${p.cycleOffset}` : "",
        p.pausedAt ? `held from ${p.pausedAt}` : "",
        p.skippedDates ? `off ${p.skippedDates.join(",")}` : "",
        p.pushedDates ? `pushed ${p.pushedDates.join(",")}` : "",
        p.pulledDates ? `pulled ${p.pulledDates.join(",")}` : "",
        `finish ${finishOf(p)}`,
      ].filter(Boolean).join(", ")
    : "no active program";
  const pick = s.override ? `; pick ${s.override.workoutName} on ${s.override.date}` : "";
  return `${marks}${pick}`;
}

/** Run one step on Sam's phone: the state before, what it returned, the state after. */
export async function play(step: Step): Promise<{ before: Snap; after: Snap; result: unknown }> {
  const before = await snap();
  const result = await on(SAM, () => step.run(before));
  takePrompts();
  tick();
  const after = await snap();
  return { before, after, result };
}
