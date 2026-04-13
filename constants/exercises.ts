export const CUSTOM_KEY = "@avenas/custom_exercises";
export const MAX_CUSTOM = 5;

export const MUSCLE_GROUPS = ["All", "Chest", "Back", "Shoulders", "Legs", "Arms", "Core"] as const;
export type MuscleGroup = typeof MUSCLE_GROUPS[number];
export type SelectableMuscle = Exclude<MuscleGroup, "All">;

export type CustomExercise = {
  name: string;
  muscles: SelectableMuscle[];
  imageUri?: string;
  videoUri?: string;
  description?: string;
};
