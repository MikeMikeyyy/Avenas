// Network layer: push local AsyncStorage data up to Supabase and report counts.
// Online-first reads (cloud -> cache) come with the screen wiring; this module
// is the write/sync half plus a count helper for the test screen.
//
// RN-only (imports the Supabase client + AsyncStorage) — not for the node harness.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { getJSON, removeKey, setJSON } from "../utils/storage";
import { ACHIEVEMENTS_KEY } from "../constants/achievements";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, WORKOUT_DRAFT_KEY, WORKOUT_DAY_OVERRIDE_KEY,
  type CompletedWorkout, type SavedProgram,
} from "../constants/programs";
import { JOURNAL_KEY, type JournalEntry } from "../constants/journal";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import {
  customFromRow,
  journalFromRow,
  programFromRow,
  workoutFromRow,
  toReplaceUserDataPayload,
} from "./mappers";
import type { CustomExerciseRow, JournalRow, ProgramRow, WorkoutRow } from "./database.types";
import { ACCOUNT_TYPE_KEY, type AccountType } from "../contexts/AccountTypeContext";
import {
  CLIENTS_KEY, CLIENT_DATA_PREFIX, PT_SEEDED_KEY, SHARED_PROGRAMS_KEY, TRAINER_CLIENTS_KEY,
  clearTrainerData,
} from "../utils/trainerStore";
import { clearChatData } from "../utils/chatStore";
import { clearModerationData } from "../utils/moderation";
import { deleteGroup, fetchMyGroups } from "./groups";
import { deleteShareRow, fetchMyShareRows, getMyUid } from "./shares";
import { unregisterPushToken } from "./push";

export type SyncCounts = {
  programs: number;
  workouts: number;
  journal: number;
  customExercises: number;
};

/**
 * Replace this user's cloud data with whatever is currently in local storage —
 * an idempotent "push" (safe to run repeatedly; re-running just re-uploads).
 *
 * Delegates to the replace_user_data RPC (migration 0004) so the whole replace
 * is ONE atomic transaction server-side: a network/insert failure rolls back
 * instead of leaving the cloud wiped or partial. The program → workout linkage
 * is carried as program_index (the program's position in the array) and the
 * server resolves it to the freshly-minted uuid — no client-side id remap.
 */
export async function pushAllLocalDataToCloud(userId: string): Promise<SyncCounts> {
  const [programs, history, journal, custom] = await Promise.all([
    getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
    getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
    getJSON<JournalEntry[]>(JOURNAL_KEY, []),
    getJSON<CustomExercise[]>(CUSTOM_KEY, []),
  ]);

  // Safety net against data loss: never let an empty local cache overwrite a
  // non-empty cloud. An empty local almost always means "not loaded yet" or
  // "just cleared on an account switch" — NOT "the user deleted everything".
  // replace_user_data wipes-then-writes, so pushing empty over real cloud data
  // would destroy it. If local is empty but the cloud has data, skip the push.
  const localTotal = programs.length + history.length + journal.length + custom.length;
  if (localTotal === 0) {
    const cloud = await cloudCounts(userId);
    if (total(cloud) > 0) {
      if (__DEV__) console.warn("[avenas] skipped empty push over non-empty cloud");
      return cloud;
    }
  }

  const payload = toReplaceUserDataPayload(programs, history, journal, custom, userId);
  const { error } = await supabase.rpc("replace_user_data", payload);
  if (error) throw new Error(`replace_user_data: ${error.message}`);

  return {
    programs: programs.length,
    workouts: history.length,
    journal: journal.length,
    customExercises: custom.length,
  };
}

/** Row counts currently in the cloud for this user (for the test screen). */
export async function cloudCounts(userId: string): Promise<SyncCounts> {
  const count = async (table: "programs" | "workouts" | "journal_entries" | "custom_exercises") => {
    const { count: c, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return c ?? 0;
  };
  const [programs, workouts, journal, customExercises] = await Promise.all([
    count("programs"),
    count("workouts"),
    count("journal_entries"),
    count("custom_exercises"),
  ]);
  return { programs, workouts, journal, customExercises };
}

/** Everything the cloud holds for one account, fetched but not yet written. */
type CloudSnapshot = {
  programs: SavedProgram[];
  workouts: CompletedWorkout[];
  journal: JournalEntry[];
  custom: CustomExercise[];
};

/**
 * Download every dataset for `userId`. Network only — throws on ANY failure
 * WITHOUT touching local storage, so callers get an all-or-nothing snapshot
 * and a failed download can never leave the device half-written or wiped.
 */
async function fetchAllFromCloud(userId: string): Promise<CloudSnapshot> {
  const { data: progRows, error: pe } = await supabase
    .from("programs").select("*").eq("user_id", userId)
    // Oldest-first, matching how local writes append to @avenas/programs. The
    // array's order is the only record of when a program was created — ids come
    // back as Supabase uuids (see mappers.programFromRow), losing the
    // `program_<timestamp>` form local creation uses. Without this the pull
    // returned rows in whatever order Postgres chose, so "newest first" in the
    // programs list was arbitrary after any sync.
    .order("created_at", { ascending: true });
  if (pe) throw new Error(`pull programs: ${pe.message}`);

  const { data: woRows, error: we } = await supabase
    .from("workouts").select("*").eq("user_id", userId)
    .order("completed_at", { ascending: false });  // history is newest-first
  if (we) throw new Error(`pull workouts: ${we.message}`);

  const { data: jRows, error: je } = await supabase
    .from("journal_entries").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (je) throw new Error(`pull journal: ${je.message}`);

  const { data: cRows, error: ce } = await supabase.from("custom_exercises").select("*").eq("user_id", userId);
  if (ce) throw new Error(`pull custom exercises: ${ce.message}`);

  return {
    programs: ((progRows ?? []) as ProgramRow[]).map(programFromRow),
    workouts: ((woRows ?? []) as WorkoutRow[]).map(workoutFromRow),
    journal: ((jRows ?? []) as JournalRow[]).map(journalFromRow),
    custom: ((cRows ?? []) as CustomExerciseRow[]).map(customFromRow),
  };
}

/** Overwrite the local cache with a fetched snapshot (cloud is the source of
 *  truth). workout_dates is rebuilt from the snapshot's workouts. */
async function writeSnapshotToLocal(snap: CloudSnapshot): Promise<void> {
  await setJSON(PROGRAMS_KEY, snap.programs);
  await setJSON(WORKOUT_HISTORY_KEY, snap.workouts);
  await setJSON(WORKOUT_DATES_KEY, Array.from(new Set(snap.workouts.map((w) => w.date))));
  await setJSON(JOURNAL_KEY, snap.journal);
  await setJSON(CUSTOM_KEY, snap.custom);
}

const snapshotCounts = (s: CloudSnapshot): SyncCounts => ({
  programs: s.programs.length,
  workouts: s.workouts.length,
  journal: s.journal.length,
  customExercises: s.custom.length,
});

/**
 * Pull this user's cloud data down and OVERWRITE the local AsyncStorage cache
 * with it. All four datasets are fetched before anything is written, so a
 * network failure mid-pull leaves local storage exactly as it was.
 */
export async function pullAllFromCloud(userId: string): Promise<SyncCounts> {
  const snap = await fetchAllFromCloud(userId);
  await writeSnapshotToLocal(snap);
  return snapshotCounts(snap);
}

/** Row counts currently in local AsyncStorage. */
export async function localCounts(): Promise<SyncCounts> {
  const [programs, history, journal, custom] = await Promise.all([
    getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
    getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
    getJSON<JournalEntry[]>(JOURNAL_KEY, []),
    getJSON<CustomExercise[]>(CUSTOM_KEY, []),
  ]);
  return {
    programs: programs.length,
    workouts: history.length,
    journal: journal.length,
    customExercises: custom.length,
  };
}

const total = (c: SyncCounts) => c.programs + c.workouts + c.journal + c.customExercises;

/**
 * First-login reconciliation — runs automatically on SIGNED_IN. NON-DESTRUCTIVE:
 * it only seeds whichever side is empty, so it can never silently overwrite data.
 *   - cloud empty, local has data  → push (this device seeds the cloud)
 *   - local empty, cloud has data  → pull (a fresh device gets its data)
 *   - both have data (or both empty) → noop (leave both; resolved later by the
 *     ongoing per-write sync, or a manual push/pull)
 */
export async function syncOnLogin(
  userId: string,
): Promise<{ direction: "pushed" | "pulled" | "noop"; counts: SyncCounts }> {
  const [cloud, local] = await Promise.all([cloudCounts(userId), localCounts()]);
  if (total(cloud) === 0 && total(local) > 0) {
    return { direction: "pushed", counts: await pushAllLocalDataToCloud(userId) };
  }
  if (total(local) === 0 && total(cloud) > 0) {
    return { direction: "pulled", counts: await pullAllFromCloud(userId) };
  }
  return { direction: "noop", counts: cloud };
}

// Which user the local AsyncStorage cache currently belongs to. Used to detect
// account switches so one account's data never leaks into another.
export const CACHE_OWNER_KEY = "@avenas/cache_owner";

export async function getCacheOwner(): Promise<string | null> {
  return getJSON<string | null>(CACHE_OWNER_KEY, null);
}
export async function setCacheOwner(userId: string): Promise<void> {
  await setJSON(CACHE_OWNER_KEY, userId);
}

/**
 * Permanently delete the signed-in user's account: the server RPC removes their
 * auth user (which cascades to all their cloud data), then we wipe the local
 * cache and sign out.
 */
export async function deleteAccount(): Promise<void> {
  // The profile photo lives in the public "avatars" Storage bucket, which the
  // auth.users cascade never reaches, so it stayed reachable by its link after
  // the account was gone (and the Privacy Policy promises it's deleted). Removed
  // FIRST, while this session still owns the folder the storage policy checks.
  // Best effort: a failure here must never block the deletion the user asked for.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error: photoError } = await supabase.storage.from("avatars").remove([`${user.id}/avatar`]);
      if (photoError && __DEV__) console.warn("[avenas] delete avatar", photoError.message);
    }
  } catch (e) {
    if (__DEV__) console.warn("[avenas] delete avatar", e);
  }
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw new Error(error.message);
  // Server-side push_tokens rows are already gone (FK cascade from the deleted
  // auth user); this clears the locally-cached token so the next account on
  // this device starts clean. Best effort by design.
  await unregisterPushToken();
  await clearLocalUserData();
  await removeKey(CACHE_OWNER_KEY);
  await supabase.auth.signOut();
}

/** Wipe the locally-cached user data + in-progress drafts (not auth/theme/unit).
 *  Includes the local-only trainer-hub data (roster, coaches, trainers, shared/
 *  sent programs, chat threads, block list) so one account's data never leaks
 *  into the next account on this device when deleting or switching accounts. */
export async function clearLocalUserData(): Promise<void> {
  await Promise.all([
    removeKey(PROGRAMS_KEY),
    removeKey(WORKOUT_HISTORY_KEY),
    removeKey(WORKOUT_DATES_KEY),
    removeKey(JOURNAL_KEY),
    removeKey(CUSTOM_KEY),
    removeKey(WORKOUT_DRAFT_KEY),
    removeKey(WORKOUT_DAY_OVERRIDE_KEY),
    // Local-only, but it describes THIS account's training: the next account on
    // the device mustn't inherit its PR cards or its already-earned milestones.
    removeKey(ACHIEVEMENTS_KEY),
    clearTrainerData(),
    clearChatData(),
    clearModerationData(),
  ]);
}

/** Thrown when an account switch can't download the new account's data. The
 *  switch is aborted with local storage untouched; the caller should cancel the
 *  sign-in (sign back out) and tell the user, instead of leaving a wiped device. */
export class AccountSwitchLoadError extends Error {
  constructor(cause: string) {
    super(`account switch: ${cause}`);
    this.name = "AccountSwitchLoadError";
  }
}

export type ReconcileResult =
  | "kept"           // same account — local kept, any empty side seeded
  | "replaced"       // different account — local replaced with its cloud data
  | "import_choice"; // unclaimed local data found — the UI must ask the user (see below)

/**
 * Reconcile the local cache to the signed-in account:
 *   - same account as before → keep local edits, seed any empty side
 *   - unclaimed local data (no cache owner yet: a pre-backend install or an
 *     upgrade from before the owner marker) → return "import_choice" WITHOUT
 *     touching anything. It may be months of this very user's offline training,
 *     so the caller asks whether to keep it (keepDeviceData) or replace it with
 *     the account's cloud copy (useCloudData). Never silently wiped.
 *   - any other account → download that account's cloud snapshot FIRST, and
 *     only then clear local and write it. A failed download throws
 *     AccountSwitchLoadError with the device untouched.
 */
export async function reconcileOnSignIn(userId: string): Promise<ReconcileResult> {
  const owner = await getCacheOwner();
  if (owner === userId) {
    await syncOnLogin(userId);
    return "kept";
  }

  if (owner === null && total(await localCounts()) > 0) {
    return "import_choice";
  }

  let snap: CloudSnapshot;
  try {
    snap = await fetchAllFromCloud(userId);
  } catch (e) {
    throw new AccountSwitchLoadError(e instanceof Error ? e.message : String(e));
  }
  await clearLocalUserData();
  await writeSnapshotToLocal(snap);
  await setCacheOwner(userId);
  return "replaced";
}

/** "import_choice" resolution: keep what's on the device. Claims the cache for
 *  this account and uploads it, so the cloud mirrors what the user chose. */
export async function keepDeviceData(userId: string): Promise<void> {
  await setCacheOwner(userId);
  await pushAllLocalDataToCloud(userId);
}

/** "import_choice" resolution: discard the on-device data and use the account's
 *  cloud copy. Fetch-first, so a failed download leaves the device untouched.
 *  (Not `use`-prefixed — it would read as a React hook.) */
export async function replaceWithCloudData(userId: string): Promise<void> {
  const snap = await fetchAllFromCloud(userId);
  await clearLocalUserData();
  await writeSnapshotToLocal(snap);
  await setCacheOwner(userId);
}

// ── per-account profile (name + role + unit) ───────────────────────────────────
export type CloudProfile = {
  name: string;
  accountType: AccountType;
  unit: "kg" | "lb";
  /** Public URL of the profile photo, or null when none is set. */
  avatarUrl: string | null;
  /** True once the user has finished the name/role step for this account. */
  complete: boolean;
  /** Reachable address when the login identifier isn't one (Apple "Hide My
   *  Email" accounts). Null when unset — most accounts never need it. */
  contactEmail: string | null;
};

// App uses "gym_user"/"pt" + "kg"/"lbs"; the DB column is "user"/"pt" + "kg"/"lb".
const toDbAccountType = (a: AccountType): "user" | "pt" => (a === "pt" ? "pt" : "user");
const toAppAccountType = (a: string | null): AccountType => (a === "pt" ? "pt" : "gym_user");

export async function pushProfile(
  userId: string,
  p: { name: string; email: string; accountType: AccountType; unit: "kg" | "lb" },
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      name: p.name,
      email: p.email,
      account_type: toDbAccountType(p.accountType),
      unit: p.unit,
      onboarding_complete: true,
    })
    .eq("id", userId);
  if (error) throw new Error(`save profile: ${error.message}`);
}

/** Update just the self-declared role on this account's profile. Separate from
 *  pushProfile (the onboarding write) so the Profile screen's Member/Trainer
 *  toggle can change this one column. Requires migration 0015 — before that, the
 *  0008 trigger rejected any account_type change once onboarding completed. */
export async function pushAccountType(userId: string, accountType: AccountType): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ account_type: toDbAccountType(accountType) })
    .eq("id", userId);
  if (error) throw new Error(`save account type: ${error.message}`);
}

/**
 * Make the server's account_type match the one this device is actually using.
 *
 * The Member/Trainer toggle in Profile was local-only for a long time, so any
 * account that switched to Trainer after onboarding kept `account_type = 'user'`
 * in the cloud. That column is what every OTHER account sees through
 * get_my_connections(), so such a trainer appeared to their connections as a
 * member and could never be bucketed as a trainer (utils/roster.ts). This runs
 * on launch and on every foreground to repair the drift. The local value wins:
 * it's the one the user actually sees in the app.
 *
 * No-ops when signed out, offline, mid-onboarding, or already in sync.
 */
export async function reconcileAccountType(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const local = await AsyncStorage.getItem(ACCOUNT_TYPE_KEY);
    if (local !== "pt" && local !== "gym_user") return;
    const profile = await pullProfile(user.id);
    if (!profile?.complete || profile.accountType === local) return;
    await pushAccountType(user.id, local);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] reconcileAccountType", e);
  }
}

/**
 * Tear down everything that only exists because this account was a TRAINER,
 * for a Trainer → Gym User downgrade.
 *
 * Deliberately narrower than clearTrainerData(), which wipes both sides of the
 * hub for an account switch. What survives here is everything the user keeps as
 * a gym user: their own trainers (derived from connections, so untouched),
 * programs they've RECEIVED and accepted, their library, and their membership
 * of other people's groups.
 *
 * What goes:
 *   - the local client roster and each client's cached data
 *   - trainers they had taken on as clients
 *   - groups they OWN (deleted for every member, since nobody else can run them)
 *   - programs they SENT (recipients keep any copy they already accepted)
 *
 * Lives here rather than in trainerStore because lib/groups.ts imports that
 * module, so the dependency has to run this direction.
 *
 * Local removal happens first and unconditionally; the cloud steps are
 * best-effort per item, so one failure can't strand the rest half-done.
 */
export async function clearCoachingData(): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const clientData = allKeys.filter(k => k.startsWith(CLIENT_DATA_PREFIX));
  await AsyncStorage.multiRemove([CLIENTS_KEY, TRAINER_CLIENTS_KEY, PT_SEEDED_KEY, ...clientData]);

  // Local share entries: drop the ones I SENT, keep what a trainer sent me.
  try {
    const local = await getJSON<{ receivedFromCoachId?: string }[]>(SHARED_PROGRAMS_KEY, []);
    await setJSON(SHARED_PROGRAMS_KEY, local.filter(s => !!s.receivedFromCoachId));
  } catch (e) {
    if (__DEV__) console.warn("[avenas] clearCoachingData local shares", e);
  }

  const uid = await getMyUid();
  if (!uid) return; // signed out: the local wipe above is all we can do

  try {
    for (const g of (await fetchMyGroups(uid)).filter(g => g.isOwner)) {
      try {
        await deleteGroup(g.id);
      } catch (e) {
        if (__DEV__) console.warn("[avenas] clearCoachingData group", g.id, e);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn("[avenas] clearCoachingData groups", e);
  }

  try {
    const rows = await fetchMyShareRows(uid);
    for (const r of rows.filter(r => r.sender_id === uid && r.kind === "share")) {
      try {
        await deleteShareRow(r.id);
      } catch (e) {
        if (__DEV__) console.warn("[avenas] clearCoachingData share", r.id, e);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn("[avenas] clearCoachingData shares", e);
  }
}

/** Update just the display name on this account's profile. */
export async function updateProfileName(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ name }).eq("id", userId);
  if (error) throw new Error(error.message);
}

/** Start an email change. Supabase emails a confirmation link to the new address;
 *  the change only takes effect once that link is clicked. */
export async function updateEmail(newEmail: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
  if (error) throw new Error(error.message);
}

/** Change the signed-in user's password. We re-verify the current password first
 *  by re-signing in (updateUser trusts the session alone, so this proves the
 *  person at the keyboard actually knows the old password). On success the user
 *  stays signed in with a fresh session. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email) throw new Error("You need to be signed in to change your password.");

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (reauthError) throw new Error("Your current password is incorrect.");

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function pullProfile(userId: string): Promise<CloudProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("name, account_type, unit, avatar_url, onboarding_complete, contact_email")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`load profile: ${error.message}`);
  if (!data) return null;
  return {
    name: (data.name as string | null) ?? "",
    accountType: toAppAccountType(data.account_type as string | null),
    unit: (data.unit as string) === "lb" ? "lb" : "kg",
    avatarUrl: (data.avatar_url as string | null) ?? null,
    complete: data.onboarding_complete === true,
    contactEmail: (data.contact_email as string | null) ?? null,
  };
}

/**
 * Set (or clear, with null) the account's contact address.
 *
 * Deliberately NOT supabase.auth.updateUser({ email }): that changes the LOGIN
 * identifier and needs a confirm-link round trip. This is a plain profile field
 * — the address to reach someone on when their login email can't be, which is
 * exactly the Apple "Hide My Email" case. See migration 0017.
 */
export async function updateContactEmail(userId: string, email: string | null): Promise<void> {
  const value = email?.trim() ? email.trim() : null;
  const { error } = await supabase.from("profiles").update({ contact_email: value }).eq("id", userId);
  if (error) throw new Error(`save contact email: ${error.message}`);
}

/**
 * Upload (or replace) the signed-in user's profile photo and return its public
 * URL. The object lives at "<userId>/avatar" so each upload overwrites the last
 * one (upsert) — no orphaned files. A cache-busting query param is appended so
 * expo-image refetches after a replace instead of showing the stale cached copy.
 *
 * `fetch(localUri).then(r => r.arrayBuffer())` is the dependency-free way to read
 * a local file into bytes in Expo/React Native (the Supabase RN guide's pattern).
 */
export async function uploadAvatar(userId: string, localUri: string, mimeType?: string): Promise<string> {
  const bytes = await fetch(localUri).then((r) => r.arrayBuffer());
  const path = `${userId}/avatar`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, { contentType: mimeType ?? "image/jpeg", upsert: true });
  if (error) throw new Error(`upload avatar: ${error.message}`);
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

/** Persist (or clear) the avatar URL on this account's profile row. */
export async function updateAvatarUrl(userId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) throw new Error(error.message);
}
