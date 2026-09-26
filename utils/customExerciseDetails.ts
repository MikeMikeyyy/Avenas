// A custom exercise that travels with a program.
//
// A program exercise is just a name and its sets, and a custom exercise's
// muscles, steps, photo and video live in its AUTHOR's list (CUSTOM_KEY). So a
// trainer's "Landmine Twist" reached a client as a bare name: the exercise
// screen showed the dumbbell tile with nothing under it, and the Progress radar
// couldn't place it in any muscle group. Copying it into the client's list
// would have fixed that at the cost of one of their MAX_CUSTOM slots.
//
// Instead the details ride on the exercise itself (`Exercise.customDetails`, a
// `CarriedExercise`), inside the workouts jsonb every copy of a program already
// carries: sends, reviews, accepts, the backup and a trainer's read of a
// client's training. The rules:
//
//   * STAMPED on send (lib/exerciseMedia.ts detailsForSend: the sender's own
//     custom exercises, media uploaded first) and on builder save (only what
//     other programs carry, so a trainer's exercise picked into your own
//     program keeps its details after that program is gone).
//   * READ by name, your own list first: `knownCustomExercises` is what every
//     name → details lookup uses (exercise screen, radar, builder, summary).
//   * OFFERED in the picker as "From your trainer" (`sharedExercises`), which
//     leaves out your own names, the catalogue's, and anything you authored.
//
// Pure: no storage, no network. scripts/verify-custom-details.ts covers it.

import { exerciseByName } from "./exerciseLookup";
import { normalizeExerciseName } from "./workout";
import type { CarriedExercise, CustomExercise } from "../constants/exercises";
import type { Exercise, SavedProgram, WorkoutMap } from "../constants/programs";

/** A URL another phone can load, rather than a file on this one. */
export function isRemoteUri(uri: string | undefined): uri is string {
  return !!uri && /^https?:\/\//i.test(uri);
}

function remoteCopy(uri: string | undefined, uploads: Record<string, string>): string | undefined {
  if (!uri) return undefined;
  return isRemoteUri(uri) ? uri : uploads[uri];
}

/**
 * `c` as it can be shown on someone else's phone: each photo or video swapped
 * for its uploaded copy (`uploads`, local file → public URL). Media that exist
 * only on this phone are left out rather than sent as a path nobody else can
 * open; `muted` goes with the video it describes.
 */
export function withRemoteMedia(c: CustomExercise, uploads: Record<string, string>): CustomExercise {
  const { imageUri, videoUri, muted, ...rest } = c;
  const image = remoteCopy(imageUri, uploads);
  const video = remoteCopy(videoUri, uploads);
  return {
    ...rest,
    ...(image ? { imageUri: image } : {}),
    ...(video ? { videoUri: video, ...(muted ? { muted: true } : {}) } : {}),
  };
}

/** Details that belong to this exercise: a builder swap renames the row and
 *  leaves the old exercise's details on it until the next stamp. */
function ownDetails(ex: Exercise): CarriedExercise | undefined {
  const d = ex.customDetails;
  return d && normalizeExerciseName(d.name) === normalizeExerciseName(ex.name) ? d : undefined;
}

/**
 * Route params for app/exercise-summary.tsx: the name, plus the details this
 * row carries. A program that isn't in your own list (one you're reviewing in
 * the builder) still opens its author's exercise, not a blank one.
 */
export function exerciseSummaryParams(ex: Exercise): { exerciseName: string; details?: string } {
  const d = ownDetails(ex);
  return d ? { exerciseName: ex.name, details: JSON.stringify(d) } : { exerciseName: ex.name };
}

/** Every custom exercise one program's days carry, first copy per name. */
export function carriedIn(workouts: WorkoutMap | undefined): CarriedExercise[] {
  const out = new Map<string, CarriedExercise>();
  for (const list of Object.values(workouts ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const ex of list) {
      const d = ownDetails(ex);
      const k = d && normalizeExerciseName(d.name);
      if (d && k && !out.has(k)) out.set(k, d);
    }
  }
  return [...out.values()];
}

/**
 * Every custom exercise these programs carry, one per name. The active
 * program's copy wins, then the newest program's (programs are appended, so
 * later in the list is newer): the version you're most likely following when
 * a trainer's exercise has changed between two sends.
 */
export function carriedExercises(programs: SavedProgram[]): CarriedExercise[] {
  const ordered = [
    ...programs.filter(p => p.status === "active"),
    ...programs.filter(p => p.status !== "active").reverse(),
  ];
  return mergeByName(...ordered.map(p => carriedIn(p.workouts)));
}

/** Lists merged by name (trim + lowercase), the first list's copy winning. */
export function mergeByName<T extends CustomExercise>(...lists: T[][]): T[] {
  const out = new Map<string, T>();
  for (const list of lists) {
    for (const c of list) {
      const k = normalizeExerciseName(c.name);
      if (!out.has(k)) out.set(k, c);
    }
  }
  return [...out.values()];
}

/**
 * Everything a name can be looked up in: your own custom exercises, then the
 * ones your programs carry. Your own win a clash, so an exercise you made is
 * never shown as someone else's version of it. This is the list every
 * name → details lookup takes (`musclesForExercise`, the exercise screen, the
 * builder's photos); it is never a list of your slots.
 */
export function knownCustomExercises(own: CustomExercise[], ...carried: CarriedExercise[][]): CustomExercise[] {
  return mergeByName<CustomExercise>(own, ...carried);
}

/**
 * The picker's "From your trainer" section: what your programs carry that you
 * can't already pick. Leaves out your own names (the CUSTOM section has them),
 * the catalogue's, and anything `me` authored (your own exercise that came back
 * inside a reviewed program, which is yours even if you've since deleted it).
 * Alphabetical.
 */
export function sharedExercises(
  own: CustomExercise[],
  carried: CarriedExercise[],
  me: string | null,
): CarriedExercise[] {
  const ownNames = new Set(own.map(c => normalizeExerciseName(c.name)));
  return carried
    .filter(c => !ownNames.has(normalizeExerciseName(c.name)))
    .filter(c => !exerciseByName(c.name))
    .filter(c => !me || c.by !== me)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The normalized names a program's days use. */
export function exerciseNamesIn(workouts: WorkoutMap | undefined): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(workouts ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const ex of list) out.add(normalizeExerciseName(ex.name));
  }
  return out;
}

export type StampSources = {
  /** Your own custom exercises, already through `withRemoteMedia`. Stamped
   *  only when `stampOwn` is set: a send, where the program is leaving you. */
  own: CustomExercise[];
  stampOwn: boolean;
  /** Details other programs carry, for an exercise picked from "From your
   *  trainer" that doesn't have them yet. */
  carried: CarriedExercise[];
  /** Your account id, recorded on your own exercises as their author. */
  by?: string;
};

/**
 * `workouts` with every exercise carrying the details it should, and the same
 * object back when nothing changed (like stampWeightUnits), so a caller can
 * tell. Per exercise:
 *
 *   1. a catalogue exercise carries nothing (the catalogue has its own);
 *   2. one of YOUR custom exercises: on a send, your current version, marked as
 *      yours; otherwise left as it is (your list already has it);
 *   3. an exercise already carrying its own details keeps them: they're the
 *      version it was sent with, and your other programs don't outrank it;
 *   4. otherwise whatever another program carries for that name, if any;
 *   5. and a row whose details were for a different name (a swap) loses them.
 */
export function stampCustomDetails(workouts: WorkoutMap, sources: StampSources): WorkoutMap {
  const ownByName = new Map(sources.own.map(c => [normalizeExerciseName(c.name), c]));
  const carriedByName = new Map(mergeByName(sources.carried).map(c => [normalizeExerciseName(c.name), c]));

  const detailsFor = (ex: Exercise): CarriedExercise | undefined => {
    if (exerciseByName(ex.name)) return undefined;
    const k = normalizeExerciseName(ex.name);
    const mine = ownByName.get(k);
    if (mine && sources.stampOwn) return sources.by ? { ...mine, by: sources.by } : { ...mine };
    const kept = ownDetails(ex);
    if (kept || mine) return kept;
    return carriedByName.get(k);
  };

  let changed = false;
  const next: WorkoutMap = {};
  for (const [key, list] of Object.entries(workouts)) {
    if (!Array.isArray(list)) { next[key] = list; continue; }
    let dayChanged = false;
    const out = list.map(ex => {
      const want = detailsFor(ex);
      if (JSON.stringify(want) === JSON.stringify(ex.customDetails)) return ex;
      dayChanged = true;
      if (!want) {
        const { customDetails: _drop, ...rest } = ex;
        return rest;
      }
      return { ...ex, customDetails: want };
    });
    next[key] = dayChanged ? out : list;
    changed ||= dayChanged;
  }
  return changed ? next : workouts;
}
