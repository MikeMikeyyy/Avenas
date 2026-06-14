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
  /** Play the demo clip muted. Controls playback only (the audio track is kept). */
  muted?: boolean;
  /** Numbered how-to steps, rendered like the bundled catalogue's `instructions`. */
  steps?: string[];
  /** Legacy single-paragraph description. Kept for exercises saved before steps existed. */
  description?: string;
};

// ─── Bundled exercise library ─────────────────────────────────────────────────
// The curated catalogue lives in `constants/exerciseData.ts`. Each entry's `id`
// is a stable slug that also keys the bundled image maps in
// `assets/exerciseImages.ts` (a static thumbnail + the animated GIF).
export type Exercise = {
  /** Stable slug — keys the thumbnail + GIF require-maps. e.g. "barbell-bench-press". */
  id: string;
  /** Display name, title-cased. */
  name: string;
  /** The muscle group this exercise trains — drives the picker's filter + chip. */
  primaryMuscle: SelectableMuscle;
  /** Equipment label, e.g. "Barbell", "Dumbbell", "Cable", "Body weight". */
  equipment: string;
  /** Secondary muscles as free-text labels — display only, optional. */
  secondaryMuscles?: string[];
  /** Step-by-step instructions — display only, optional. */
  instructions?: string[];
  /** True for the curated "main" set — surfaced first in the picker. */
  featured?: boolean;
};
