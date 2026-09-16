// Marking a date as rest, and the two things a user might mean by it.
//
// The point of the design is that ONE check in resolveDayIndex makes a skipped
// date disappear from every scheduling surface, so most of this suite is about
// proving that reach: the workout resolver, the streak, and the cycle-push maths.
//
// Run:  npx tsx scripts/verify-skipped-dates.ts
// Exits non-zero (throws) if any assertion fails.

import {
  isDatePulled,
  isDatePushed,
  isDateSkipped,
  pullDate,
  pushDate,
  skipDate,
  toggleSkippedDate,
  unskipDate,
} from "../utils/skippedDates";
import { cycleDrift } from "../utils/cycleDrift";
import { getWorkoutForDate, resolveDayIndex, resolveWorkoutForDate, cycleIndexForDate, normalizeDriftDates } from "../utils/workout";
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
  eq(sessionCount(pulled), sessionCount(base) + 1, "pull: sessions only move earlier, none are deleted");

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

// ─── normalisation keeps the three lists disjoint ────────────────────────────
{
  const clash = normalizeDriftDates({ ...base, skippedDates: [WED], pulledDates: [WED] });
  eq((clash.pulledDates ?? []).includes(WED), false, "normalise: a date can't be both skipped and spent");
  const clash2 = normalizeDriftDates(pullDate(pushDate(base, WED), WED));
  eq((clash2.pulledDates ?? []).includes(WED), false, "normalise: ...nor both pushed and spent");
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

// ─── resuming from a hold drops the marks the hold swallowed ────────────────
{
  const held = pushDate({ ...base, pausedAt: TUE }, plus(TUE, 2));
  const resumed = normalizeDriftDates({
    ...held,
    pausedAt: undefined,
    skippedDates: (held.skippedDates ?? []).filter(d => !(d >= TUE && d < plus(TUE, 5))),
    pushedDates: (held.pushedDates ?? []).filter(d => !(d >= TUE && d < plus(TUE, 5))),
  });
  // utils/programPause.ts can't be imported here (it pulls in React Native), so
  // this mirrors its filter; the invariant is what matters, not the empty-array
  // convention around it.
  eq((resumed.pushedDates ?? []).length, 0, "resume: a push inside the hold window is dropped");
  eq(cycleDrift(resumed, plus(TUE, 10)), 0, "resume: ...so it can't extend the program for days nothing was scheduled on");
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
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("skipped-date invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ skipped-date invariants hold");
