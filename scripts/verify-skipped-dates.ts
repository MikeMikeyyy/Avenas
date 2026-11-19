// Marking a date as rest, and the two things a user might mean by it.
//
// The point of the design is that ONE check in resolveDayIndex makes a skipped
// date disappear from every scheduling surface, so most of this suite is about
// proving that reach: the workout resolver, the streak, and the cycle-push maths.
//
// Run:  npx tsx scripts/verify-skipped-dates.ts
// Exits non-zero (throws) if any assertion fails.

import {
  clearShifts,
  isDatePulled,
  isDatePushed,
  isDateSkipped,
  marksAfterEdit,
  marksAfterHold,
  pickAfterMove,
  pickAfterUndoMove,
  planDoItTomorrow,
  pullDate,
  pushDate,
  skipDate,
  toggleSkippedDate,
  unskipDate,
  isSettledMove,
} from "../utils/skippedDates";
import { cycleDrift } from "../utils/cycleDrift";
import { addDaysYMD, formatStoredDate, parseStoredDate, toYMD } from "../utils/dates";
import { heldOn, idleDays, programAsOf, runStartYMD } from "../utils/programHolds";
import { activateProgram, completeProgram, deactivateProgram, minTotalWeeks, programsAfterPastLog, setWorkoutDay } from "../utils/programLifecycle";
import { getEffectiveToday, getWorkoutForDate, resolveDayIndex, resolveWorkoutForDate, cycleIndexForDate, normalizeDriftDates } from "../utils/workout";
import { sessionCountForDay, workoutMatchesDay } from "../utils/progressStats";
import { markDayRefLabels, programDays } from "../utils/programDays";
import { getCurrentWeek, programFinishDate } from "../constants/programs";
import type { CompletedWorkout } from "../constants/programs";
import { isStreakRiskDay, streakSurvives } from "../utils/streak";
import { programFromRow, programToRow } from "../lib/mappers";
import type { ProgramRow } from "../lib/database.types";
import type { SavedProgram } from "../constants/programs";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

// ─── fixture ─────────────────────────────────────────────────────────────────
// Starts Mon 07 Sep 2026. Cycle: Upper, Lower, Rest, Upper, Lower, Rest.
const base: SavedProgram = {
  id: "P", name: "UL", totalWeeks: 8, currentWeek: 1, status: "active",
  startDate: "07 Sep 2026", trainingDays: 4, cycleDays: 6,
  cyclePattern: ["Upper", "Lower", "Rest", "Upper", "Lower", "Rest"],
  dayIds: ["d0", "d1", "d2", "d3", "d4", "d5"],
  workouts: {},
};

const MON = "2026-09-07", TUE = "2026-09-08", WED = "2026-09-09";
const THU = "2026-09-10", FRI = "2026-09-11";

/** `ymd` plus n days, as "YYYY-MM-DD". */
const plus = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`;
};
/** Sessions scheduled over `n` days from MON — a COUNT, so an off-by-one can't
 *  hide behind a repeated day name. */
const sessionCount = (p: SavedProgram, n = 60): number => {
  let c = 0;
  for (let i = 0; i < n; i++) if (getWorkoutForDate(p, plus(MON, i)) !== null) c += 1;
  return c;
};
const schedule = (p: SavedProgram, from: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => getWorkoutForDate(p, plus(from, i))?.name ?? "Rest");

// Baseline: the cycle as written.
eq(getWorkoutForDate(base, MON)?.name, "Upper", "baseline: Monday is Upper");
eq(getWorkoutForDate(base, TUE)?.name, "Lower", "baseline: Tuesday is Lower");
eq(getWorkoutForDate(base, WED), null, "baseline: Wednesday is Rest");
eq(getWorkoutForDate(base, THU)?.name, "Upper", "baseline: Thursday is Upper");

// ─── the list ────────────────────────────────────────────────────────────────

eq(isDateSkipped(base, TUE), false, "nothing skipped to start");
eq(skipDate(base, TUE).skippedDates, [TUE], "skipDate adds the date");
eq(isDateSkipped(skipDate(base, TUE), TUE), true, "skipped date reads back");
eq(skipDate(skipDate(base, TUE), TUE).skippedDates, [TUE], "skipDate is idempotent");
eq(skipDate(skipDate(base, THU), TUE).skippedDates, [TUE, THU], "list is kept sorted");
eq(unskipDate(skipDate(base, TUE), TUE).skippedDates, undefined, "unskipping the last one clears the field");
eq(unskipDate(base, TUE) === base, true, "unskipping a date that wasn't skipped returns the same object");
eq(toggleSkippedDate(base, TUE).skippedDates, [TUE], "toggle on");
eq(toggleSkippedDate(toggleSkippedDate(base, TUE), TUE).skippedDates, undefined, "toggle off");
// Never mutates its input — callers hold the program in state.
{
  const before = JSON.stringify(base);
  skipDate(base, TUE); unskipDate(base, TUE); pushDate(base, TUE);
  eq(JSON.stringify(base), before, "helpers never mutate the program they're given");
}

// ─── SKIP: the date empties, the cycle does not move ─────────────────────────
{
  const sick = skipDate(base, TUE);
  eq(getWorkoutForDate(sick, TUE), null, "skip: Tuesday now schedules nothing");
  eq(resolveDayIndex(sick, TUE), null, "skip: resolveDayIndex reports no day");
  eq(getWorkoutForDate(sick, WED), null, "skip: Wednesday was already Rest");
  eq(getWorkoutForDate(sick, THU)?.name, "Upper", "skip: Thursday is UNCHANGED — the cycle held its place");
  eq(getWorkoutForDate(sick, MON)?.name, "Upper", "skip: earlier days untouched");
  // The raw cycle maths is deliberately NOT skip-aware: the dayId backfill asks
  // which slot an already-logged session fell on, and marking the date off
  // afterwards must not erase that.
  eq(cycleIndexForDate(sick, TUE), 1, "skip: cycleIndexForDate still reports the underlying slot");
}

// ─── PUSH: everything AFTER slides; everything before is untouched ───────────
{
  const pushed = pushDate(base, TUE);
  eq(isDateSkipped(pushed, TUE), true, "push: the date is also skipped");
  eq(isDatePushed(pushed, TUE), true, "push: ...and recorded as a push");
  eq(pushed.cycleOffset, undefined, "push: cycleOffset is NOT touched — a push is anchored to its date");

  // The regression this design exists for. A cycleOffset nudge re-labelled
  // days before the push, so Monday's Upper turned into something else and a
  // completed workout vanished from the week.
  eq(getWorkoutForDate(pushed, MON)?.name, "Upper", "push: MONDAY IS UNCHANGED — the past never moves");
  eq(getWorkoutForDate(pushed, TUE), null, "push: Tuesday is rest");
  eq(getWorkoutForDate(pushed, WED)?.name, "Lower", "push: Tuesday's Lower lands on Wednesday");
  eq(getWorkoutForDate(pushed, THU), null, "push: Wednesday's Rest moves to Thursday");
  eq(getWorkoutForDate(pushed, FRI)?.name, "Upper", "push: and everything after follows");
  eq(getWorkoutForDate(pushed, "2026-09-15")?.name, "Lower", "push: still shifted a full cycle later");

  // No workout is lost: the same set of sessions appears, one day later.
  const names = (p: SavedProgram, days: string[]) => days.map(d => getWorkoutForDate(p, d)?.name ?? "Rest");
  const week = [MON, TUE, WED, THU, FRI, "2026-09-12", "2026-09-13"];
  eq(names(base, week), ["Upper", "Lower", "Rest", "Upper", "Lower", "Rest", "Upper"], "baseline week");
  eq(names(pushed, week), ["Upper", "Rest", "Lower", "Rest", "Upper", "Lower", "Rest"], "push: nothing deleted, everything from Tue slid one day");

  eq(cycleDrift(pushed, MON), 0, "drift: none before the push itself");
  eq(cycleDrift(pushed, TUE), 0, "drift: strictly before, so a push doesn't delay its own date");
  eq(cycleDrift(pushed, WED), 1, "drift: counts from the day after");
}

// ─── two pushes stack, and each can be undone independently ─────────────────
{
  const twice = pushDate(pushDate(base, TUE), THU);
  eq(twice.pushedDates, [TUE, THU], "two pushes are both recorded, sorted");
  eq(cycleDrift(twice, FRI), 2, "two earlier pushes delay by two days");
  eq(getWorkoutForDate(twice, MON)?.name, "Upper", "two pushes: the past is still untouched");
  // Undo the later one: the earlier push's effect must survive intact.
  const undoneThu = unskipDate(twice, THU);
  eq(undoneThu.pushedDates, [TUE], "undo removes only that date's push");
  eq(getWorkoutForDate(undoneThu, WED)?.name, "Lower", "undo: the other push still applies");
}

// ─── UNDO: removing the date restores the original alignment exactly ────────
{
  const pushed = pushDate(base, TUE);
  const undone = unskipDate(pushed, TUE);
  eq(undone.skippedDates, undefined, "undo: no longer skipped");
  eq(undone.pushedDates, undefined, "undo: no longer pushing");
  const week = [MON, TUE, WED, THU, FRI];
  const namesOf = (p: SavedProgram) => week.map(d => getWorkoutForDate(p, d)?.name ?? "Rest");
  eq(namesOf(undone), namesOf(base), "undo: the whole week is byte-identical to before the push");
  // A plain skip undoes the same way.
  eq(namesOf(unskipDate(skipDate(base, TUE), TUE)), namesOf(base), "undo: a plain skip restores too");
}

// ─── the streak: resting on purpose must not cost anything ───────────────────
{
  const sick = skipDate(base, TUE);
  eq(isStreakRiskDay(base, TUE), true, "streak: Tuesday is normally a day you could lose the streak on");
  eq(isStreakRiskDay(sick, TUE), false, "streak: once marked as rest it can't cost the streak");
  // Open Monday, next open Friday. In between: Tue (Lower), Wed (Rest),
  // Thu (Upper) — two workout days missed, so the streak goes.
  eq(streakSurvives(base, MON, FRI), false, "streak: Tue + Thu missed is two workout days and resets");
  // Mark Tuesday off and the same gap costs only Thursday, which is the one
  // free miss. Being ill and saying so protects the streak; saying nothing
  // does not.
  eq(streakSurvives(sick, MON, FRI), true, "streak: marking Tuesday as rest leaves only one real miss");
}

// ─── a MISSED past day made rest touches that date and nothing else ─────────
// Home's week strip allows this for workouts earlier in the week, so it has to
// hold even with a move already on the schedule: no other date's workout
// changes, no push or pull is re-targeted by the write-side normalisation, and
// putting the day back restores the week exactly. Goes through the same
// normalizeDriftDates the commit in utils/restDay.ts runs.
{
  const moved = planDoItTomorrow(base, MON).program;
  const WINDOW = 42;
  let checked = 0;
  for (let i = 0; i < 14; i++) {
    const day = plus(MON, i);
    if (getWorkoutForDate(moved, day) === null) continue;
    checked += 1;
    const missed = normalizeDriftDates(skipDate(moved, day));
    eq(getWorkoutForDate(missed, day), null, `past skip ${day}: that date is now rest`);
    const others = (p: SavedProgram) =>
      schedule(p, MON, WINDOW).filter((_, k) => plus(MON, k) !== day);
    eq(others(missed), others(moved), `past skip ${day}: every other date is unchanged`);
    eq([missed.pushedDates, missed.pulledDates], [moved.pushedDates, moved.pulledDates], `past skip ${day}: no move is re-targeted`);
    const restored = normalizeDriftDates(unskipDate(missed, day));
    eq(schedule(restored, MON, WINDOW), schedule(moved, MON, WINDOW), `past skip ${day}: putting it back restores the week`);
  }
  eq(checked > 4, true, "past skip: the loop actually exercised several workout days");
}

// ─── "Set Workout Date" must solve against the SAME maths ───────────────────
// It picks a cycleOffset so today resolves to a chosen day. It used to compute
// daysPassed inline, which didn't know about pushes — so on a program with a
// pushed rest day it solved for the wrong index and landed a day out. This is
// the calculation programs.tsx:handleSetWorkoutDay now performs.
{
  const solveOffset = (p: SavedProgram, todayYMD_: string, targetIndex: number): number | null => {
    const natural = cycleIndexForDate({ ...p, cycleOffset: 0 }, todayYMD_);
    if (natural === null) return null;
    const n = p.cycleDays;
    return ((targetIndex - natural) % n + n) % n;
  };
  // Land Thursday on index 0 ("Upper") on a clean program.
  {
    const off = solveOffset(base, THU, 0)!;
    eq(getWorkoutForDate({ ...base, cycleOffset: off }, THU)?.name, "Upper", "set-day: lands on the chosen day");
  }
  // Same, on a program carrying a push. The inline version got this wrong.
  {
    const pushed = pushDate(base, TUE);
    const off = solveOffset(pushed, THU, 0)!;
    eq(
      getWorkoutForDate({ ...pushed, cycleOffset: off }, THU)?.name,
      "Upper",
      "set-day: still lands correctly when a push is in the way",
    );
    // And every slot, not just one, so an off-by-one can't hide.
    for (let target = 0; target < base.cycleDays; target++) {
      const o = solveOffset(pushed, FRI, target)!;
      const want = base.cyclePattern[target];
      const got = getWorkoutForDate({ ...pushed, cycleOffset: o }, FRI)?.name ?? "Rest";
      eq(got, want === "Rest" ? "Rest" : want, `set-day: target index ${target} resolves to ${want}`);
    }
  }
  // THE REGRESSION GATE. The solve inverts `natural` computed with cycleOffset
  // forced to 0, which is only valid while the drift term is INDEPENDENT of the
  // offset. A reader that checked "does this pulled date still land on a Rest?"
  // made drift depend on it, and 4 of 6 targets landed on the wrong day. Every
  // combination of marks, every target slot, both directions.
  for (const [label, prog] of [
    ["a pull", pullDate(base, WED)],
    ["a push and a pull", pullDate(pushDate(base, TUE), plus(THU, 1))],
    ["two pulls", pullDate(pullDate(base, WED), plus(WED, 3))],
  ] as const) {
    for (let target = 0; target < base.cycleDays; target++) {
      const o = solveOffset(prog, plus(FRI, 3), target);
      const idx = cycleIndexForDate({ ...prog, cycleOffset: o! }, plus(FRI, 3));
      eq(idx, target, `set-day: with ${label}, target slot ${target} resolves to itself`);
    }
  }
}

// ─── picking a different workout for today (the override flow) ──────────────
// Change-day writes { date, workoutName, programId, dayId } and resolution
// looks the slot up BY ID, so it is drift-independent by construction — the
// whole point of dayId. These assertions pin that: the same override resolves
// to the same day whatever the timeline has done around it.
{
  const variants: [string, SavedProgram][] = [
    ["clean", base],
    ["after a push", pushDate(base, TUE)],
    ["after a pull", pullDate(base, WED)],
    ["after both", pullDate(pushDate(base, TUE), plus(THU, 1))],
  ];
  for (const [label, prog] of variants) {
    // "I want to do Lower today" — slot 1, dayId d1.
    const resolved = resolveWorkoutForDate(
      prog,
      { date: plus(FRI, 2), workoutName: "Lower", programId: "P", dayId: "d1" },
      plus(FRI, 2),
      [prog],
    );
    eq(resolved?.name, "Lower", `override: ${label}, the chosen day is what loads`);
    eq(resolved?.dayId, "d1", `override: ${label}, and it's the slot that was tapped`);
  }
  // An override for a DIFFERENT date is ignored, drift or not — a stale one
  // from yesterday must never win.
  eq(
    resolveWorkoutForDate(pushDate(base, TUE), { date: MON, workoutName: "Lower", programId: "P", dayId: "d1" }, plus(FRI, 2), [pushDate(base, TUE)])?.name,
    getWorkoutForDate(pushDate(base, TUE), plus(FRI, 2))?.name,
    "override: a stale override falls back to what the cycle says",
  );
}

// ─── what the Journal and the trainer see is a SNAPSHOT ─────────────────────
// A logged session carries its own name, exercises and dayId, so nothing the
// user does to the timeline afterwards can rewrite history. This is the same
// contract as editing a running program (CLAUDE.md), and it is what makes the
// Journal and the trainer's client view safe.
{
  const session: CompletedWorkout = {
    id: "w1", date: TUE, completedAt: `${TUE}T10:00:00.000Z`,
    workoutName: "Lower", dayId: "d1", programId: "P",
    durationSeconds: 3600, exercises: [],
  };
  // Push and pull all around it; the record is untouched.
  const churned = pullDate(pushDate(pushDate(base, MON), THU), plus(THU, 4));
  eq(session.workoutName, "Lower", "journal: the logged name is stored, not re-derived");
  eq(session.dayId, "d1", "journal: ...and so is the slot it belongs to");
  const lowerDay = markDayRefLabels(programDays(churned))[1];
  eq(workoutMatchesDay(session, lowerDay), true,
     "journal: it still matches its own day after the timeline moved");
  // And the day it belongs to is found by id, never by where the date now lands.
  eq(cycleIndexForDate(churned, TUE) !== 1, true,
     "journal: ...even though that date now resolves to a different slot entirely");
}

// ─── the trainer sees exactly what the client logged ────────────────────────
// A trainer's client page renders ProgressView + ClientJournalView from the
// client's history — the SAME components the client's own tabs use. So the
// figures are the client's figures by construction; what has to hold is that
// none of them move when the client bends their timeline afterwards.
{
  const history: CompletedWorkout[] = [
    { id: "a", date: MON, completedAt: `${MON}T09:00:00.000Z`, workoutName: "Upper", dayId: "d0", programId: "P", durationSeconds: 3000, exercises: [] },
    { id: "b", date: TUE, completedAt: `${TUE}T09:00:00.000Z`, workoutName: "Lower", dayId: "d1", programId: "P", durationSeconds: 3200, exercises: [] },
    { id: "c", date: plus(MON, 3), completedAt: `${plus(MON, 3)}T09:00:00.000Z`, workoutName: "Upper", dayId: "d3", programId: "P", durationSeconds: 3100, exercises: [] },
  ];
  const before = markDayRefLabels(programDays(base)).map(d => sessionCountForDay(history, d));
  // The client is ill, pushes a day, spends a rest day, marks another off.
  const churned = skipDate(pullDate(pushDate(base, plus(MON, 6)), plus(MON, 9)), plus(MON, 12));
  const after = markDayRefLabels(programDays(churned)).map(d => sessionCountForDay(history, d));
  eq(after, before, "trainer: per-day session counts are unchanged by pushes, pulls and skips");
  eq(before.reduce((a, b) => a + b, 0), 3, "trainer: ...and all three sessions are attributed");

  // Attribution is by dayId, so it survives the day being RENAMED too — the
  // trainer keeps seeing the session under whatever the day is called now.
  const renamed = { ...churned, cyclePattern: ["Push", "Lower", "Rest", "Upper", "Lower", "Rest"] };
  eq(
    markDayRefLabels(programDays(renamed)).map(d => sessionCountForDay(history, d)),
    before,
    "trainer: ...and by a rename, because the match is on dayId not the label",
  );
}

// ─── PULL: spend a rest day, everything from it moves a day EARLIER ──────────
// The mirror of a push, and how a push gets paid back.
{
  // WED is Rest in the baseline cycle.
  const pulled = pullDate(base, WED);
  eq(isDatePulled(pulled, WED), true, "pull: the date is recorded");
  eq(isDateSkipped(pulled, WED), false, "pull: NOT a skip — the day still schedules something");
  eq(pulled.cycleOffset, undefined, "pull: cycleOffset is not touched either");

  eq(getWorkoutForDate(pulled, MON)?.name, "Upper", "pull: the past is untouched");
  eq(getWorkoutForDate(pulled, TUE)?.name, "Lower", "pull: the day BEFORE is untouched — this is the <= vs < gate");
  eq(getWorkoutForDate(pulled, WED)?.name, "Upper", "pull: Wednesday's Rest is spent, Thursday's Upper moves onto it");
  eq(getWorkoutForDate(pulled, THU)?.name, "Lower", "pull: and everything after follows, a day earlier");

  eq(cycleDrift(pulled, TUE), 0, "drift: a pull does not affect the day before it");
  eq(cycleDrift(pulled, WED), -1, "drift: a pull counts from its OWN date — inclusive");
  eq(cycleDrift(pulled, THU), -1, "drift: ...and stays applied after");
}

// ─── the shift identities ────────────────────────────────────────────────────
// The strongest statement of the design: a push inserts a blank day, a pull
// deletes one. Everything else follows.
{
  const pushed = pushDate(base, TUE);
  const pulled = pullDate(base, WED);
  let pushOk = true, pullOk = true;
  for (let i = 1; i < 30; i++) {
    const d = plus(TUE, i);
    if (resolveDayIndex(pushed, d) !== resolveDayIndex(base, plus(d, -1))) pushOk = false;
  }
  for (let i = 0; i < 30; i++) {
    const d = plus(WED, i);
    if (resolveDayIndex(pulled, d) !== resolveDayIndex(base, plus(d, 1))) pullOk = false;
  }
  eq(pushOk, true, "identity: after a push, every day resolves to what the day BEFORE it used to");
  eq(pullOk, true, "identity: from a pull onward, every day resolves to what the day AFTER it used to");
}

// ─── the whole point: a push paid back with a rest day ───────────────────────
// "This week I was ill so I pushed a day; next week I want to be back on the
// days I planned." One pull does that, and the program's length comes back too.
{
  const ill = pushDate(base, TUE);                 // everything slides a day
  const repaid = pullDate(ill, THU);               // THU is the Rest under drift +1
  eq(getWorkoutForDate(ill, THU), null, "setup: after the push, Thursday holds the displaced Rest");

  eq(getWorkoutForDate(repaid, WED)?.name, "Lower", "repaid: Tuesday's Lower still sits on Wednesday");
  eq(
    schedule(repaid, FRI, 21),
    schedule(base, FRI, 21),
    "repaid: from Friday on, the next three weeks are byte-identical to the original plan",
  );
  eq(cycleDrift(repaid, plus(FRI, 14)), 0, "repaid: net drift is back to zero");
  // Nothing is lost at all. A push DELAYS its session (only a plain skip drops
  // one), and the repayment spends a rest day — so the cost of being ill for a
  // day is one rest day, not one workout.
  eq(sessionCount(repaid), sessionCount(base), "repaid: no session lost — the cost was a rest day");
  eq(sessionCount(skipDate(base, TUE)), sessionCount(base) - 1, "contrast: a plain SKIP is what loses a session");

  // Two disruptions need two repayments; one is not enough.
  const twice = pushDate(pushDate(base, TUE), plus(TUE, 7));
  eq(cycleDrift(twice, plus(TUE, 21)), 2, "two pushes drift by two");
  eq(cycleDrift(pullDate(twice, THU), plus(TUE, 21)), 1, "one repayment leaves one day of drift");
}

// ─── a pull must never cost a SESSION, only a rest day ───────────────────────
// The hazard: a pull is recorded on a rest day, then a push lands in front of
// it and slides a workout onto that date. Normalising on write re-targets the
// pull rather than letting it delete the session.
{
  const pulled = pullDate(base, WED);
  // Every session a day earlier, and the program finishing a day sooner: the
  // same sessions. (Counted in a window past its end, this was one more, while
  // the cycle ran on past the last day; nothing is scheduled there now:
  // utils/workout.ts resolveDayIndex.)
  eq(sessionCount(pulled), sessionCount(base), "pull: sessions only move earlier, none are deleted");
  eq(toYMD(programFinishDate(pulled)!), plus(toYMD(programFinishDate(base)!), -1), "pull: ...and the program finishes a day sooner");

  // Now push in front of it. WED would hold "Lower" — a workout.
  const conflicted = { ...pushDate(pulled, MON) };
  eq(getWorkoutForDate({ ...conflicted, pulledDates: undefined }, WED)?.name, "Lower",
     "conflict setup: with the push applied, the pulled date now holds a workout");

  const fixed = normalizeDriftDates(conflicted);
  eq(fixed.pulledDates !== undefined && fixed.pulledDates[0] !== WED, true,
     "normalise: the stale pull is moved off the workout day");
  eq(
    sessionCount(fixed),
    sessionCount({ ...conflicted, pulledDates: undefined }),
    "normalise: NO session is deleted — the pull only ever spends a rest day",
  );
  // And it still lands on a rest, which is the invariant.
  for (const d of fixed.pulledDates ?? []) {
    const idx = cycleIndexForDate({ ...fixed, pulledDates: (fixed.pulledDates ?? []).filter(x => x !== d) }, d);
    eq(idx !== null && base.cyclePattern[idx] === "Rest", true, `normalise: pulled date ${d} sits on a Rest`);
  }
}

// ─── what may share a date ───────────────────────────────────────────────────
{
  // A push and a pull on one date are meaningless together.
  const clash = normalizeDriftDates(pullDate(pushDate(base, WED), WED));
  eq((clash.pulledDates ?? []).includes(WED), false, "normalise: a date can't be both moved and spent");
  // A skip and a pull are independent: skipping the day a move was absorbed
  // into must NOT un-absorb it, or the rest of the program silently runs late.
  const both = normalizeDriftDates({ ...base, skippedDates: [WED], pulledDates: [WED] });
  eq((both.pulledDates ?? []).includes(WED), true, "normalise: skipping a day keeps the pull on it");
}

// ─── the week counter follows the program's timeline, not the calendar ───────
const asDate = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
{
  eq(getCurrentWeek(base, asDate(MON)), 1, "week: day 0 is week 1");
  eq(getCurrentWeek(base, asDate(plus(MON, 6))), 1, "week: day 6 is still week 1");
  eq(getCurrentWeek(base, asDate(plus(MON, 7))), 2, "week: day 7 starts week 2");

  // A push held the cycle still for a day, so it must hold the WEEK still too —
  // otherwise the program quietly loses a day of programming off the end.
  const ill = pushDate(base, TUE);
  eq(getCurrentWeek(ill, asDate(plus(MON, 7))), 1, "week: one push keeps day 7 in week 1");
  eq(getCurrentWeek(ill, asDate(plus(MON, 8))), 2, "week: week 2 starts a day later");

  // Repaying puts it straight back.
  const repaid = pullDate(ill, THU);
  for (let i = 0; i < 28; i++) {
    eq(getCurrentWeek(repaid, asDate(plus(MON, i))), getCurrentWeek(base, asDate(plus(MON, i))),
       `week: push+repay matches the original plan on day ${i}`);
  }
  eq(getCurrentWeek(base, asDate(plus(MON, 400))), base.totalWeeks, "week: clamped at totalWeeks");
  eq(getCurrentWeek({ ...base, pausedAt: TUE, currentWeek: 3 }, asDate(plus(MON, 40))), 3,
     "week: a held program still freezes at its stored week");
  eq(getCurrentWeek({ ...base, startDate: "not a date", currentWeek: 5 }, asDate(MON)), 5,
     "week: an unparseable start still falls back to the stored week");
}

// ─── the finish date moves with the timeline ─────────────────────────────────
{
  const end = programFinishDate(base)!;
  eq(end.getTime(), asDate(plus(MON, base.totalWeeks * 7 - 1)).getTime(), "finish: start + totalWeeks, minus the start day itself");
  const ill = pushDate(base, TUE);
  eq(programFinishDate(ill)!.getTime(), asDate(plus(MON, base.totalWeeks * 7)).getTime(), "finish: a push moves it out a day");
  eq(programFinishDate(pullDate(ill, THU))!.getTime(), end.getTime(), "finish: repaying brings it back");
  eq(programFinishDate({ ...base, startDate: "nonsense" }), null, "finish: unparseable start gives null, never a January-year-0 date");
}

// ─── the cycle advances by exactly one day, every day ────────────────────────
// A daylight-saving transition makes a local-midnight span 23 or 25 hours; a
// millisecond quotient that FLOORS drops a whole day there and shifts the cycle
// one slot early for months. This walk fails in any DST zone if that regresses,
// and passes in UTC — which is why it's a 400-day walk and not a spot check.
{
  let ok = true, firstBad = "";
  for (let i = 0; i < 400; i++) {
    const a = cycleIndexForDate(base, plus(MON, i));
    const b = cycleIndexForDate(base, plus(MON, i + 1));
    if (a === null || b === null || b !== (a + 1) % base.cycleDays) {
      if (ok) firstBad = plus(MON, i);
      ok = false;
    }
  }
  eq(ok, true, `cycle advances exactly one slot per day across 400 days (first break: ${firstBad || "none"})`);

  let weekOk = true;
  let prev = getCurrentWeek(base, asDate(MON));
  for (let i = 1; i < 400; i++) {
    const w = getCurrentWeek(base, asDate(plus(MON, i)));
    if (w < prev) weekOk = false;
    prev = w;
  }
  eq(weekOk, true, "the week counter never goes backwards across 400 days");
}

// ─── re-activating a program must not inherit the last run's marks ──────────
// Every mark is dated before the new startDate, so ALL of them would count as
// drift against day 1 — landing the fresh run several slots into the cycle and
// moving its finish date out by the same amount. This is the transform
// app/programs.tsx:handleMakeActive performs.
{
  const usedUp = pullDate(pushDate(skipDate(base, TUE), THU), plus(THU, 2));
  const reactivated: SavedProgram = {
    ...usedUp,
    status: "active", startDate: "05 Oct 2026", currentWeek: 1,
    cycleOffset: undefined, pausedAt: undefined,
    skippedDates: undefined, pushedDates: undefined, pulledDates: undefined,
  };
  eq(cycleDrift(reactivated, "2026-10-05"), 0, "re-activate: no drift carried into the new run");
  eq(getWorkoutForDate(reactivated, "2026-10-05")?.name, "Upper", "re-activate: day 1 is the first day of the cycle");
  eq(getCurrentWeek(reactivated, asDate("2026-10-05")), 1, "re-activate: back to week 1");
  // Contrast: keeping them would have thrown day 1 off by the net drift.
  const careless = { ...reactivated, pushedDates: usedUp.pushedDates, skippedDates: usedUp.skippedDates };
  eq(getWorkoutForDate(careless, "2026-10-05")?.name !== "Upper", true,
     "re-activate: ...which is exactly what carrying the marks over would break");
}

// ─── resuming from a hold: each move keeps its rest day ─────────────────────
// utils/programPause.ts resumeProgram shifts the start by the days held and
// records the hold (it can't be imported here: it pulls in React Native), then
// settles the marks with marksAfterHold, which is what's tested. "Carry on
// where I left off": the resume day must be on the cycle and week the pause day
// was.
{
  const resume = (p: SavedProgram, pausedAt: string, on: string) => {
    const held = Math.round((asDate(on).getTime() - asDate(pausedAt).getTime()) / 86400000);
    const holds = [...(p.holds ?? []), { from: pausedAt, to: on, shift: held, offsetShift: 0 }];
    return marksAfterHold({ ...p, startDate: formatStoredDate(new Date(2026, 8, 7 + held)), holds }, pausedAt, on);
  };
  const daysLater = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();

  // A move into the hold: Thursday's Upper moved on before a pause from
  // Wednesday. The hold did the waiting, so the move goes, and so must the rest
  // day that absorbed it, Sunday, after the hold. Kept, it ran the program a
  // day early from Sunday on.
  {
    const moved = planDoItTomorrow(base, THU).program;
    eq([moved.pushedDates, moved.pulledDates], [[THU], [plus(MON, 6)]], "hold setup: Thursday moved, absorbed on Sunday");
    const back = resume(moved, WED, plus(MON, 5));
    eq([back.skippedDates, back.pushedDates, back.pulledDates], [undefined, undefined, undefined],
      "resume: a move into the hold goes, and so does the rest day after the hold it was paired with");
    eq(schedule(back, plus(MON, 5), 21), schedule(base, WED, 21), "resume: picks up exactly where the pause day was");
    eq(programFinishDate(back)!.getTime(), daysLater(programFinishDate(base)!, 3), "resume: finishes the days held later, no more, no less");
  }
  // A move before the hold whose rest day fell inside it: Tuesday's Lower
  // moved to Wednesday, Thursday's rest spent, then paused from Wednesday.
  // Dropped with the hold, that rest day left the move unpaid: the program ran
  // a day late and resumed a day behind where it left off.
  {
    const moved = planDoItTomorrow(base, TUE).program;
    eq(moved.pulledDates, [THU], "hold setup: Tuesday moved, absorbed on Thursday");
    const on = plus(MON, 7);
    const back = resume(moved, WED, on);
    eq(back.pushedDates, [TUE], "resume: the move before the hold stands");
    eq((back.pulledDates ?? []).length === 1 && back.pulledDates![0] > on, true, "resume: ...and takes a rest day after the resume day");
    eq(schedule(back, on, 21), schedule(moved, WED, 21), "resume: picks up exactly where the pause day was, moved workout and all");
    eq(getCurrentWeek(back, asDate(on)), getCurrentWeek(moved, asDate(WED)), "resume: in the week the hold began in");
    eq(programFinishDate(back)!.getTime(), daysLater(programFinishDate(base)!, 5), "resume: finishes the days held later, no more, no less");
  }
  // A rest day spent ON the pause day still counts: the program had already
  // caught up there when it stopped. (Its date can move: shifting the start
  // re-labels the days before the resume too, and normalizeDriftDates keeps it
  // on a rest day, no later than the resume day.)
  {
    const moved = planDoItTomorrow(base, MON).program;
    eq(moved.pulledDates, [THU], "hold setup: Monday moved, absorbed on Thursday");
    const back = resume(moved, THU, plus(MON, 5));
    eq(cycleDrift(back, plus(MON, 5)), cycleDrift(moved, THU), "resume: a rest day spent on the pause day still counts");
    eq(schedule(back, plus(MON, 5), 21), schedule(moved, THU, 21), "resume: picks up where the pause day was");
  }
  // A long hold moves the start past a move and the rest day that absorbed it,
  // both before the pause. They're history, and still count: the rest day has
  // no slot to check before the start, and re-targeted or dropped it left the
  // move unpaid, resuming a day behind (a week back, on a week boundary).
  {
    const moved = planDoItTomorrow(base, MON).program;
    const on = plus(MON, 21);
    const back = resume(moved, FRI, on);
    eq(back.pulledDates, [THU], "long hold: the rest day spent before the pause stays, though the start is now after it");
    eq(schedule(back, on, 21), schedule(moved, FRI, 21), "long hold: picks up exactly where the pause day was");
    eq(getCurrentWeek(back, asDate(on)), getCurrentWeek(moved, asDate(FRI)), "long hold: in the week the hold began in");
  }
  // Resumed the day it was paused: nothing was held, nothing moves.
  {
    const moved = planDoItTomorrow(base, TUE).program;
    const back = marksAfterHold(moved, WED, WED);
    eq([back.skippedDates, back.pushedDates, back.pulledDates], [moved.skippedDates, moved.pushedDates, moved.pulledDates],
      "resume the same day: the marks are untouched");
  }
}

// ─── a re-dated timeline pairs its moves up again ────────────────────────────
// Logging day 1 before the start moves the start back, re-dating every day
// under the moves. A rest day a move took that's now a workout was re-targeted
// forward, past the first rest day after the move; then a move put straight
// back paired that move up afresh, and the days between the two rest days came
// back different.
{
  const three: SavedProgram = {
    id: "T", name: "ULR", totalWeeks: 8, currentWeek: 1, status: "active",
    startDate: "07 Sep 2026", trainingDays: 2, cycleDays: 3,
    cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["t0", "t1", "t2"], workouts: {},
  };
  const moved = planDoItTomorrow(three, MON).program;
  const log = { owningProgramId: "T", programId: "T", date: "2026-09-06", workoutName: "Upper" };
  const [backdated] = programsAfterPastLog([moved], log).programs;
  eq(backdated.startDate, "06 Sep 2026", "back-date: the start moves back to the session logged");
  const roundTrip = unskipDate(planDoItTomorrow(backdated, TUE).program, TUE);
  eq([roundTrip.pushedDates, roundTrip.pulledDates], [backdated.pushedDates, backdated.pulledDates],
    "back-date: a move put straight back leaves the moves and rest days as they were");
  eq(schedule(roundTrip, MON, 28), schedule(backdated, MON, 28), "back-date: ...and every day of the next four weeks");
  // Contrast: only re-targeting (what a back-date did) left the rest day where
  // a round trip doesn't put it back.
  const retargeted = normalizeDriftDates({ ...moved, startDate: "06 Sep 2026" });
  const retargetedTrip = unskipDate(planDoItTomorrow(retargeted, TUE).program, TUE);
  eq(JSON.stringify(schedule(retargetedTrip, MON, 28)) !== JSON.stringify(schedule(retargeted, MON, 28)), true,
    "back-date: ...which re-targeting alone didn't manage");
}

// ─── an edit of a running program keeps its marks legal ─────────────────────
// The builder saved an edit without normalizeDriftDates: make Thursday's rest a
// workout and the rest day a move was absorbed into took that workout out of
// the plan.
{
  const moved = planDoItTomorrow(base, TUE).program;
  const arms = { ...moved, cyclePattern: ["Upper", "Lower", "Arms", "Upper", "Lower", "Rest"], trainingDays: 5 };
  eq(getWorkoutForDate({ ...arms, pulledDates: undefined }, THU)?.name, "Arms", "edit setup: Thursday now holds Arms");
  eq(getWorkoutForDate(arms, THU)?.name === "Arms", false, "edit setup: ...which the stale rest day took out of the plan");
  const saved = marksAfterEdit(moved, arms);
  eq(getWorkoutForDate(saved, THU)?.name, "Arms", "edit: Arms stays on Thursday");
  for (const d of saved.pulledDates ?? []) {
    const idx = cycleIndexForDate({ ...saved, pulledDates: (saved.pulledDates ?? []).filter(x => x !== d) }, d);
    eq(idx !== null && saved.cyclePattern[idx] === "Rest", true, `edit: the move's rest day ${d} is a rest day`);
  }
  eq(programFinishDate(saved)!.getTime(), programFinishDate({ ...arms, skippedDates: undefined, pushedDates: undefined, pulledDates: undefined })!.getTime(),
    "edit: the move is still absorbed, so it finishes on time");
  const renamed = marksAfterEdit(moved, { ...moved, name: "Renamed", workouts: { "0:Upper": [] } });
  eq(renamed.pulledDates, moved.pulledDates, "edit: changing what's in the days leaves the moves alone");
}

// ─── a move put straight back near the end ───────────────────────────────────
// A move with no rest day before the program's last day ends it a day later
// (planDoItTomorrow), and putting ANOTHER move straight back mustn't then find
// it a rest day after the end: that pull moved the finish back and forth.
{
  const week: SavedProgram = {
    id: "W", name: "ULR", totalWeeks: 1, currentWeek: 1, status: "active",
    startDate: "07 Sep 2026", trainingDays: 2, cycleDays: 3,
    cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["w0", "w1", "w2"], workouts: {},
  };
  const SUN = plus(MON, 6);
  const last = planDoItTomorrow(week, SUN);
  eq(last.kind, "extended", "end: moving the last day ends the program a day later");
  const trip = unskipDate(planDoItTomorrow(last.program, FRI).program, FRI);
  eq([trip.pushedDates, trip.pulledDates], [last.program.pushedDates, last.program.pulledDates],
    "end: a move put straight back leaves the last day's move as it was");
  eq(programFinishDate(trip)!.getTime(), programFinishDate(last.program)!.getTime(), "end: ...and the finish");

  // Set Workout Date on the day the move brought into the run, past the plan's
  // last day: the run runs to it. Counted from the plan's last day, the move
  // before counted below that day and not from it, so no end date held, the
  // run ended the day before and the workout just set was gone from the
  // Workout tab (found by the solo flows, 2026-11-17).
  const MON2 = plus(MON, 7);
  eq(toYMD(programFinishDate(last.program)!), MON2, "past the plan setup: the last day's move ends it on the Monday");
  const set = setWorkoutDay(last.program, 1, MON2)!;
  eq(toYMD(programFinishDate(set)!), MON2, "past the plan: set on the day the move brought in, it runs to that day");
  eq(getWorkoutForDate(set, MON2)?.dayId, "w1", "past the plan: ...which is the day set");
  eq([0, 1, 2, 3, 4, 5, 6].map(k => getWorkoutForDate(set, plus(MON, k))?.dayId ?? null),
    [0, 1, 2, 3, 4, 5, 6].map(k => getWorkoutForDate(last.program, plus(MON, k))?.dayId ?? null),
    "past the plan: the days before read as they did");
  const movedOn = planDoItTomorrow(set, MON2);
  eq([movedOn.kind, toYMD(programFinishDate(movedOn.program)!)], ["extended", plus(MON, 8)], "past the plan: a move after it still ends it a day later");
  // Set where the plan still has days to go, it finishes on the plan's last day.
  const early = setWorkoutDay(last.program, 0, FRI)!;
  eq(toYMD(programFinishDate(early)!), SUN, "on plan: set before the plan's last day, it finishes on it");
}

// ─── Set Workout Date between midnight and 3am ───────────────────────────────
// Wednesday was a rest day, so at 1am on Thursday the app is on Thursday.
// "Today is Lower" re-aligns from Thursday on and leaves Wednesday the rest it
// was: re-labelled, it turned into an Upper not logged, which held the app on
// Wednesday (getEffectiveToday), and marking it off was the patch.
{
  const oneAm = new Date(2026, 8, 10, 1, 0);
  eq(getEffectiveToday(base, [], oneAm), THU, "1am setup: the app is on Thursday (Wednesday rested)");
  const set = setWorkoutDay(base, 1, THU)!;
  eq(getEffectiveToday(set, [], oneAm), THU, "1am: the app stays on the day that was set");
  eq(getWorkoutForDate(set, THU)?.name, "Lower", "1am: ...which is Lower");
  eq([getWorkoutForDate(set, WED), isDateSkipped(set, WED)], [null, false], "1am: Wednesday reads as the rest it was, nothing marked off");
}

// ─── Set Workout Date leaves the past as it was ─────────────────────────────
// User priority, 2026-11-16: nothing done should change the history. Every day
// before today reads as it did, the re-alignment kept as a hold of no days on
// today (programAsOf undoes it for an earlier day); from today, the day set.
{
  const before = schedule(base, MON, 10);
  for (const [day, i] of [[THU, 0], [THU, 1], [FRI, 0], [FRI, 1]] as const) {
    const set = setWorkoutDay(base, i, day)!;
    const days = schedule(set, MON, 10);
    const cut = days.findIndex((_, k) => addDaysYMD(MON, k) === day);
    eq(days.slice(0, cut), before.slice(0, cut), `past kept (${day} set to day ${i + 1}): the days before read as they did`);
    eq(getWorkoutForDate(set, day)?.dayId, base.dayIds![i], `past kept (${day} set to day ${i + 1}): that day is the day set`);
    eq(runStartYMD(set), runStartYMD(base), `past kept (${day} set to day ${i + 1}): the run still began when it did`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// THE USER-FACING MODEL: "Skip it" or "Do it tomorrow"
// ═════════════════════════════════════════════════════════════════════════════
// A real schedule: train Mon/Tue/Wed, rest Thu+Fri, train Sat+Sun. The case that
// exposed the old prompt, where "use Friday's rest day" was offered but it was
// THURSDAY that visibly became a training day.
{
  const mine: SavedProgram = {
    id: "M", name: "Mine", totalWeeks: 8, currentWeek: 1, status: "active",
    startDate: "14 Sep 2026", trainingDays: 5, cycleDays: 7,
    cyclePattern: ["Push", "Pull", "Legs", "Rest", "Rest", "Upper", "Lower"],
    dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"], workouts: {},
  };
  const SAT = "2026-09-19", SUN = "2026-09-20";
  const NEXT_THU = "2026-09-24", NEXT_SAT = "2026-09-26";
  const planned = programFinishDate(mine)!.getTime();

  for (const [label, day] of [["Saturday", SAT], ["Sunday", SUN]] as const) {
    const plan = planDoItTomorrow(mine, day);
    eq(plan.kind, "absorbed", `tomorrow (${label}): a rest day is available, so it's absorbed`);
    if (plan.kind !== "absorbed") continue;

    // The label regression. Name the day that VISIBLY changes, not the internal
    // pull date (Friday, which stays a rest day).
    eq(plan.lostRestDay, NEXT_THU, `tomorrow (${label}): the rest day named is next THURSDAY, the one that changes`);
    eq(plan.lostRestBecomes, "Legs", `tomorrow (${label}): ...and it becomes Legs`);
    eq(getWorkoutForDate(plan.program, "2026-09-25"), null, `tomorrow (${label}): Friday really does stay a rest day`);
    eq(plan.backOnPlan, NEXT_SAT, `tomorrow (${label}): back on usual days from next Saturday`);

    eq(programFinishDate(plan.program)!.getTime(), planned, `tomorrow (${label}): the program still finishes on time`);
    eq(
      schedule(plan.program, NEXT_SAT, 21),
      schedule(mine, NEXT_SAT, 21),
      `tomorrow (${label}): from next Saturday, the next three weeks match the plan exactly`,
    );
    // Nothing lost: the missed workout moved rather than vanished.
    eq(sessionCount(plan.program, 42), sessionCount(mine, 42),
       `tomorrow (${label}): no session lost, only a rest day`);
  }

  // Skip really is "miss it, week unchanged".
  const skipped = skipDate(mine, SAT);
  eq(getWorkoutForDate(skipped, SUN)?.name, "Lower", "skip: Sunday is still Lower");
  eq(programFinishDate(skipped)!.getTime(), planned, "skip: finishes on time");
  eq(sessionCount(skipped, 42), sessionCount(mine, 42) - 1, "skip: exactly the one session is gone");

  // ─── undo puts the week back EXACTLY, rest day included ───
  // The push and its pull were one action; they come off as one. Removing only
  // the push would orphan the pull and drag everything a day EARLY.
  {
    const moved = planDoItTomorrow(mine, SAT).program;
    const undone = normalizeDriftDates(unskipDate(moved, SAT));
    eq(undone.pushedDates, undefined, "undo move: the push is gone");
    eq(undone.pulledDates, undefined, "undo move: ...and so is the rest day it used");
    eq(schedule(undone, SAT, 28), schedule(mine, SAT, 28), "undo move: four weeks identical to the plan");
    eq(programFinishDate(undone)!.getTime(), planned, "undo move: finish date unchanged");
  }

  // ─── two moves, undo the first: the second is still absorbed ───
  {
    const two = planDoItTomorrow(planDoItTomorrow(mine, SAT).program, "2026-09-21").program;
    eq((two.pushedDates ?? []).length, 2, "two moves: two pushes");
    eq((two.pulledDates ?? []).length, 2, "two moves: two rest days used");
    const firstUndone = normalizeDriftDates(unskipDate(two, SAT));
    eq((firstUndone.pushedDates ?? []).length, 1, "two moves, undo first: one push left");
    eq((firstUndone.pulledDates ?? []).length, 1, "two moves, undo first: ...paired with one rest day");
    eq(programFinishDate(firstUndone)!.getTime(), planned, "two moves, undo first: still finishes on time");
  }

  // ─── skipping the day a move was absorbed into keeps the absorb ───
  // Otherwise skipping one workout would quietly make the program a day late.
  {
    const moved = planDoItTomorrow(mine, SAT).program;
    const pullDay = moved.pulledDates![0];
    const skippedPull = normalizeDriftDates(skipDate(moved, pullDay));
    eq(skippedPull.pulledDates, [pullDay], "skip the absorbing day: the rest day stays used");
    eq(programFinishDate(skippedPull)!.getTime(), planned, "skip the absorbing day: still finishes on time");
  }

  // ─── Set Workout Date is a reset from today ───
  // Move Saturday, then on Monday say "today is Push". The old behaviour: the
  // week looked back on plan but the finish date stayed a day late, because the
  // move still counted. What the moves before today still owe is cancelled from
  // today, and they stay as they were, so the days before read as they did.
  {
    const MON2 = "2026-09-21";
    const moved = pushDate(mine, SAT); // a bare push, the worst case for leftover drift
    const after = setWorkoutDay(moved, 0, MON2)!;

    eq(getWorkoutForDate(after, MON2)?.name, "Push", "set date: today is the day that was chosen");
    eq(programFinishDate(after)!.getTime(), planned, "set date: the finish date is honest, no hidden extra day");
    eq(isDateSkipped(after, SAT), true, "set date: a PAST move still reads rest");
    eq(schedule(after, "2026-09-14", 7), schedule(moved, "2026-09-14", 7), "set date: the week before today reads as it did");
    eq(schedule(after, MON2, 28), schedule({ ...mine, startDate: "21 Sep 2026" }, MON2, 28), "set date: from today, the plan from day 1, nothing late");
  }
  {
    // A move dated in the FUTURE is removed outright: a reset mustn't leave a
    // planned day empty.
    const FUTURE_SAT = "2026-09-26";
    const reset = clearShifts(pushDate(mine, FUTURE_SAT), "2026-09-21");
    eq(isDateSkipped(reset, FUTURE_SAT), false, "set date: a future move is cleared, not turned into a skip");
    const plainSkip = clearShifts(skipDate(mine, FUTURE_SAT), "2026-09-21");
    eq(isDateSkipped(plainSkip, FUTURE_SAT), true, "set date: a plain skip is left alone, it never shifted anything");
    // A move whose rest day was still to come: it stays, settled (the next
    // move's re-sweep leaves it be), and the days before today read with it.
    const moved = planDoItTomorrow(mine, SAT).program;
    const set = setWorkoutDay(moved, 0, "2026-09-21")!;
    eq([set.pushedDates, set.pulledDates, isDateSkipped(set, SAT)], [[SAT], undefined, true], "set date: the move before today stays (settled), its rest day still to come goes");
    eq([isSettledMove(set, SAT), unskipDate(set, SAT) === set], [true, true], "set date: a move before it is settled, so it can't be put back");
    eq([isDatePushed(set, SAT), isDatePushed(set, "2026-09-22")], [true, false], "set date: ...and read as the move it was, before today");
    eq(schedule(set, "2026-09-14", 7), schedule(moved, "2026-09-14", 7), "set date: the week before today reads as it did, the move's shift included");
  }
}

// ─── a Change Workout Day pick moves with its day ────────────────────────────
// Which picks travel. Their effect on the week is in verify-week-schedule.ts.
{
  const pick = { date: MON, workoutName: "Lower", programId: "P", dayId: "d1" };
  eq(pickAfterMove(base, pick, MON), { ...pick, date: TUE }, "pick: carried to the next day, everything else kept");
  eq(pickAfterMove(base, { ...pick, date: WED }, WED), null,
    "pick on a planned rest day: not carried (the rest slot moves, and the pick would replace the next day's workout)");
  eq(pickAfterMove(base, { date: MON, workoutName: "Arms" }, MON), null,
    "custom workout: not carried (tomorrow would open as an empty custom day)");
  eq(pickAfterMove(base, { date: MON, workoutName: "Rest" }, MON), null, "a Rest override: nothing to carry");
  eq(pickAfterMove(base, pick, TUE), null, "a pick for another date: none of this move's business");
  eq(pickAfterMove(base, null, MON), null, "no pick: nothing to carry");

  const carried = pickAfterMove(base, pick, MON);
  eq(pickAfterUndoMove(base, carried, MON), pick, "undo: the carried pick comes back to its day");
  eq(pickAfterUndoMove(base, pick, MON), null, "undo: a pick still on the day itself is left alone");
  eq(pickAfterUndoMove(base, { ...pick, date: WED }, MON), null, "undo: a pick further out isn't this move's");
  eq(pickAfterUndoMove(base, { date: TUE, workoutName: "Arms" }, MON), null, "undo: a custom workout is never treated as carried");

  // Tuesday's own workout already moved on: Monday's move lands on Wednesday,
  // past it, and so does the pick. Carried to Tuesday, it sat on a day showing
  // nothing while Wednesday showed Monday's Upper, the workout swapped away.
  const tueMoved = planDoItTomorrow(base, TUE).program;
  const both = planDoItTomorrow(tueMoved, MON).program;
  const rides = pickAfterMove(tueMoved, pick, MON);
  eq(rides?.date, WED, "pick: carried past a day whose own workout moved on, to where the move lands");
  eq(getWorkoutForDate(both, WED)?.dayId, "d0", "pick: ...which is where Monday's slot now sits");
  eq(pickAfterUndoMove(both, rides, MON), pick, "undo Monday: the pick comes back with its slot");
  // Undoing Tuesday instead brings Monday's slot back to Tuesday, and the pick
  // on it: it follows the slot, whichever move put it there.
  const tueUndone = unskipDate(both, TUE);
  eq(getWorkoutForDate(tueUndone, TUE)?.dayId, "d0", "undo Tuesday: Monday's slot lands on Tuesday now");
  eq(pickAfterUndoMove(both, rides, TUE), { ...pick, date: TUE }, "undo Tuesday: ...and the pick with it");
}

// ─── a cycle with no rest day: the move genuinely costs a day ───────────────
{
  const noRest: SavedProgram = {
    ...base, id: "N", cycleDays: 3, trainingDays: 3,
    cyclePattern: ["Push", "Pull", "Legs"], dayIds: ["d0", "d1", "d2"],
  };
  const plan = planDoItTomorrow(noRest, TUE);
  eq(plan.kind, "extended", "no rest day: nothing to absorb it, so it's reported as extending");
  eq(
    programFinishDate(plan.program)!.getTime(),
    programFinishDate(noRest)!.getTime() + 86400000,
    "no rest day: ...and the program really does finish one day later",
  );
  eq(plan.program.pulledDates, undefined, "no rest day: no rest day is invented");
}

// ─── a hold the program came back from ───────────────────────────────────────
// Resuming moves the start on by the days held (and, picking up today, the
// cycle with it). That keeps the cycle and the finish right from then on, but
// it re-labelled every day BEFORE the hold: the program page lost the weeks
// before a pause, and a rest day a move had spent before it could look like a
// workout and be moved. So the hold is kept (SavedProgram.holds) and a past
// date is read as it stood then (utils/programHolds.ts programAsOf).
// resumeProgram itself pulls in React Native; this does what it does.
{
  const resumeAt = (p: SavedProgram, pausedAt: string, on: string, mode: "today" | "whereILeftOff"): SavedProgram => {
    const held = Math.round((asDate(on).getTime() - asDate(pausedAt).getTime()) / 86400000);
    const start = parseStoredDate(p.startDate)!;
    start.setDate(start.getDate() + held);
    const cycleOffset = mode === "today" ? ((p.cycleOffset ?? 0) + held) % p.cycleDays : p.cycleOffset;
    const holds = [...(p.holds ?? []), { from: pausedAt, to: on, shift: held, offsetShift: mode === "today" ? held : 0 }];
    return marksAfterHold({ ...p, pausedAt: undefined, startDate: formatStoredDate(start), cycleOffset, holds }, pausedAt, on);
  };
  const MON2 = plus(MON, 7);

  // Held Thursday to Monday, carrying on: Monday is Thursday's Upper.
  const carryOn = resumeAt(base, THU, MON2, "whereILeftOff");
  eq(carryOn.startDate, "11 Sep 2026", "hold: the start moves on by the days held");
  eq(carryOn.holds, [{ from: THU, to: MON2, shift: 4, offsetShift: 0 }], "hold: ...and the hold is kept");
  eq(runStartYMD(carryOn), MON, "hold: the run still began the day it did");
  eq(schedule(carryOn, MON, 3), schedule(base, MON, 3), "hold: the days before it read as they did");
  eq(schedule({ ...carryOn, holds: undefined }, MON, 3), ["Rest", "Rest", "Rest"],
    "hold: ...where the moved start alone put them before the program");
  eq([THU, FRI, plus(MON, 5), plus(MON, 6)].map(d => heldOn(carryOn, d)), [true, true, true, true], "hold: the days held are held");
  eq([WED, MON2].map(d => heldOn(carryOn, d)), [false, false], "hold: ...and only those");
  eq(schedule(carryOn, THU, 4), ["Rest", "Rest", "Rest", "Rest"], "hold: ...and schedule nothing");
  eq(getWorkoutForDate(carryOn, MON2)?.name, getWorkoutForDate(base, THU)?.name, "hold: the resume day is the pause day's workout");
  const asOf = programAsOf(carryOn, WED);
  eq([asOf.startDate, asOf.cycleOffset, asOf.holds], ["07 Sep 2026", undefined, undefined], "hold: before it, the program as it stood then");
  eq(programAsOf(asOf, WED), asOf, "hold: ...and reading it again changes nothing");
  eq(programAsOf(carryOn, MON2) === carryOn, true, "hold: after it, the program as it is");

  // Picking up today: the cycle carries on with the calendar.
  const today = resumeAt(base, THU, MON2, "today");
  eq(today.holds, [{ from: THU, to: MON2, shift: 4, offsetShift: 4 }], "hold, today: the offset it moved is kept too");
  eq(schedule(today, MON, 3), schedule(base, MON, 3), "hold, today: the days before it read as they did");
  eq(getWorkoutForDate(today, MON2)?.name, getWorkoutForDate(base, MON2)?.name, "hold, today: the resume day is the calendar's");

  // Two holds: each stretch reads as it was lived.
  const THU2 = plus(MON, 10), SUN2 = plus(MON, 13);
  const twice = resumeAt(carryOn, THU2, SUN2, "whereILeftOff");
  eq(runStartYMD(twice), MON, "two holds: the run still began the day it did");
  eq(schedule(twice, MON, 3), schedule(base, MON, 3), "two holds: the days before the first read as they did");
  eq(schedule(twice, MON2, 3), schedule(carryOn, MON2, 3), "two holds: the days between them too");
  eq(getWorkoutForDate(twice, SUN2)?.name, getWorkoutForDate(carryOn, THU2)?.name, "two holds: the second resume day is its pause day's workout");

  // A rest day a move spent before the hold stays where it was, and the days
  // already lived through keep their workouts.
  const moved = planDoItTomorrow(base, TUE).program;
  const resumed = resumeAt(moved, FRI, MON2, "whereILeftOff");
  eq([resumed.pushedDates, resumed.pulledDates], [[TUE], [THU]], "hold: a move and its rest day before it stay as they were");
  eq(schedule(resumed, MON, 4), schedule(moved, MON, 4), "hold: ...and so do the days before it");
  eq(getWorkoutForDate(resumed, MON2)?.name, getWorkoutForDate(moved, FRI)?.name, "hold: carrying on from the pause day");

  // A week with nothing done holds the program by itself (autoPauseIfIdle):
  // counted from the last workout alone, it held itself again the morning
  // after every resume from a holiday.
  eq(idleDays(carryOn, [], plus(MON, 13)), 6, "idle: from the resume day, not the run's start");
  eq(idleDays(carryOn, [TUE], plus(MON, 8)), 1, "idle: a workout before the hold doesn't count against a fresh resume");
  eq(idleDays(carryOn, [plus(MON, 8)], plus(MON, 13)), 5, "idle: a workout after it does");
  eq(idleDays({ ...base, startDate: "14 Sep 2026" }, ["2026-09-01"], "2026-09-15"), 1,
    "idle: a program made active since the last workout counts from its start");

  // A session from before the hold, logged from the Journal after it, is
  // inside the run: the start stays. Against the moved start, it moved the
  // start back and re-dated the whole running cycle.
  const logged = programsAfterPastLog([carryOn], { owningProgramId: "P", programId: "P", date: TUE, workoutName: "Lower" });
  eq([logged.changed, logged.programs[0].startDate], [false, "11 Sep 2026"], "hold: a session logged from before it doesn't move the start");
  const earlier = programsAfterPastLog([carryOn], { owningProgramId: "P", programId: "P", date: plus(MON, -1), workoutName: "Upper" }).programs[0];
  eq([earlier.startDate, runStartYMD(earlier), earlier.holds], ["10 Sep 2026", plus(MON, -1), carryOn.holds],
    "hold: one from before the run moves its start back a day, and keeps the hold");

  // Let go while on hold (finished, made inactive, replaced): the days it was
  // held stay held, never the workouts they'd have been, missed (found by a
  // history probe of the solo flows, 2026-11-16).
  {
    const heldSince = plus(MON, 10);
    const onHoldNow: SavedProgram = { ...base, pausedAt: heldSince, currentWeek: 2 };
    const LET_GO = formatStoredDate(new Date(`${plus(MON, 13)}T12:00:00`));
    const read = (p: SavedProgram) => [10, 11, 12, 13].map(k => (getWorkoutForDate(p, plus(MON, k)) ? "workout" : heldOn(p, plus(MON, k)) ? "held" : "rest"));
    const asWas = read(onHoldNow);
    const done = completeProgram([onHoldNow], "P", LET_GO).programs[0];
    eq([done.status, done.pausedAt, read(done)], ["completed", undefined, ["held", "held", "held", "held"]], "let go on hold: finished, its held days still held");
    const off = deactivateProgram([onHoldNow], "P", [], LET_GO)[0];
    eq([off.pausedAt, read(off)], [undefined, ["held", "held", "held", "held"]], "let go on hold: made inactive, the same");
    const other: SavedProgram = { ...base, id: "Q", status: "created", currentWeek: 0 };
    const replaced = activateProgram([onHoldNow, other], "Q", LET_GO, []).programs[0];
    eq(read(replaced), ["held", "held", "held", "held"], "let go on hold: replaced, the same");
    eq(asWas.every(s => s !== "workout"), true, "let go on hold: (setup) held, nothing scheduled");
    const notYet = completeProgram([{ ...base, pausedAt: plus(MON, 14) }], "P", LET_GO).programs[0];
    eq([notYet.pausedAt, notYet.holds], [undefined, undefined], "let go before a hold from tomorrow began: nothing held");
  }

  // On hold now, it reads the week it had reached on the day it was held: a
  // session from before the run, moving its start back, moves that week on
  // too. Left as it was, it read the week before, and the builder could make
  // it shorter than a week it has a session in (found by the solo flows,
  // 2026-11-15).
  const onHold: SavedProgram = { ...base, startDate: "05 Oct 2026", pausedAt: "2026-10-09", currentWeek: 1 };
  const backdated = programsAfterPastLog([onHold], { owningProgramId: "P", programId: "P", date: "2026-09-28", workoutName: "Upper" }).programs[0];
  eq([backdated.startDate, backdated.pausedAt, getCurrentWeek(backdated), minTotalWeeks(backdated)], ["28 Sep 2026", "2026-10-09", 2, 2],
    "hold: a session from before the run moves the start back, and the week reached by the hold with it");
  const sameWeek = programsAfterPastLog([onHold], { owningProgramId: "P", programId: "P", date: "2026-10-03", workoutName: "Upper" }).programs[0];
  eq([sameWeek.startDate, getCurrentWeek(sameWeek)], ["03 Oct 2026", 1], "hold: ...still week 1 when the hold day's in its first week");
  const running = programsAfterPastLog([{ ...onHold, pausedAt: undefined }], { owningProgramId: "P", programId: "P", date: "2026-09-28", workoutName: "Upper" }).programs[0];
  eq(running.currentWeek, 1, "hold: a run that isn't held keeps its stored week (getCurrentWeek counts from the start)");
}

// ─── a past session moves only the start of the run under way ───────────────
// Found by the solo flows, 2026-11-17: a program set to start next Monday had
// day 1 logged ten days ago, which moved its start back over its own earlier
// runs: the two shared days, it finished at once, and carrying it on numbered
// a session in both.
{
  const TODAY = "2026-10-06";
  const log = { owningProgramId: "P", programId: "P", date: "2026-09-26", workoutName: "Upper" };
  const after = (p: SavedProgram, date: string) => programsAfterPastLog([p], { ...log, date }, TODAY);
  const later: SavedProgram = { ...base, startDate: "12 Oct 2026" };
  eq(after(later, "2026-09-26").changed, false, "past log: a program set to start later keeps the start it was given");
  const done: SavedProgram = { ...base, status: "completed", completedDate: "01 Nov 2026" };
  eq(after(done, "2026-09-01").changed, false, "past log: a finished run isn't re-dated");
  const shelved: SavedProgram = { ...base, status: "paused", currentWeek: 2 };
  eq(after(shelved, "2026-09-01").changed, false, "past log: nor a shelved one");
  const earlierRun = {
    startDate: "07 Sep 2026", totalWeeks: 8, cycleDays: 6, cyclePattern: base.cyclePattern, dayIds: base.dayIds,
    currentWeek: 3, status: "completed" as const, endDate: "2026-09-27",
  };
  const rerun: SavedProgram = { ...base, startDate: "05 Oct 2026", runs: [earlierRun] };
  eq(after(rerun, "2026-09-20").changed, false, "past log: a day of an earlier run is that run's, the run under way keeps its start");
  eq(after(rerun, "2026-09-27").changed, false, "past log: ...its last day too");
  eq(after(rerun, "2026-09-30").programs[0].startDate, "30 Sep 2026", "past log: a day after it ended moves the run under way's start back to it");
  eq(after(base, "2026-09-01").programs[0].startDate, "01 Sep 2026", "past log: with no earlier run, back to the day logged");
  const unrun: SavedProgram = { ...base, status: "created", currentWeek: 0 };
  eq(after(unrun, "2026-09-01").programs[0].startDate, "01 Sep 2026", "past log: a program never run moves too (a run of its own once made active)");
  eq(after({ ...unrun, runs: [earlierRun] }, "2026-09-20").changed, false, "past log: ...but never into a day of an earlier run");
}

// ─── a rest day for a move, past held days and other moves ──────────────────
// The search counts days the cycle moves on: a moved day or a held one holds it
// still. Counted as calendar days, two moves and a hold between a move and its
// rest day used up a 3-day cycle's search, so a back-dated start left two moves
// with no rest day, and putting the next move straight back paired them up and
// moved the finish (found by verify-solo-flows --deep).
{
  const ulr: SavedProgram = {
    id: "S", name: "ULR", totalWeeks: 3, currentWeek: 1, status: "active",
    startDate: "12 Oct 2026", trainingDays: 2, cycleDays: 3,
    cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["s0", "s1", "s2"], workouts: {},
    holds: [{ from: "2026-10-15", to: "2026-10-16", shift: 1, offsetShift: 0 }],
    skippedDates: ["2026-10-12", "2026-10-13", "2026-10-16"],
    pushedDates: ["2026-10-12", "2026-10-13", "2026-10-16"],
    pulledDates: ["2026-10-17", "2026-10-19", "2026-10-21"],
  };
  const [logged] = programsAfterPastLog([ulr], { owningProgramId: "S", programId: "S", date: "2026-10-06", workoutName: "Upper" }).programs;
  eq(logged.pulledDates?.length, 3, "search: a back-dated start leaves every move a rest day");
  const trip = unskipDate(planDoItTomorrow(logged, "2026-10-17").program, "2026-10-17");
  eq([trip.pushedDates, trip.pulledDates], [logged.pushedDates, logged.pulledDates], "search: ...so a move put straight back leaves them as they were");
  eq(programFinishDate(trip)!.getTime(), programFinishDate(logged)!.getTime(), "search: ...finish and all");
}

// ─── it survives a round trip to the cloud ───────────────────────────────────
{
  const withSkips = pushDate(skipDate(base, TUE), THU);
  const row: ProgramRow = { ...programToRow(withSkips, "u1"), id: "P", created_at: "t", updated_at: "t" };
  eq(row.skipped_dates, [TUE, THU], "sync: skipped dates are written to the row");
  eq(row.pushed_dates, [THU], "sync: pushes are written separately");
  eq(programFromRow(row).skippedDates, [TUE, THU], "sync: skips come back intact");
  eq(programFromRow(row).pushedDates, [THU], "sync: pushes come back intact");
  // The schedule the round trip produces must be the one we started with.
  const week = [MON, TUE, WED, THU, FRI];
  eq(
    week.map(d => getWorkoutForDate(programFromRow(row), d)?.name ?? "Rest"),
    week.map(d => getWorkoutForDate(withSkips, d)?.name ?? "Rest"),
    "sync: the resolved week survives the round trip",
  );
  // A row from before the columns existed reads as "nothing marked", not [].
  const legacy: ProgramRow = { ...row, skipped_dates: [], pushed_dates: [], pulled_dates: [] };
  eq(programFromRow(legacy).skippedDates, undefined, "sync: an empty column reads as absent, not an empty array");
  eq(programFromRow(legacy).pushedDates, undefined, "sync: ...same for pushes");
  eq(programFromRow(legacy).pulledDates, undefined, "sync: ...same for pulls");
  eq(getWorkoutForDate(programFromRow(legacy), TUE)?.name, "Lower", "sync: ...so a legacy program schedules normally");

  // Pulls round-trip too, or the whole repayment is dropped on the next sync.
  const withPull = pullDate(base, WED);
  const pullRow: ProgramRow = { ...programToRow(withPull, "u1"), id: "P", created_at: "t", updated_at: "t" };
  eq(pullRow.pulled_dates, [WED], "sync: pulled dates are written to the row");
  eq(programFromRow(pullRow).pulledDates, [WED], "sync: ...and come back intact");
  eq(
    schedule(programFromRow(pullRow), MON, 14),
    schedule(withPull, MON, 14),
    "sync: the resolved fortnight survives the round trip",
  );

  // The holds too, or a restore re-labels every day before the last pause.
  const held: SavedProgram = { ...base, startDate: "11 Sep 2026", holds: [{ from: THU, to: plus(MON, 7), shift: 4, offsetShift: 0 }] };
  const heldRow: ProgramRow = { ...programToRow(held, "u1"), id: "P", created_at: "t", updated_at: "t" };
  eq(programFromRow(heldRow).holds, held.holds, "sync: holds come back intact");
  eq(programFromRow({ ...heldRow, holds: null }).holds, undefined, "sync: a row from before the column reads as no holds");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("skipped-date invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ skipped-date invariants hold");
