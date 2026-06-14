// Network layer: push local AsyncStorage data up to Supabase and report counts.
// Online-first reads (cloud -> cache) come with the screen wiring; this module
// is the write/sync half plus a count helper for the test screen.
//
// RN-only (imports the Supabase client + AsyncStorage) — not for the node harness.

import { supabase } from "./supabase";
import { getJSON, removeKey, setJSON } from "../utils/storage";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, WORKOUT_DRAFT_KEY, WORKOUT_DAY_OVERRIDE_KEY,
  type CompletedWorkout, type SavedProgram,
} from "../constants/programs";
import { JOURNAL_KEY, type JournalEntry } from "../constants/journal";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import {
  customFromRow, customToRow,
  journalFromRow, journalToRow,
  programFromRow, programToRow,
  workoutFromRow, workoutToRow,
} from "./mappers";
import type { CustomExerciseRow, JournalRow, ProgramRow, WorkoutRow } from "./database.types";
import type { AccountType } from "../contexts/AccountTypeContext";

export type SyncCounts = {
  programs: number;
  workouts: number;
  journal: number;
  customExercises: number;
};

/**
 * Replace this user's cloud data with whatever is currently in local storage —
 * an idempotent "push" (safe to run repeatedly; re-running just re-uploads).
 * Programs are inserted first so each one's new uuid can be mapped onto the
 * workouts that reference it.
 */
export async function pushAllLocalDataToCloud(userId: string): Promise<SyncCounts> {
  const [programs, history, journal, custom] = await Promise.all([
    getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
    getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
    getJSON<JournalEntry[]>(JOURNAL_KEY, []),
    getJSON<CustomExercise[]>(CUSTOM_KEY, []),
  ]);

  // Clear existing rows for this user (workouts first — they FK to programs).
  for (const table of ["workouts", "programs", "journal_entries", "custom_exercises"] as const) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`clear ${table}: ${error.message}`);
  }

  // Programs — insert and capture local-id -> new-uuid mapping (PostgREST returns
  // inserted rows in input order).
  const idMap = new Map<string, string>();
  if (programs.length > 0) {
    const { data, error } = await supabase
      .from("programs")
      .insert(programs.map((p) => programToRow(p, userId)))
      .select("id");
    if (error) throw new Error(`programs: ${error.message}`);
    (data ?? []).forEach((row: { id: string }, i: number) => idMap.set(programs[i].id, row.id));
  }

  // Workouts — resolve each workout's local programId to the new program uuid
  // (free / legacy workouts have no program -> null).
  if (history.length > 0) {
    const rows = history.map((w) =>
      workoutToRow(w, userId, w.programId ? idMap.get(w.programId) ?? null : null),
    );
    const { error } = await supabase.from("workouts").insert(rows);
    if (error) throw new Error(`workouts: ${error.message}`);
  }

  if (journal.length > 0) {
    const { error } = await supabase.from("journal_entries").insert(journal.map((j) => journalToRow(j, userId)));
    if (error) throw new Error(`journal: ${error.message}`);
  }

  if (custom.length > 0) {
    const { error } = await supabase.from("custom_exercises").insert(custom.map((c) => customToRow(c, userId)));
    if (error) throw new Error(`custom exercises: ${error.message}`);
  }

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

/**
 * Pull this user's cloud data down and OVERWRITE the local AsyncStorage cache
 * with it (cloud is the source of truth). Because the screens already read
 * AsyncStorage, this is what makes data appear on a freshly signed-in device.
 * workout_dates is rebuilt from the pulled workouts.
 */
export async function pullAllFromCloud(userId: string): Promise<SyncCounts> {
  const { data: progRows, error: pe } = await supabase.from("programs").select("*").eq("user_id", userId);
  if (pe) throw new Error(`pull programs: ${pe.message}`);
  const programs = ((progRows ?? []) as ProgramRow[]).map(programFromRow);
  await setJSON(PROGRAMS_KEY, programs);

  const { data: woRows, error: we } = await supabase
    .from("workouts").select("*").eq("user_id", userId)
    .order("completed_at", { ascending: false });  // history is newest-first
  if (we) throw new Error(`pull workouts: ${we.message}`);
  const workouts = ((woRows ?? []) as WorkoutRow[]).map(workoutFromRow);
  await setJSON(WORKOUT_HISTORY_KEY, workouts);
  await setJSON(WORKOUT_DATES_KEY, Array.from(new Set(workouts.map((w) => w.date))));

  const { data: jRows, error: je } = await supabase
    .from("journal_entries").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (je) throw new Error(`pull journal: ${je.message}`);
  const journal = ((jRows ?? []) as JournalRow[]).map(journalFromRow);
  await setJSON(JOURNAL_KEY, journal);

  const { data: cRows, error: ce } = await supabase.from("custom_exercises").select("*").eq("user_id", userId);
  if (ce) throw new Error(`pull custom exercises: ${ce.message}`);
  const custom = ((cRows ?? []) as CustomExerciseRow[]).map(customFromRow);
  await setJSON(CUSTOM_KEY, custom);

  return {
    programs: programs.length,
    workouts: workouts.length,
    journal: journal.length,
    customExercises: custom.length,
  };
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
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw new Error(error.message);
  await clearLocalUserData();
  await removeKey(CACHE_OWNER_KEY);
  await supabase.auth.signOut();
}

/** Wipe the locally-cached user data + in-progress drafts (not auth/theme/unit). */
export async function clearLocalUserData(): Promise<void> {
  await Promise.all([
    removeKey(PROGRAMS_KEY),
    removeKey(WORKOUT_HISTORY_KEY),
    removeKey(WORKOUT_DATES_KEY),
    removeKey(JOURNAL_KEY),
    removeKey(CUSTOM_KEY),
    removeKey(WORKOUT_DRAFT_KEY),
    removeKey(WORKOUT_DAY_OVERRIDE_KEY),
  ]);
}

/**
 * Reconcile the local cache to the signed-in account:
 *   - same account as before → keep local edits, seed any empty side
 *   - any other account (incl. a brand-new one) → clear local and load THIS
 *     account's cloud data. An empty cloud ⇒ an empty account, as expected.
 *
 * NOTE: this never auto-imports stray on-device data into a new account, so a
 * new account always starts empty. (Migrating a pre-backend user's local data
 * into their first account, if we want it for release, should be an explicit
 * "import your existing data?" prompt — not a silent adopt.)
 */
export async function reconcileOnSignIn(userId: string): Promise<"kept" | "replaced"> {
  const owner = await getCacheOwner();
  if (owner === userId) {
    await syncOnLogin(userId);
    return "kept";
  }

  await clearLocalUserData();
  const cloud = await cloudCounts(userId);
  if (total(cloud) > 0) await pullAllFromCloud(userId);
  await setCacheOwner(userId);
  return "replaced";
}

// ── per-account profile (name + role + unit) ───────────────────────────────────
export type CloudProfile = {
  name: string;
  accountType: AccountType;
  unit: "kg" | "lb";
  /** True once the user has finished the name/role step for this account. */
  complete: boolean;
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
    .select("name, account_type, unit, onboarding_complete")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`load profile: ${error.message}`);
  if (!data) return null;
  return {
    name: (data.name as string | null) ?? "",
    accountType: toAppAccountType(data.account_type as string | null),
    unit: (data.unit as string) === "lb" ? "lb" : "kg",
    complete: data.onboarding_complete === true,
  };
}
