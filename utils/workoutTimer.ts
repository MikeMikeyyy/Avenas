// utils/workoutTimer.ts
//
// The Workout tab's timer (components/WorkoutTimerScreen.tsx), as pure rules:
// your own countdown and the stopwatch as values you start, pause and reset,
// what the dial shows for each of them and for a rest, and the set the session
// is up to as the timer's card and the workout bar's "Up next" line read it.
// User design and decisions, 2026-10-15 (the Workout Timer canvas):
//
//   * The dial shows the REST whenever one runs (RestTimerContext): the same
//     countdown as the pop-up and the lock screen, so it never pauses; Skip in
//     the middle and ±15s either side.
//   * Otherwise TIMER is your own countdown and STOPWATCH the stopwatch, and
//     both pause. Your own countdown is not a rest: nothing else shows it.
//   * ±15s work while your countdown runs, not only before it starts.
//   * The stopwatch's ring goes round once a minute.
//   * Time's up: the ring full and glowing, "Time's up" under the time.
//
// No React, no clock of its own: every function takes `now`, so
// scripts/verify-workout-timer.ts plays them out exactly.

import type { LiveActivityPendingSet } from "../modules/avenas-live-activity";

// ─── Your own countdown ──────────────────────────────────────────────────────

/** Your own countdown: what it counts down from, and either when it reaches
 *  zero (running) or what was left when it was paused. Both null: ready. */
export type Countdown = {
  durationSec: number;
  endsAt: number | null;
  leftMs: number | null;
};

export type CountdownPhase = "ready" | "running" | "paused" | "done";

export const DEFAULT_COUNTDOWN_SEC = 60;
export const MIN_COUNTDOWN_SEC = 5;
export const MAX_COUNTDOWN_SEC = 99 * 60 + 59;
/** What −15s and +15s move it by. */
export const ADJUST_SEC = 15;

const clampDuration = (sec: number) => Math.min(MAX_COUNTDOWN_SEC, Math.max(MIN_COUNTDOWN_SEC, Math.round(sec)));

export function newCountdown(durationSec: number = DEFAULT_COUNTDOWN_SEC): Countdown {
  return { durationSec: clampDuration(durationSec), endsAt: null, leftMs: null };
}

export function countdownPhase(c: Countdown, now: number): CountdownPhase {
  if (c.endsAt !== null) return now >= c.endsAt ? "done" : "running";
  if (c.leftMs !== null) return "paused";
  return "ready";
}

/** Whole seconds left, counted up (00:01 shows until it's really over). */
export function countdownLeftSec(c: Countdown, now: number): number {
  switch (countdownPhase(c, now)) {
    case "ready": return c.durationSec;
    case "paused": return Math.ceil((c.leftMs ?? 0) / 1000);
    case "running": return Math.max(0, Math.ceil(((c.endsAt ?? now) - now) / 1000));
    default: return 0;
  }
}

/** Start from ready (the whole duration) or resume from a pause. */
export function startCountdown(c: Countdown, now: number): Countdown {
  const phase = countdownPhase(c, now);
  if (phase === "running") return c;
  const leftMs = phase === "paused" ? (c.leftMs ?? 0) : c.durationSec * 1000;
  return { ...c, endsAt: now + leftMs, leftMs: null };
}

export function pauseCountdown(c: Countdown, now: number): Countdown {
  if (countdownPhase(c, now) !== "running") return c;
  return { ...c, endsAt: null, leftMs: Math.max(0, (c.endsAt ?? now) - now) };
}

/** Back to ready, on the same duration. */
export function resetCountdown(c: Countdown): Countdown {
  return { durationSec: c.durationSec, endsAt: null, leftMs: null };
}

/** A new duration, typed in: ready on it. */
export function setCountdownDuration(c: Countdown, sec: number): Countdown {
  return { durationSec: clampDuration(sec), endsAt: null, leftMs: null };
}

/** A tap on your countdown's time, before it starts, turns it into two wheels
 *  (user request, 2026-10-15: it was two typed boxes and a tick): minutes 00
 *  to 99, and seconds in fives, as the program builder's rest times go. */
export const WHEEL_SECOND_STEP = 5;
export const WHEEL_MINUTES = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
export const WHEEL_SECONDS = Array.from({ length: 60 / WHEEL_SECOND_STEP }, (_, i) => String(i * WHEEL_SECOND_STEP).padStart(2, "0"));
export type WheelPlace = { min: number; sec: number };

/** Where a time sits on the wheels: its minutes, and its seconds to the
 *  nearest five. */
export function wheelsFor(durationSec: number): WheelPlace {
  const whole = clampDuration(durationSec);
  return {
    min: Math.min(WHEEL_MINUTES.length - 1, Math.floor(whole / 60)),
    sec: Math.min(WHEEL_SECONDS.length - 1, Math.round((whole % 60) / WHEEL_SECOND_STEP)),
  };
}

/** The time the wheels are on, in seconds. */
export function wheelsSec(place: WheelPlace): number {
  return place.min * 60 + place.sec * WHEEL_SECOND_STEP;
}

/**
 * ±15s. Before it starts it changes the duration; while it runs or waits
 * paused it moves what's left, and taking it to nothing ends it (Time's up),
 * as −15s does to a rest. Once it's done, +15s is 15 seconds more, counting
 * again, and −15s has nothing left to take.
 */
export function adjustCountdown(c: Countdown, deltaSec: number, now: number): Countdown {
  const phase = countdownPhase(c, now);
  if (phase === "ready") return { ...c, durationSec: clampDuration(c.durationSec + deltaSec) };
  if (phase === "running") {
    const endsAt = (c.endsAt ?? now) + deltaSec * 1000;
    return { ...c, endsAt: endsAt <= now ? now : endsAt };
  }
  if (phase === "paused") {
    const leftMs = (c.leftMs ?? 0) + deltaSec * 1000;
    return leftMs <= 0 ? { ...c, endsAt: now, leftMs: null } : { ...c, leftMs };
  }
  return deltaSec > 0 ? { ...c, endsAt: now + deltaSec * 1000, leftMs: null } : c;
}

// ─── The stopwatch ───────────────────────────────────────────────────────────

/** The stopwatch: when it was last started (null while stopped), and the time
 *  banked before that. */
export type Stopwatch = { startedAt: number | null; bankedMs: number };

export type StopwatchPhase = "ready" | "running" | "paused";

export const newStopwatch = (): Stopwatch => ({ startedAt: null, bankedMs: 0 });

export function stopwatchPhase(s: Stopwatch): StopwatchPhase {
  if (s.startedAt !== null) return "running";
  return s.bankedMs > 0 ? "paused" : "ready";
}

export function stopwatchElapsedMs(s: Stopwatch, now: number): number {
  return s.bankedMs + (s.startedAt !== null ? Math.max(0, now - s.startedAt) : 0);
}

export function startStopwatch(s: Stopwatch, now: number): Stopwatch {
  return s.startedAt !== null ? s : { startedAt: now, bankedMs: s.bankedMs };
}

export function pauseStopwatch(s: Stopwatch, now: number): Stopwatch {
  return s.startedAt === null ? s : { startedAt: null, bankedMs: stopwatchElapsedMs(s, now) };
}

// ─── What the dial shows ─────────────────────────────────────────────────────

/** "01:30", and "1:02:05" past an hour. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

export type TimerMode = "timer" | "stopwatch";

/** −15s or +15s, either side of the middle button. */
export type AdjustButton = "less" | "more";
/** A button that's there and does something now ("on"), there but with
 *  nothing to do ("off", dimmed), or not there at all (null). */
export type ButtonState = "on" | "off" | null;
export type MainAction = "start" | "pause" | "resume" | "skip" | "restart";

export type DialView = {
  /** Which countdown the dial is showing, and so what its buttons act on. */
  source: "rest" | "countdown" | "stopwatch";
  time: string;
  label: string;
  /** How the label reads: plain, the paused orange, or Time's up's green. */
  tone: "plain" | "paused" | "done";
  /** How much of the ring is drawn, 0 to 1, now. */
  fraction: number;
  /** How the ring moves from here until something changes. */
  ring: RingMotion;
  /** Time's up: the ring full and glowing. */
  glow: boolean;
  /** How many of the dial's 60 ticks are lit: from the top round to the one
   *  the time shown points at. */
  litTicks: number;
  /** −15s and +15s: always there on Timer, a rest or your countdown (user
   *  decision, 2026-10-15), never on the stopwatch. */
  less: ButtonState;
  more: ButtonState;
  main: MainAction;
  /** Reset, under the middle button on both modes: "off" with nothing to
   *  reset. On a rest it starts the rest over from its full length. */
  reset: "on" | "off";
  /** Your countdown before it starts: a tap on the time sets it. */
  editable: boolean;
};

/** The rest as the dial reads it: running, when it ends, and how long it was
 *  set for (RestTimerContext's restEndsAt and restTotal). Read off its end, so
 *  the ring drains smoothly rather than a second at a time. */
export type RestState = { active: boolean; endsAt: number | null; totalSec: number };

/**
 * How the ring moves until something changes, so the dial runs it with the
 * clock on the UI thread: still at `fraction`; draining to empty at `endsAt`,
 * and full until `totalMs` before then (a rest +15s past its length); or
 * round once a minute from `zeroAt`, when the stopwatch read 0. It used to
 * ease to each of the dial's renders four times a second, so it ran a step
 * behind the time shown (user report, 2026-10-15).
 */
export type RingMotion =
  | { kind: "still"; fraction: number }
  | { kind: "drain"; endsAt: number; totalMs: number }
  | { kind: "sweep"; zeroAt: number };

export type DialArgs = {
  mode: TimerMode;
  rest: RestState;
  restOver: boolean;
  countdown: Countdown;
  stopwatch: Stopwatch;
  now: number;
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
// The ticks lit run from the top round to the one the time shown points at,
// that one included, so at 00:15 on the stopwatch the tick at the quarter is
// lit. Rounded, they lit one short of it until half a second past (user
// report, 2026-10-15). The stopwatch shows whole seconds gone; a countdown
// shows them counted up, and its ticks follow the ring's fraction the same way.
const sweepTicks = (elapsedMs: number) => (elapsedMs > 0 ? (Math.floor(elapsedMs / 1000) % 60) + 1 : 0);
const drainTicks = (fraction: number) => (fraction > 0 ? Math.min(60, Math.ceil(fraction * 60 - 1e-9) + 1) : 0);
/** How often the dial looks again for a rest that's reached its end, until
 *  the rest timer ends it (it checks twice a second). */
const REST_END_POLL_MS = 100;

/**
 * What the dial shows. On TIMER, a rest running wins over your own countdown
 * (a rest from a tick takes the dial over); a rest that ran out while the
 * screen was open (`restOver`) shows Time's up until something else happens.
 */
export function dialView(args: DialArgs): DialView {
  const { mode, rest, restOver, countdown, stopwatch, now } = args;
  const base = { tone: "plain" as const, glow: false, editable: false };
  // Time's up, for a rest or your countdown: the ring full and glowing; +15s
  // is 15 seconds more, and −15s has nothing to take.
  const timesUp = {
    time: formatClock(0),
    label: "Time's up",
    tone: "done" as const,
    fraction: 1,
    ring: { kind: "still" as const, fraction: 1 },
    glow: true,
    litTicks: 60,
    less: "off" as const,
    more: "on" as const,
    main: "restart" as const,
    reset: "on" as const,
  };

  if (mode === "stopwatch") {
    const phase = stopwatchPhase(stopwatch);
    const ms = stopwatchElapsedMs(stopwatch, now);
    // Round once a minute, like a second hand.
    const fraction = (ms % 60_000) / 60_000;
    return {
      ...base,
      source: "stopwatch",
      time: formatClock(ms / 1000),
      label: phase === "paused" ? "Paused" : "Elapsed",
      tone: phase === "paused" ? "paused" : "plain",
      fraction,
      ring: phase === "running"
        ? { kind: "sweep", zeroAt: (stopwatch.startedAt ?? now) - stopwatch.bankedMs }
        : { kind: "still", fraction },
      litTicks: sweepTicks(ms),
      less: null,
      more: null,
      main: phase === "running" ? "pause" : phase === "paused" ? "resume" : "start",
      reset: phase === "ready" ? "off" : "on",
    };
  }

  if (rest.active) {
    const leftMs = Math.max(0, (rest.endsAt ?? now) - now);
    const fraction = rest.totalSec > 0 ? clamp01(leftMs / (rest.totalSec * 1000)) : 0;
    return {
      ...base,
      source: "rest",
      // Counted up, as the pop-up counts it (RestTimerContext).
      time: formatClock(Math.ceil(leftMs / 1000)),
      label: "Rest",
      fraction,
      ring: rest.totalSec > 0 && rest.endsAt !== null
        ? { kind: "drain", endsAt: rest.endsAt, totalMs: rest.totalSec * 1000 }
        : { kind: "still", fraction },
      litTicks: drainTicks(fraction),
      less: "on",
      more: "on",
      main: "skip",
      reset: "on",
    };
  }

  const phase = countdownPhase(countdown, now);
  if (restOver && (phase === "ready" || phase === "done")) {
    return { ...base, ...timesUp, source: "rest" };
  }

  const leftSec = countdownLeftSec(countdown, now);
  if (phase === "done") {
    return { ...base, ...timesUp, source: "countdown" };
  }
  const leftMs = phase === "running" ? Math.max(0, (countdown.endsAt ?? now) - now) : phase === "paused" ? (countdown.leftMs ?? 0) : countdown.durationSec * 1000;
  const fraction = phase === "ready" ? 1 : clamp01(leftMs / (countdown.durationSec * 1000));
  const ready = phase === "ready";
  return {
    ...base,
    source: "countdown",
    time: formatClock(leftSec),
    label: ready ? "Tap to edit" : phase === "paused" ? "Paused" : "Time left",
    tone: phase === "paused" ? "paused" : "plain",
    fraction,
    ring: phase === "running" && countdown.endsAt !== null
      ? { kind: "drain", endsAt: countdown.endsAt, totalMs: countdown.durationSec * 1000 }
      : { kind: "still", fraction },
    litTicks: drainTicks(fraction),
    // Before it starts, ±15s set its time, as far as it goes either way.
    less: ready && countdown.durationSec <= MIN_COUNTDOWN_SEC ? "off" : "on",
    more: ready && countdown.durationSec >= MAX_COUNTDOWN_SEC ? "off" : "on",
    main: ready ? "start" : phase === "running" ? "pause" : "resume",
    reset: ready ? "off" : "on",
    editable: ready,
  };
}

/** The ring's fraction at time `t` (epoch ms), following `ring`. */
export function ringAt(ring: RingMotion, t: number): number {
  if (ring.kind === "still") return clamp01(ring.fraction);
  if (ring.kind === "drain") return ring.totalMs > 0 ? clamp01((ring.endsAt - t) / ring.totalMs) : 0;
  return ((((t - ring.zeroAt) % 60_000) + 60_000) % 60_000) / 60_000;
}

/** One stretch of the ring's run: to `to` over `ms`, steadily with the clock
 *  (`steady`), or eased onto it. */
export type RingStep = { to: number; ms: number; steady: boolean };

/** A lead-in this close to where the ring already is just carries on, steady. */
const RING_CLOSE = 0.02;

/**
 * The ring's run from `now`, for the dial to play on the UI thread: a short
 * lead-in from where it's drawn (`from`) onto the clock, then exactly with the
 * clock until something changes. A sweep then goes on round, once a minute
 * from the top (`repeatMinute`).
 */
export function ringPlan(ring: RingMotion, from: number, now: number, leadMs: number): { steps: RingStep[]; repeatMinute: boolean } {
  const leadTo = (to: number, ms: number): RingStep[] => [
    // The stopwatch's minute coming round during the lead-in starts it from
    // the top; anything else eases back, the ring unwinding.
    ...(ring.kind === "sweep" && to < from - 0.5 ? [{ to: 0, ms: 0, steady: true }] : []),
    { to, ms, steady: Math.abs(to - from) <= RING_CLOSE },
  ];
  if (ring.kind === "still") return { steps: leadTo(clamp01(ring.fraction), leadMs), repeatMinute: false };
  if (ring.kind === "drain") {
    const left = ring.endsAt - now;
    if (left <= 0) return { steps: [{ to: 0, ms: 0, steady: true }], repeatMinute: false };
    const lead = Math.min(leadMs, left);
    const t1 = now + lead;
    const steps = leadTo(ringAt(ring, t1), lead);
    // Full until the rest is back within its length, then down to empty.
    const fullUntil = ring.endsAt - ring.totalMs;
    if (fullUntil > t1) steps.push({ to: 1, ms: fullUntil - t1, steady: true });
    const drainFrom = Math.max(t1, fullUntil);
    if (ring.endsAt > drainFrom) steps.push({ to: 0, ms: ring.endsAt - drainFrom, steady: true });
    return { steps, repeatMinute: false };
  }
  const t1 = now + leadMs;
  const f1 = ringAt(ring, t1);
  return { steps: [...leadTo(f1, leadMs), { to: 1, ms: Math.round((1 - f1) * 60_000), steady: true }], repeatMinute: true };
}

/**
 * How long until the time the dial shows next changes, in ms, or null while
 * nothing on it moves. The dial renders then, just past the second turning,
 * so the time and its ticks change on the second rather than up to a quarter
 * of a second after it, as they did when it looked four times a second.
 */
export function nextChangeIn(args: DialArgs): number | null {
  const { mode, rest, countdown, stopwatch, now } = args;
  // Shown counted up, a countdown's time changes as what's left reaches a
  // whole second.
  const tillWhole = (leftMs: number) => leftMs % 1000 || 1000;
  if (mode === "stopwatch") {
    return stopwatchPhase(stopwatch) === "running" ? 1000 - (stopwatchElapsedMs(stopwatch, now) % 1000) : null;
  }
  if (rest.active) {
    const left = (rest.endsAt ?? now) - now;
    return left > 0 ? tillWhole(left) : REST_END_POLL_MS;
  }
  if (countdownPhase(countdown, now) !== "running") return null;
  return tillWhole((countdown.endsAt ?? now) - now);
}

/**
 * Whether a rest the screen was watching ran out rather than being skipped:
 * it went within a moment of its end (the rest timer checks twice a second).
 * A Skip, or the workout ending, takes it away early.
 */
export function restRanOut(lastEndsAt: number | null, now: number): boolean {
  return lastEndsAt !== null && now >= lastEndsAt - 750;
}

/**
 * Whether −15s ends the rest: with that or less left, RestTimerContext's
 * adjustRestTimer ends it rather than move it, and the dial reads Time's up,
 * as your own countdown does when −15s takes it to nothing.
 */
export function lessEndsRest(endsAt: number | null, now: number): boolean {
  return endsAt !== null && endsAt - ADJUST_SEC * 1000 <= now;
}

// ─── The set the session is up to ────────────────────────────────────────────

/** The set the session is up to, as the timer's card and the workout bar's
 *  "Up next" line show it: the lock screen card's head of the queue. */
export type UpNext = {
  exId: string;
  setType: "warmup" | "working";
  setIdx: number;
  exerciseName: string;
  /** Its place among the session's exercises, from 1, and how many there are. */
  exerciseNumber: number;
  exerciseCount: number;
  /** "Set 2 of 4" / "Warmup 1". */
  setLabel: string;
  /** "80 kg × 8", "8 reps", "60 s", or "" with nothing to go on yet. */
  numbers: string;
  isWarmup: boolean;
  /** Its exercise's working sets, done or not as they'll stand when it's up. */
  setDone: boolean[];
  /** Its dot among them; -1 for a warmup, which has none. */
  dot: number;
};

/** The set's numbers in a line, as the lock screen card writes them. */
export function setNumbersText(weight: string, reps: string, unit: string, isHold: boolean): string {
  const w = weight.trim();
  const r = reps.trim();
  if (w) return r ? `${w} ${unit} × ${r}${isHold ? " s" : ""}` : `${w} ${unit}`;
  if (r) return isHold ? `${r} s` : `${r} ${r === "1" ? "rep" : "reps"}`;
  return "";
}

/** The head of the lock screen's queue (utils/liveActivity.ts), as the timer
 *  reads it, or null when there's none. */
export function upNextFrom(
  head: LiveActivityPendingSet | undefined,
  exerciseIds: readonly string[],
  unit: string,
): UpNext | null {
  if (!head) return null;
  const at = exerciseIds.indexOf(head.exId);
  const isWarmup = head.setType === "warmup";
  return {
    exId: head.exId,
    setType: head.setType,
    setIdx: head.setIdx,
    exerciseName: head.exerciseName,
    exerciseNumber: at >= 0 ? at + 1 : 1,
    exerciseCount: Math.max(1, exerciseIds.length),
    setLabel: head.setLabel,
    numbers: setNumbersText(head.weight, head.reps, unit, head.isHold),
    isWarmup,
    setDone: head.setDone,
    dot: isWarmup ? -1 : head.setIdx,
  };
}

/** The workout bar's line under a rest: "Barbell Bench Press", then "· Set 3
 *  of 4 · 80 kg × 8", the name the part that gives way. */
export function upNextTail(u: UpNext): string {
  return [u.setLabel, u.numbers].filter(Boolean).map(s => `· ${s}`).join(" ");
}

/** Whether two up-nexts read the same (the bar redraws only on a change). */
export function sameUpNext(a: UpNext | null, b: UpNext | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
