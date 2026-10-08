// The programs the simulated lifter runs, and the lifts in them: what each
// starts at, how it moves up, and what takes its place when the equipment's in
// use. Built the way the program builder saves them (new-program.tsx): day ids
// are the positional d0…dN every new program gets (normalizeDayIds), so two
// programs share ids and only the program tells their days apart.
//
// Chosen to cover what a real few months of logging throws at the app: a day
// name used twice in one cycle ("Upper"), one exercise on two days and twice
// in one day (a heavy and a back-off Bench Press), bodyweight lifts, a timed
// hold, and a 3-program rotation so a program finishes and comes round again.

import type { Exercise, ProgramSet, SavedProgram } from "../../../constants/programs";

export type LiftKind = "weighted" | "bodyweight" | "hold";

export type Lift = {
  kind: LiftKind;
  /** The working weight the lifter starts on, kg (weighted lifts). */
  startKg?: number;
  /** One jump up, kg. */
  stepKg?: number;
  /** The plates / pin steps it goes up in, kg. */
  roundKg?: number;
  /** ...and in pounds, for the stretch the lifter logs in lbs. */
  roundLb?: number;
  /** What the lifter does instead when it's taken. */
  swapFor?: string;
};

const barbell = (startKg: number, stepKg: number, swapFor?: string): Lift => ({ kind: "weighted", startKg, stepKg, roundKg: 2.5, roundLb: 5, swapFor });
const dumbbell = (startKg: number, swapFor?: string): Lift => ({ kind: "weighted", startKg, stepKg: 2, roundKg: 2, roundLb: 5, swapFor });
const stack = (startKg: number, swapFor?: string): Lift => ({ kind: "weighted", startKg, stepKg: 5, roundKg: 5, roundLb: 10, swapFor });

/** Every lift any program or swap uses. Names are the catalogue's
 *  (constants/exerciseData.ts), so the Strength radar places them. */
export const LIFTS: Record<string, Lift> = {
  "Barbell Bench Press": barbell(80, 2.5, "Dumbbell Bench Press"),
  "Dumbbell Bench Press": dumbbell(30),
  "Incline Dumbbell Bench Press": dumbbell(26),
  "Incline Barbell Bench Press": barbell(60, 2.5, "Incline Dumbbell Bench Press"),
  "Barbell Row": barbell(70, 2.5, "Chest-Supported T-Bar Row"),
  "Chest-Supported T-Bar Row": barbell(50, 2.5),
  "Overhead Press": barbell(50, 2.5, "Dumbbell Shoulder Press"),
  "Dumbbell Shoulder Press": dumbbell(22),
  "Barbell Curl": barbell(30, 2.5),
  "Hammer Curl": dumbbell(14),
  "Dumbbell Curl": dumbbell(12),
  "Barbell Back Squat": barbell(100, 2.5, "Hack Squat"),
  "Hack Squat": stack(120),
  "Front Squat": barbell(70, 2.5),
  "Romanian Deadlift": barbell(90, 2.5),
  "Deadlift": barbell(140, 5),
  "Leg Press": stack(180, "Hack Squat"),
  "Bulgarian Split Squat": dumbbell(16),
  "Walking Lunge": dumbbell(18),
  "Barbell Hip Thrust": barbell(100, 5),
  "Standing Calf Raise": stack(80, "Seated Calf Raise"),
  "Seated Calf Raise": stack(50),
  "Lying Leg Curl": stack(40, "Seated Leg Curl"),
  "Seated Leg Curl": stack(45),
  "Leg Extension": stack(55),
  "Lat Pulldown": stack(65, "Machine Pulldown"),
  "Machine Pulldown": stack(70),
  "Seated Cable Row": stack(65, "Machine Row"),
  "Machine Row": stack(70),
  "Face Pull": stack(25),
  "Rear Delt Fly": dumbbell(8),
  "Dumbbell Lateral Raise": dumbbell(10, "Cable Lateral Raise"),
  "Cable Lateral Raise": stack(10),
  "Cable Fly": stack(15, "Pec Deck"),
  "Pec Deck": stack(45),
  "Tricep Pushdown": stack(30, "Rope Tricep Pushdown"),
  "Rope Tricep Pushdown": stack(25),
  "Overhead Cable Extension": stack(25),
  "Pull-Up": { kind: "bodyweight" },
  "Chest Dip": { kind: "bodyweight" },
  "Hanging Leg Raise": { kind: "bodyweight" },
  "Plank": { kind: "hold" },
};

/** A program exercise: warm-ups, then working sets aimed at `reps`. */
function ex(id: string, name: string, warmups: number, working: number, reps: number): Exercise {
  if (!LIFTS[name]) throw new Error(`no lift "${name}"`);
  const sets: ProgramSet[] = [
    ...Array.from({ length: warmups }, (): ProgramSet => ({ type: "warmup" })),
    ...Array.from({ length: working }, (): ProgramSet => ({ type: "working", reps: String(reps) })),
  ];
  return { id, name, sets, ...(LIFTS[name].kind === "hold" ? { isIsometric: true } : {}) };
}

type Day = { label: string; exercises?: Exercise[] };

function program(id: string, name: string, totalWeeks: number, days: Day[]): SavedProgram {
  const workouts: Record<string, Exercise[]> = {};
  days.forEach((d, i) => { if (d.exercises) workouts[`${i}:${d.label}`] = d.exercises; });
  return {
    id, name, totalWeeks, currentWeek: 1, status: "created",
    startDate: "01 Jan 2026",
    trainingDays: days.filter(d => d.label !== "Rest").length,
    cycleDays: days.length,
    cyclePattern: days.map(d => d.label),
    dayIds: days.map((_, i) => `d${i}`),
    workouts,
  };
}

const REST: Day = { label: "Rest" };

export const UPPER_LOWER = "prog_ul";
export const PPL = "prog_ppl";
export const FULL_BODY = "prog_fb";

export function startingPrograms(): SavedProgram[] {
  return [
    program(UPPER_LOWER, "Upper Lower", 6, [
      { label: "Upper", exercises: [
        ex("ul0a", "Barbell Bench Press", 2, 3, 5),
        ex("ul0b", "Barbell Row", 0, 3, 8),
        ex("ul0c", "Overhead Press", 1, 3, 8),
        ex("ul0d", "Pull-Up", 0, 3, 8),
        ex("ul0e", "Barbell Curl", 0, 3, 10),
      ] },
      { label: "Lower", exercises: [
        ex("ul1a", "Barbell Back Squat", 2, 3, 5),
        ex("ul1b", "Romanian Deadlift", 0, 3, 8),
        ex("ul1c", "Leg Press", 0, 3, 10),
        ex("ul1d", "Standing Calf Raise", 0, 3, 12),
        ex("ul1e", "Plank", 0, 3, 60),
      ] },
      REST,
      // The cycle's second "Upper": its own day, its own exercises, with the
      // first day's Bench Press again as a back-off.
      { label: "Upper", exercises: [
        ex("ul3a", "Incline Dumbbell Bench Press", 1, 3, 10),
        ex("ul3b", "Lat Pulldown", 0, 3, 10),
        ex("ul3c", "Dumbbell Lateral Raise", 0, 3, 15),
        ex("ul3d", "Barbell Bench Press", 0, 3, 8),
        ex("ul3e", "Tricep Pushdown", 0, 3, 12),
      ] },
      { label: "Lower", exercises: [
        ex("ul4a", "Deadlift", 1, 3, 5),
        ex("ul4b", "Bulgarian Split Squat", 0, 3, 10),
        ex("ul4c", "Lying Leg Curl", 0, 3, 12),
        ex("ul4d", "Leg Extension", 0, 3, 12),
        ex("ul4e", "Hanging Leg Raise", 0, 3, 12),
      ] },
      REST,
      REST,
    ]),
    program(PPL, "Push Pull Legs", 8, [
      { label: "Push", exercises: [
        // One exercise twice in a day: a heavy top set block, then back-offs.
        ex("pp0a", "Barbell Bench Press", 2, 3, 5),
        ex("pp0b", "Barbell Bench Press", 0, 2, 10),
        ex("pp0c", "Overhead Press", 0, 3, 8),
        ex("pp0d", "Dumbbell Lateral Raise", 0, 3, 15),
        ex("pp0e", "Tricep Pushdown", 0, 3, 12),
        ex("pp0f", "Chest Dip", 0, 3, 10),
      ] },
      { label: "Pull", exercises: [
        ex("pp1a", "Deadlift", 1, 3, 5),
        ex("pp1b", "Pull-Up", 0, 3, 8),
        ex("pp1c", "Barbell Row", 0, 3, 8),
        ex("pp1d", "Face Pull", 0, 3, 15),
        ex("pp1e", "Hammer Curl", 0, 3, 12),
      ] },
      { label: "Legs", exercises: [
        ex("pp2a", "Barbell Back Squat", 2, 3, 5),
        ex("pp2b", "Romanian Deadlift", 0, 3, 8),
        ex("pp2c", "Leg Press", 0, 3, 10),
        ex("pp2d", "Lying Leg Curl", 0, 3, 12),
        ex("pp2e", "Standing Calf Raise", 0, 3, 15),
      ] },
      { label: "Push", exercises: [
        ex("pp3a", "Incline Barbell Bench Press", 1, 3, 8),
        ex("pp3b", "Dumbbell Shoulder Press", 0, 3, 10),
        ex("pp3c", "Cable Fly", 0, 3, 12),
        ex("pp3d", "Dumbbell Lateral Raise", 0, 3, 15),
        ex("pp3e", "Overhead Cable Extension", 0, 3, 12),
      ] },
      { label: "Pull", exercises: [
        ex("pp4a", "Lat Pulldown", 0, 3, 10),
        ex("pp4b", "Seated Cable Row", 0, 3, 10),
        ex("pp4c", "Rear Delt Fly", 0, 3, 15),
        ex("pp4d", "Barbell Curl", 0, 3, 10),
        ex("pp4e", "Hanging Leg Raise", 0, 3, 12),
      ] },
      { label: "Legs", exercises: [
        ex("pp5a", "Front Squat", 1, 3, 6),
        ex("pp5b", "Barbell Hip Thrust", 0, 3, 10),
        ex("pp5c", "Walking Lunge", 0, 3, 12),
        ex("pp5d", "Seated Leg Curl", 0, 3, 12),
        ex("pp5e", "Seated Calf Raise", 0, 3, 15),
      ] },
      REST,
    ]),
    program(FULL_BODY, "Full Body", 4, [
      { label: "Full Body A", exercises: [
        ex("fb0a", "Barbell Back Squat", 2, 3, 5),
        ex("fb0b", "Barbell Bench Press", 1, 3, 5),
        ex("fb0c", "Barbell Row", 0, 3, 8),
        ex("fb0d", "Plank", 0, 3, 45),
      ] },
      REST,
      { label: "Full Body B", exercises: [
        ex("fb2a", "Deadlift", 1, 3, 5),
        ex("fb2b", "Overhead Press", 0, 3, 8),
        ex("fb2c", "Pull-Up", 0, 3, 8),
        ex("fb2d", "Dumbbell Curl", 0, 3, 12),
      ] },
      REST,
    ]),
  ];
}

/** What the lifter fills a custom workout with. */
export const CUSTOM_WORKOUT = {
  name: "Arms",
  exercises: ["Barbell Curl", "Hammer Curl", "Tricep Pushdown", "Dumbbell Lateral Raise"],
};

/** What gets added on top of a session now and then. */
export const EXTRA_LIFTS = ["Face Pull", "Dumbbell Curl", "Rear Delt Fly", "Hanging Leg Raise"];
