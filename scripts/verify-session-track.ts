// scripts/verify-session-track.ts
//
// A workout card says how many sessions of that day you have DONE, and its dot
// track shows where that sits in the PROGRAM.
//
// The case that prompted this: sick for a week, missed two of four sessions, then
// trained the whole of the next week. The card can honestly say "2nd session" —
// it was — as long as the track puts it on the 3rd dot with the 2nd greyed out,
// so a missed week is visible instead of silently closing up.
//
// Run:  npx tsx scripts/verify-session-track.ts
// Exits non-zero if any assertion fails.

import { buildSessionTrack, buildSessionTracks, occurrencesOfDay } from "../utils/sessionTrack";
import { pushDate, skipDate } from "../utils/skippedDates";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

// ─── fixture ─────────────────────────────────────────────────────────────────
// Starts Mon 7 Sep 2026, a 7-day cycle training Mon/Tue/Thu/Fri. So "Upper" (d0)
// falls on Mon 7 Sep, Mon 14 Sep, Mon 21 Sep …
const program: SavedProgram = {
  id: "P", name: "UL", totalWeeks: 8, currentWeek: 1, status: "active",
  startDate: "7 Sep 2026", trainingDays: 4, cycleDays: 7,
  cyclePattern: ["Upper", "Lower", "Rest", "Upper 2", "Legs", "Rest", "Rest"],
  dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
  workouts: {},
};

const MON_W1 = "2026-09-07", MON_W2 = "2026-09-14", MON_W3 = "2026-09-21";

function session(id: string, date: string, dayId = "d0"): CompletedWorkout {
  return {
    id, date, completedAt: `${date}T19:30:00.000Z`, workoutName: "Upper",
    durationSeconds: 3600, exercises: [], programId: "P", dayId,
  };
}

const track = (history: CompletedWorkout[], todayYMD: string, p: SavedProgram = program) =>
  buildSessionTrack({ program: p, dayId: "d0", history, todayYMD });

// ─── the schedule itself ─────────────────────────────────────────────────────
eq(
  occurrencesOfDay(program, "d0", MON_W3),
  [MON_W1, MON_W2, MON_W3],
  "Upper is scheduled on the Monday of each week",
);
eq(occurrencesOfDay(program, "d2", MON_W3), [], "a Rest slot is never an occurrence");
eq(occurrencesOfDay(program, "nope", MON_W3), [], "a day id that isn't in the cycle has no occurrences");

// ─── the reported bug ────────────────────────────────────────────────────────
// Week 1 missed (ill), weeks 2 and 3 trained.
{
  const t = track([session("w2", MON_W2), session("w3", MON_W3)], MON_W3);
  eq(t.numberById["w2"], 2, "the week-2 session is the 2nd session, not the 1st");
  eq(t.numberById["w3"], 3, "the week-3 session is the 3rd session");
  eq(t.missed, [1], "the week the user was ill is reported missed");
}

// A day trained every week keeps counting exactly as before.
{
  const t = track([session("w1", MON_W1), session("w2", MON_W2), session("w3", MON_W3)], MON_W3);
  eq([t.numberById["w1"], t.numberById["w2"], t.numberById["w3"]], [1, 2, 3], "1st, 2nd, 3rd when nothing is missed");
  eq(t.missed, [], "nothing missed");
}

// ─── Make Rest Day ───────────────────────────────────────────────────────────
{
  const skipped = skipDate(program, MON_W2);
  const t = track([session("w1", MON_W1), session("w3", MON_W3)], MON_W3, skipped);
  eq(t.numberById["w3"], 3, "a day marked as rest still costs its number");
  eq(t.missed, [2], "the day marked as rest is the missed one");
}

// ─── Move to Tomorrow ────────────────────────────────────────────────────────
// A push blanks Monday and delays the rest of the cycle, so the session lands on
// Tuesday. It must count ONCE, and must not read as missed.
{
  const pushed = pushDate(program, MON_W2);
  const occ = occurrencesOfDay(pushed, "d0", MON_W3);
  eq(occ.includes(MON_W2), false, "the pushed date itself is not an occurrence");
  eq(occ.filter(d => d >= MON_W2 && d < MON_W3).length, 1, "a moved session is one occurrence, not two");
  const t = track([session("w1", MON_W1), session("w2", "2026-09-15")], MON_W3, pushed);
  eq(t.numberById["w2"], 2, "the moved session is still the 2nd");
  eq(t.missed, [], "moving a workout is not missing it");
}

// ─── logged late ─────────────────────────────────────────────────────────────
{
  // Week 2's Upper trained on the Wednesday, before week 3 comes round.
  const t = track([session("w1", MON_W1), session("late", "2026-09-16")], MON_W3);
  eq(t.numberById["late"], 2, "a session logged late fills its own occurrence");
  eq(t.missed, [], "and that occurrence is not missed");
}

// ─── today ───────────────────────────────────────────────────────────────────
{
  const t = track([session("w1", MON_W1), session("w2", MON_W2)], MON_W3);
  eq(t.missed, [], "today's occurrence isn't missed until the day is over");
  eq(t.occurrences, 3, "today's occurrence still counts towards the total");
}

// ─── a hold invents nothing ──────────────────────────────────────────────────
{
  const held: SavedProgram = { ...program, pausedAt: MON_W2 };
  eq(occurrencesOfDay(held, "d0", MON_W3), [MON_W1], "a held program schedules nothing from the hold on");
  const t = track([session("w1", MON_W1)], MON_W3, held);
  eq(t.missed, [], "the weeks spent on hold are not missed sessions");
}

// ─── logging the missed one afterwards ───────────────────────────────────────
{
  const before = track([session("w2", MON_W2), session("w3", MON_W3)], MON_W3);
  const after  = track([session("w1", MON_W1), session("w2", MON_W2), session("w3", MON_W3)], MON_W3);
  eq(before.missed, [1], "missed before the session is logged");
  eq(after.missed, [], "and not missed once it is");
  eq(after.numberById["w3"], before.numberById["w3"], "logging it leaves the later numbers alone");
}

// ─── two sessions in one week ────────────────────────────────────────────────
// Delete-and-redo, or genuinely training the day twice. Both belong to the same
// occurrence and both say so; neither steals the next week's number.
{
  const t = track([session("a", MON_W2), session("b", "2026-09-16")], MON_W3);
  eq([t.numberById["a"], t.numberById["b"]], [2, 2], "two sessions in one week are both the 2nd");
  eq(t.missed, [1], "and week 1 is still the missed one");
}

// ─── the slot was edited into a Rest day ─────────────────────────────────────
{
  const nowRest: SavedProgram = { ...program, cyclePattern: ["Rest", "Lower", "Rest", "Upper 2", "Legs", "Rest", "Rest"] };
  eq(occurrencesOfDay(nowRest, "d0", MON_W3), [], "a slot turned into Rest schedules nothing");
  const t = track([session("w1", MON_W1)], MON_W3, nowRest);
  eq(t.missed, [], "and invents no missed sessions for the days it used to hold");
}

// ─── a resumed hold ──────────────────────────────────────────────────────────
// Resuming moves startDate, so occurrences before the hold can't be re-derived.
// What must hold regardless: numbers stay distinct and in date order.
{
  const resumed: SavedProgram = { ...program, startDate: "14 Sep 2026" }; // start shifted a week
  const t = track([session("w1", MON_W1), session("w2", MON_W2), session("w3", MON_W3)], MON_W3, resumed);
  const numbers = ["w1", "w2", "w3"].map(id => t.numberById[id] ?? 0);
  eq(new Set(numbers).size, numbers.length, "after a resume every session still has its own number");
  eq([...numbers].sort((a, b) => a - b), numbers, "and they still ascend with the dates");
}

// ─── day spacing ─────────────────────────────────────────────────────────────
// Walks a year, including both daylight-saving transitions in either hemisphere.
// A floor-vs-round slip in the date stepping shows up here as an 8- or 6-day gap.
{
  const year: SavedProgram = { ...program, totalWeeks: 52 };
  const occ = occurrencesOfDay(year, "d0", "2027-09-06");
  const gaps = new Set(occ.slice(1).map((d, i) => {
    const a = new Date(occ[i]).getTime();
    const b = new Date(d).getTime();
    return Math.round((b - a) / 86400000);
  }));
  eq([...gaps], [7], "every occurrence is exactly one cycle after the last, all year");
  eq(occ.length, 52, "and there is one a week for a 52-week program");
}

// ─── nothing to count ────────────────────────────────────────────────────────
{
  const noStart: SavedProgram = { ...program, startDate: "not a date" };
  eq(occurrencesOfDay(noStart, "d0", MON_W3), [], "an unparseable start date counts nothing");
  const t = track([session("w1", MON_W1)], MON_W3, noStart);
  eq(t.numberById, {}, "so no session gets a number, and the caller falls back");
}

// ─── what the screens actually call ──────────────────────────────────────────
// buildSessionTracks does the grouping and the fallback that Home and the
// Journal used to each do for themselves.
// The card says how many you've DONE; the dot says where you are in the program.
// Week 1 missed, weeks 2 and 3 trained: week 3 is your 2nd session, on the 3rd
// dot, with the 1st greyed out.
{
  const tracks = buildSessionTracks(
    [session("w2", MON_W2), session("w3", MON_W3)],
    [program],
    MON_W3,
  );
  eq(tracks.numberById["w3"], 2, "the card counts sessions done: this is the 2nd");
  eq(tracks.positionById["w3"], 3, "but it sits on the 3rd dot, where the program is");
  eq(tracks.numberById["w2"], 1, "and the week before it was the 1st done");
  eq(tracks.positionById["w2"], 2, "on the 2nd dot");
  eq(tracks.missedById["w3"], [1], "with the missed week greyed");
}

// Nothing missed: the two numbers agree, as they always did.
{
  const tracks = buildSessionTracks(
    [session("w1", MON_W1), session("w2", MON_W2), session("w3", MON_W3)],
    [program],
    MON_W3,
  );
  eq(["w1", "w2", "w3"].map(id => tracks.numberById[id]), [1, 2, 3], "count with nothing missed");
  eq(["w1", "w2", "w3"].map(id => tracks.positionById[id]), [1, 2, 3], "and the dots match it");
}

// A free workout: no program owns it, so it keeps a plain count and no dots.
{
  const free: CompletedWorkout = {
    id: "free", date: MON_W2, completedAt: `${MON_W2}T18:00:00.000Z`, workoutName: "Arms",
    durationSeconds: 1800, exercises: [], programId: "",
  };
  const tracks = buildSessionTracks([free], [program], MON_W3);
  eq(tracks.numberById["free"], 1, "a free workout still gets a number");
  eq(tracks.positionById["free"], 1, "its dot sits where the count says");
  eq(tracks.missedById["free"], undefined, "but never a missed dot");
}

// Two programs whose slots are both positional "d0": one program's sessions must
// not count towards the other's day.
{
  const other: SavedProgram = { ...program, id: "P2", name: "Other", status: "completed", startDate: "1 Jun 2026" };
  const mine = session("mine", MON_W3);
  const theirs: CompletedWorkout = { ...session("theirs", "2026-06-01"), programId: "P2" };
  const tracks = buildSessionTracks([theirs, mine], [program, other], MON_W3);
  eq(tracks.numberById["mine"], 1, "the other program's d0 sessions don't shift this one's count");
  eq(tracks.positionById["mine"], 3, "and this one still sits on its own program's 3rd dot");
}

// ─── report ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ session counts and their place on the program's track hold");
