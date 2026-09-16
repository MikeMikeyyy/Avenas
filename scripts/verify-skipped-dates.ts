// Marking a date as rest, and the two things a user might mean by it.
//
// The point of the design is that ONE check in resolveDayIndex makes a skipped
// date disappear from every scheduling surface, so most of this suite is about
// proving that reach: the workout resolver, the streak, and the cycle-push maths.
//
// Run:  npx tsx scripts/verify-skipped-dates.ts
// Exits non-zero (throws) if any assertion fails.

import {
  isDatePushed,
  isDateSkipped,
  pushDate,
  pushesBefore,
  skipDate,
  toggleSkippedDate,
  unskipDate,
} from "../utils/skippedDates";
import { getWorkoutForDate, resolveDayIndex, cycleIndexForDate } from "../utils/workout";
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

  eq(pushesBefore(pushed, MON), 0, "pushesBefore: none before the push itself");
  eq(pushesBefore(pushed, TUE), 0, "pushesBefore: strictly before, so the date doesn't delay itself");
  eq(pushesBefore(pushed, WED), 1, "pushesBefore: counts from the day after");
}

// ─── two pushes stack, and each can be undone independently ─────────────────
{
  const twice = pushDate(pushDate(base, TUE), THU);
  eq(twice.pushedDates, [TUE, THU], "two pushes are both recorded, sorted");
  eq(pushesBefore(twice, FRI), 2, "two earlier pushes delay by two days");
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
  const legacy: ProgramRow = { ...row, skipped_dates: [], pushed_dates: [] };
  eq(programFromRow(legacy).skippedDates, undefined, "sync: an empty column reads as absent, not an empty array");
  eq(programFromRow(legacy).pushedDates, undefined, "sync: ...same for pushes");
  eq(getWorkoutForDate(programFromRow(legacy), TUE)?.name, "Lower", "sync: ...so a legacy program schedules normally");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("skipped-date invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ skipped-date invariants hold");
