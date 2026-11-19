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
  getCurrentWeek, programFinishDate, type CompletedExercise, type CompletedWorkout, type SavedProgram,
} from "../../../constants/programs";
import { addDaysYMD, formatStoredDate, parseStoredDate, toYMD } from "../../../utils/dates";
import { getEffectiveToday, getWorkoutForDate, normalizeDriftDates, resolveWorkoutForDate, type DayOverride } from "../../../utils/workout";
import { applyRestDay, clearRestDay, type RestDayOutcome } from "../../../utils/restDay";
import { AUTO_PAUSE_AFTER_DAYS, idleDays, pauseProgram, resumeWithPrompt, settleActiveProgram } from "../../../utils/programPause";
import {
  activateProgram, carryOnProgram, completeProgram, deactivateProgram, minTotalWeeks, programsAfterDeletedSession,
  programsAfterPastLog, runFinishedOn, setWorkoutDay, withTotalWeeks,
} from "../../../utils/programLifecycle";
import { completeIfFinished, reopenIfUnfinished } from "../../../utils/programFinish";
import { buildProgramHistory } from "../../../utils/programHistory";
import { archiveProgram, restoreProgram } from "../../../utils/programArchive";
import { buildWeekSchedule, weekStartFor } from "../../../utils/weekSchedule";
import { buildSessionTracks, occurrencesOfDay } from "../../../utils/sessionTrack";
import { isDateSkipped, marksAfterEdit } from "../../../utils/skippedDates";
import { dayIdAt, programDays } from "../../../utils/programDays";
import { planImport, readWorkoutCsv, type ExerciseChoice } from "../../../utils/workoutImport";
import { matchExerciseName } from "../../../utils/exerciseMatch";
import { loadImports, saveImport, undoImport, type ImportRecord } from "../../../utils/importStore";
import { joinSuperset, supersetRuns } from "../../../utils/supersets";
import { nextSetOf } from "../../../utils/nextSet";
import { completedExercises, type DraftSet } from "../../../utils/unfinishedSession";
import { logExercisesFor, loggedExercises } from "../../../utils/logWorkout";
import { earliestStart, startOptions, startsLater, storedStart, withStartDate } from "../../../utils/programStart";
import { calendarWeeks, homeMonthCells, pastPlanFrom, type CalendarDayState, type HomeCellState } from "../../../utils/journalCalendar";
import { runStartYMD } from "../../../utils/programHolds";
import { programAsRun } from "../../../utils/programRuns";
import { isStreakRiskDay } from "../../../utils/streak";

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
      workouts: {
        "0:Upper": [exercise("a_bench", "Bench Press"), exercise("a_ohp", "Shoulder Press")],
        "1:Lower": [exercise("a_squat", "Squat")],
      },
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
  /** What each import from another app added, newest first (Import & Export's Undo). */
  imports: ImportRecord[];
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
      imports: await loadImports(),
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

/** Home's calendar (components/ActivityCalendar.tsx) and the Journal's for a
 *  day, as each draws it: the calendar day as today, every program's runs for
 *  the days gone by, the active program for the rest. Each month worked out
 *  once. */
function calendars(s: Snap): (ymd: string) => { home: HomeCellState; journal: CalendarDayState | null } {
  const active = activeOf(s);
  const plan = pastPlanFrom(s.programs, s.history);
  const dates = new Set(s.dates);
  const months = new Map<string, { home: HomeCellState[]; pad: number; journal: Map<string, CalendarDayState> }>();
  return ymd => {
    const [y, m, d] = ymd.split("-").map(Number);
    const key = ymd.slice(0, 7);
    let month = months.get(key);
    if (!month) {
      const journal = new Map<string, CalendarDayState>();
      for (const w of calendarWeeks(y, m - 1, s.calendarDay, dates, active, plan)) for (const day of w.days) if (day) journal.set(day.date, day.state);
      month = { home: homeMonthCells(y, m - 1, s.calendarDay, dates, active, plan), pad: (new Date(y, m - 1, 1).getDay() + 6) % 7, journal };
      months.set(key, month);
    }
    return { home: month.home[month.pad + d - 1], journal: month.journal.get(ymd) ?? null };
  };
}

/**
 * A program made active, or its start moved, to start on `start`
 * (utils/programStart.ts; user request, 2026-11-16): day 1 on the day picked,
 * never today once a workout was logged today, its run fresh, week 0 and
 * nothing scheduled before it, the days between rest on Home's calendar and
 * the Journal's with no streak to lose on them, and the history as it was.
 */
function startsAsPicked(before: Snap, after: Snap, pid: string, start: string): string[] {
  const p = programOf(after, pid)!;
  const issues: string[] = [];
  const today = after.calendarDay;
  if (p.status !== "active") return [`${p.name} isn't active`];
  if (runStartYMD(p) !== start) issues.push(`${p.name} starts ${runStartYMD(p)}, not ${start} as picked`);
  if (start === today && before.history.some(w => w.date === today)) issues.push(`${p.name} starts today, a day already trained`);
  if (p.cycleOffset || p.pausedAt || p.skippedDates || p.pushedDates || p.pulledDates) issues.push(`${p.name}'s fresh run kept marks from before: ${JSON.stringify({ cycleOffset: p.cycleOffset, pausedAt: p.pausedAt, skipped: p.skippedDates, pushed: p.pushedDates, pulled: p.pulledDates })}`);
  const first = dayOf(getWorkoutForDate(p, start));
  const expected = p.cyclePattern[0] === "Rest" ? null : { name: p.cyclePattern[0], dayId: dayIdAt(p, 0), programId: p.id };
  if (!sameDay(first, expected)) issues.push(`its day 1 (${say(expected)}) isn't on ${start}, the day picked: it has ${say(first)}`);
  if (start > today && getCurrentWeek(p) !== 0) issues.push(`before its start it reads week ${getCurrentWeek(p)}`);
  const cal = calendars(after);
  for (let d = today; d < start; d = addDaysYMD(d, 1)) {
    const planned = getWorkoutForDate(p, d);
    if (planned) issues.push(`${d}, before ${p.name} starts on ${start}, schedules ${planned.name}`);
    if (isStreakRiskDay(p, d)) issues.push(`the streak can be lost on ${d}, before ${p.name} starts`);
    if (d > today && d.slice(0, 7) === today.slice(0, 7)) {
      const { home, journal } = cal(d);
      if (home !== "rest") issues.push(`Home's calendar shows ${d}, before ${p.name} starts, as ${home}, not rest`);
      if (journal !== "rest") issues.push(`the Journal's calendar shows ${d}, before ${p.name} starts, as ${journal}, not rest`);
    }
  }
  if (JSON.stringify(before.history) !== JSON.stringify(after.history)) issues.push("making it active changed the history");
  return issues;
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
async function finishWorkout(
  s: Snap,
  day: { name: string; programId?: string; dayId?: string },
  exercises: CompletedExercise[] = [],
): Promise<CompletedWorkout> {
  const completed: CompletedWorkout = {
    id: `workout_${Date.now()}_${nextId++}`,
    date: s.today,
    completedAt: new Date().toISOString(),
    workoutName: day.name,
    programId: day.programId ?? "",
    dayId: day.dayId,
    durationSeconds: 1800,
    exercises,
  };
  const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
  if (!dates.includes(completed.date)) await setJSON(WORKOUT_DATES_KEY, [...dates, completed.date]);
  const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
  await setJSON(WORKOUT_HISTORY_KEY, [completed, ...history]);
  return completed;
}

/** The Workout tab's Finish as a whole (finalizeComplete): the session, then
 *  whether it was the program's last, which ends it (utils/programFinish.ts). */
async function logToday(s: Snap, day: { name: string; programId?: string; dayId?: string }): Promise<CompletedWorkout> {
  const w = await finishWorkout(s, day);
  await completeIfFinished();
  return w;
}

/** workout-detail.tsx's Delete, and the Workout tab's Delete & Redo
 *  (handleDiscardCompleted): the session goes, and its date with it when
 *  nothing else was logged that day; and the program it ended, picked back
 *  up while its last day hasn't gone by. */
async function deleteWorkout(target: CompletedWorkout): Promise<void> {
  const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
  const updated = history.filter(w => w.id !== target.id);
  await setJSON(WORKOUT_HISTORY_KEY, updated);
  if (!updated.some(w => w.date === target.date)) {
    const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
    await setJSON(WORKOUT_DATES_KEY, dates.filter(d => d !== target.date));
  }
  await reopenIfUnfinished(target);
}

/** The Journal's newest workout (its list's first card) or its oldest. */
const byDate = (a: CompletedWorkout, b: CompletedWorkout) => a.date.localeCompare(b.date) || a.completedAt.localeCompare(b.completedAt);
const newestOf = (s: Snap) => [...s.history].sort(byDate).at(-1) ?? null;
const oldestOf = (s: Snap) => [...s.history].sort(byDate)[0] ?? null;

/** log-workout.tsx's save of a session on a past date, from the Journal:
 *  `exercises` as its Save writes them (utils/logWorkout.ts loggedExercises). */
async function logFromJournal(
  date: string,
  day: { name: string; programId: string; dayId?: string },
  exercises: CompletedExercise[] = [],
): Promise<CompletedWorkout> {
  const completed: CompletedWorkout = {
    id: `workout_${Date.now()}_${nextId++}`,
    date,
    completedAt: `${date}T08:00:00.000Z`,
    workoutName: day.name,
    programId: day.programId,
    dayId: day.dayId,
    durationSeconds: 1800,
    exercises,
  };
  const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
  await setJSON(WORKOUT_HISTORY_KEY, [completed, ...history]);
  const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
  if (!dates.includes(date)) await setJSON(WORKOUT_DATES_KEY, [...dates, date]);
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  const after = programsAfterPastLog(programs, { owningProgramId: day.programId, programId: day.programId, date, workoutName: day.name });
  if (after.changed) await setJSON(PROGRAMS_KEY, after.programs);
  // Its last session, logged after the fact, ends it.
  if (day.programId) await completeIfFinished();
  return completed;
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

/** What the app does each time it comes to the front (app/_layout.tsx): a run
 *  that's finished completes, then a week with nothing logged holds it. */
const appOpens = () => settleActiveProgram();

/** Once the app has opened, or a session has been saved, a run that's finished
 *  (its last session done, or its last day gone by) isn't still running:
 *  scheduled on, every session after it read as its last. */
function endedWhenFinished(s: Snap): string[] {
  const active = activeOf(s);
  if (!active) return [];
  const on = runFinishedOn(active, s.history, s.today);
  return on ? [`${active.name} finished on ${on} (its last day ${finishOf(active)}), and it's still the active program`] : [];
}

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
    check: (b, a) => [...predictionHolds(b, a), ...endedWhenFinished(a)],
  },
  {
    label: "past midnight: 1am, still up",
    enabled: () => true,
    run: async () => { advanceDays(1, 1); await appOpens(); },
    check: (b, a) => [...predictionHolds(b, a), ...endedWhenFinished(a)],
  },
  {
    label: "a week goes by without opening the app",
    enabled: () => true,
    run: async () => { advanceDays(7, 10); await appOpens(); },
    check: (_b, a) => endedWhenFinished(a),
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
    const position = buildSessionTracks(after.history, after.programs, after.today).numberById[w.id];
    const occurrences = occurrencesOfDay(active, w.dayId, after.today);
    if (position === undefined || occurrences[position - 1] !== w.date) {
      issues.push(`${w.workoutName}, logged on its own day ${w.date}, sits on ${position ? `occurrence ${position} (${occurrences[position - 1]})` : "no occurrence"}; its occurrences are ${occurrences.slice(-4).join(", ")}`);
    }
  }
  return issues;
}

/** What every card shows: each session's number, its dot, and the dots
 *  around it (utils/sessionTrack.ts). */
const cards = (s: Snap) => buildSessionTracks(s.history, s.programs, s.today);

/** A delete takes its session and nothing else: no program moves, today's
 *  pick stays, and every other session the schedule placed keeps its dot
 *  (user request, 2026-10-16: delete, do it again, delete again). But for a
 *  pick left with no program running and nothing done today, which goes with
 *  the run that ended (reopenIfUnfinished). */
function afterDeleting(before: Snap, after: Snap, target: CompletedWorkout): string[] {
  const issues: string[] = [];
  if (after.history.some(w => w.id === target.id)) issues.push(`${target.workoutName} on ${target.date} is still there after deleting it`);
  // Only the program it ended, picked back up (programsAfterDeletedSession).
  if (JSON.stringify(programsAfterDeletedSession(before.programs, target, after.history)) !== JSON.stringify(after.programs)) {
    issues.push("deleting a workout changed a program");
  }
  const pickGoes = !activeOf(after) && before.override?.date === after.today && !after.history.some(w => w.date === after.today);
  if (JSON.stringify(pickGoes ? null : before.override) !== JSON.stringify(after.override)) {
    issues.push(pickGoes ? "a pick for a run that's ended stayed after its day's workout was deleted" : "deleting a workout changed today's pick");
  }
  const was = cards(before);
  const now = cards(after);
  for (const w of after.history) {
    // Placed on its schedule (a count's dot moves with the count, by design).
    if (was.missedById[w.id] === undefined) continue;
    if (now.numberById[w.id] !== was.numberById[w.id]) {
      issues.push(`deleting ${target.workoutName} on ${target.date} moved ${w.workoutName} on ${w.date} from dot ${was.numberById[w.id]} to ${now.numberById[w.id]}`);
    }
  }
  return issues;
}

/** A running program's stored week isn't read (getCurrentWeek counts from its
 *  dates), and a last session logged and deleted again leaves it at its last
 *  week: ended, then picked back up. */
const asRun = (programs: SavedProgram[]) => programs.map(p => (p.status === "active" && !p.pausedAt ? { ...p, currentWeek: 0 } : p));

/** Logged and deleted again: everything as it was, every card included. */
function backAsItWas(before: Snap, after: Snap): string[] {
  const issues: string[] = [];
  for (const [what, a, b] of [
    ["the workout history", before.history, after.history],
    ["the workout dates", [...before.dates].sort(), [...after.dates].sort()],
    ["the programs", asRun(before.programs), asRun(after.programs)],
    ["today's pick", before.override, after.override],
    ["the workout cards", cards(before), cards(after)],
    ["Home's week", activeOf(before) ? homeStrip(before) : null, activeOf(after) ? homeStrip(after) : null],
  ] as const) {
    if (JSON.stringify(a) !== JSON.stringify(b)) issues.push(`${what} isn't back as it was after logging and deleting`);
  }
  if (before.today !== after.today) issues.push(`the app moved from ${before.today} to ${after.today}`);
  return issues;
}

/** The exercises today's workout opens with, as the Workout tab draws them. */
const todaysExercises = (s: Snap) => resolveWorkoutForDate(activeOf(s), s.override, s.today, s.programs)?.exercises ?? [];

const workoutSteps: Step[] = [
  {
    label: "Workout tab: log today's workout",
    enabled: s => { const w = workoutTab(s); return !w.completed && !!w.shows; },
    changes: { history: true },
    run: async s => logToday(s, workoutTab(s).shows!),
    check: (_b, after, w) => [...sessionLandsOnToday(after, w as CompletedWorkout), ...endedWhenFinished(after)],
  },
  {
    // A superset made on the Workout tab (utils/supersets.ts; user request,
    // 2026-11-15): today's first two, Superset With from the first one's
    // sheet, done the way the session walks them, set by set; saved as one,
    // and the program left as it was (it's the session's alone, like a swap).
    label: "Workout tab: superset today's first two exercises, and log it",
    enabled: s => { const w = workoutTab(s); return !w.completed && !!w.shows && todaysExercises(s).length >= 2; },
    changes: { history: true },
    run: async s => {
      const exercises = joinSuperset(todaysExercises(s), 0, 1);
      const log = Object.fromEntries(exercises.map(e => [e.id, {
        warmup: [] as DraftSet[],
        working: [0, 1].map((): DraftSet => ({ weight: "60", reps: "8", done: false })),
        notes: "",
      }]));
      // Each tick on the set the session's up to (the glow, the lock screen).
      const walked: string[] = [];
      for (let at = 1; at < 20; at++) {
        const next = nextSetOf(exercises.map(e => e.id), log, exercises.map(e => e.supersetId));
        if (!next) break;
        log[next.exId].working[next.setIdx] = { ...log[next.exId].working[next.setIdx], done: true, doneAt: at };
        walked.push(`${next.exIndex}:${next.setIdx}`);
      }
      const w = await finishWorkout(s, workoutTab(s).shows!, completedExercises(exercises, log, true, new Set()));
      await completeIfFinished();
      return { w, walked, programId: activeOf(s)?.id };
    },
    check: (_b, after, result) => {
      const { w, walked, programId } = result as { w: CompletedWorkout; walked: string[]; programId?: string };
      const issues = [...sessionLandsOnToday(after, w), ...endedWhenFinished(after)];
      if (walked.join(" ") !== "0:0 1:0 0:1 1:1") issues.push(`the superset's sets came up ${walked.join(" ")}, not a round at a time`);
      const saved = after.history.find(x => x.id === w.id);
      if (JSON.stringify(supersetRuns(saved?.exercises ?? [])) !== "[[0,1]]") {
        issues.push(`the session saved its superset as ${JSON.stringify(saved?.exercises.map(e => e.supersetId ?? null))}`);
      }
      const program = after.programs.find(p => p.id === programId);
      if (program && Object.values(program.workouts).some(list => list.some(e => e.supersetId))) {
        issues.push("a superset made on the Workout tab got into the program");
      }
      return issues;
    },
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
      await completeIfFinished();
      return w;
    },
    check: (_b, after, w) => [...sessionLandsOnToday(after, w as CompletedWorkout), ...endedWhenFinished(after)],
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
      // finalizeComplete: after the custom workout is made the program's own.
      await completeIfFinished();
      return w;
    },
    check: (_b, after, w) => [...sessionLandsOnToday(after, w as CompletedWorkout), ...endedWhenFinished(after)],
  },
  {
    label: "Workout tab: Delete & Redo today's workout",
    enabled: s => !!workoutTab(s).completed,
    // The program a deleted last session ended is picked back up: afterDeleting
    // holds every program to exactly that.
    changes: { history: true, otherPrograms: true },
    run: async s => {
      const target = workoutTab(s).completed!;
      await deleteWorkout(target);
      return target;
    },
    check: (b, a, target) => afterDeleting(b, a, target as CompletedWorkout),
  },
  {
    label: "Workout tab: log today's workout, then Delete & Redo",
    enabled: s => { const w = workoutTab(s); return !w.completed && !!w.shows; },
    changes: { history: true },
    run: async s => deleteWorkout(await logToday(s, workoutTab(s).shows!)),
    check: backAsItWas,
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

/** A new length on the program being run moves its end and nothing it has
 *  done: the week it's in, today's workout and every session's dot stay, and
 *  it's never shorter than the week it's in. */
function lengthChanged(before: Snap, after: Snap): string[] {
  const was = activeOf(before)!;
  const now = activeOf(after);
  if (!now || now.id !== was.id) return [`changing ${was.name}'s length took it out of the active slot`];
  const issues: string[] = [];
  if (now.totalWeeks < minTotalWeeks(was)) issues.push(`${now.name} went to ${now.totalWeeks} weeks, shorter than week ${minTotalWeeks(was)} it's in`);
  // The week the run has reached, which changing its length never moves. Read
  // past the cap: past its plan's last day (a move with no rest day to take
  // it, a Set Workout Date there, or 1am the day after) it shows its last
  // week, and made longer, the week it has really reached.
  const reached = (p: SavedProgram) => getCurrentWeek({ ...p, totalWeeks: Number.MAX_SAFE_INTEGER });
  if (reached(now) !== reached(was)) issues.push(`changing its length moved the week from ${reached(was)} to ${reached(now)}`);
  const [shownBefore, shownAfter] = [workoutTab(before).shows, workoutTab(after).shows];
  if (!workoutTab(after).completed && !sameDay(shownBefore, shownAfter)) issues.push(`changing its length changed today from ${say(shownBefore)} to ${say(shownAfter)}`);
  const [was_, now_] = [cards(before), cards(after)];
  for (const w of after.history) {
    if (now_.numberById[w.id] !== was_.numberById[w.id]) {
      issues.push(`changing its length moved ${w.workoutName} on ${w.date} from dot ${was_.numberById[w.id]} to ${now_.numberById[w.id]}`);
    }
  }
  return issues;
}

/** A finished program carried on: the active program again, two weeks longer,
 *  every session where it was, and the days since it ended not read as
 *  missed on its page (they're held). */
function carriedOn(before: Snap, after: Snap, id: string): string[] {
  const was = programOf(before, id)!;
  const now = programOf(after, id)!;
  const issues: string[] = [];
  if (now.status !== "active" || activeOf(after)?.id !== id) issues.push(`${now.name} wasn't carried on: it's ${now.status}`);
  if (now.totalWeeks !== was.totalWeeks + 2) issues.push(`${now.name} is ${now.totalWeeks} weeks, not the ${was.totalWeeks + 2} asked for`);
  if (runFinishedOn(now, after.history, after.today)) issues.push(`carried on two weeks longer, ${now.name} has already finished`);
  const [was_, now_] = [cards(before), cards(after)];
  for (const w of after.history.filter(x => x.programId === id)) {
    if (now_.numberById[w.id] !== was_.numberById[w.id]) {
      issues.push(`carrying it on moved ${w.workoutName} on ${w.date} from dot ${was_.numberById[w.id]} to ${now_.numberById[w.id]}`);
    }
  }
  // It ended on the day it was completed, or with a session of its own after.
  const done = parseStoredDate(was.completedDate);
  const ended = after.history
    .filter(w => w.programId === id)
    .reduce((m, w) => (w.date > m ? w.date : m), done ? toYMD(done) : after.today);
  const missed = buildProgramHistory(now, after.history, after.today).weeks
    .flatMap(w => w.days)
    .filter(d => d.ymd > ended && d.ymd < after.today && d.state === "missed");
  if (missed.length > 0) issues.push(`carried on, ${missed.map(d => d.ymd).join(", ")} read as missed: the days after it ended`);
  // Finished while held, it carries on where the hold began, in the week it
  // was in on that day: the days held aren't its own.
  const doneOn = done ? toYMD(done) : null;
  const heldThrough = doneOn && ended === doneOn ? was.holds?.find(h => h.from < h.to && h.from <= doneOn && doneOn < h.to) : undefined;
  if (heldThrough) {
    const ran: SavedProgram = { ...was, status: "active", completedDate: undefined, holds: was.holds?.filter(h => h.to <= heldThrough.from) };
    const heldIn = getCurrentWeek(ran, new Date(`${heldThrough.from}T12:00:00`));
    if (getCurrentWeek(now) !== heldIn) issues.push(`finished while held from ${heldThrough.from}, in week ${heldIn}, it carried on in week ${getCurrentWeek(now)}`);
  }
  return issues;
}

/** My Programs' Make Active Program with `start` picked (makeActive): the one
 *  running replaced today, today's pick gone with it. */
async function makeActiveFrom(pid: string, start: string): Promise<string> {
  const { programs } = activateProgram(await readPrograms(), pid, todayStored(), await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []), storedStart(start));
  await writePrograms(programs);
  await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
  return start;
}

/** The active program, as My Programs offers it: none once its run has run
 *  out (its last day gone by, or its last session done), since opening the
 *  page ends it (completeIfFinished) before any of its actions are there. */
const offered = (s: Snap): SavedProgram | null => {
  const active = activeOf(s);
  return active && !runFinishedOn(active, s.history, s.today) ? active : null;
};

/** The start step's coming Monday: tomorrow on a Sunday. */
const comingMonday = (s: Snap) =>
  startOptions(s.calendarDay, s.history).find(o => o.key === "monday")?.ymd ?? addDaysYMD(s.calendarDay, 1);

const programSteps: Step[] = [
  // Make Active Program, starting on the first day its start step offers
  // (utils/programStart.ts): today, or tomorrow once a workout's logged today.
  ...[A, B].map((pid): Step => ({
    label: `My Programs: make ${NAMES[pid]} active`,
    enabled: s => { const p = programOf(s, pid); return !!p && p.status !== "active" && !p.archivedAt; },
    changes: { otherPrograms: true },
    run: async s => makeActiveFrom(pid, earliestStart(s.calendarDay, s.history)),
    check: (before, after, start) => {
      const issues = startsAsPicked(before, after, pid, start as string);
      const p = programOf(after, pid)!;
      const first = dayOf(getWorkoutForDate(p, after.calendarDay));
      const expected = p.cyclePattern[0] === "Rest" ? null : { name: p.cyclePattern[0], dayId: dayIdAt(p, 0), programId: p.id };
      if (start === after.calendarDay && after.today === after.calendarDay && !workoutTab(after).completed && !sameDay(first, expected)) {
        issues.push(`a fresh run starts on day 1 (${say(expected)}); today shows ${say(first)}`);
      }
      return issues;
    },
  })),
  // Its start put off to the coming Monday (user request, 2026-11-16: "the
  // coming monday or week after monday etc."), the days until then rest.
  ...[A, B].map((pid): Step => ({
    label: `My Programs: make ${NAMES[pid]} active from the coming Monday`,
    enabled: s => { const p = programOf(s, pid); return !!p && p.status !== "active" && !p.archivedAt; },
    changes: { otherPrograms: true },
    run: async s => makeActiveFrom(pid, comingMonday(s)),
    check: (before, after, start) => startsAsPicked(before, after, pid, start as string),
  })),
  {
    // Change Start Date, before it's begun: the Monday after.
    label: "My Programs: change the active program's start to the Monday after",
    enabled: s => !!startsLater(activeOf(s), s.calendarDay),
    run: async s => {
      const active = activeOf(s)!;
      const to = startOptions(s.calendarDay, s.history).find(o => o.key === "mondayAfter")!.ymd;
      await writePrograms((await readPrograms()).map(p => (p.id === active.id ? normalizeDriftDates(withStartDate(p, to)) : p)));
      return { id: active.id, to };
    },
    check: (before, after, result) => {
      const { id, to } = result as { id: string; to: string };
      return startsAsPicked(before, after, id, to);
    },
  },
  {
    label: "My Programs: make the active program inactive",
    enabled: s => !!offered(s),
    run: async s => {
      await writePrograms(deactivateProgram(await readPrograms(), activeOf(s)!.id, await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, [])));
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
    },
  },
  {
    label: "My Programs: mark the active program complete",
    // Not offered before the day it's set to start (utils/programStart.ts).
    enabled: s => !!offered(s) && !startsLater(activeOf(s), s.calendarDay),
    run: async s => {
      await writePrograms(completeProgram(await readPrograms(), activeOf(s)!.id, todayStored()).programs);
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
    },
  },
  {
    label: "My Programs: pause the active program",
    enabled: s => !!offered(s) && !activeOf(s)!.pausedAt && !startsLater(activeOf(s), s.calendarDay),
    run: async s => {
      // handlePauseProgram: held from the day the Workout tab is on.
      const active = activeOf(s)!;
      await writePrograms(pauseProgram(await readPrograms(), active.id, getEffectiveToday(active, s.history), s.history));
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
      // The app opening again straight after must leave it running: a resume
      // the same day as the week-idle auto-pause left nothing to count from,
      // and it held itself again every time the app opened (user report,
      // 2026-10-13).
      if (idleDays(now, after.history.map(w => w.date)) >= AUTO_PAUSE_AFTER_DAYS) {
        issues.push(`resumed, it would hold itself again the next time the app opened (${idleDays(now, after.history.map(w => w.date))} idle days)`);
      }
      // The weeks didn't count during the hold, so it picks up in the week the
      // hold began in, on the program's timeline as it is now (a session logged
      // from the Journal meanwhile can have moved its start back).
      // A hold from tomorrow (after today's workout, holdStartsOn) resumed
      // today never began: it carries on from today.
      const heldFrom = was.pausedAt! > before.today ? before.today : was.pausedAt!;
      const [y, m, d] = heldFrom.split("-").map(Number);
      const heldIn = getCurrentWeek({ ...was, pausedAt: undefined }, new Date(y, m - 1, d));
      if (getCurrentWeek(now) !== heldIn) issues.push(`resuming put it in week ${getCurrentWeek(now)}; the hold began in week ${heldIn}`);
      return issues;
    },
  })),
  // Set Workout Date: "today is day N" on the active program.
  ...[0, 1, 2].map((index): Step => ({
    label: `My Programs: Set Workout Date, today is day ${index + 1}`,
    enabled: s => {
      const active = offered(s);
      return !!active && !active.pausedAt && !startsLater(active, s.calendarDay) && !!active.cyclePattern[index] && active.cyclePattern[index] !== "Rest";
    },
    run: async s => {
      const active = activeOf(s)!;
      const today = getEffectiveToday(active, s.history);
      const realigned = setWorkoutDay(active, index, today);
      if (!realigned) return null;
      await writePrograms((await readPrograms()).map(p => (p.id === active.id ? realigned : p)));
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
      return realigned;
    },
    check: (before, after, realigned) => {
      if (!realigned) return [];
      const was = activeOf(before)!;
      const active = activeOf(after)!;
      const issues: string[] = [];
      const want = { name: active.cyclePattern[index], dayId: dayIdAt(active, index), programId: active.id };
      const shown = workoutTab(after).shows;
      if (!workoutTab(after).completed && !sameDay(shown, want)) issues.push(`set today to ${say(want)}; the Workout tab shows ${say(shown)}`);
      // A reset from today: no move from today on survives; the ones before
      // stay, and every day before today reads as it did (user priority,
      // 2026-11-16: nothing done should change the history).
      const today = getEffectiveToday(was, before.history);
      const later = [...(active.pushedDates ?? []), ...(active.pulledDates ?? [])].filter(d => d >= today);
      if (later.length) issues.push(`moves from today on survived the reset: ${JSON.stringify(later)}`);
      // Back on plan: it finishes on the plan's last day, or today when the
      // moves before had carried the run past that (programFinishDate).
      const start = parseStoredDate(active.startDate);
      const planned = start ? addDaysYMD(toYMD(start), active.totalWeeks * 7 - 1) : null;
      const onPlan = planned && planned < today ? today : planned;
      if (finishOf(active) !== onPlan) issues.push(`setting today's day finishes it on ${finishOf(active)}, not back on plan on ${onPlan}`);
      const from = addDaysYMD(today, -21);
      const diff = firstDifference(planWindow(was, from, 21), planWindow(active, from, 21));
      if (diff) issues.push(`setting today's day re-labelled a day before it: ${diff}`);
      return issues;
    },
  })),
  {
    // The builder's Update on the program being run (new-program.tsx doUpdate):
    // the mid-run edit that re-dates the cycle under any moves, here its last
    // day turned into a workout, or back into a rest day.
    label: "Program builder: edit the active program, its last day a workout (or a rest day again)",
    // From My Programs, which ends a run that has run out as it opens.
    enabled: s => !!offered(s),
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
  // The builder's TOTAL WEEKS on the program being run (user request,
  // 2026-11-05: extend or shorten it mid-run or at its end): saved as doUpdate
  // saves it, never shorter than the week it's in (withTotalWeeks).
  ...[1, -1].map((delta): Step => ({
    label: `Program builder: the active program a week ${delta > 0 ? "longer" : "shorter"}`,
    enabled: s => !!offered(s),
    run: async s => {
      const active = activeOf(s)!;
      await writePrograms((await readPrograms()).map(p => (p.id === active.id
        ? marksAfterEdit(p, withTotalWeeks(p, p.totalWeeks + delta))
        : p)));
    },
    check: lengthChanged,
  })),
  {
    // More weeks on a finished program carries it on (user decision,
    // 2026-11-05): the builder's Carry On (confirmCarryOn), two weeks longer.
    label: "Program builder: a finished program two weeks longer, carried on",
    enabled: s => s.programs.some(p => p.status === "completed" && !p.archivedAt),
    changes: { otherPrograms: true },
    run: async s => {
      const target = s.programs.find(p => p.status === "completed" && !p.archivedAt)!;
      const programs = (await readPrograms()).map(p => (p.id === target.id ? marksAfterEdit(p, { ...p, totalWeeks: p.totalWeeks + 2 }) : p));
      const { programs: carried } = carryOnProgram(programs, target.id, await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []), toYMD(new Date()));
      await writePrograms(carried);
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
      return target.id;
    },
    check: (before, after, id) => carriedOn(before, after, id as string),
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
    check: (_b, a) => endedWhenFinished(a),
  },
  {
    // Log Workout's Superset With (utils/logWorkout.ts; user request,
    // 2026-11-15): yesterday's planned day opened as the page opens it, its
    // first two exercises paired on the first one's card, the sets typed in,
    // and saved. The session keeps the superset; the program's days don't get
    // it (it's the log's alone, like a swap).
    label: "Journal: log yesterday's planned workout, its first two exercises supersetted",
    enabled: s => {
      const active = activeOf(s);
      const y = addDaysYMD(s.today, -1);
      const planned = active ? getWorkoutForDate(active, y) : null;
      return !!planned && planned.exercises.length >= 2 && !s.history.some(w => w.date === y);
    },
    changes: { history: true },
    run: async s => {
      const active = activeOf(s)!;
      const y = addDaysYMD(s.today, -1);
      const planned = getWorkoutForDate(active, y)!;
      const days = JSON.stringify(active.workouts);
      const opened = joinSuperset(logExercisesFor(planned.exercises), 0, 1);
      const typed = opened.map(e => ({ ...e, sets: e.sets.map(x => ({ ...x, weight: "60", reps: "8", done: true })) }));
      const w = await logFromJournal(y, { name: planned.name, programId: active.id, dayId: planned.dayId }, loggedExercises(typed, true));
      return { w, programId: active.id, days };
    },
    check: (_b, after, result) => {
      const { w, programId, days } = result as { w: CompletedWorkout; programId: string; days: string };
      const issues = endedWhenFinished(after);
      const saved = after.history.find(x => x.id === w.id);
      if (JSON.stringify(supersetRuns(saved?.exercises ?? [])) !== "[[0,1]]") {
        issues.push(`the Journal's log saved its superset as ${JSON.stringify(saved?.exercises.map(e => e.supersetId ?? null))}`);
      }
      const program = after.programs.find(p => p.id === programId);
      if (program && JSON.stringify(program.workouts) !== days) issues.push("a superset made in Log Workout changed the program's days");
      return issues;
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
    check: (b, a) => {
      const issues = endedWhenFinished(a);
      // Set to start later, it keeps the start it was given
      // (programsAfterPastLog): moved back, it had run its length by today.
      const was = activeOf(b)!;
      const now = programOf(a, was.id);
      const starts = startsLater(was, b.calendarDay);
      if (starts && now && runStartYMD(now) !== starts) issues.push(`${was.name}, set to start ${starts}, now starts ${runStartYMD(now)}`);
      return issues;
    },
  },
  {
    label: "Journal: log yesterday's planned workout, then delete it",
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
      await deleteWorkout(await logFromJournal(y, { name: planned.name, programId: active.id, dayId: planned.dayId }));
    },
    check: backAsItWas,
  },
  // workout-detail's Delete, from the Journal's list.
  ...([["newest", newestOf], ["oldest", oldestOf]] as const).map(([which, pick]): Step => ({
    label: `Journal: delete the ${which} workout`,
    enabled: s => !!pick(s),
    // As Delete & Redo: afterDeleting holds the programs to the one picked back up.
    changes: { history: true, otherPrograms: true },
    run: async s => {
      const target = pick(s)!;
      await deleteWorkout(target);
      return target;
    },
    check: (b, a, target) => afterDeleting(b, a, target as CompletedWorkout),
  })),
];

// Settings > Import & Export: another app's history in, and taken back out.

const HEVY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Hevy's export of a morning session on each of `dates` ("YYYY-MM-DD"). */
function hevyExport(dates: string[]): string {
  const rows = [`"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"`];
  for (const date of dates) {
    const [y, m, d] = date.split("-").map(Number);
    const day = `${d} ${HEVY_MONTHS[m - 1]} ${y}`;
    for (const [i, kg] of [60, 80, 80].entries()) {
      rows.push(`"Push","${day}, 07:00","${day}, 07:50","","Bench Press (Barbell)",,"",${i},"${i === 0 ? "warmup" : "normal"}",${kg},8,,0,`);
    }
  }
  return rows.join("\n");
}

/** Import & Export's Choose CSV File, the review's matches as they come, and
 *  Import (app/import-export.tsx, app/import-review.tsx): what the import added. */
async function importFromHevy(s: Snap, dates: string[]): Promise<CompletedWorkout[]> {
  const read = readWorkoutCsv(hevyExport(dates));
  if (!read.ok) throw new Error(`harness: the Hevy file didn't read: ${read.error}`);
  const choices: Record<string, ExerciseChoice> = {};
  for (const w of read.data.workouts) {
    for (const e of w.exercises) {
      const m = matchExerciseName(e.name);
      choices[e.name] = m.kind === "none" ? null : { name: m.name };
    }
  }
  const plan = planImport(read.data, { weightUnit: "kg", choices, history: s.history });
  await saveImport(plan.workouts, "hevy");
  return plan.workouts;
}

/** Days off Hevy for an import: today, yesterday and ten days ago. */
const importDays = (s: Snap) => [s.today, addDaysYMD(s.today, -1), addDaysYMD(s.today, -10)];

/** An import added a session on each day it had that Avenas hadn't logged,
 *  left every logged day as it was, and is on record to undo. */
function afterImporting(before: Snap, after: Snap, added: CompletedWorkout[]): string[] {
  const issues: string[] = [];
  const free = importDays(before).filter(d => !before.history.some(w => w.date === d));
  const addedDays = added.map(w => w.date).sort();
  if (JSON.stringify(addedDays) !== JSON.stringify([...free].sort())) issues.push(`the import added sessions on ${addedDays.join(", ") || "no day"}, not on the days with nothing logged: ${free.join(", ") || "none"}`);
  for (const w of before.history) {
    if (!after.history.some(x => JSON.stringify(x) === JSON.stringify(w))) issues.push(`the import changed or took out ${w.workoutName} on ${w.date}`);
  }
  for (const w of added) {
    if (w.programId !== "" || w.dayId !== undefined) issues.push(`an imported session (${w.date}) was put on a program`);
    if (w.exercises[0]?.name !== "Barbell Bench Press") issues.push(`an imported session's exercise came in as ${w.exercises[0]?.name}`);
  }
  if (after.history.length !== before.history.length + added.length) issues.push(`the history went from ${before.history.length} to ${after.history.length} sessions importing ${added.length}`);
  if (JSON.stringify(before.programs) !== JSON.stringify(after.programs)) issues.push("an import changed a program");
  if (added.length > 0 && after.imports[0]?.workouts.length !== added.length) issues.push("the import isn't on record to undo");
  if (added.length === 0 && after.imports.length !== before.imports.length) issues.push("an import that added nothing was put on record");
  return issues;
}

const importSteps: Step[] = [
  {
    label: "Import & Export: import a Hevy file (today, yesterday, ten days ago)",
    enabled: () => true,
    changes: { history: true },
    run: s => importFromHevy(s, importDays(s)),
    check: (b, a, added) => afterImporting(b, a, added as CompletedWorkout[]),
  },
  {
    label: "Import & Export: undo the last import",
    enabled: s => s.imports.length > 0,
    changes: { history: true },
    run: async s => {
      await undoImport(s.imports[0].at);
      return s.imports[0];
    },
    check: (before, after, record) => {
      const r = record as ImportRecord;
      const issues: string[] = [];
      const key = (w: { date: string; completedAt: string; workoutName: string }) => `${w.date}|${w.completedAt}|${w.workoutName}`;
      const imported = new Set(r.workouts.map(key));
      const kept = before.history.filter(w => !imported.has(key(w)));
      if (JSON.stringify(after.history) !== JSON.stringify(kept)) issues.push("undoing the import didn't take out exactly what it added");
      if (after.imports.some(x => x.at === r.at)) issues.push("the undone import is still on record");
      return issues;
    },
  },
  {
    label: "Import & Export: import a Hevy file, then undo it",
    enabled: () => true,
    changes: { history: true },
    run: async s => {
      const before = await loadImports();
      await importFromHevy(s, importDays(s));
      const after = await loadImports();
      if (after.length > before.length) await undoImport(after[0].at);
    },
    check: backAsItWas,
  },
];

export const STEPS: Step[] = [...clockSteps, ...workoutSteps, ...stripSteps, ...programSteps, ...journalSteps, ...importSteps];

/** Sequences always played out, step by step: the everyday ones worth pinning
 *  whatever the explorer happens to reach. */
export const STORIES: string[][] = [
  // When a program starts (utils/programStart.ts; user request, 2026-11-16).
  // Trained today, then made active: it starts tomorrow, today's workout left
  // as the one it was.
  ["Workout tab: log today's workout", "My Programs: make Push Pull active", "the next day comes (app opened at 10am)",
    "Workout tab: log today's workout"],
  // Set to start the coming Monday: rest till then, day 1 on the day.
  ["My Programs: make Push Pull active from the coming Monday", "the next day comes (app opened at 10am)",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Workout tab: log today's workout"],
  // Put off a week more, and a week away from the app before it: it doesn't
  // hold itself for a week with nothing logged before it began.
  ["My Programs: make Push Pull active from the coming Monday", "My Programs: change the active program's start to the Monday after",
    "a week goes by without opening the app", "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)", "Workout tab: log today's workout"],
  // On hold, a session logged from before the run moves its start back: it's
  // then in the week it had reached by the hold, and can't be made shorter than
  // that (found by the walks, 2026-11-15: it read the week before, and a week
  // shorter put a session it had outside it).
  ["My Programs: pause the active program", "Journal: log day 1 on a date ten days ago",
    "Program builder: the active program a week shorter", "Program builder: the active program a week shorter"],
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
  // Delete it, do it again, delete it again (user request, 2026-10-16): today's
  // from the Workout tab, and yesterday's from the Journal, then the next day.
  ["Workout tab: log today's workout", "Workout tab: Delete & Redo today's workout",
    "Workout tab: log today's workout", "Workout tab: Delete & Redo today's workout",
    "Workout tab: log today's workout", "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Workout tab: log today's workout"],
  ["Journal: log yesterday's planned workout", "Journal: delete the newest workout",
    "Journal: log yesterday's planned workout", "Journal: delete the newest workout",
    "Journal: log yesterday's planned workout", "Workout tab: log today's workout"],
  // At 1am, last night's session deleted and done again: the app goes back to
  // last night's workout, and on to the new day once it's logged.
  ["past midnight: 1am, still up", "Workout tab: log today's workout", "Journal: delete the newest workout",
    "Workout tab: log today's workout", "Journal: delete the newest workout", "Workout tab: log today's workout"],
  // On hold, and made inactive, with its last session deleted and done again.
  ["Workout tab: log today's workout", "My Programs: pause the active program", "Journal: delete the newest workout",
    "My Programs: resume, carrying on where I left off", "Workout tab: log today's workout"],
  ["Workout tab: log today's workout", "My Programs: make the active program inactive", "Journal: delete the newest workout",
    "Journal: delete the oldest workout", "My Programs: make Strength active", "Workout tab: log today's workout",
    "Workout tab: Delete & Redo today's workout", "Workout tab: log today's workout"],
  // Moving over from Hevy (user request, 2026-10-23): today and yesterday
  // came in from the file, the next workout (Saturday's Upper, past Friday's
  // rest) is logged in Avenas, and the import is undone, which leaves that one
  // alone.
  ["Import & Export: import a Hevy file (today, yesterday, ten days ago)", "the next day comes (app opened at 10am)",
    "the next day comes (app opened at 10am)", "Workout tab: log today's workout", "Import & Export: undo the last import",
    "Workout tab: Delete & Redo today's workout"],
  // A session logged today first: the import leaves today alone, and the
  // same file again adds nothing.
  ["Workout tab: log today's workout", "Import & Export: import a Hevy file (today, yesterday, ten days ago)",
    "Import & Export: import a Hevy file (today, yesterday, ten days ago)", "Import & Export: undo the last import"],
  // A program's length and its end (user request, 2026-11-05). Strength made
  // a week long (it's in week 1) ends on Saturday 3 October, its Upper the
  // last workout: it ends once that's done, Delete & Redo picks it back up,
  // done again it ends again, and two more weeks carry it on from there.
  ["Program builder: the active program a week shorter", "Program builder: the active program a week shorter",
    "Workout tab: log today's workout", "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Workout tab: log today's workout", "Workout tab: Delete & Redo today's workout", "Workout tab: log today's workout",
    "the next day comes (app opened at 10am)", "Program builder: a finished program two weeks longer, carried on",
    "Workout tab: log today's workout"],
  // Its last workout missed: it ends on its last day, once that's gone by,
  // and carried on a few days later, those days don't read as missed.
  ["Program builder: the active program a week shorter", "Program builder: the active program a week shorter",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Program builder: a finished program two weeks longer, carried on", "Workout tab: log today's workout"],
  // A week more on its last day: it runs on, and the last workout isn't last.
  ["Program builder: the active program a week shorter", "Program builder: the active program a week shorter",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Program builder: the active program a week longer", "Workout tab: log today's workout", "the next day comes (app opened at 10am)"],
  // The last workout done after midnight still ends it, on its own day.
  ["Program builder: the active program a week shorter", "Program builder: the active program a week shorter",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)", "past midnight: 1am, still up",
    "Workout tab: log today's workout", "the next day comes (app opened at 10am)"],
  // The last workout moved on a day: the program ends a day later, there.
  ["Program builder: the active program a week shorter", "Program builder: the active program a week shorter",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)", "Workout tab: log today's workout"],

  // Nothing done changes what's logged or how the days gone by read (user
  // priority, 2026-11-16). Each of these found by the walks and fixed.
  // Set Workout Date on the day the last workout was moved to, past the
  // plan's last day: it runs to that day (it ended the day before, the day
  // just set gone from the Workout tab).
  ["Program builder: the active program a week shorter", "Program builder: the active program a week shorter",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)",
    "My Programs: Set Workout Date, today is day 2", "Workout tab: log today's workout"],
  // Set Workout Date after a move, and at 1am: the days before read as they
  // did (it re-labelled them, a rest day a missed workout).
  ["Workout tab: change today to Rest, Move to Tomorrow", "the next day comes (app opened at 10am)",
    "the next day comes (app opened at 10am)", "My Programs: Set Workout Date, today is day 1", "Workout tab: log today's workout"],
  ["past midnight: 1am, still up", "My Programs: Set Workout Date, today is day 2", "Workout tab: log today's workout"],
  // Held after training today: the hold starts tomorrow, today's workout
  // stays today's (it was held from today, the session on a held day).
  ["Workout tab: log today's workout", "My Programs: pause the active program", "the next day comes (app opened at 10am)",
    "the next day comes (app opened at 10am)", "My Programs: resume, picking up today", "Workout tab: log today's workout"],
  ["Workout tab: log today's workout", "My Programs: pause the active program", "My Programs: resume, carrying on where I left off",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)", "Workout tab: log today's workout"],
  // Finished while held, then carried on the same day: the held days stay
  // held (they read as workouts missed), and today isn't held.
  ["My Programs: pause the active program", "the next day comes (app opened at 10am)",
    "My Programs: mark the active program complete", "Program builder: a finished program two weeks longer, carried on",
    "Workout tab: log today's workout"],
  // Held nine days, then finished, then carried on: back in the week it was
  // held in (it came back a week on, the days held counted as its own).
  ["My Programs: pause the active program", "a week goes by without opening the app", "the next day comes (app opened at 10am)",
    "the next day comes (app opened at 10am)", "My Programs: mark the active program complete",
    "Program builder: a finished program two weeks longer, carried on", "Workout tab: log today's workout"],
  // A workout done ahead of its day on the last day: its number stays when
  // the program is carried on (it fell back a number past the run's end).
  ["Program builder: the active program a week shorter", "Program builder: the active program a week shorter",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "Workout tab: change today to Strength's day 2", "Workout tab: log today's workout",
    "Program builder: a finished program two weeks longer, carried on"],
  // Set to start the coming Monday, a session logged ten days ago keeps that
  // start (it moved it back, and the program had run its length by Monday).
  ["My Programs: make Push Pull active from the coming Monday", "Journal: log day 1 on a date ten days ago",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)",
    "the next day comes (app opened at 10am)", "the next day comes (app opened at 10am)", "Workout tab: log today's workout"],
  // Started again, then a session of its earlier run logged: that run's, the
  // run under way keeps its start (moved back over it, the two shared days).
  ["Workout tab: log today's workout", "My Programs: make the active program inactive", "My Programs: make Strength active",
    "the next day comes (app opened at 10am)", "Workout tab: log today's workout", "Journal: log day 1 on a date ten days ago"],
  // Finished and started again the same day: today is the new run's alone.
  ["My Programs: mark the active program complete", "My Programs: make Strength active", "Workout tab: log today's workout"],
  // Set to start the coming Monday, let go, then started today: the run
  // before ends before today (it ran on to Sunday, into the new one).
  ["My Programs: make the active program inactive", "My Programs: make Strength active from the coming Monday",
    "My Programs: make the active program inactive", "My Programs: make Strength active", "Workout tab: log today's workout"],
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
    // A program's runs follow one another, never sharing a day: a session on
    // one was counted in both, its number in each (utils/programRuns.ts).
    const runStarts = [...(p.runs ?? []).map(r => runStartYMD(programAsRun(p, r))), p.status === "created" ? null : runStartYMD(p)];
    (p.runs ?? []).forEach((r, i) => {
      const next = runStarts[i + 1];
      if (next && r.endDate >= next) issues.push(`${p.name}'s run ${i + 1} ends ${r.endDate}, on or after its next run began on ${next}`);
    });
    // A shelved or finished run never reads past its length ("Week 6 of 4",
    // "Completed 8 of 6 weeks"): it can't be made shorter than it got to.
    if ((p.status === "paused" || p.status === "completed") && p.currentWeek > p.totalWeeks) {
      issues.push(`${p.name} reads week ${p.currentWeek} of ${p.totalWeeks}`);
    }
  }

  // The dates the calendars, reminders and the week-idle hold read are the
  // dates something is logged on: a delete takes its date only when it was the
  // day's last session, and a redo puts it back once.
  const logged = [...new Set(s.history.map(w => w.date))].sort();
  const dates = [...s.dates].sort();
  if (JSON.stringify(dates) !== JSON.stringify(logged)) {
    issues.push(`the saved workout dates ${JSON.stringify(dates)} aren't the dates logged ${JSON.stringify(logged)}`);
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

  // Set to start later (utils/programStart.ts; user request, 2026-11-16): in
  // no week, and every day still to come before its start a rest day on both
  // calendars (this month's, as Home shows them). And once those days have
  // gone by, still rest, never missed: a day gone by before the active run
  // began, nothing logged on it and no other run's workout planned there.
  const active = activeOf(s);
  if (active && !active.pausedAt) {
    const cal = calendars(s);
    const plan = pastPlanFrom(s.programs, s.history);
    const starts = startsLater(active, s.calendarDay);
    if (starts && getCurrentWeek(active) !== 0) issues.push(`${active.name} starts ${starts} and reads week ${getCurrentWeek(active)}`);
    const runStart = runStartYMD(active);
    const monthStart = `${s.calendarDay.slice(0, 7)}-01`;
    for (let d = addDaysYMD(s.calendarDay, -14); d < addDaysYMD(s.calendarDay, 14); d = addDaysYMD(d, 1)) {
      if (d < monthStart || d.slice(0, 7) !== s.calendarDay.slice(0, 7) || d === s.calendarDay) continue;
      if (!runStart || d >= runStart || s.dates.includes(d)) continue;
      if (d < s.calendarDay && plan(d) === "workout") continue;
      const { home, journal } = cal(d);
      if (home !== "rest" || journal !== "rest") {
        issues.push(`${d}, before ${active.name} began on ${runStart} and with nothing logged, shows as ${home} on Home's calendar and ${journal} on the Journal's, not rest`);
      }
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
  // What's logged is a snapshot (CLAUDE.md): a step adds a session or takes
  // one away, and never rewrites one it leaves.
  const was = new Map(before.history.map(w => [w.id, JSON.stringify(w)]));
  for (const w of after.history) {
    const prior = was.get(w.id);
    if (prior !== undefined && prior !== JSON.stringify(w)) issues.push(`it rewrote ${w.workoutName} on ${w.date} (${w.id})`);
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
