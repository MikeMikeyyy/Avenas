export const PROGRAMS_KEY = "@avenas/programs";

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
