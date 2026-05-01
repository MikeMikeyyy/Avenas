export const PROGRAMS_KEY = "@avenas/programs";
export const WORKOUT_DATES_KEY = "@avenas/workout_dates";
export const WORKOUT_HISTORY_KEY = "@avenas/workout_history";

export type CompletedSet = {
  type: "warmup" | "working";
  weight: string;
  reps: string;
  done: boolean;
};

export type CompletedExercise = {
  name: string;
  sets: CompletedSet[];
  notes: string;
};

export type CompletedWorkout = {
  id: string;
  date: string;          // YYYY-MM-DD
  completedAt: string;   // ISO timestamp
  workoutName: string;
  durationSeconds: number;
  exercises: CompletedExercise[];
};

export type ProgramSet = {
  type: "warmup" | "working";
  weightKg?: string;
  repMode?: "target" | "range"; // defaults to "target"
  reps?: string;                // repMode === "target", e.g. "8"
  repsMin?: string;             // repMode === "range", e.g. "8"
  repsMax?: string;             // repMode === "range", e.g. "12"
};

export type Exercise = {
  id: string;
  name: string;
  sets: ProgramSet[];
  isIsometric?: boolean;
  restSeconds?: number;
  programNotes?: string;
  // Legacy fields — kept optional for migration only
  warmupSets?: number;
  workingSets?: number;
  reps?: string;
};

export function normaliseSets(ex: Exercise): ProgramSet[] {
  if (ex.sets?.length) return ex.sets;
  return [
    ...Array.from({ length: ex.warmupSets ?? 0 }, () => ({ type: "warmup" as const })),
    ...Array.from({ length: ex.workingSets ?? 1 }, () => ({
      type: "working" as const,
      reps: ex.reps || undefined,
    })),
  ];
}

export type WorkoutMap = Record<string, Exercise[]>;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseStoredDate(dateStr: string): Date {
  const parts = dateStr.split(" ");
  const day = parseInt(parts[0], 10);
  const month = MONTH_NAMES.indexOf(parts[1]);
  const year = parseInt(parts[2], 10);
  return new Date(year, month < 0 ? 0 : month, day);
}

export function getCurrentWeek(program: SavedProgram): number {
  if (program.status === "completed") return program.totalWeeks;
  if (program.status === "paused" || program.status === "created") return program.currentWeek;
  const start = parseStoredDate(program.startDate);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSince = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.floor(daysSince / 7) + 1;
  return Math.min(Math.max(week, 1), program.totalWeeks);
}

export type SavedProgram = {
  id: string;
  name: string;
  totalWeeks: number;
  currentWeek: number;
  status: "active" | "completed" | "paused" | "created";
  startDate: string;
  cycleOffset?: number;
  trainingDays: number;
  cycleDays: number;
  cyclePattern: string[];
  workouts: WorkoutMap;
};
