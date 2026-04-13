export const PROGRAMS_KEY = "@avenas/programs";

export type Exercise = {
  id: string;
  name: string;
  warmupSets: number;
  workingSets: number;
  reps: string;
};

export type WorkoutMap = Record<string, Exercise[]>;

export type SavedProgram = {
  id: string;
  name: string;
  totalWeeks: number;
  currentWeek: number;
  status: "active" | "completed" | "paused" | "created";
  startDate: string;
  trainingDays: number;
  cycleDays: number;
  cyclePattern: string[];
  workouts: WorkoutMap;
};
