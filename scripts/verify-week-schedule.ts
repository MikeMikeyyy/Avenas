// Home's "This Week's Schedule" against the Workout tab: the two must never
// disagree about what today holds.
//
// Every case here is one a user hit: a workout logged at 1am showing the day as
// Rest, Change Workout Day updating one page and not the other, and the state
// left behind after completing a workout, deleting it and doing it again.
//
// Run:  npx tsx scripts/verify-week-schedule.ts
// Exits non-zero if any assertion fails.

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import { buildWeekSchedule, weekStartFor } from "../utils/weekSchedule";
import { getEffectiveToday, resolveWorkoutForDate, type DayOverride } from "../utils/workout";
import { pickAfterMove, pickAfterUndoMove, planDoItTomorrow, skipDate, unskipDate } from "../utils/skippedDates";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

// ─── fixture ─────────────────────────────────────────────────────────────────
// Starts Mon 14 Sep 2026. Cycle: Upper, Lower, Rest, Upper, Rest, Legs, Rest,
// so Friday 18 Sep is a REST day in the cycle and Saturday is Legs.
const MON = "2026-09-14", TUE = "2026-09-15", WED = "2026-09-16";
const THU = "2026-09-17", FRI = "2026-09-18";

const program: SavedProgram = {
  id: "P", name: "UL", totalWeeks: 8, currentWeek: 1, status: "active",
  startDate: "14 Sep 2026", trainingDays: 4, cycleDays: 7,
  cyclePattern: ["Upper", "Lower", "Rest", "Upper", "Rest", "Legs", "Rest"],
  dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
  workouts: { "5:Legs": [{ id: "e1", name: "Squat", sets: [] }] },
};

function session(date: string, workoutName: string, id = `w-${date}-${workoutName}`): CompletedWorkout {
  return { id, date, completedAt: `${date}T19:30:00.000Z`, workoutName, durationSeconds: 3600, exercises: [], programId: "P" };
}

/** The strip exactly as Home builds it: the same resolver the Workout tab uses
 *  feeds the effective day's row. */
function strip(history: CompletedWorkout[], now: Date, override: DayOverride | null = null, p: SavedProgram = program) {
  const effectiveToday = getEffectiveToday(p, history, now);
  const resolved = resolveWorkoutForDate(p, override, effectiveToday, [p]);
  const schedule = buildWeekSchedule({
    program: p,
    history,
    weekStartYMD: weekStartFor(effectiveToday),
    effectiveToday,
    resolvedTodayName: resolved?.name ?? null,
    override,
    allPrograms: [p],
  });
  return { effectiveToday, resolvedName: resolved?.name ?? null, schedule };
}
const row = (s: ReturnType<typeof strip>, date: string) => s.schedule.days.find(d => d.dateYMD === date)!;
const names = (s: ReturnType<typeof strip>) => s.schedule.days.map(d => d.workoutName);

// ─── the plan, with nothing logged ───────────────────────────────────────────
{
  const s = strip([], new Date("2026-09-18T09:00:00"));
  eq(s.effectiveToday, FRI, "Friday morning: today is Friday");
  eq(names(s), ["Upper", "Lower", "Rest", "Upper", "Rest", "Legs", "Rest"], "the week reads straight off the cycle");
  eq(row(s, FRI).isToday, true, "Friday is marked as today");
  eq(row(s, FRI).isRest, true, "and it's a rest day in this cycle");
}

// ─── THE BUG: a workout logged at 1am, seen in the morning ───────────────────
// At 1am Friday the app is still on Thursday (before the 3am rollover) while
// Thursday's Upper is unfinished, so the session is dated Thursday.
{
  const at1am = new Date("2026-09-18T01:00:00");
  eq(getEffectiveToday(program, [], at1am), THU, "1am Friday: the app is still on Thursday");

  const logged = [session(THU, "Upper")];
  const night = strip(logged, at1am);
  eq(night.effectiveToday, FRI, "once Thursday is logged, 1am rolls over to Friday");

  const morning = strip(logged, new Date("2026-09-18T08:00:00"));
  eq(row(morning, THU).workoutName, "Upper", "Thursday keeps the workout that was logged on it");
  eq(row(morning, THU).completed, true, "and shows as done");
  eq(row(morning, THU).editable, false, "a day you trained can't be marked off");
  eq(row(morning, FRI).isToday, true, "Friday is today in the morning");
}

// A session logged on a day the CYCLE calls Rest (a custom workout, or a day
// swapped in by change-day) is what the strip shows. This is the report: it
// used to say "Rest" with no tick, hiding the workout entirely.
{
  const s = strip([session(FRI, "Legs")], new Date("2026-09-18T08:00:00"));
  eq(row(s, FRI).workoutName, "Legs", "a workout logged on a cycle rest day shows by name");
  eq(row(s, FRI).completed, true, "with its tick");
  eq(row(s, FRI).isRest, false, "and doesn't read as a rest day");
  eq([s.schedule.completedCount, s.schedule.plannedCount], [1, 5],
    "the ring counts it, so it can never read 1 of 0");
}

// ─── Change Workout Day moves BOTH pages ─────────────────────────────────────
{
  const now = new Date("2026-09-18T08:00:00");
  const plain = strip([], now);
  eq(row(plain, FRI).workoutName, "Rest", "before: Friday is a rest day on the strip");

  const override: DayOverride = { date: FRI, workoutName: "Legs", programId: "P", dayId: "d5" };
  const swapped = strip([], now, override);
  eq(swapped.resolvedName, "Legs", "the Workout tab resolves Friday to Legs");
  eq(row(swapped, FRI).workoutName, "Legs", "and the strip says Legs too");
  eq(row(swapped, FRI).isRest, false, "so the row no longer reads as rest");
  eq(row(swapped, FRI).editable, true, "and it can be skipped or moved like any planned day");

  // Changing your mind again follows through to the strip.
  const again = strip([], now, { date: FRI, workoutName: "Upper", programId: "P", dayId: "d3" });
  eq(row(again, FRI).workoutName, "Upper", "picking a different day updates the strip again");

  // An override left over from a previous day is ignored by BOTH pages.
  const stale = strip([], now, { date: THU, workoutName: "Legs", programId: "P", dayId: "d5" });
  eq([stale.resolvedName, row(stale, FRI).workoutName], [null, "Rest"],
    "yesterday's override doesn't leak into today on either page");
  eq(row(stale, THU).workoutName, "Upper", "nor back onto yesterday's own row, which reads its plan");
}

// ─── Move to Tomorrow takes a Change Workout Day pick with it ────────────────
// The report: Legs picked on Thursday's Upper, then "Not doing 'Legs'? Move to
// Tomorrow" moved UPPER and dropped the pick.
{
  const thursday = new Date("2026-09-17T08:00:00");
  const pick: DayOverride = { date: THU, workoutName: "Legs", programId: "P", dayId: "d5" };
  const plan = planDoItTomorrow(program, THU);
  const carried = pickAfterMove(program, pick, THU);
  eq(carried?.date, FRI, "the pick is carried to Friday");

  const moved = strip([], thursday, carried, plan.program);
  eq([row(moved, THU).workoutName, row(moved, THU).isPushed], ["Rest", true], "Thursday is moved, with nothing left on it");
  eq(row(moved, FRI).workoutName, "Legs", "Friday shows the pick on the strip before Friday arrives");
  eq(names(moved).slice(5), ["Legs", "Rest"], "Saturday's rest absorbs the move, so the weekend is back on plan");
  // The prompt names the lost rest day by what lands on it: the pick, since it
  // travels with the slot (utils/restDay.ts reads plan.lostRestDay for this).
  eq(plan.kind === "absorbed" ? plan.lostRestDay : null, carried?.date, "the rest day lost is Friday, where the pick lands");

  const friday = strip([], new Date("2026-09-18T08:00:00"), carried, plan.program);
  eq([friday.resolvedName, row(friday, FRI).workoutName], ["Legs", "Legs"], "on Friday both pages say Legs");

  // Undone from the strip: the move comes off and the pick comes home.
  const restored = pickAfterUndoMove(carried, THU);
  const undone = strip([], thursday, restored, unskipDate(plan.program, THU));
  eq([undone.resolvedName, row(undone, THU).workoutName], ["Legs", "Legs"], "undo: Thursday is Legs again on both pages");
  eq(row(undone, FRI).workoutName, "Rest", "undo: and Friday is back to its rest day");
}

// ─── complete, delete, do it again ───────────────────────────────────────────
{
  const now = new Date("2026-09-18T08:00:00");
  const override: DayOverride = { date: FRI, workoutName: "Legs", programId: "P", dayId: "d5" };

  const before = strip([], now, override);
  eq([row(before, FRI).workoutName, row(before, FRI).completed], ["Legs", false], "1. swapped in, not yet done");

  const done = strip([session(FRI, "Legs", "first")], now, override);
  eq([row(done, FRI).workoutName, row(done, FRI).completed], ["Legs", true], "2. finished: same name, now ticked");
  eq(row(done, FRI).editable, false, "   and locked while it stands");

  // Deleted from the workout detail screen: history is the only record, so the
  // row falls back to what's planned and the tick goes.
  const deleted = strip([], now, override);
  eq([row(deleted, FRI).workoutName, row(deleted, FRI).completed], ["Legs", false], "3. deleted: back to the swapped-in day, no tick");
  eq(row(deleted, FRI).editable, true, "   and tappable again");

  const redone = strip([session(FRI, "Legs", "second")], now, override);
  eq([row(redone, FRI).workoutName, row(redone, FRI).completed], ["Legs", true], "4. done again: ticked again");
  eq(redone.schedule.completedCount, 1, "   counted once, not twice");

  // Two sessions on one date (delete-and-redo that left both, or a double
  // session): the newest is the one shown.
  const twice = strip(
    [session(FRI, "Legs", "old"), { ...session(FRI, "Custom", "new"), completedAt: `${FRI}T21:00:00.000Z` }],
    now, override,
  );
  eq(row(twice, FRI).workoutName, "Custom", "two sessions on a date: the newest is shown");
}

// ─── days marked off still behave ────────────────────────────────────────────
{
  const now = new Date("2026-09-16T08:00:00"); // Wednesday, a rest day in this cycle
  const skipped = skipDate(program, THU);      // tomorrow marked off
  const s = strip([], now, null, skipped);
  eq(row(s, THU).workoutName, "Rest", "a day marked off reads as rest");
  eq([row(s, THU).isSkipped, row(s, THU).editable], [true, true], "and can be put back");
  eq(row(s, TUE).isPast, true, "Tuesday is in the past on Wednesday");
  eq(row(s, MON).editable, true, "a workout missed earlier in the week can still be made a rest day");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ Home's week strip agrees with the Workout tab");
