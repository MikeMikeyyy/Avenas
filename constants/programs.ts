export const PROGRAMS_KEY = "@avenas/programs";

export type Exercise = {
  id: string;
  name: string;
  warmupSets: number;
  workingSets: number;
  reps: string;
  isIsometric?: boolean;
  restSeconds?: number; // 0 / undefined = off
  programNotes?: string; // PT coaching notes shown on workout day
};

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
