// lib/exerciseMedia.ts
//
// The RN side of a custom exercise travelling with a program
// (utils/customExerciseDetails.ts has the rules): uploading its photo and video
// so someone else's phone can open them, stamping a program on its way out,
// and the loaders the screens use to look a name up.
//
// A custom exercise's photo and video are files in its author's app folder
// (create-custom-exercise copies them there), so a path to one means nothing on
// any other phone. They're uploaded to the public exercise-media bucket
// (migration 0038) at "<uid>/<file name>" the first time a program using them
// is sent, and only then: nobody's clips are uploaded just for being made.
// The file name carries its creation time, so a replaced photo is a new file
// and a new upload, and an unchanged one is never uploaded twice
// (EXERCISE_MEDIA_UPLOADS_KEY remembers what went up).
//
// Never throws: a send must not fail because a clip couldn't upload, so the
// program goes without that clip instead (and a server without 0038 simply
// sends no media).

import * as FileSystem from "expo-file-system/legacy";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase";
import { getMyUid } from "./shares";
import { getJSON, setJSON } from "../utils/storage";
import { normalizeExerciseName } from "../utils/workout";
import {
  carriedExercises,
  exerciseNamesIn,
  isRemoteUri,
  knownCustomExercises,
  stampCustomDetails,
  withRemoteMedia,
} from "../utils/customExerciseDetails";
import {
  CUSTOM_KEY,
  EXERCISE_MEDIA_UPLOADS_KEY,
  MAX_MEDIA_BYTES,
  type CarriedExercise,
  type CustomExercise,
} from "../constants/exercises";
import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";

const BUCKET = "exercise-media";

const warn = (op: string, err: unknown) => {
  if (__DEV__) console.warn("[avenas] exercise media", op, err);
};

/** The bucket only takes these (0038's allowed_mime_types). The picker saves
 *  .jpg and .mp4; the others cover files from older builds. */
function contentTypeOf(uri: string): string | null {
  switch (uri.split("?")[0].split(".").pop()?.toLowerCase()) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "mp4": return "video/mp4";
    case "mov": return "video/quicktime";
    default: return null;
  }
}

/**
 * Stream one file to "<uid>/<file name>" and return its public URL, or null
 * when there's nothing to upload (the file isn't on this phone, e.g. after a
 * restore onto a new one, or it isn't a type the bucket takes).
 *
 * FileSystem.uploadAsync rather than supabase-js's upload(), which would read
 * the whole clip into JS memory first. x-upsert makes a retry after a lost
 * response harmless: same file, same path.
 */
async function uploadFile(uid: string, localUri: string): Promise<string | null> {
  const type = contentTypeOf(localUri);
  const name = localUri.split("/").pop();
  if (!type || !name) return null;
  const info = await FileSystem.getInfoAsync(localUri);
  if (!info.exists) return null;
  // A clip saved before the pick-time limit can be over it. The bucket would
  // refuse it anyway, but only after the whole file had been sent.
  if (info.size > MAX_MEDIA_BYTES) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const path = `${uid}/${name}`;
  const res = await FileSystem.uploadAsync(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, localUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": type,
      "x-upsert": "true",
      // Each name is one file forever (see above), so it can be cached as long as a phone likes.
      "cache-control": "max-age=31536000",
    },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`${res.status} ${res.body}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Upload whatever these exercises' photos and videos still need, and return
 * the whole local file → public URL map. A cached URL counts only if it's in
 * this account's folder, so a device that changed hands never sends another
 * account's copy.
 */
export async function uploadExerciseMedia(exercises: CustomExercise[]): Promise<Record<string, string>> {
  const uploads = await getJSON<Record<string, string>>(EXERCISE_MEDIA_UPLOADS_KEY, {});
  const uid = await getMyUid();
  if (!uid) return {};
  const mine = `/${BUCKET}/${uid}/`;
  const out: Record<string, string> = {};
  for (const [file, url] of Object.entries(uploads)) {
    if (typeof url === "string" && url.includes(mine)) out[file] = url;
  }
  const pending = new Set<string>();
  for (const c of exercises) {
    for (const uri of [c.imageUri, c.videoUri]) {
      if (uri && !isRemoteUri(uri) && !out[uri]) pending.add(uri);
    }
  }
  let added = false;
  for (const uri of pending) {
    try {
      const url = await uploadFile(uid, uri);
      if (url) { out[uri] = url; added = true; }
    } catch (e) {
      warn("upload", e);
    }
  }
  if (added) await setJSON(EXERCISE_MEDIA_UPLOADS_KEY, out);
  return out;
}

/**
 * A program on its way to someone else, with every custom exercise in it
 * carrying its details: the sender's own (current version, media uploaded
 * first, marked as theirs), and anything else their programs carry. Every
 * snapshot that leaves this phone goes through here (utils/trainerStore.ts),
 * beside withSenderUnits. Returns the snapshot unchanged if anything fails.
 */
export async function detailsForSend(snapshot: SavedProgram): Promise<SavedProgram> {
  try {
    const [own, programs, uid] = await Promise.all([
      getJSON<CustomExercise[]>(CUSTOM_KEY, []),
      getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
      getMyUid(),
    ]);
    const ownList = Array.isArray(own) ? own : [];
    const used = exerciseNamesIn(snapshot.workouts);
    const ownUsed = ownList.filter(c => used.has(normalizeExerciseName(c.name)));
    const uploads = await uploadExerciseMedia(ownUsed);
    const workouts = stampCustomDetails(snapshot.workouts ?? {}, {
      own: ownUsed.map(c => withRemoteMedia(c, uploads)),
      stampOwn: true,
      carried: carriedExercises(Array.isArray(programs) ? programs : []),
      by: uid ?? undefined,
    });
    return workouts === snapshot.workouts ? snapshot : { ...snapshot, workouts };
  } catch (e) {
    warn("detailsForSend", e);
    return snapshot;
  }
}

/** What your programs carry, and who you are: the picker's "From your
 *  trainer" is built from these (utils/customExerciseDetails.ts sharedExercises). */
export async function loadCarriedExercises(): Promise<{ carried: CarriedExercise[]; me: string | null }> {
  const [programs, me] = await Promise.all([
    getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
    getMyUid().catch(() => null),
  ]);
  return { carried: carriedExercises(Array.isArray(programs) ? programs : []), me };
}

/** Every custom exercise a name can be looked up in on this phone: yours,
 *  then what your programs carry. See knownCustomExercises. */
export async function loadKnownCustomExercises(): Promise<CustomExercise[]> {
  const [own, programs] = await Promise.all([
    getJSON<CustomExercise[]>(CUSTOM_KEY, []),
    getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
  ]);
  return knownCustomExercises(
    Array.isArray(own) ? own : [],
    carriedExercises(Array.isArray(programs) ? programs : []),
  );
}

/**
 * Remove everything this account uploaded, for account deletion: the auth
 * cascade never reaches Storage, and the files would otherwise stay reachable
 * by their links. Programs already sent lose their media with it, which is
 * what deleting an account means. Best effort, never throws.
 */
export async function deleteMyExerciseMedia(uid: string): Promise<void> {
  try {
    const bucket = supabase.storage.from(BUCKET);
    // Bounded, and stops on a page that removed nothing: a refused remove
    // comes back as an empty success, which would otherwise list the same
    // page forever.
    for (let page = 0; page < 50; page++) {
      const { data, error } = await bucket.list(uid, { limit: 100 });
      if (error) throw error;
      if (!data || data.length === 0) return;
      const { data: removed, error: removeError } = await bucket.remove(data.map(f => `${uid}/${f.name}`));
      if (removeError) throw removeError;
      if (!removed || removed.length === 0 || data.length < 100) return;
    }
  } catch (e) {
    warn("delete", e);
  }
}
