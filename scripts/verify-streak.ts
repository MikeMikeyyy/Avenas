// Streak rules: rest days freeze it, one missed workout day is free, the second
// one ends it — and the single reminder lands on the night it would actually end.
//
// Run:  npx tsx scripts/verify-streak.ts
// Exits non-zero (throws) if any assertion fails.

import {
  STREAK_GRACE_DAYS,
  isStreakRecord,
  isStreakRiskDay,
  missedStreakDays,
  streakBreakDate,
  streakOnOpen,
  streakSurvives,
  type StreakRecord,
} from "../utils/streak";
import { daysBetweenYMD, fromYMD, toYMD } from "../utils/dates";
import type { SavedProgram } from "../constants/programs";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

// ─── fixtures ────────────────────────────────────────────────────────────────
// 2026-09-07 is a Monday. Cycle starts that day.

const base: Omit<SavedProgram, "cyclePattern" | "cycleDays"> = {
  id: "P", name: "Prog", totalWeeks: 8, currentWeek: 1, status: "active",
  startDate: "07 Sep 2026", trainingDays: 0, workouts: {},
};

/** Mon/Wed/Fri training, Tue/Thu/Sat/Sun rest — the shape that used to kill a
 *  streak for resting exactly as programmed. */
const mwf: SavedProgram = {
  ...base, cycleDays: 7, trainingDays: 3,
  cyclePattern: ["Upper", "Rest", "Lower", "Rest", "Full", "Rest", "Rest"],
};
/** Every day is a training day — the worst case for the grace allowance. */
const everyDay: SavedProgram = {
  ...base, cycleDays: 1, trainingDays: 1, cyclePattern: ["Train"],
};

const MON = "2026-09-07", TUE = "2026-09-08", WED = "2026-09-09";
const THU = "2026-09-10", FRI = "2026-09-11", SAT = "2026-09-12";
const SUN = "2026-09-13", NEXT_MON = "2026-09-14", NEXT_TUE = "2026-09-15";

// ─── date helpers the rules stand on ─────────────────────────────────────────

eq(toYMD(fromYMD("2026-09-07")!), "2026-09-07", "fromYMD/toYMD round-trip");
eq(fromYMD("2026-09-07")!.getHours(), 0, "fromYMD lands on LOCAL midnight");
eq(fromYMD("not-a-date"), null, "fromYMD rejects malformed input");
eq(fromYMD("2026-9-7"), null, "fromYMD requires zero padding");
eq(daysBetweenYMD(MON, THU), 3, "daysBetweenYMD counts forward");
eq(daysBetweenYMD(THU, MON), -3, "daysBetweenYMD counts backward");
eq(daysBetweenYMD(MON, MON), 0, "daysBetweenYMD same day is 0");
eq(daysBetweenYMD("bad", MON), null, "daysBetweenYMD rejects malformed input");
// A gap spanning a DST boundary must still be whole days (both ends are local
// midnights, so the rounding absorbs the 23- and 25-hour days).
eq(daysBetweenYMD("2026-03-01", "2026-04-01"), 31, "daysBetweenYMD is DST-safe");

// ─── which days can cost you the streak ──────────────────────────────────────

eq(isStreakRiskDay(mwf, MON), true, "risk day: programmed workout counts");
eq(isStreakRiskDay(mwf, TUE), false, "risk day: Rest does not count");
eq(isStreakRiskDay(mwf, WED), true, "risk day: second training day counts");
eq(isStreakRiskDay(mwf, SAT), false, "risk day: weekend rest does not count");
eq(isStreakRiskDay(null, TUE), true, "risk day: no program -> every day counts");
eq(
  isStreakRiskDay({ ...mwf, startDate: "not a date" }, TUE),
  true,
  "risk day: unparseable startDate behaves as no program, never a silent freeze",
);
eq(
  isStreakRiskDay({ ...mwf, pausedAt: MON }, WED),
  false,
  "risk day: a held program schedules nothing, so the streak freezes",
);
eq(
  isStreakRiskDay({ ...mwf, pausedAt: FRI }, WED),
  true,
  "risk day: days BEFORE the hold still count",
);

// ─── the user's exact scenario ───────────────────────────────────────────────
// "log on Monday, Tuesday I don't, then Wednesday I don't -> Thursday resets"
// (all workout days).

eq(missedStreakDays(everyDay, MON, TUE), 0, "every-day: opening Tue misses nothing");
eq(streakSurvives(everyDay, MON, TUE), true, "every-day: Mon -> Tue survives");
eq(missedStreakDays(everyDay, MON, WED), 1, "every-day: opening Wed missed Tue only");
eq(streakSurvives(everyDay, MON, WED), true, "every-day: Mon -> Wed survives on the free day");
eq(missedStreakDays(everyDay, MON, THU), 2, "every-day: opening Thu missed Tue AND Wed");
eq(streakSurvives(everyDay, MON, THU), false, "every-day: Mon -> Thu RESETS, exactly as asked");
eq(streakSurvives(everyDay, MON, FRI), false, "every-day: a longer gap still resets");

// ─── rest days freeze it ─────────────────────────────────────────────────────

eq(missedStreakDays(mwf, MON, WED), 0, "MWF: Tue is a rest day, so nothing was missed");
eq(streakSurvives(mwf, MON, WED), true, "MWF: resting Tue as programmed keeps the streak");
eq(missedStreakDays(mwf, MON, FRI), 1, "MWF: only Wed counts between Mon and Fri");
eq(streakSurvives(mwf, MON, FRI), true, "MWF: one missed workout day is free");
eq(missedStreakDays(mwf, MON, NEXT_MON), 2, "MWF: Wed and Fri both missed");
eq(streakSurvives(mwf, MON, NEXT_MON), false, "MWF: two missed workout days resets");
// Friday into the next week: Sat/Sun/Tue are all rest, so a whole weekend costs
// nothing — this is the case that used to break a streak for following the plan.
eq(streakSurvives(mwf, FRI, NEXT_MON), true, "MWF: a full rest weekend never breaks it");
eq(missedStreakDays(mwf, FRI, NEXT_MON), 0, "MWF: Sat+Sun are not misses");
eq(streakSurvives(mwf, FRI, NEXT_TUE), true, "MWF: Sat, Sun, and one missed Mon is still fine");

// ─── freezes ─────────────────────────────────────────────────────────────────

const held: SavedProgram = { ...mwf, pausedAt: TUE };
eq(missedStreakDays(held, MON, "2026-12-25"), 0, "held program: months away, nothing missed");
eq(streakSurvives(held, MON, "2026-12-25"), true, "held program: the streak freezes indefinitely");

// Same-day and out-of-order opens never cost anything.
eq(missedStreakDays(everyDay, WED, WED), 0, "same day: nothing between");
eq(streakSurvives(everyDay, WED, WED), true, "same day: survives");
eq(streakSurvives(everyDay, WED, MON), true, "clock moved backwards: survives rather than punishing");
eq(missedStreakDays(everyDay, "bad-date", WED), 0, "malformed lastOpened: no misses invented");
eq(streakSurvives(null, MON, WED), true, "no program: one missed calendar day is free");
eq(streakSurvives(null, MON, THU), false, "no program: two missed calendar days resets");

// ─── the reminder lands on the night it would actually end ───────────────────

eq(STREAK_GRACE_DAYS, 1, "grace is one day");
// All-workout program: open Monday, so the break night is Wednesday (the 2nd
// unopened workout day). NOT Tuesday, which is the free one.
eq(streakBreakDate(everyDay, MON, 7), WED, "reminder: every-day program breaks Wednesday night");
// MWF: after Monday the training days are Wed then Fri, so Friday is the night.
eq(streakBreakDate(mwf, MON, 7), FRI, "reminder: MWF breaks Friday night, not Tuesday");
// After Friday: next training days are Mon then Wed, so it rides through the
// weekend and lands the following Wednesday. Needs a horizon long enough to see it.
eq(streakBreakDate(mwf, FRI, 7), "2026-09-16", "reminder: a rest weekend pushes the night out");
eq(streakBreakDate(mwf, FRI, 3), null, "reminder: nothing at risk inside a short horizon -> no nudge");
eq(streakBreakDate(held, MON, 7), null, "reminder: a held program is never at risk, so never nags");
eq(streakBreakDate(null, MON, 7), WED, "reminder: no program falls back to calendar days");
eq(streakBreakDate(everyDay, "bad-date", 7), null, "reminder: malformed date schedules nothing");
// The break night is always strictly after the day the app was last opened —
// the bug being fixed was a reminder firing on a day the user HAD opened it.
for (const [prog, label] of [[everyDay, "every-day"], [mwf, "MWF"], [null, "no program"]] as const) {
  const d = streakBreakDate(prog, WED, 14);
  eq(d !== null && d > WED, true, `reminder: ${label} never nags on the day just opened`);
}

// ─── each open, launched or back from the background ─────────────────────────
// contexts/StreakContext.tsx runs streakOnOpen on launch AND on every return to
// the foreground. It ran on launch only, and iOS keeps the app in memory for
// days: a week away came back to the old number, and a day the app was only
// brought back on went uncounted (user report, 2026-10-28).

{
  const at = (day: string, count: number, extra: Partial<StreakRecord> = {}): StreakRecord => ({
    count, startDate: "2026-09-01", highestStreak: Math.max(count, 9), lastOpenedDate: day, openedDates: [day], dayBasis: "local", ...extra,
  });
  const open = (saved: StreakRecord | null, today: string, program: SavedProgram | null = mwf) => streakOnOpen(saved, today, program);

  const first = open(null, MON);
  eq([first.record.count, first.record.highestStreak, first.record.openedDates, first.write], [1, 1, [MON], true], "open: the first ever starts at 1");
  const again = open(at(MON, 5), MON);
  eq([again.record.count, again.write, again.grew], [5, false, false], "open: a second open the same day changes nothing, writes nothing");

  const wed = open(at(MON, 5), WED);
  eq([wed.record.count, wed.grew, wed.record.lastOpenedDate, wed.record.openedDates], [6, true, WED, [MON, WED]],
    "open: back on Wednesday (Tuesday a rest day) carries the streak on");

  // Opened every day, each one only bringing the app back. Every day counts.
  let daily = at(MON, 5);
  for (const day of [TUE, WED, THU, FRI, SAT, SUN, NEXT_MON]) daily = open(daily, day).record;
  eq([daily.count, daily.openedDates.length], [12, 8], "open: every day the app is brought back counts, a week of them +7");
  // What happened when those days weren't recorded: the next launch measured
  // from Monday, found Wed, Fri and Mon unopened, and ended a streak kept daily.
  eq(open(at(MON, 5), NEXT_TUE).record.count, 1, "open: (unrecorded days look like a week away, which ends it)");

  // A week away, back on Tuesday, the auto-pause holding the program from that
  // day: Wed, Fri and Mon were missed, so it ends, the best kept.
  const away = open(at(MON, 5, { highestStreak: 20 }), NEXT_TUE, { ...mwf, pausedAt: NEXT_TUE });
  eq([away.record.count, away.record.highestStreak, away.record.startDate, away.grew], [1, 20, NEXT_TUE, false],
    "open: a week away ends it, even with the program held from the day you come back");
  // Held before going away: a hold freezes it (as it always has).
  eq(open(at(MON, 5), "2026-12-25", held).record.count, 6, "open: held from before the absence, months away still carry on");
  eq(open(at(MON, 9, { highestStreak: 9 }), WED).record.highestStreak, 10, "open: a new best is kept as the best");

  // Older records.
  const legacy = { count: 3, startDate: MON, highestStreak: 3, lastOpenedDate: MON } as StreakRecord;
  const legacySame = open(legacy, MON);
  eq([legacySame.record.openedDates, legacySame.record.dayBasis, legacySame.write], [[MON], "local", true],
    "open: a record from before opened dates and local days gains both, and is written");
  eq(isStreakRecord(legacy), true, "record: an older one without opened dates still reads as a streak");
  eq(isStreakRecord({ count: "3" }), false, "record: anything else doesn't");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("streak invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ streak invariants hold");
