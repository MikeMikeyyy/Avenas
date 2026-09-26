export const CUSTOM_KEY = "@avenas/custom_exercises";
export const MAX_CUSTOM = 10;

/**
 * The longest demo video a custom exercise takes. A demo is a few reps; at the
 * 720p iOS re-encodes to on pick, a minute is roughly 35-45 MB, inside
 * MAX_MEDIA_BYTES. Checked when the video is picked (create-custom-exercise),
 * before it's copied anywhere, so a long video never reaches the phone's
 * storage or the upload.
 */
export const MAX_VIDEO_SECONDS = 60;
/**
 * The largest photo or video file a custom exercise takes: the exercise-media
 * bucket's file_size_limit (migration 0038), so anything the phone accepts can
 * also be uploaded when a program is sent. The SQL's 52428800 and this move
 * together. Android has no re-encode on pick, so there this is the limit that
 * bites first.
 */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
/** Exercise names the user starred, catalogue and custom alike. Device-local
 *  preference — never in the cloud snapshot. See utils/exerciseFavourites.ts. */
export const FAVOURITE_EXERCISES_KEY = "@avenas/favourite_exercises";

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

/**
 * A custom exercise as it travels INSIDE a program (`Exercise.customDetails`),
 * so whoever the program reaches sees what its author made: muscles, steps,
 * photo and video. Never stored in anyone's CUSTOM_KEY list, so it takes none
 * of their MAX_CUSTOM slots. Its media are public URLs (lib/exerciseMedia.ts),
 * never the author's local files, which exist only on the author's phone.
 * `by` is the author's account id, so the picker can tell a trainer's exercise
 * from one of your own that came back to you inside a reviewed program.
 * See utils/customExerciseDetails.ts.
 */
export type CarriedExercise = CustomExercise & { by?: string };

/** Local file URI → public URL of that file in the exercise-media bucket, for
 *  every custom exercise photo or video this device has uploaded. Keyed by the
 *  file, so a replaced photo (a new file) uploads again and an unchanged one
 *  never does. Local-only cache. See lib/exerciseMedia.ts. */
export const EXERCISE_MEDIA_UPLOADS_KEY = "@avenas/exercise_media_uploads";

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
