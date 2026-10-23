// The Workout tab's timer (components/WorkoutTimerScreen.tsx), through its pure
// rules in utils/workoutTimer.ts and the store in utils/workoutTimerStore.ts.
// User design and decisions, 2026-10-15:
//
//   - Your own countdown and the stopwatch start, pause, resume and reset;
//     ±15s move your countdown while it runs, not only before it starts, and
//     −15s past nothing is Time's up, where +15s is 15 seconds more.
//   - −15s and +15s are always either side of the middle button on Timer, a
//     rest or your countdown, and Reset is under it on both modes (user
//     report, 2026-10-15: the first build drew neither).
//   - A rest takes the dial over (Rest, Skip in the middle, ±15s, Reset to
//     start it over), and has no pause. One that runs out with the timer open
//     reads Time's up, the ring full and glowing; a Skip doesn't. −15s that
//     ends a rest reads Time's up, at exactly the point the rest timer ends it.
//   - The stopwatch's ring goes round once a minute.
//   - The card at the foot is the set the Workout screen glows on, the lock
//     screen card's next set, and moves on only with a tick; the workout bar's
//     "Up next" line reads the same set.
//
// Run:  npx tsx scripts/verify-workout-timer.ts
// Exits non-zero (throws) if any assertion fails.

import {
  adjustCountdown,
  countdownLeftSec,
  countdownPhase,
  dialView,
  formatClock,
  lessEndsRest,
  newCountdown,
  newStopwatch,
  pauseCountdown,
  pauseStopwatch,
  resetCountdown,
  restRanOut,
  sameUpNext,
  setCountdownDuration,
  setNumbersText,
  startCountdown,
  startStopwatch,
  nextChangeIn,
  ringAt,
  ringPlan,
  stopwatchElapsedMs,
  stopwatchPhase,
  upNextFrom,
  upNextTail,
  wheelsFor,
  wheelsSec,
  WHEEL_MINUTES,
  WHEEL_SECONDS,
  type Countdown,
  type DialArgs,
  type DialView,
  type RestState,
  type RingMotion,
  type Stopwatch,
  type TimerMode,
} from "../utils/workoutTimer";
import {
  getTimerState,
  getUpNext,
  publishUpNext,
  subscribeTimerState,
  subscribeUpNext,
  updateTimerState,
} from "../utils/workoutTimerStore";
import { buildLiveActivityQueue, logWithLockScreenTicks } from "../utils/liveActivity";
import { nextSetOf } from "../utils/nextSet";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

const T = 1_800_000_000_000;
const s = (sec: number) => sec * 1000;

// ─── your own countdown ──────────────────────────────────────────────────────

{
  eq(newCountdown().durationSec, 60, "countdown: a minute to start with");
  eq(newCountdown(3).durationSec, 5, "countdown: never under 5 seconds");
  eq(newCountdown(10_000).durationSec, 99 * 60 + 59, "countdown: never over 99:59");

  const ready = newCountdown(60);
  eq(countdownPhase(ready, T), "ready", "countdown: ready before it starts");
  eq(countdownLeftSec(ready, T), 60, "countdown: ready shows its whole time");

  const running = startCountdown(ready, T);
  eq(countdownPhase(running, T + s(20)), "running", "countdown: running once started");
  eq(countdownLeftSec(running, T + 400), 60, "countdown: counted up, so 01:00 shows for its first second");
  eq(countdownLeftSec(running, T + s(1)), 59, "countdown: a second in, 00:59");
  eq(countdownLeftSec(running, T + s(60) - 1), 1, "countdown: 00:01 until it's really over");
  eq(countdownPhase(running, T + s(60)), "done", "countdown: done at its end");
  eq(countdownLeftSec(running, T + s(61)), 0, "countdown: nothing left once done");
  eq(startCountdown(running, T + s(5)), running, "countdown: Start while it runs changes nothing");

  const paused = pauseCountdown(running, T + 20_500);
  eq(countdownPhase(paused, T + s(500)), "paused", "countdown: paused stays paused, however long");
  eq(countdownLeftSec(paused, T + s(500)), 40, "countdown: paused with 39.5s left shows 00:40");
  eq(pauseCountdown(paused, T + s(30)), paused, "countdown: Pause while paused changes nothing");
  const resumed = startCountdown(paused, T + s(100));
  eq(resumed.endsAt, T + s(100) + 39_500, "countdown: Resume picks up exactly what was left");
  eq(countdownLeftSec(resumed, T + s(100)), 40, "countdown: resumed, the same 00:40");

  eq(resetCountdown(resumed), { durationSec: 60, endsAt: null, leftMs: null }, "countdown: Reset is ready on the same time");
  eq(setCountdownDuration(running, 90), { durationSec: 90, endsAt: null, leftMs: null }, "countdown: a time set on the wheels is ready on it");
  eq(setCountdownDuration(ready, 0).durationSec, 5, "countdown: 00:00 on the wheels is the shortest, 00:05");

  // The wheels a tap on the time turns into: minutes, and seconds in fives.
  eq([WHEEL_MINUTES.length, WHEEL_MINUTES[0], WHEEL_MINUTES[99]], [100, "00", "99"], "wheels: minutes 00 to 99");
  eq(WHEEL_SECONDS, ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"], "wheels: seconds in fives");
  eq(wheelsFor(60), { min: 1, sec: 0 }, "wheels: 01:00 opens on 01 and 00");
  eq(wheelsFor(90), { min: 1, sec: 6 }, "wheels: 01:30 opens on 01 and 30");
  eq(wheelsFor(5), { min: 0, sec: 1 }, "wheels: the shortest, 00:05");
  eq(wheelsFor(63), { min: 1, sec: 1 }, "wheels: a time between fives opens on the nearest (01:03 on 01:05)");
  eq(wheelsFor(57), { min: 0, sec: 11 }, "wheels: never past the last five (00:57 on 00:55)");
  eq(wheelsFor(99 * 60 + 59), { min: 99, sec: 11 }, "wheels: the longest opens on 99 and 55");
  eq(wheelsSec({ min: 2, sec: 9 }), 165, "wheels: 02 and 45 are 165 seconds");
  {
    let roundTrips = true;
    for (let sec = 5; sec <= 99 * 60 + 55; sec += 5) {
      if (wheelsSec(wheelsFor(sec)) !== sec) { roundTrips = false; break; }
    }
    eq(roundTrips, true, "wheels: every time in fives opens on itself");
  }

  // ±15s
  eq(adjustCountdown(ready, 15, T).durationSec, 75, "+15s before it starts: a longer time");
  eq(adjustCountdown(newCountdown(10), -15, T).durationSec, 5, "−15s before it starts: never under 5 seconds");
  eq(adjustCountdown(newCountdown(99 * 60 + 59), 15, T).durationSec, 99 * 60 + 59, "+15s before it starts: never over 99:59");
  eq(adjustCountdown(running, 15, T + s(20)).endsAt, T + s(75), "+15s while it runs: 15 seconds more left");
  eq(adjustCountdown(running, -15, T + s(20)).endsAt, T + s(45), "−15s while it runs: 15 seconds less left");
  const cut = adjustCountdown(running, -15, T + s(50));
  eq([cut.endsAt, countdownPhase(cut, T + s(50))], [T + s(50), "done"], "−15s with 10s left: Time's up, now");
  eq(adjustCountdown(paused, 15, T + s(200)).leftMs, 54_500, "+15s while paused: more left, still paused");
  const pausedOut = adjustCountdown(pauseCountdown(running, T + s(50)), -15, T + s(70));
  eq([pausedOut.endsAt, countdownPhase(pausedOut, T + s(70))], [T + s(70), "done"], "−15s while paused with 10s left: Time's up");
  const done = startCountdown(ready, T);
  const more = adjustCountdown(done, 15, T + s(90));
  eq([more.endsAt, countdownPhase(more, T + s(90)), countdownLeftSec(more, T + s(90))], [T + s(105), "running", 15], "+15s at Time's up: 15 seconds more, counting");
  eq(adjustCountdown(done, -15, T + s(90)), done, "−15s at Time's up: nothing left to take");
}

// ─── the stopwatch ───────────────────────────────────────────────────────────

{
  const sw0 = newStopwatch();
  eq(stopwatchPhase(sw0), "ready", "stopwatch: ready at first");
  const sw1 = startStopwatch(sw0, T);
  eq(stopwatchPhase(sw1), "running", "stopwatch: running once started");
  eq(stopwatchElapsedMs(sw1, T + s(90)), s(90), "stopwatch: counts from its start");
  eq(startStopwatch(sw1, T + s(5)), sw1, "stopwatch: Start while it runs changes nothing");
  const sw2 = pauseStopwatch(sw1, T + s(90));
  eq([stopwatchPhase(sw2), stopwatchElapsedMs(sw2, T + s(500))], ["paused", s(90)], "stopwatch: paused holds its time");
  eq(pauseStopwatch(sw2, T + s(600)), sw2, "stopwatch: Pause while paused changes nothing");
  const sw3 = startStopwatch(sw2, T + s(500));
  eq(stopwatchElapsedMs(sw3, T + s(510)), s(100), "stopwatch: Resume carries on from what it held");
  eq(stopwatchElapsedMs(sw1, T - s(5)), 0, "stopwatch: never negative (a clock moved back)");
}

// ─── the clock ───────────────────────────────────────────────────────────────

eq(formatClock(0), "00:00", "clock: 00:00");
eq(formatClock(59.9), "00:59", "clock: whole seconds, rounded down");
eq(formatClock(90), "01:30", "clock: minutes and seconds");
eq(formatClock(3725), "1:02:05", "clock: hours past an hour");
eq(formatClock(-4), "00:00", "clock: never negative");

// ─── what the dial shows ─────────────────────────────────────────────────────

const noRest: RestState = { active: false, endsAt: null, totalSec: 0 };
const dial = (args: { mode?: TimerMode; rest?: RestState; restOver?: boolean; countdown?: Countdown; stopwatch?: Stopwatch; now?: number }): DialView =>
  dialView({
    mode: args.mode ?? "timer",
    rest: args.rest ?? noRest,
    restOver: args.restOver ?? false,
    countdown: args.countdown ?? newCountdown(60),
    stopwatch: args.stopwatch ?? newStopwatch(),
    now: args.now ?? T,
  });
// [−15s, the middle button, +15s, Reset under them]: "on" does something now,
// "off" is there but dimmed, null isn't there.
const buttons = (v: DialView) => [v.less, v.main, v.more, v.reset];

{
  // Your countdown.
  const ready = dial({});
  eq([ready.source, ready.time, ready.label, ready.editable], ["countdown", "01:00", "Tap to edit", true], "dial: your countdown, ready, tap to set its time");
  eq([ready.fraction, ready.litTicks], [1, 60], "dial: ready, the ring and every tick full");
  eq(buttons(ready), ["on", "start", "on", "off"], "dial: ready: −15s and +15s set its time either side of Start; nothing to reset yet");
  eq(buttons(dial({ countdown: newCountdown(5) })).slice(0, 3), ["off", "start", "on"], "dial: ready at 5 seconds, −15s can't go shorter");
  eq(buttons(dial({ countdown: newCountdown(99 * 60 + 59) })).slice(0, 3), ["on", "start", "off"], "dial: ready at 99:59, +15s can't go longer");

  const running = startCountdown(newCountdown(60), T);
  const half = dial({ countdown: running, now: T + s(30) });
  eq([half.time, half.label, half.tone, half.editable], ["00:30", "Time left", "plain", false], "dial: running, the time left");
  eq([half.fraction, half.litTicks], [0.5, 31], "dial: half way, half the ring, and the ticks to the half (the tick at it lit)");
  eq(buttons(half), ["on", "pause", "on", "on"], "dial: running: ±15s either side of Pause, and Reset");

  const paused = dial({ countdown: pauseCountdown(running, T + s(45)), now: T + s(400) });
  eq([paused.time, paused.label, paused.tone], ["00:15", "Paused", "paused"], "dial: paused, in the paused colour");
  eq(buttons(paused), ["on", "resume", "on", "on"], "dial: paused: ±15s stay either side of Resume, and Reset");

  const over = dial({ countdown: running, now: T + s(61) });
  eq([over.source, over.time, over.label, over.tone, over.glow], ["countdown", "00:00", "Time's up", "done", true], "dial: your countdown done: Time's up, glowing");
  eq([over.fraction, over.litTicks], [1, 60], "dial: Time's up, the ring full");
  eq(buttons(over), ["off", "restart", "on", "on"], "dial: Time's up: Restart, +15s for 15 more, Reset; −15s has nothing to take");

  // A rest.
  const rest: RestState = { active: true, endsAt: T + s(90), totalSec: 90 };
  const resting = dial({ rest, now: T });
  eq([resting.source, resting.time, resting.label], ["rest", "01:30", "Rest"], "dial: a rest takes the dial over");
  eq(buttons(resting), ["on", "skip", "on", "on"], "dial: a rest: −15s, Skip, +15s, and Reset (start it over), no pause");
  eq(dial({ rest, now: T + 29_400 }).time, "01:01", "dial: the rest counted up, as the pop-up counts it");
  eq(dial({ rest, now: T + s(45) }).fraction, 0.5, "dial: the rest's ring drains with it");
  eq(dial({ rest, countdown: running, now: T + s(10) }).source, "rest", "dial: a rest wins over your running countdown");
  const longer = dial({ rest: { active: true, endsAt: T + s(105), totalSec: 90 }, now: T });
  eq([longer.time, longer.fraction, longer.litTicks], ["01:45", 1, 60], "dial: +15s past the rest's length shows the time, the ring stays full");
  eq(dial({ rest: { active: true, endsAt: T - 200, totalSec: 90 }, now: T }).time, "00:00", "dial: a rest a moment past its end reads 00:00, never negative");
  eq(dial({ rest: { active: true, endsAt: T + s(30), totalSec: 0 }, now: T }).fraction, 0, "dial: a rest with no length draws no ring, not NaN");

  // A rest that ran out with the timer open.
  const timesUp = dial({ restOver: true });
  eq([timesUp.source, timesUp.label, timesUp.tone, timesUp.glow, timesUp.fraction], ["rest", "Time's up", "done", true, 1], "dial: a rest run out: Time's up, the ring full and glowing");
  eq(buttons(timesUp), ["off", "restart", "on", "on"], "dial: a rest run out: Restart (the same rest again), +15s for 15 more, Reset");
  eq(dial({ restOver: true, countdown: running, now: T + s(10) }).source, "countdown", "dial: your countdown going wins over an old Time's up");
  eq(dial({ restOver: true, rest, now: T }).source, "rest", "dial: a new rest wins over Time's up");

  // The stopwatch.
  const sw = startStopwatch(newStopwatch(), T);
  eq(buttons(dial({ mode: "stopwatch" })), [null, "start", null, "off"], "dial: stopwatch ready: Start, no ±15s, nothing to reset yet");
  const ticking = dial({ mode: "stopwatch", stopwatch: sw, now: T + s(75) });
  eq([ticking.source, ticking.time, ticking.label], ["stopwatch", "01:15", "Elapsed"], "dial: stopwatch running");
  eq([ticking.fraction, ticking.litTicks], [0.25, 16], "dial: the stopwatch's ring goes round once a minute, its ticks lit to the quarter");
  eq(dial({ mode: "stopwatch", stopwatch: sw, now: T + s(120) }).fraction, 0, "dial: a whole minute round, the ring starts again");
  eq(buttons(ticking), [null, "pause", null, "on"], "dial: stopwatch running: Pause, and Reset");
  const swPaused = dial({ mode: "stopwatch", stopwatch: pauseStopwatch(sw, T + s(30)), now: T + s(90) });
  eq([swPaused.time, swPaused.label, swPaused.tone], ["00:30", "Paused", "paused"], "dial: stopwatch paused holds its time");
  eq(buttons(swPaused), [null, "resume", null, "on"], "dial: stopwatch paused: Resume, and Reset");
  eq(dial({ mode: "stopwatch", stopwatch: sw, rest, now: T + s(5) }).source, "stopwatch", "dial: switched to the stopwatch mid-rest, it stays on the stopwatch");
}

// ─── the ticks, the ring and the clock, in line with the time ────────────────
// User report, 2026-10-15: at 00:15 on the stopwatch the lit ticks stopped one
// short of the quarter, and the ring ran a step behind the time shown.

{
  const sw = startStopwatch(newStopwatch(), T);
  const swAt = (sec: number) => dial({ mode: "stopwatch", stopwatch: sw, now: T + sec * 1000 });
  let swInLine = true;
  for (let ms = 250; ms < 130_000; ms += 250) {
    const v = swAt(ms / 1000);
    const shownSec = Number(v.time.slice(-2));
    if (v.litTicks !== shownSec + 1) { swInLine = false; break; }
  }
  eq(swInLine, true, "ticks: on the stopwatch, lit to the second the time shows, every quarter second for two minutes");
  const quarter = swAt(15);
  eq([quarter.time, quarter.litTicks > 15], ["00:15", true], "ticks: at 00:15 the tick at the quarter is lit (the user's report)");
  eq(swAt(14.99).litTicks, 15, "ticks: at 00:14.99, not the quarter yet");
  eq(swAt(0.2).litTicks, 1, "ticks: the top one lights as the stopwatch starts");
  eq(swAt(59.5).litTicks, 60, "ticks: at 00:59 every one is lit");
  eq(swAt(60).litTicks, 1, "ticks: at 01:00 round again from the top");
  eq(dial({ mode: "stopwatch" }).litTicks, 0, "ticks: a stopwatch at 00:00, none");

  // A one-minute countdown: its time is counted up, and so are its ticks.
  const cd = startCountdown(newCountdown(60), T);
  let cdInLine = true;
  for (let ms = 0; ms < 60_000; ms += 250) {
    const v = dial({ countdown: cd, now: T + ms });
    const [mm, ss] = v.time.split(":").map(Number);
    if (v.litTicks !== Math.min(60, mm * 60 + ss + 1)) { cdInLine = false; break; }
  }
  eq(cdInLine, true, "ticks: on a one-minute countdown, lit to the second the time shows, all the way down");
  eq(dial({ countdown: cd, now: T + s(45) }).litTicks, 16, "ticks: 00:15 left, lit to the quarter");

  // The ring's run, which the dial plays on the UI thread.
  eq(swAt(5).ring, { kind: "sweep", zeroAt: T }, "ring: a running stopwatch goes round from when it read 0");
  const swPaused = pauseStopwatch(sw, T + s(30));
  eq(dial({ mode: "stopwatch", stopwatch: startStopwatch(swPaused, T + s(100)), now: T + s(101) }).ring, { kind: "sweep", zeroAt: T + s(70) },
    "ring: resumed, from when it would have read 0 with the time it held");
  eq(dial({ mode: "stopwatch", stopwatch: swPaused, now: T + s(200) }).ring, { kind: "still", fraction: 0.5 }, "ring: a paused stopwatch holds still");
  eq(dial({ countdown: cd, now: T + s(10) }).ring, { kind: "drain", endsAt: T + s(60), totalMs: s(60) }, "ring: your countdown drains to its end");
  eq(dial({}).ring, { kind: "still", fraction: 1 }, "ring: ready, full and still");
  eq(dial({ countdown: pauseCountdown(cd, T + s(45)), now: T + s(90) }).ring, { kind: "still", fraction: 0.25 }, "ring: paused, still");
  eq(dial({ rest: { active: true, endsAt: T + s(90), totalSec: 90 }, now: T }).ring, { kind: "drain", endsAt: T + s(90), totalMs: s(90) }, "ring: a rest drains to its end");
  eq(dial({ restOver: true }).ring, { kind: "still", fraction: 1 }, "ring: Time's up, full and still");

  const drain: RingMotion = { kind: "drain", endsAt: T + s(90), totalMs: s(90) };
  eq([ringAt(drain, T), ringAt(drain, T + s(45)), ringAt(drain, T + s(90)), ringAt(drain, T + s(95))], [1, 0.5, 0, 0], "ring: drains from full to empty at the end");
  eq(ringAt({ kind: "drain", endsAt: T + s(105), totalMs: s(90) }, T), 1, "ring: +15s past the rest's length, full");
  eq([ringAt({ kind: "sweep", zeroAt: T }, T + s(15)), ringAt({ kind: "sweep", zeroAt: T }, T + s(75))], [0.25, 0.25], "ring: the stopwatch's, round once a minute");

  const LEAD = 300;
  const total = (steps: { ms: number }[]) => steps.reduce((sum, step) => sum + step.ms, 0);
  const fresh = ringPlan(drain, 1, T, LEAD);
  const lastStep = fresh.steps[fresh.steps.length - 1];
  eq(total(fresh.steps), s(90), "ring: a rest's run ends exactly when the rest does");
  eq(fresh.steps[0].to, ringAt(drain, T + LEAD), "ring: after its lead-in it's where the clock is");
  eq([lastStep.to, fresh.steps.slice(1).every(step => step.steady), fresh.repeatMinute], [0, true, false], "ring: then steadily down to empty, once");
  eq(Math.abs((fresh.steps[0].to - lastStep.to) / lastStep.ms - 1 / s(90)) < 1e-12, true, "ring: at exactly the rest's own pace");

  const held = ringPlan({ kind: "drain", endsAt: T + s(105), totalMs: s(90) }, 1, T, LEAD);
  eq(held.steps.map(step => [step.to, step.ms]), [[1, LEAD], [1, s(15) - LEAD], [0, s(90)]], "ring: +15s past its length, full for the 15 seconds over, then down over its length");
  eq(ringPlan(drain, 0.4, T + s(90) - 200, LEAD).steps, [{ to: 0, ms: 200, steady: false }], "ring: under a lead-in left, straight down to empty by its end");
  eq(ringPlan(drain, 0.2, T + s(95), LEAD).steps, [{ to: 0, ms: 0, steady: true }], "ring: past its end, empty");

  const sweep: RingMotion = { kind: "sweep", zeroAt: T };
  const at15 = ringPlan(sweep, 0.25, T + s(15), LEAD);
  eq([total(at15.steps), at15.repeatMinute], [s(45), true], "ring: the stopwatch's reaches the top exactly as the minute turns, then goes on round");
  eq([at15.steps[0].to, at15.steps[0].steady], [ringAt(sweep, T + s(15) + LEAD), true], "ring: already on the clock, the lead-in just carries on");
  const wrap = ringPlan(sweep, 0.998, T + 59_900, LEAD);
  eq([wrap.steps[0], total(wrap.steps)], [{ to: 0, ms: 0, steady: true }, s(120) - 59_900], "ring: the minute turning in the lead-in starts it from the top, on to the next minute");
  eq(ringPlan({ kind: "still", fraction: 0.25 }, 1, T, LEAD).steps, [{ to: 0.25, ms: LEAD, steady: false }], "ring: still, eased to where it stands");

  // The clock the dial renders on: just as the time it shows changes.
  const args = (over: Partial<DialArgs>): DialArgs => ({
    mode: "timer", rest: noRest, restOver: false, countdown: newCountdown(60), stopwatch: newStopwatch(), now: T, ...over,
  });
  eq(nextChangeIn(args({ mode: "stopwatch", stopwatch: sw, now: T + 15_300 })), 700, "clock: the stopwatch at 15.3s changes in 0.7s");
  eq(nextChangeIn(args({ mode: "stopwatch", stopwatch: sw, now: T + s(15) })), 1000, "clock: on the second, the next is a second away");
  eq(nextChangeIn(args({ mode: "stopwatch" })), null, "clock: a stopwatch at 00:00 doesn't move");
  eq(nextChangeIn(args({ mode: "stopwatch", stopwatch: swPaused, now: T + s(90) })), null, "clock: nor a paused one");
  eq(nextChangeIn(args({ countdown: cd, now: T + 15_500 })), 500, "clock: 44.5s left (00:45) shows 00:44 in 0.5s");
  eq(nextChangeIn(args({ countdown: cd, now: T + s(15) })), 1000, "clock: 45.0s left shows 00:44 a second on");
  eq([nextChangeIn(args({})), nextChangeIn(args({ countdown: cd, now: T + s(61) }))], [null, null], "clock: ready, and Time's up, don't move");
  const resting: RestState = { active: true, endsAt: T + 30_200, totalSec: 90 };
  eq(nextChangeIn(args({ rest: resting })), 200, "clock: a rest with 30.2s left changes in 0.2s");
  eq(nextChangeIn(args({ rest: resting, now: T + s(31) })), 100, "clock: a rest past its end looks again shortly, until the rest timer ends it");
  eq(nextChangeIn(args({ mode: "stopwatch", rest: resting, stopwatch: sw, now: T + 2_400 })), 600, "clock: on the stopwatch mid-rest, the stopwatch's seconds");

  let onTheSecond = true;
  for (let ms = 1; ms < 3_000; ms += 137) {
    for (const c of [
      args({ mode: "stopwatch", stopwatch: sw, now: T + ms }),
      args({ countdown: cd, now: T + ms }),
      args({ rest: { active: true, endsAt: T + s(90), totalSec: 90 }, now: T + ms }),
    ]) {
      const due = nextChangeIn(c);
      const shown = dialView(c).time;
      if (due === null || dialView({ ...c, now: c.now + due - 1 }).time !== shown || dialView({ ...c, now: c.now + due }).time === shown) onTheSecond = false;
    }
  }
  eq(onTheSecond, true, "clock: the time shown holds until then and changes then, for the stopwatch, a countdown and a rest");
}

// ─── how a rest ends ─────────────────────────────────────────────────────────

{
  const end = T + s(90);
  eq(restRanOut(null, T), false, "rest: no rest watched, nothing ran out");
  eq(restRanOut(end, end - s(10)), false, "rest: Skip with 10s left didn't run out (no Time's up)");
  eq(restRanOut(end, end - 1000), false, "rest: Skip with a second left didn't run out");
  // The rest timer checks twice a second and ends a rest on its first check at
  // or past its end (contexts/RestTimerContext.tsx), so it goes within 500ms.
  for (const late of [0, 250, 499]) {
    eq(restRanOut(end, end + late), true, `rest: ended ${late}ms past its end by the rest timer: ran out`);
  }

  // −15s: RestTimerContext's adjustRestTimer ends the rest when its new end is
  // at or before now. lessEndsRest must say so at exactly the same point.
  const contextEnds = (endsAt: number, now: number) => endsAt + -15 * 1000 <= now;
  for (const left of [30_000, 15_001, 15_000, 14_999, 10_000, 1]) {
    eq(lessEndsRest(end, end - left), contextEnds(end, end - left), `rest: −15s with ${left}ms left, ends it exactly when the rest timer does`);
  }
  eq(lessEndsRest(end, end - s(15)), true, "rest: −15s with exactly 15s left ends it (Time's up)");
  eq(lessEndsRest(end, end - s(16)), false, "rest: −15s with 16s left just shortens it");
  eq(lessEndsRest(null, T), false, "rest: −15s with no rest ends nothing");
}

// ─── the set the session is up to ────────────────────────────────────────────

eq(setNumbersText("80", "8", "kg", false), "80 kg × 8", "numbers: weight × reps");
eq(setNumbersText(" 80 ", " 8 ", "lbs", false), "80 lbs × 8", "numbers: trimmed, in the session's unit");
eq(setNumbersText("", "8", "kg", false), "8 reps", "numbers: a bodyweight set is its reps");
eq(setNumbersText("", "1", "kg", false), "1 rep", "numbers: one rep");
eq(setNumbersText("80", "", "kg", false), "80 kg", "numbers: a weight with no reps yet");
eq(setNumbersText("", "60", "kg", true), "60 s", "numbers: a hold is seconds");
eq(setNumbersText("20", "45", "kg", true), "20 kg × 45 s", "numbers: a weighted hold");
eq(setNumbersText("", "", "kg", false), "", "numbers: nothing to go on, nothing written");
eq(upNextFrom(undefined, ["a"], "kg"), null, "up next: no set left, none");

{
  // A session as the Workout tab holds it, ticked as its checkboxes tick (the
  // lock screen's replay is that same rule: last time's numbers into an empty
  // set, then done, stamped).
  type Set = { id: string; weight: string; reps: string; done: boolean; doneAt?: number };
  const set = (id: string, weight = "", reps = ""): Set => ({ id, weight, reps, done: false });
  const exercises = [
    { id: "bench", name: "Barbell Bench Press", restSeconds: 90 },
    { id: "row", name: "Seated Cable Row", restSeconds: 60 },
  ];
  const ids = exercises.map(e => e.id);
  const hints: Record<string, string[]> = { bench: ["40×10", "80×8", "80×8", "80×7"], row: ["60×10", "60×10"] };
  let log: Record<string, { warmup: Set[]; working: Set[] }> = {
    bench: { warmup: [set("w")], working: [set("a"), set("b"), set("c")] },
    row: { warmup: [], working: [set("r1"), set("r2", "65", "")] },
  };
  let clock = 0;
  const tick = (exId: string, setType: "warmup" | "working", setIdx: number) => {
    clock += 1;
    log = logWithLockScreenTicks(log, [{ exId, setType, setIdx, ts: clock }], exId => hints[exId]);
  };
  const upNext = () => upNextFrom(buildLiveActivityQueue(exercises, log, exId => hints[exId]).queue[0], ids, "kg");
  // The card is always the set the Workout screen glows on (utils/nextSet.ts).
  const sameAsPage = (label: string) => {
    const page = nextSetOf(ids, log);
    const card = upNext();
    eq(card && { exId: card.exId, setType: card.setType, setIdx: card.setIdx },
      page && { exId: page.exId, setType: page.setType, setIdx: page.setIdx }, `up next is the page's next set: ${label}`);
  };

  const first = upNext();
  eq(first && [first.exerciseName, first.exerciseNumber, first.exerciseCount], ["Barbell Bench Press", 1, 2], "up next: Exercise 1 / 2 to start");
  eq(first && [first.setLabel, first.numbers, first.isWarmup, first.dot], ["Warmup 1", "40 kg × 10", true, -1], "up next: a warmup first, last time's numbers, no dot");
  eq(first?.setDone, [false, false, false], "up next: the exercise's working sets as dots, none done");
  sameAsPage("to start");

  tick("bench", "warmup", 0);
  const second = upNext();
  eq(second && [second.setLabel, second.numbers, second.dot], ["Set 1 of 3", "80 kg × 8", 0], "up next: after the warmup, the first working set");
  sameAsPage("after the warmup");
  eq(log.bench.warmup[0], { id: "w", weight: "40", reps: "10", done: true, doneAt: 1 }, "tick: an empty set takes last time's numbers as it's ticked");

  tick("bench", "working", 0);
  const third = upNext();
  eq(third && [third.setLabel, third.dot, upNextTail(third)], ["Set 2 of 3", 1, "· Set 2 of 3 · 80 kg × 8"], "up next: the card moves on only with a tick");
  eq(third?.setDone, [true, false, false], "up next: the set done shows filled");
  sameAsPage("after set 1");

  // A set skipped on the page: the page goes on from the set ticked last, and
  // so does the card, with the skipped set waiting at the end.
  tick("row", "working", 0);
  const afterJump = upNext();
  eq(afterJump && [afterJump.exerciseName, afterJump.exerciseNumber, afterJump.setLabel, afterJump.numbers],
    ["Seated Cable Row", 2, "Set 2 of 2", "65 kg"], "up next: follows the set ticked last; what's typed beats last time");
  sameAsPage("after jumping to the row");
  tick("row", "working", 1);
  const skipped = upNext();
  eq(skipped && [skipped.exerciseName, skipped.setLabel, skipped.dot], ["Barbell Bench Press", "Set 2 of 3", 1], "up next: the skipped sets come round last");
  sameAsPage("with only skipped sets left");
  eq(log.row.working[1], { id: "r2", weight: "65", reps: "", done: true, doneAt: 4 }, "tick: what was typed stays as typed");

  tick("bench", "working", 1);
  tick("bench", "working", 2);
  const { queue, totalCount } = buildLiveActivityQueue(exercises, log, exId => hints[exId]);
  eq([upNext(), queue.length, totalCount], [null, 0, 6], "up next: every set ticked, none (the card says All sets done)");
  sameAsPage("all done");

  eq(upNextFrom({ ...buildLiveActivityQueue(exercises, { bench: { warmup: [], working: [set("a")] } }, () => []).queue[0], exId: "gone" }, ids, "kg")?.exerciseNumber, 1,
    "up next: an exercise no longer on the page still reads as a number, never 0");
  eq(upNextTail({ ...first!, numbers: "" }), "· Warmup 1", "up next: the bar's line with nothing to go on is just the set");
}

// ─── the store ───────────────────────────────────────────────────────────────

{
  let heard = 0;
  const stop = subscribeTimerState(() => { heard += 1; });
  updateTimerState(st => st);
  eq(heard, 0, "store: a change that changes nothing tells nobody");
  updateTimerState(st => ({ ...st, mode: "stopwatch" }));
  eq([heard, getTimerState().mode], [1, "stopwatch"], "store: a change is heard, and kept");
  updateTimerState(st => ({ ...st, countdown: startCountdown(st.countdown, T) }));
  eq(countdownPhase(getTimerState().countdown, T + 1), "running", "store: your countdown keeps going with the timer closed (it lives here)");
  stop();
  updateTimerState(st => ({ ...st, mode: "timer" }));
  eq(heard, 2, "store: unsubscribed, heard no more");

  let bar = 0;
  const off = subscribeUpNext(() => { bar += 1; });
  const a = upNextFrom({
    exId: "x", setType: "working", setIdx: 1, exerciseName: "Squat", setLabel: "Set 2 of 4",
    weight: "100", reps: "5", restSeconds: 120, isFinal: false, isHold: false, setDone: [true, false, false, false], warmupDone: [true],
  }, ["x"], "kg");
  publishUpNext(a);
  publishUpNext(a && { ...a });
  eq(bar, 1, "up next store: the same set again doesn't redraw the bar (the payload rebuilds every second)");
  eq(sameUpNext(a, a && { ...a, numbers: "100 kg × 6" }), false, "up next store: a number changed is a change");
  publishUpNext(a && { ...a, numbers: "100 kg × 6" });
  publishUpNext(null);
  publishUpNext(null);
  eq([bar, getUpNext()], [3, null], "up next store: a change, then none (no session), told once each");
  off();
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("workout-timer invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ workout-timer invariants hold");
