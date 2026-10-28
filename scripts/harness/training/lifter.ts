// One simulated person logging months of training on one phone: the programs
// in ./programs.ts in rotation, real sets and weights that go up (and
// sometimes back down), and the mess real logging has in it. Missed days,
// Make Rest Day and Move to Tomorrow, a session finished after midnight, one
// logged days later from the Journal, a machine taken (swap), an exercise
// added, a warm-up or a set fewer, a custom workout, two sessions in a day, a
// session deleted, a holiday with or without pausing first, kg switched to
// lbs, programs finished, shelved and run again.
//
// Every write goes through the app's own functions, or repeats the screen's
// few lines of storage writes with where they come from, as the solo flows do
// (scripts/harness/solo/flows.ts). Beside the phone's storage the lifter keeps
// a LEDGER: what was really done, typed in which unit, and when it really
// finished. The checks (./checks.ts) hold every screen to the ledger.

import { advanceDays, answerPrompts, setClock, takePrompts, type Chooser } from "../solo/env";
import { on, type Phone } from "../app";
import { getJSON, removeKey, setJSON } from "../../../utils/storage";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_DAY_OVERRIDE_KEY, WORKOUT_HISTORY_KEY,
  normaliseSets, programFinishDate,
  type CompletedExercise, type CompletedWorkout, type Exercise, type PlannedExercise, type ProgramSet, type SavedProgram,
} from "../../../constants/programs";
import { planOf } from "../../../utils/exerciseChanges";
import { LB_PER_KG, UNIT_KEY, parseWeightToKg, trimNumber } from "../../../utils/units";
import { addDaysYMD, formatStoredDate, toYMD } from "../../../utils/dates";
import { getEffectiveToday, getWorkoutForDate, resolveWorkoutForDate, swapOrigin, type DayOverride } from "../../../utils/workout";
import { applyRestDay } from "../../../utils/restDay";
import { autoPauseIfIdle, pauseProgram, resumeWithPrompt } from "../../../utils/programPause";
import { activateProgram, completeProgram, deactivateProgram, programsAfterPastLog } from "../../../utils/programLifecycle";
import { awardProgramAchievement, awardWorkoutAchievements } from "../../../utils/achievementStore";
import { stampSession, timeValFromDate } from "../../../utils/sessionTime";
import { programDays } from "../../../utils/programDays";
import { CUSTOM_WORKOUT, EXTRA_LIFTS, FULL_BODY, LIFTS, PPL, UPPER_LOWER, startingPrograms, type LiftKind } from "./programs";

// ─── The ledger ──────────────────────────────────────────────────────────────

export type LedgerSet = {
  type: "warmup" | "working";
  /** What was typed, in the session's unit. "" = left blank. */
  weight: string;
  reps: string;
  done: boolean;
};

export type LedgerExercise = {
  name: string;
  /** Its place in the program (programExerciseId), absent for one added. */
  place?: string;
  swappedFrom?: string;
  kind: LiftKind;
  sets: LedgerSet[];
  note: string;
};

export type LedgerSession = {
  id: string;
  /** The training day it was logged on. */
  date: string;
  /** When it really ended, epoch ms. */
  finishedAt: number;
  /** Saved with its times (a Journal log can leave them out, and is then
   *  stamped at midday). */
  timed: boolean;
  durationSeconds: number;
  /** "" = a free workout. */
  programId: string;
  dayId?: string;
  workoutName: string;
  unit: "kg" | "lb";
  exercises: LedgerExercise[];
  sessionNote: string;
  via: "workout" | "journal";
  /** The order sessions were saved in. */
  savedSeq: number;
  /** The program day as the session was set up from it, in order: what the
   *  lifter was given before doing anything to it. Absent for a free or custom
   *  workout. */
  plan?: PlannedExercise[];
};

/** One run of a program: from activation to completion or shelving, and
 *  which (`finished`), once it's over. */
export type ProgramRun = { programId: string; startYMD: string; endYMD?: string; finished?: boolean };

/** The day the Workout tab is showing, as resolveWorkoutForDate returns it. */
type Day = { name: string; exercises: Exercise[]; programId?: string; dayId?: string };

/** A session exercise as the Workout tab holds it (withProgramIds, swaps). */
export type SessionCard = {
  name: string;
  programExerciseId?: string;
  swappedFrom?: string;
  kind: LiftKind;
  /** Its set rows by kind, warm-ups first, as it's finished with: what last
   *  time's numbers are lined up with (utils/workout.ts prevHintsForRows). */
  rows: ("warmup" | "working")[];
};

/** What the Workout tab has in front of it just before Complete Workout. */
export type BeforeLog = {
  lifter: Lifter;
  history: CompletedWorkout[];
  programs: SavedProgram[];
  workout: { name: string; programId?: string; dayId?: string };
  cards: SessionCard[];
  isKg: boolean;
  /** Today's plan for the day, as the Workout tab set the session up. */
  plan?: PlannedExercise[];
};

export type AfterSave = {
  lifter: Lifter;
  saved: CompletedWorkout;
  ledger: LedgerSession;
  /** History as it was before this session was saved. */
  prior: CompletedWorkout[];
};

const pressStartingWith = (prefix: string): Chooser => (_t, buttons) => buttons.find(b => b.startsWith(prefix)) ?? null;

/** A free workout logged from the Journal: no program, no places. */
function customDay(): Day {
  return {
    name: CUSTOM_WORKOUT.name,
    programId: "",
    exercises: CUSTOM_WORKOUT.exercises.map(name => ({ id: "", name, sets: [1, 2, 3].map(() => ({ type: "working" as const, reps: "12" })) })),
  };
}

type SetKind = "warmup" | "working";

/** What a card with no program exercise is done as: three sets of ten. */
const UNPLANNED: ProgramSet[] = [1, 2, 3].map((): ProgramSet => ({ type: "working", reps: "10" }));

/** `sets` with one of `kind` left out: the first warm-up (the lightest, so the
 *  heavier is the one done) or the last working set (the one − takes). */
function oneShort<T extends { type: SetKind }>(sets: T[], kind: SetKind | null): T[] {
  if (!kind) return sets;
  const at = kind === "warmup" ? sets.findIndex(s => s.type === "warmup") : sets.map(s => s.type).lastIndexOf("working");
  return at < 0 ? sets : sets.filter((_, i) => i !== at);
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** A small seeded PRNG, so a failing run can be played again. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Hooks = {
  beforeLog?: (b: BeforeLog) => void;
  afterSave?: (a: AfterSave) => void;
};

export class Lifter {
  readonly phone: Phone;
  readonly seed: number;
  private readonly rand: () => number;
  /** The chances of a set short (shortOf), apart from `rand` so leaving a set
   *  out never changes what else the lifter does. */
  private readonly shortRand: () => number;
  unit: "kg" | "lb" = "kg";
  readonly sessions: LedgerSession[] = [];
  readonly runs: ProgramRun[] = [];
  readonly story: string[] = [];
  /** Holds as they happened: paused from `from`, resumed on `to` (open while
   *  still held). */
  readonly holds: { programId: string; from: string; to?: string }[] = [];
  /** Each day as it stood when the day was over: the program running, and
   *  whether it had a workout planned (a day marked off or held had none). A
   *  past day must read the same on the program page however much later it's
   *  looked at. */
  readonly plans = new Map<string, { programId: string; planned: boolean }>();
  private readonly strength = new Map<string, number>();
  private seq = 0;
  private savedSeq = 0;
  private pendingLogs: { due: string; date: string; day: Day }[] = [];
  private holiday: { from: string; to: string; pauseFirst: boolean } | null = null;
  private readonly unitSwitchDay: number;
  private readonly rotation = [UPPER_LOWER, PPL, FULL_BODY];
  private next = 0;
  private dayIndex = 0;

  constructor(seed: number, readonly hooks: Hooks = {}) {
    this.seed = seed;
    this.rand = rng(seed);
    this.shortRand = rng(seed ^ 0x5e75);
    this.phone = { uid: `lifter${seed}`, name: `Lifter ${seed}`, store: new Map(), offline: false };
    // A third of lifters switch to lbs for a stretch, somewhere in the run.
    this.unitSwitchDay = this.rand() < 0.35 ? 20 + Math.floor(this.rand() * 80) : -1;
    // Where the rotation starts.
    this.next = Math.floor(this.rand() * this.rotation.length);
  }

  private chance(p: number) { return this.rand() < p; }
  private pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.rand() * xs.length)]; }
  private between(a: number, b: number) { return a + Math.floor(this.rand() * (b - a + 1)); }

  private note(date: string, what: string) {
    const [y, m, d] = date.split("-").map(Number);
    this.story.push(`${SHORT_DAYS[new Date(y, m - 1, d).getDay()]} ${date}: ${what}`);
  }

  /** On this phone. */
  run<T>(fn: () => Promise<T>): Promise<T> { return on(this.phone, fn); }

  // ─── Reading what's stored ─────────────────────────────────────────────────

  readPrograms() { return this.run(() => getJSON<SavedProgram[]>(PROGRAMS_KEY, [])); }
  readHistory() { return this.run(() => getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, [])); }
  readOverride() { return this.run(() => getJSON<DayOverride | null>(WORKOUT_DAY_OVERRIDE_KEY, null)); }

  /** The Workout tab for the day it's on: a session already logged there, or
   *  what it resolves to (loadData). */
  async workoutTab(): Promise<{ today: string; active: SavedProgram | null; programs: SavedProgram[]; completed: CompletedWorkout | null; shows: Day | null }> {
    const programs = await this.readPrograms();
    const history = await this.readHistory();
    const active = programs.find(p => p.status === "active") ?? null;
    const today = getEffectiveToday(active, history);
    const override = await this.readOverride();
    const resolved = active ? resolveWorkoutForDate(active, override, today, programs) : null;
    return {
      today, active, programs,
      completed: history.find(w => w.date === today) ?? null,
      shows: resolved ? { name: resolved.name, exercises: resolved.exercises, programId: resolved.programId, dayId: resolved.dayId } : null,
    };
  }

  // ─── The start ─────────────────────────────────────────────────────────────

  async start(startYMD: string) {
    const [y, m, d] = startYMD.split("-").map(Number);
    setClock(y, m, d, 9, 0);
    this.phone.store = new Map([
      [UNIT_KEY, "kg"],
      [PROGRAMS_KEY, JSON.stringify(startingPrograms())],
      [WORKOUT_HISTORY_KEY, "[]"],
      [WORKOUT_DATES_KEY, "[]"],
    ]);
    takePrompts();
    answerPrompts(() => null);
    await this.activateNext(startYMD);
  }

  /** Make the next program in the rotation active. `ended` says how the run
   *  going until now ended, when the lifter decided: marked complete, or
   *  shelved; otherwise it's finished if the activation finished it. */
  private async activateNext(today: string, ended?: "completed" | "shelved") {
    const id = this.rotation[this.next % this.rotation.length];
    this.next += 1;
    const programs = await this.readPrograms();
    const { programs: updated, finished } = activateProgram(programs, id, formatStoredDate(new Date()));
    await this.run(async () => {
      await setJSON(PROGRAMS_KEY, updated);
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
      // My Programs awards a program the activation finished (handleActivate).
      if (finished) await awardProgramAchievement(finished.program, finished.week);
    });
    for (const r of this.runs) {
      if (r.endYMD || r.programId === id) continue;
      r.endYMD = today;
      r.finished = ended ? ended === "completed" : finished?.program.id === r.programId;
    }
    this.runs.push({ programId: id, startYMD: today });
    this.note(today, `made ${updated.find(p => p.id === id)!.name} active${finished ? ` (${finished.program.name} finished)` : ""}`);
  }

  // ─── A day ─────────────────────────────────────────────────────────────────

  /** Live `date` (the calendar day), from waking to bed, then note how the day
   *  stood when it was over. */
  async day(date: string) {
    await this.live(date);
    const programs = await this.readPrograms();
    const active = programs.find(p => p.status === "active");
    if (active) this.plans.set(date, { programId: active.id, planned: !!getWorkoutForDate(active, date) });
  }

  private async live(date: string) {
    const [y, m, d] = date.split("-").map(Number);
    this.dayIndex += 1;
    if (this.dayIndex === this.unitSwitchDay) await this.switchUnit(date);
    if (this.unitSwitchDay > 0 && this.dayIndex === this.unitSwitchDay + 45) await this.switchUnit(date);

    // A holiday: nothing opened, nothing logged.
    if (!this.holiday && this.dayIndex > 30 && this.chance(0.012)) {
      const length = this.between(7, 12);
      this.holiday = { from: date, to: addDaysYMD(date, length), pauseFirst: this.chance(0.5) };
      this.note(date, `goes on holiday for ${length} days${this.holiday.pauseFirst ? ", pausing the program first" : ""}`);
      if (this.holiday.pauseFirst) {
        setClock(y, m, d, 7, 30);
        const { active, today } = await this.workoutTab();
        if (active && !active.pausedAt) {
          const programs = await this.readPrograms();
          await this.run(async () => {
            await setJSON(PROGRAMS_KEY, pauseProgram(programs, active.id, today));
            await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
          });
          this.holds.push({ programId: active.id, from: today });
        }
      }
    }
    if (this.holiday && date < this.holiday.to) return;
    const back = this.holiday && date === this.holiday.to;
    if (back) this.holiday = null;

    // Morning: the app opens (app/_layout.tsx autoPauseIfIdle), which holds
    // the program by itself after a week with nothing logged.
    setClock(y, m, d, 7, 0);
    const before = (await this.readPrograms()).find(p => p.status === "active");
    await this.run(() => autoPauseIfIdle());
    const after = (await this.readPrograms()).find(p => p.status === "active");
    if (after?.pausedAt && !before?.pausedAt) {
      this.holds.push({ programId: after.id, from: after.pausedAt });
      this.note(date, `${after.name} put itself on hold (a week with nothing logged)`);
    }
    if (back) await this.resume(date);

    await this.managePrograms(date);

    // The day's training. Held, the Workout tab offers Resume: a few pick it
    // up early, and train that day if it has a workout.
    let tab = await this.workoutTab();
    if (tab.active?.pausedAt && this.chance(0.15)) {
      await this.resume(date);
      tab = await this.workoutTab();
    }
    if (tab.active?.pausedAt) {
      // Still held: nothing to train.
    } else if (tab.shows && !tab.completed) {
      await this.programDay(date, tab.shows);
    } else if (!tab.completed && this.chance(0.05)) {
      setClock(y, m, d, this.between(9, 18), this.between(0, 59));
      await this.customWorkout(date, this.chance(0.4));
    }

    // Now and then, a second session the same day: the Workout tab is done for
    // the day once anything's logged, so it goes in from the Journal.
    if (this.sessions.some(s => s.date === date) && this.chance(0.015)) {
      setClock(y, m, d, 20, this.between(0, 50));
      await this.logFromJournal(date, customDay());
    }

    // Logging a missed session from the Journal, days later (one due while
    // away goes in on the way back, after the hold it fell before).
    for (const log of this.pendingLogs.filter(l => l.due <= date)) {
      setClock(y, m, d, 21, this.between(0, 40));
      await this.logFromJournal(log.date, log.day);
    }
    this.pendingLogs = this.pendingLogs.filter(l => l.due > date);

    // Deleting a session from the Journal (workout detail's Delete).
    if (this.sessions.length > 3 && this.chance(0.03)) {
      setClock(y, m, d, 22, 0);
      const recent = [...this.sessions].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 8);
      await this.deleteSession(date, this.pick(recent).id);
    }
  }

  private async switchUnit(date: string) {
    this.unit = this.unit === "kg" ? "lb" : "kg";
    await this.run(() => setJSON(UNIT_KEY, this.unit));
    this.note(date, `switches to ${this.unit === "kg" ? "kg" : "lbs"}`);
  }

  private async resume(date: string) {
    const { active } = await this.workoutTab();
    if (!active?.pausedAt) return;
    const choice = this.chance(0.5) ? "Today" : "Carry on";
    const programs = await this.run(async () => {
      answerPrompts(pressStartingWith(choice));
      try { return await resumeWithPrompt(active.id); } finally { answerPrompts(() => null); }
    });
    takePrompts();
    if (programs) {
      // resumeProgram resumes on the calendar day.
      const open = [...this.holds].reverse().find(h => h.programId === active.id && !h.to);
      if (open) open.to = toYMD(new Date());
      this.note(date, `resumes ${active.name} (${choice})`);
    }
  }

  /** Finishing, switching and re-running programs (My Programs). */
  private async managePrograms(date: string) {
    const programs = await this.readPrograms();
    const active = programs.find(p => p.status === "active") ?? null;
    if (!active) { await this.activateNext(date); return; }
    if (active.pausedAt) return;
    const finish = programFinishDate(active);
    if (finish && date > toYMD(finish) && this.chance(0.6)) {
      if (this.chance(0.5)) {
        // Mark Complete, then the next one.
        const { programs: done, weekReached } = completeProgram(programs, active.id, formatStoredDate(new Date()));
        await this.run(async () => {
          await setJSON(PROGRAMS_KEY, done);
          await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
          await awardProgramAchievement(done.find(p => p.id === active.id)!, weekReached);
        });
        this.note(date, `marks ${active.name} complete`);
        await this.activateNext(date, "completed");
        return;
      }
      await this.activateNext(date);
      return;
    }
    // Now and then a program is shelved mid-run for another.
    if (this.chance(0.004)) {
      await this.run(async () => {
        await setJSON(PROGRAMS_KEY, deactivateProgram(programs, active.id));
        await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
      });
      this.note(date, `shelves ${active.name}`);
      await this.activateNext(date, "shelved");
    }
  }

  /** A day the program has a workout on. */
  private async programDay(date: string, day: Day) {
    const [y, m, d] = date.split("-").map(Number);
    const r = this.rand();
    if (r < 0.78) {
      setClock(y, m, d, this.between(6, 20), this.between(0, 59));
      await this.trainToday(date, day);
      // Delete & Redo now and then: the session deleted from the Workout tab
      // and done again from the program.
      if (this.chance(0.02)) {
        const last = this.sessions[this.sessions.length - 1];
        await this.deleteSession(date, last.id);
        const again = await this.workoutTab();
        if (again.shows && !again.completed) await this.trainToday(date, again.shows);
      }
    } else if (r < 0.81) {
      // A late one: finished after midnight, so the app is still on today.
      setClock(y, m, d + 1, 0, this.between(20, 95));
      await this.trainToday(date, day);
    } else if (r < 0.85) {
      this.note(date, `misses ${day.name}`);
    } else if (r < 0.88) {
      setClock(y, m, d, 8, 0);
      await this.markOff(date, "Make Rest Day");
    } else if (r < 0.92) {
      setClock(y, m, d, 8, 0);
      await this.markOff(date, "Move to");
    } else if (r < 0.95) {
      // Trained, but logs it from the Journal a day or two later.
      this.pendingLogs.push({ due: addDaysYMD(date, this.between(1, 3)), date, day });
      this.note(date, `trains ${day.name} without the app`);
    } else if (r < 0.97) {
      setClock(y, m, d, this.between(9, 18), this.between(0, 59));
      await this.customWorkout(date, this.chance(0.5));
    } else {
      // Change Workout Day: another of the program's days today.
      setClock(y, m, d, 9, 0);
      const tab = await this.workoutTab();
      const program = tab.programs.find(p => p.id === (day.programId ?? tab.active?.id));
      const others = program ? programDays(program).filter(x => x.dayId !== day.dayId && x.index >= 0) : [];
      if (!program || others.length === 0) return;
      const pick = this.pick(others);
      await this.run(() => setJSON(WORKOUT_DAY_OVERRIDE_KEY, { date: tab.today, workoutName: pick.label, programId: program.id, dayId: pick.dayId }));
      const changed = await this.workoutTab();
      if (!changed.shows) return;
      this.note(date, `changes today to ${changed.shows.name} (${changed.shows.dayId})`);
      setClock(y, m, d, this.between(10, 19), this.between(0, 59));
      await this.trainToday(date, changed.shows);
    }
  }

  private async markOff(date: string, button: string) {
    const { active, today } = await this.workoutTab();
    if (!active) return;
    const outcome = await this.run(async () => {
      answerPrompts(pressStartingWith(button));
      try { return await applyRestDay(active.id, today, "ask"); } finally { answerPrompts(() => null); }
    });
    takePrompts();
    this.note(date, `${button === "Move to" ? "moves" : "rests"} ${today}${outcome ? ` (${outcome})` : " (nothing)"}`);
  }

  // ─── Sets ──────────────────────────────────────────────────────────────────

  /** A weight as the lifter types it: the nearest plate step in their unit. */
  private typed(kg: number, name: string): string {
    const lift = LIFTS[name];
    if (this.unit === "kg") {
      const step = lift.roundKg ?? 2.5;
      return trimNumber(Math.max(step, Math.round(kg / step) * step), 2);
    }
    const step = lift.roundLb ?? 5;
    return trimNumber(Math.max(step, Math.round((kg * LB_PER_KG) / step) * step), 1);
  }

  private workingKg(name: string): number {
    const lift = LIFTS[name];
    const kg = this.strength.get(name) ?? lift.startKg ?? 0;
    this.strength.set(name, kg);
    return kg;
  }

  /** After a session: weights mostly creep up, and now and then come down. */
  private progress(name: string) {
    const lift = LIFTS[name];
    if (lift.kind !== "weighted") return;
    const kg = this.workingKg(name);
    if (this.chance(0.04)) this.strength.set(name, kg * 0.9);
    else if (this.chance(0.4)) this.strength.set(name, kg + (lift.stepKg ?? 2.5));
  }

  /** Now and then a card is done a set short: a warm-up fewer (− takes the
   *  last set, then a warm-up is turned into a working set) or a working set
   *  fewer (−), which last time's numbers have to line up with
   *  (prevHintsForRows). Decided from chances of its own, so each lifter's
   *  story is the one it was before sets were left out. */
  private shortOf(template: Exercise | null): SetKind | null {
    const kinds = (template ? normaliseSets(template) : UNPLANNED).map(s => s.type);
    const warmups = kinds.filter(k => k === "warmup").length;
    if (warmups > 0 && this.shortRand() < 0.06) return "warmup";
    if (kinds.length - warmups > 1 && this.shortRand() < 0.05) return "working";
    return null;
  }

  /** The sets the lifter logs for one card. */
  private setsFor(name: string, template: Exercise | null): LedgerSet[] {
    const lift = LIFTS[name];
    const shape = template ? normaliseSets(template) : UNPLANNED;
    const work = this.workingKg(name);
    let warmupN = 0;
    const warmups = shape.filter(s => s.type === "warmup").length;
    return shape.map((s): LedgerSet => {
      const target = Number(s.reps ?? "10") || 10;
      if (s.type === "warmup") {
        warmupN += 1;
        const share = 0.4 + (0.4 * warmupN) / Math.max(1, warmups);
        return {
          type: "warmup",
          weight: lift.kind === "weighted" ? this.typed(work * share, name) : "",
          reps: String(Math.max(3, target)),
          done: true,
        };
      }
      // Working sets: mostly as planned, sometimes a rep or two short, now and
      // then one left unticked (a skipped set) or ticked with no reps typed.
      let weight = "";
      if (lift.kind === "weighted") weight = this.typed(work, name);
      else if (lift.kind === "bodyweight" && this.dayIndex > 40 && this.chance(0.25)) weight = this.typed(10, "Barbell Curl");
      const reps = lift.kind === "hold"
        ? String(this.between(40, 90))
        : String(Math.max(1, target - (this.chance(0.15) ? this.between(1, 2) : 0)));
      if (this.chance(0.03)) return { type: "working", weight: this.chance(0.5) ? weight : "", reps: this.chance(0.5) ? reps : "", done: false };
      if (this.chance(0.01) && weight) return { type: "working", weight, reps: "", done: true };
      return { type: "working", weight, reps, done: true };
    });
  }

  private exerciseNote(): string {
    return this.chance(0.12) ? this.pick(["felt strong", "grip went", "shoulder a bit tight", "slow on the last set", "machine taken, did it after"]) : "";
  }

  // ─── Logging ───────────────────────────────────────────────────────────────

  /** The Workout tab: today's workout, done and completed now (the clock). */
  private async trainToday(date: string, day: Day) {
    // withProgramIds, then swaps (the Change chip) and an add or two.
    const cards: (Omit<SessionCard, "rows"> & { template: Exercise | null })[] = day.exercises.map(e => ({
      name: e.name, programExerciseId: e.id, kind: LIFTS[e.name]?.kind ?? "weighted", template: e,
    }));
    for (const c of cards) {
      const swapFor = LIFTS[c.name]?.swapFor;
      if (swapFor && this.chance(0.05)) {
        c.swappedFrom = swapOrigin({ name: c.name }, { name: swapFor }).swappedFrom;
        c.name = swapFor;
        c.kind = LIFTS[swapFor].kind;
      }
    }
    if (this.chance(0.04)) {
      const extra = this.pick(EXTRA_LIFTS.filter(n => !cards.some(c => c.name === n)));
      if (extra) cards.push({ name: extra, kind: LIFTS[extra].kind, template: null });
    }
    // A machine taken: one exercise done first (Move exercise). Or one left
    // out (Remove). What the Journal's "Planned 2nd" and "Skipped" are about.
    const reordered: string[] = [];
    if (cards.length > 2 && this.chance(0.05)) {
      const [moved] = cards.splice(this.between(1, cards.length - 1), 1);
      cards.unshift(moved);
      reordered.push(`did ${moved.name} first`);
    }
    if (cards.length > 2 && this.chance(0.03)) {
      const [left] = cards.splice(this.between(1, cards.length - 1), 1);
      reordered.push(`skipped ${left.name}`);
    }
    // A set short on a card now and then (shortOf).
    const shorts = cards.map(c => this.shortOf(c.template));
    // The plan as the Workout tab set the session up: the day's exercises, in
    // the program's order (workout.tsx `planOf`, saved as CompletedWorkout.plan).
    const plan = day.dayId ? planOf(day.exercises) : undefined;
    const tab = await this.workoutTab();
    const history = await this.readHistory();
    this.hooks.beforeLog?.({
      lifter: this,
      history,
      programs: tab.programs,
      workout: { name: day.name, programId: day.programId, dayId: day.dayId },
      cards: cards.map(({ template, ...c }, i) => {
        // The card's rows as it's finished with, warm-ups first as the tab lays them out.
        const kinds = oneShort(template ? normaliseSets(template) : UNPLANNED, shorts[i]).map(s => s.type);
        return { ...c, rows: [...kinds.filter(k => k === "warmup"), ...kinds.filter(k => k !== "warmup")] };
      }),
      isKg: this.unit === "kg",
      plan,
    });

    const exercises: LedgerExercise[] = cards.map((c, i) => ({
      name: c.name,
      place: c.programExerciseId,
      swappedFrom: c.swappedFrom,
      kind: c.kind,
      sets: oneShort(this.setsFor(c.name, c.template), shorts[i]),
      note: this.exerciseNote(),
    }));
    const finish = new Date();
    const minutes = this.between(45, 95);
    await this.save({
      via: "workout",
      // The day the tab is on, as Complete Workout stamps it (buildCompletedWorkout).
      date: tab.today,
      finish,
      start: new Date(finish.getTime() - minutes * 60_000),
      workoutName: day.name,
      programId: day.programId ?? "",
      dayId: day.dayId,
      exercises,
      sessionNote: this.chance(0.2) ? this.pick(["good session", "tired today", "gym was packed"]) : "",
      plan,
    });
    for (const c of cards) if (!c.swappedFrom) this.progress(c.name);
    const fewer = cards.flatMap((c, i) => (shorts[i] ? [`${c.name} a ${shorts[i] === "warmup" ? "warm-up" : "working set"} short`] : []));
    this.note(date, `logs ${day.name}${day.dayId ? ` (${day.dayId})` : ""} on ${tab.today}, done ${hm(finish)}${cards.some(c => c.swappedFrom) ? `, swapped ${cards.filter(c => c.swappedFrom).map(c => `${c.swappedFrom}→${c.name}`).join(", ")}` : ""}${reordered.length ? `, ${reordered.join(", ")}` : ""}${fewer.length ? `, ${fewer.join(", ")}` : ""}`);
  }

  /** The Workout tab's custom workout: named, exercises picked, maybe added
   *  to the program (confirmCustomWorkout → Finish). */
  private async customWorkout(date: string, addToProgram: boolean) {
    const tab = await this.workoutTab();
    if (tab.completed) return;
    const active = tab.active && !tab.active.pausedAt ? tab.active : null;
    const add = addToProgram && !!active;
    const name = CUSTOM_WORKOUT.name;
    await this.run(() => setJSON(WORKOUT_DAY_OVERRIDE_KEY, { date: tab.today, workoutName: name }));
    const exercises: LedgerExercise[] = CUSTOM_WORKOUT.exercises.map(n => ({
      name: n, kind: LIFTS[n].kind, sets: this.setsFor(n, null), note: this.exerciseNote(),
    }));
    const finish = new Date();
    await this.save({
      via: "workout",
      date: tab.today,
      finish,
      start: new Date(finish.getTime() - this.between(30, 60) * 60_000),
      workoutName: name,
      programId: add ? active!.id : "",
      exercises,
      sessionNote: "",
    });
    await this.run(async () => {
      if (add) {
        const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
        await setJSON(PROGRAMS_KEY, programs.map(p => (p.id === active!.id && !(p.extraWorkouts ?? []).includes(name)
          ? { ...p, extraWorkouts: [...(p.extraWorkouts ?? []), name] } : p)));
      }
      await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
    });
    for (const n of CUSTOM_WORKOUT.exercises) this.progress(n);
    this.note(date, `logs a custom "${name}" on ${tab.today}${add ? ", added to the program" : ""}`);
  }

  /** log-workout.tsx's save of a session on a past date (doSave). */
  private async logFromJournal(date: string, day: Day) {
    const withTime = this.chance(0.7);
    // Some late: finished in the small hours after the day, the session
    // counted as that day's (logging an earlier day: one logged the same
    // evening hasn't finished yet).
    const late = date < toYMD(new Date()) && this.chance(0.15);
    const [y, m, d] = date.split("-").map(Number);
    const end = late
      ? new Date(y, m - 1, d + 1, this.between(0, 2), this.between(0, 59))
      : new Date(y, m - 1, d, this.between(7, 19), this.between(0, 59));
    const exercises: LedgerExercise[] = day.exercises.map(e => ({
      name: e.name, place: e.id || undefined, kind: LIFTS[e.name]?.kind ?? "weighted",
      sets: this.setsFor(e.name, e), note: this.exerciseNote(),
    }));
    await this.save({
      via: "journal",
      date,
      finish: withTime ? end : new Date(`${date}T12:00:00`),
      start: withTime ? new Date(end.getTime() - this.between(45, 90) * 60_000) : null,
      workoutName: day.name,
      programId: day.programId ?? "",
      dayId: day.dayId,
      exercises,
      sessionNote: "",
      // log-workout reads the plan off the program as it saves (planForDay).
      plan: day.dayId ? planOf(day.exercises) : undefined,
    });
    for (const e of day.exercises) this.progress(e.name);
    this.note(toYMD(new Date()), `logs ${day.name} for ${date} from the Journal${withTime ? `, done ${hm(end)}${late ? " that night" : ""}` : " (no time)"}`);
  }

  /** Writes a finished session the way its screen does, and the ledger. */
  private async save(s: {
    via: "workout" | "journal";
    date: string;
    finish: Date;
    /** Null: a Journal log with no time set. */
    start: Date | null;
    workoutName: string;
    programId: string;
    dayId?: string;
    exercises: LedgerExercise[];
    sessionNote: string;
    plan?: PlannedExercise[];
  }) {
    const isKg = this.unit === "kg";
    const exercises: CompletedExercise[] = s.exercises.map(e => ({
      name: e.name,
      sets: e.sets.map(x => ({ type: x.type, weight: parseWeightToKg(x.weight, isKg), reps: x.reps, done: x.done })),
      notes: e.note,
      ...(e.swappedFrom ? { swappedFrom: e.swappedFrom } : {}),
      ...(e.place ? { programExerciseId: e.place } : {}),
      // The Hold switch, on for a hold the program marks (both screens start
      // it from the program exercise's isIsometric).
      ...(e.kind === "hold" ? { isIsometric: true as const } : {}),
    }));
    let completedAt: string;
    let durationSeconds: number;
    if (s.via === "workout") {
      // Complete Workout's sheet: the times as minute wheels, read against
      // the start as it was stamped (workout.tsx onConfirm).
      ({ completedAt, durationSeconds } = stampSession(s.date, timeValFromDate(s.start!), timeValFromDate(s.finish), s.start));
    } else if (s.start) {
      // The Journal's log: the times picked, no stamp to go by (log-workout.tsx).
      ({ completedAt, durationSeconds } = stampSession(s.date, timeValFromDate(s.start), timeValFromDate(s.finish)));
    } else {
      completedAt = new Date(`${s.date}T12:00:00`).toISOString();
      durationSeconds = 0;
    }
    const completed: CompletedWorkout = {
      id: `workout_${Date.now()}_${this.seq++}`,
      date: s.date,
      completedAt,
      workoutName: s.workoutName,
      programId: s.programId,
      dayId: s.dayId,
      ...(s.plan ? { plan: s.plan } : {}),
      durationSeconds,
      sessionNotes: s.sessionNote.trim() ? s.sessionNote : undefined,
      exercises,
    };
    const prior = await this.readHistory();
    await this.run(async () => {
      if (s.via === "workout") {
        // persistCompletedWorkout: dates, then history, then the awards.
        const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
        if (!dates.includes(completed.date)) await setJSON(WORKOUT_DATES_KEY, [...dates, completed.date]);
        await setJSON(WORKOUT_HISTORY_KEY, [completed, ...prior]);
        await awardWorkoutAchievements(completed, prior, isKg);
      } else {
        await setJSON(WORKOUT_HISTORY_KEY, [completed, ...prior]);
        await awardWorkoutAchievements(completed, prior, isKg);
        const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
        if (!dates.includes(completed.date)) await setJSON(WORKOUT_DATES_KEY, [...dates, completed.date]);
        if (s.programId) {
          const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
          const after = programsAfterPastLog(programs, {
            owningProgramId: s.programId, programId: s.dayId ? s.programId : undefined, date: s.date, workoutName: s.workoutName,
          });
          if (after.changed) await setJSON(PROGRAMS_KEY, after.programs);
        }
      }
    });
    const ledger: LedgerSession = {
      id: completed.id,
      date: s.date,
      finishedAt: s.finish.getTime(),
      timed: s.start !== null,
      durationSeconds,
      programId: s.programId,
      dayId: s.dayId,
      workoutName: s.workoutName,
      unit: this.unit,
      exercises: s.exercises,
      sessionNote: s.sessionNote,
      via: s.via,
      savedSeq: this.savedSeq++,
      ...(s.plan ? { plan: s.plan } : {}),
    };
    this.sessions.push(ledger);
    this.hooks.afterSave?.({ lifter: this, saved: completed, ledger, prior });
  }

  /** workout-detail's Delete (or the Workout tab's Delete & Redo). */
  private async deleteSession(date: string, id: string) {
    const target = this.sessions.find(s => s.id === id);
    if (!target) return;
    await this.run(async () => {
      const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
      const updated = history.filter(w => w.id !== id);
      await setJSON(WORKOUT_HISTORY_KEY, updated);
      if (!updated.some(w => w.date === target.date)) {
        const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
        await setJSON(WORKOUT_DATES_KEY, dates.filter(d => d !== target.date));
      }
    });
    this.sessions.splice(this.sessions.indexOf(target), 1);
    this.note(date, `deletes ${target.workoutName} of ${target.date}`);
  }

  /** The clock to `date` at `hour`, for a check to read the screens then. */
  at(date: string, hour: number, minute = 0) {
    const [y, m, d] = date.split("-").map(Number);
    setClock(y, m, d, hour, minute);
  }

  /** One day on. */
  static nextDay(date: string) { return addDaysYMD(date, 1); }
}

export { advanceDays };
