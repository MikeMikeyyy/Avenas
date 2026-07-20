// Data layer for the Trainer feature.
//
// Rosters and client training data are still local/mock, BUT program sharing
// is now REAL for connected accounts: entries whose counterpart id is an auth
// uid ride supabase's shared_programs table (migration 0013, full program
// snapshot per row) while mock-roster people keep the on-device path — the
// same routing pattern utils/chatStore.ts uses for messages. Loads merge
// cloud + local into the existing SharedProgram / SentProgram shapes, so the
// screens never know the difference; mutations route by id (uuid → cloud).
// Cloud loads fail soft to local-only when offline.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getJSON, removeKey, setJSON } from "./storage";
import { formatStoredDate } from "./dates";
import { PROGRAMS_KEY, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import { ACCOUNT_TYPE_KEY } from "../contexts/AccountTypeContext";
import { isCloudContactId } from "../lib/chat";
import {
  deleteShareRow,
  fetchMyShareRows,
  fetchShareRow,
  getMyUid,
  insertShareRows,
  updateShareRow,
  type NewShareRow,
  type SharedProgramRow,
} from "../lib/shares";

const warnShares = (op: string, err: unknown) => {
  if (__DEV__) console.warn("[avenas] shares", op, err);
};

/** Cloud rows are keyed by uuid; local mock entries by `share_…` / `sent_…`. */
const isCloudShareId = isCloudContactId;

export const CLIENTS_KEY = "@avenas/pt/clients";
export const CLIENT_DATA_PREFIX = "@avenas/pt/client_data/";
export const SHARED_PROGRAMS_KEY = "@avenas/pt/shared_programs";
export const PT_SEEDED_KEY = "@avenas/pt/seeded_v2";

export const ASSIGNED_PT_KEY = "@avenas/gym/assigned_pt";
export const SENT_PROGRAMS_KEY = "@avenas/gym/sent_programs";

// Trainers may also receive programs from senior coaches/mentors. Stored
// separately from ASSIGNED_PT_KEY so the gym user's single-trainer flow in
// MyPTHome is unaffected.
export const COACHES_KEY = "@avenas/pt/coaches";

// Gym users can now have additional trainers beyond their primary
// (ASSIGNED_PT_KEY). The primary stays in the existing single-trainer field
// so MyPTHome's prominent header is unchanged; this key holds the rest.
export const OTHER_TRAINERS_KEY = "@avenas/gym/other_trainers";

export type Client = {
  id: string;
  name: string;
  initials: string;
  note?: string;
  lastActiveISO?: string;
  streak?: number;
  /** True when this "client" is actually a fellow trainer you've connected with.
   *  They appear in the roster so you can send them programs, but are also listed
   *  on the My Coaches page. Removing one severs the whole connection. */
  isTrainer?: boolean;
  /** Profile photo URL for real connected accounts (migration 0006). Absent for
   *  local/mock clients, which fall back to initials. */
  photoUri?: string;
};

export type ClientData = {
  workoutHistory: CompletedWorkout[];
  programs: SavedProgram[];
  journal: JournalEntry[];
};

export type SharedProgram = {
  id: string;
  clientId: string | "all";
  programId: string;
  programName: string;
  sentAtISO: string;
  /** Set when this is a program a coach sent to ME (incoming → surfaced on the
   *  My Coaches page). When unset, the entry is an outgoing share I sent to a
   *  client/trainer (→ PTHome "Programs You've Sent"). This is the source of
   *  truth for direction; `clientId` is unreliable now that connected trainers
   *  also appear in the client roster. */
  receivedFromCoachId?: string;
  /** Full program snapshot at send time so the gym user can materialise it on accept. */
  programSnapshot?: SavedProgram;
  /** Set when the gym user accepts the program — also signals the trainer that it landed. */
  acceptedAtISO?: string;
  /** Local @avenas/programs id created when the snapshot is materialised on accept. */
  acceptedProgramId?: string;
  /** Set whenever the trainer edits the shared snapshot after the initial send. */
  lastEditedAtISO?: string;
  /** Set when the gym user deletes their accepted copy from /programs. Hides the share from the trainer's per-client view; the entry survives so the gym user can re-accept. */
  deletedByRecipientAtISO?: string;
};

export type AssignedPT = {
  id: string;
  name: string;
  initials: string;
  /** Profile photo URL for real connected trainers/coaches (migration 0006). */
  photoUri?: string;
};

export type SentProgramStatus = "sent" | "returned";

export type SentProgram = {
  id: string;
  programId: string;
  programName: string;
  sentAtISO: string;
  status: SentProgramStatus;
  /** Full program snapshot the gym user sent — the trainer reviews this copy. */
  programSnapshot?: SavedProgram;
  returnedAtISO?: string;
  trainerComments?: string;
  /** Stamped when the gym user accepts the trainer's edits — the local program in @avenas/programs has been overwritten. */
  appliedAtISO?: string;
  /** Stamped whenever the trainer saves edits in the program builder during review. Used to detect unsent updates after a Send Back. */
  lastEditedAtISO?: string;
};

export const clientDataKey = (clientId: string) => `${CLIENT_DATA_PREFIX}${clientId}`;

// ─── cloud share plumbing ─────────────────────────────────────────────────────

/** Per-cloud-share local state the server doesn't need: which LOCAL program a
 *  recipient's accept materialised, so re-accepts update in place. */
export const CLOUD_SHARE_META_KEY = "@avenas/pt/cloud_share_meta";
type CloudShareMeta = Record<string, { acceptedProgramId?: string }>;

async function loadShareMeta(): Promise<CloudShareMeta> {
  return getJSON<CloudShareMeta>(CLOUD_SHARE_META_KEY, {});
}
async function saveShareMeta(meta: CloudShareMeta): Promise<void> {
  await setJSON(CLOUD_SHARE_META_KEY, meta);
}

async function viewerIsPT(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ACCOUNT_TYPE_KEY)) === "pt";
  } catch {
    return false;
  }
}

/** Map a cloud 'share' row into the SharedProgram shape the screens consume.
 *  Direction is derived from the viewer: incoming rows surface under
 *  receivedFromCoachId for trainers (My Coaches) and as plain received entries
 *  for gym users; outgoing rows keep clientId = recipient. */
function rowToShared(row: SharedProgramRow, uid: string, isPT: boolean, meta: CloudShareMeta): SharedProgram {
  const incoming = row.recipient_id === uid;
  return {
    id: row.id,
    clientId: incoming ? uid : row.recipient_id,
    programId: row.sender_program_id,
    programName: row.program_name,
    sentAtISO: row.sent_key,
    receivedFromCoachId: incoming && isPT ? row.sender_id : undefined,
    programSnapshot: row.snapshot as unknown as SavedProgram,
    acceptedAtISO: row.accepted_at ?? undefined,
    acceptedProgramId: incoming ? meta[row.id]?.acceptedProgramId : undefined,
    lastEditedAtISO: row.last_edited_at ?? undefined,
    deletedByRecipientAtISO: row.deleted_by_recipient_at ?? undefined,
  };
}

/** Map a cloud 'review' row into the SentProgram shape. Serves both sides:
 *  the gym user (sender) sees their sent list, the trainer (recipient) their
 *  reviews inbox. The trainer's working copy lives in returned_snapshot. */
function rowToSent(row: SharedProgramRow): SentProgram {
  return {
    id: row.id,
    programId: row.sender_program_id,
    programName: row.program_name,
    sentAtISO: row.sent_key,
    status: row.returned_at ? "returned" : "sent",
    programSnapshot: (row.returned_snapshot ?? row.snapshot) as unknown as SavedProgram,
    returnedAtISO: row.returned_at ?? undefined,
    trainerComments: row.trainer_comments ?? undefined,
    appliedAtISO: row.accepted_at ?? undefined,
    lastEditedAtISO: row.last_edited_at ?? undefined,
  };
}

/** All my cloud rows, or [] when offline / signed out (fail soft — the local
 *  entries still render, and the next focus retries). */
async function fetchCloudRowsSafe(): Promise<{ uid: string; rows: SharedProgramRow[] } | null> {
  try {
    const uid = await getMyUid();
    if (!uid) return null;
    return { uid, rows: await fetchMyShareRows(uid) };
  } catch (e) {
    warnShares("fetch", e);
    return null;
  }
}

/** Materialise a program snapshot into @avenas/programs. Re-uses (and updates
 *  in place) `priorId` when that program still exists — a re-accept after the
 *  sender edited lands on the same local program. Returns the local id. */
async function materialiseSnapshot(snap: SavedProgram, priorId?: string): Promise<string> {
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  const existing = priorId ? programs.find(p => p.id === priorId) : undefined;
  if (existing) {
    const updated = programs.map(p => p.id === existing.id ? {
      ...p,
      name: snap.name,
      totalWeeks: snap.totalWeeks,
      trainingDays: snap.trainingDays,
      cycleDays: snap.cycleDays,
      cyclePattern: snap.cyclePattern,
      workouts: snap.workouts,
    } : p);
    await setJSON(PROGRAMS_KEY, updated);
    return existing.id;
  }
  const importedId = `program_${Date.now()}`;
  const imported: SavedProgram = {
    ...snap,
    id: importedId,
    status: "created",
    currentWeek: 0,
    startDate: formatStoredDate(new Date()),
    cycleOffset: undefined,
    completedDate: undefined,
  };
  await setJSON(PROGRAMS_KEY, [...programs, imported]);
  return importedId;
}

export async function loadClients(): Promise<Client[]> {
  return getJSON<Client[]>(CLIENTS_KEY, []);
}
export async function saveClients(list: Client[]): Promise<void> {
  await setJSON(CLIENTS_KEY, list);
}

export async function loadClientData(clientId: string): Promise<ClientData> {
  return getJSON<ClientData>(clientDataKey(clientId), { workoutHistory: [], programs: [], journal: [] });
}
export async function saveClientData(clientId: string, data: ClientData): Promise<void> {
  await setJSON(clientDataKey(clientId), data);
}

/** Local (mock-roster) share entries only. */
async function loadLocalSharedPrograms(): Promise<SharedProgram[]> {
  return getJSON<SharedProgram[]>(SHARED_PROGRAMS_KEY, []);
}

/** All share entries the viewer can see: local mock entries merged with cloud
 *  'share' rows (both directions), newest first. */
export async function loadSharedPrograms(): Promise<SharedProgram[]> {
  const local = await loadLocalSharedPrograms();
  const cloud = await fetchCloudRowsSafe();
  if (!cloud) return local;
  const [isPT, meta] = await Promise.all([viewerIsPT(), loadShareMeta()]);
  const mapped = cloud.rows
    .filter(r => r.kind === "share")
    .map(r => rowToShared(r, cloud.uid, isPT, meta));
  return [...mapped, ...local].sort(
    (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
  );
}

/** Send program shares. Entries addressed to REAL accounts (uuid clientId) go
 *  through the cloud table — and THROW when that fails (offline / not
 *  connected), so callers can tell the user instead of faking success. Mock
 *  roster entries keep the local path. */
export async function appendSharedPrograms(entries: SharedProgram[]): Promise<void> {
  const cloudEntries = entries.filter(e => e.clientId !== "all" && isCloudContactId(e.clientId));
  const localEntries = entries.filter(e => !cloudEntries.includes(e));
  if (cloudEntries.length > 0) {
    const uid = await getMyUid();
    if (!uid) throw new Error("Sign in to send programs to connected accounts.");
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    const rows: NewShareRow[] = cloudEntries.map(e => {
      const snapshot = e.programSnapshot ?? programs.find(p => p.id === e.programId);
      if (!snapshot) throw new Error(`Program "${e.programName}" was not found.`);
      return {
        recipientId: e.clientId as string,
        kind: "share",
        senderProgramId: e.programId,
        programName: e.programName,
        snapshot,
        sentKey: e.sentAtISO,
      };
    });
    await insertShareRows(uid, rows);
  }
  if (localEntries.length > 0) {
    const existing = await loadLocalSharedPrograms();
    await setJSON(SHARED_PROGRAMS_KEY, [...localEntries, ...existing]);
  }
}

/** Stable grouping key — every entry created in a single send call shares the same sentAtISO. */
export function batchKeyOf(s: SharedProgram): string {
  return `${s.programId}|${s.sentAtISO}`;
}

/** Expand legacy `clientId: "all"` entries into one entry per current client.
 *  Idempotent — does nothing when no broadcast entries are present. */
export async function migrateBroadcastShares(clients: Client[]): Promise<void> {
  if (clients.length === 0) return;
  const list = await loadLocalSharedPrograms();
  if (!list.some(s => s.clientId === "all")) return;
  const next: SharedProgram[] = [];
  for (const s of list) {
    if (s.clientId !== "all") { next.push(s); continue; }
    for (const c of clients) {
      next.push({ ...s, id: `${s.id}_${c.id}`, clientId: c.id });
    }
  }
  await setJSON(SHARED_PROGRAMS_KEY, next);
}

/** Accept every share entry in a batch as a single unit — LOCAL entries and my
 *  incoming CLOUD rows alike. Materialises the snapshot to @avenas/programs
 *  exactly once (re-using an existing acceptedProgramId from either side) so
 *  all entries in the batch land on the same local program. */
export async function acceptSharedProgramBatch(batchKey: string): Promise<string | null> {
  const acceptedAt = new Date().toISOString();
  const list = await loadLocalSharedPrograms();
  const localTargets = list.filter(s => batchKeyOf(s) === batchKey);

  const cloud = await fetchCloudRowsSafe();
  const meta = await loadShareMeta();
  const cloudTargets = (cloud?.rows ?? []).filter(
    r => r.kind === "share" && r.recipient_id === cloud?.uid && `${r.sender_program_id}|${r.sent_key}` === batchKey,
  );
  if (localTargets.length === 0 && cloudTargets.length === 0) return null;

  const snap =
    localTargets.find(t => t.programSnapshot)?.programSnapshot ??
    (cloudTargets[0]?.snapshot as unknown as SavedProgram | undefined);
  if (!snap) {
    const next = list.map(s => batchKeyOf(s) === batchKey ? { ...s, acceptedAtISO: acceptedAt } : s);
    await setJSON(SHARED_PROGRAMS_KEY, next);
    return null;
  }

  const priorId =
    localTargets.find(t => t.acceptedProgramId)?.acceptedProgramId ??
    cloudTargets.map(r => meta[r.id]?.acceptedProgramId).find(Boolean);
  const importedId = await materialiseSnapshot(snap, priorId);

  if (localTargets.length > 0) {
    const next = list.map(s => batchKeyOf(s) === batchKey
      ? { ...s, acceptedAtISO: acceptedAt, acceptedProgramId: importedId, deletedByRecipientAtISO: undefined }
      : s
    );
    await setJSON(SHARED_PROGRAMS_KEY, next);
  }
  for (const r of cloudTargets) {
    meta[r.id] = { acceptedProgramId: importedId };
    try {
      await updateShareRow(r.id, { accepted_at: acceptedAt, deleted_by_recipient_at: null });
    } catch (e) {
      // Local import already happened; the pending stamp just means the entry
      // still shows unaccepted next load — re-accepting is idempotent.
      warnShares("acceptBatch", e);
    }
  }
  await saveShareMeta(meta);
  return importedId;
}

/** Unsend a whole batch (local entries + my outgoing cloud rows). */
export async function removeSharedProgramBatch(batchKey: string): Promise<void> {
  const existing = await loadLocalSharedPrograms();
  await setJSON(SHARED_PROGRAMS_KEY, existing.filter(s => batchKeyOf(s) !== batchKey));
  const cloud = await fetchCloudRowsSafe();
  for (const r of (cloud?.rows ?? []).filter(
    r => r.kind === "share" && r.sender_id === cloud?.uid && `${r.sender_program_id}|${r.sent_key}` === batchKey,
  )) {
    try {
      await deleteShareRow(r.id);
    } catch (e) {
      warnShares("unsendBatch", e);
    }
  }
}

/** Apply a patch to every entry in the batch. Used by the post-send edit flow. */
export async function updateSharedProgramBatch(batchKey: string, patch: Partial<SharedProgram>): Promise<void> {
  const existing = await loadLocalSharedPrograms();
  const next = existing.map(s => batchKeyOf(s) === batchKey ? { ...s, ...patch } : s);
  await setJSON(SHARED_PROGRAMS_KEY, next);
  const cloud = await fetchCloudRowsSafe();
  const rowPatch: Parameters<typeof updateShareRow>[1] = {};
  if (patch.programSnapshot) rowPatch.snapshot = patch.programSnapshot as unknown as Record<string, unknown>;
  if (patch.programName) rowPatch.program_name = patch.programName;
  if (patch.lastEditedAtISO) rowPatch.last_edited_at = patch.lastEditedAtISO;
  // An explicit `acceptedAtISO: undefined` in the patch is the sender resetting
  // acceptance after an edit — mirror that as a NULL, not "leave unchanged".
  if ("acceptedAtISO" in patch) rowPatch.accepted_at = patch.acceptedAtISO ?? null;
  if (Object.keys(rowPatch).length === 0) return;
  for (const r of (cloud?.rows ?? []).filter(
    r => r.kind === "share" && r.sender_id === cloud?.uid && `${r.sender_program_id}|${r.sent_key}` === batchKey,
  )) {
    try {
      await updateShareRow(r.id, rowPatch);
    } catch (e) {
      warnShares("editBatch", e);
    }
  }
}

/** Accept a shared program. On first accept the snapshot is appended to @avenas/programs.
 *  On a re-accept (trainer edited after the user previously accepted) the existing local program is updated in place. */
export async function acceptSharedProgram(shareId: string): Promise<string | null> {
  if (isCloudShareId(shareId)) {
    let row: SharedProgramRow | null = null;
    try {
      row = await fetchShareRow(shareId);
    } catch (e) {
      warnShares("accept", e);
    }
    if (!row) return null;
    const meta = await loadShareMeta();
    const importedId = await materialiseSnapshot(
      row.snapshot as unknown as SavedProgram,
      meta[row.id]?.acceptedProgramId,
    );
    meta[row.id] = { acceptedProgramId: importedId };
    await saveShareMeta(meta);
    try {
      await updateShareRow(row.id, { accepted_at: new Date().toISOString(), deleted_by_recipient_at: null });
    } catch (e) {
      warnShares("acceptStamp", e); // local import done; re-accept is idempotent
    }
    return importedId;
  }

  const list = await loadLocalSharedPrograms();
  const target = list.find(s => s.id === shareId);
  if (!target) return null;
  if (!target.programSnapshot) {
    // Nothing to materialise — just stamp acceptedAtISO.
    const next = list.map(s => s.id === shareId ? { ...s, acceptedAtISO: new Date().toISOString() } : s);
    await setJSON(SHARED_PROGRAMS_KEY, next);
    return null;
  }

  const importedId = await materialiseSnapshot(target.programSnapshot, target.acceptedProgramId);
  const next = list.map(s => s.id === shareId
    ? { ...s, acceptedAtISO: new Date().toISOString(), acceptedProgramId: importedId, deletedByRecipientAtISO: undefined }
    : s
  );
  await setJSON(SHARED_PROGRAMS_KEY, next);
  return importedId;
}

export async function loadAssignedPT(): Promise<AssignedPT | null> {
  return getJSON<AssignedPT | null>(ASSIGNED_PT_KEY, null);
}
export async function saveAssignedPT(pt: AssignedPT | null): Promise<void> {
  await setJSON(ASSIGNED_PT_KEY, pt);
}

export async function loadOtherTrainers(): Promise<AssignedPT[]> {
  return getJSON<AssignedPT[]>(OTHER_TRAINERS_KEY, []);
}
export async function saveOtherTrainers(list: AssignedPT[]): Promise<void> {
  await setJSON(OTHER_TRAINERS_KEY, list);
}
export async function addOtherTrainer(pt: AssignedPT): Promise<void> {
  const existing = await loadOtherTrainers();
  if (existing.some(p => p.id === pt.id)) return;
  await setJSON(OTHER_TRAINERS_KEY, [...existing, pt]);
}
export async function removeOtherTrainer(id: string): Promise<void> {
  const existing = await loadOtherTrainers();
  await setJSON(OTHER_TRAINERS_KEY, existing.filter(p => p.id !== id));
}

export async function loadCoaches(): Promise<AssignedPT[]> {
  return getJSON<AssignedPT[]>(COACHES_KEY, []);
}
export async function saveCoaches(list: AssignedPT[]): Promise<void> {
  await setJSON(COACHES_KEY, list);
}
export async function addCoach(coach: AssignedPT): Promise<void> {
  const existing = await loadCoaches();
  if (existing.some(c => c.id === coach.id)) return;
  await setJSON(COACHES_KEY, [...existing, coach]);
}
export async function removeCoach(id: string): Promise<void> {
  const existing = await loadCoaches();
  await setJSON(COACHES_KEY, existing.filter(c => c.id !== id));
}

/** Connect with a fellow trainer. The connection is symmetric: they're recorded
 *  as a coach (so programs they send surface on My Coaches) AND inserted into the
 *  client roster (so you can send programs to them via the normal Send flow).
 *  Idempotent — re-connecting the same trainer is a no-op for each list. */
export async function connectTrainer(pt: AssignedPT): Promise<void> {
  await addCoach(pt);
  const clients = await loadClients();
  if (!clients.some(c => c.id === pt.id)) {
    const asClient: Client = {
      id: pt.id,
      name: pt.name,
      initials: pt.initials,
      lastActiveISO: new Date().toISOString(),
      streak: 0,
      isTrainer: true,
    };
    await setJSON(CLIENTS_KEY, [asClient, ...clients]);
  }
}

/** Sever a trainer connection from either side — removes the coach entry, the
 *  mirrored client entry, and that client's local data. */
export async function disconnectTrainer(id: string): Promise<void> {
  await removeCoach(id);
  const clients = await loadClients();
  if (clients.some(c => c.id === id)) {
    await setJSON(CLIENTS_KEY, clients.filter(c => c.id !== id));
    await removeKey(clientDataKey(id));
  }
}

/** Backfill `receivedFromCoachId` on legacy incoming shares. Before the field
 *  existed, a coach-sent program was identified only by `clientId` carrying the
 *  coach id. Now that connected trainers also live in the client roster that
 *  heuristic collides, so stamp the explicit flag once. Idempotent. */
export async function migrateCoachReceivedShares(): Promise<void> {
  const [shares, coaches] = await Promise.all([loadLocalSharedPrograms(), loadCoaches()]);
  if (coaches.length === 0 || shares.length === 0) return;
  const coachIds = new Set(coaches.map(c => c.id));
  let mutated = false;
  const next = shares.map(s => {
    if (s.receivedFromCoachId || !coachIds.has(s.clientId)) return s;
    mutated = true;
    return { ...s, receivedFromCoachId: s.clientId };
  });
  if (mutated) await setJSON(SHARED_PROGRAMS_KEY, next);
}

async function loadLocalSentPrograms(): Promise<SentProgram[]> {
  return getJSON<SentProgram[]>(SENT_PROGRAMS_KEY, []);
}

/** The viewer's review entries: local ones merged with cloud 'review' rows.
 *  Direction is viewer-dependent — a trainer sees their reviews INBOX
 *  (recipient side, minus ones they dismissed), a gym user their SENT list. */
export async function loadSentPrograms(): Promise<SentProgram[]> {
  const local = await loadLocalSentPrograms();
  const cloud = await fetchCloudRowsSafe();
  if (!cloud) return local;
  const isPT = await viewerIsPT();
  const mapped = cloud.rows
    .filter(r => r.kind === "review")
    .filter(r => (isPT ? r.recipient_id === cloud.uid && !r.deleted_by_recipient_at : r.sender_id === cloud.uid))
    .map(rowToSent);
  return [...mapped, ...local].sort(
    (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
  );
}

/** Send a program for review. When the trainer is a REAL account (uuid),
 *  the entry rides the cloud table and THROWS on failure so callers can tell
 *  the user; a local/mock trainer keeps the on-device path. */
export async function appendSentProgram(entry: SentProgram, recipientId?: string): Promise<void> {
  if (recipientId && isCloudContactId(recipientId)) {
    const uid = await getMyUid();
    if (!uid) throw new Error("Sign in to send programs to your trainer.");
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    const snapshot = entry.programSnapshot ?? programs.find(p => p.id === entry.programId);
    if (!snapshot) throw new Error(`Program "${entry.programName}" was not found.`);
    await insertShareRows(uid, [{
      recipientId,
      kind: "review",
      senderProgramId: entry.programId,
      programName: entry.programName,
      snapshot,
      sentKey: entry.sentAtISO,
    }]);
    return;
  }
  const existing = await loadLocalSentPrograms();
  await setJSON(SENT_PROGRAMS_KEY, [entry, ...existing]);
}

/** When the gym user deletes a program in /programs, mark the matching SharedProgram(s)
 *  as withdrawn rather than removing them — the trainer's per-client view filters them out,
 *  but the gym user can still re-accept from their My Trainer page if they want it back. */
export async function removeSharedProgramByLocalId(localProgramId: string): Promise<void> {
  const list = await loadLocalSharedPrograms();
  let mutated = false;
  const now = new Date().toISOString();
  const next = list.map(s => {
    if (s.acceptedProgramId !== localProgramId) return s;
    mutated = true;
    return { ...s, deletedByRecipientAtISO: now, acceptedAtISO: undefined, acceptedProgramId: undefined };
  });
  if (mutated) await setJSON(SHARED_PROGRAMS_KEY, next);

  // Cloud shares that materialised this local program: hide from the sender's
  // view + clear the accept, keeping the row so the recipient can re-accept.
  const meta = await loadShareMeta();
  const affected = Object.entries(meta).filter(([, m]) => m.acceptedProgramId === localProgramId);
  if (affected.length === 0) return;
  for (const [id] of affected) {
    delete meta[id];
    try {
      await updateShareRow(id, { deleted_by_recipient_at: now, accepted_at: null });
    } catch (e) {
      warnShares("hideByLocalId", e);
    }
  }
  await saveShareMeta(meta);
}

/** Migration: pre-acceptedProgramId entries are linked back to a local program by name + snapshot match. */
export async function backfillAcceptedProgramIds(): Promise<void> {
  const shares = await loadLocalSharedPrograms();
  const orphan = shares.filter(s => s.acceptedAtISO && !s.acceptedProgramId);
  if (orphan.length === 0) return;

  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  let mutated = false;
  const next = shares.map(s => {
    if (!s.acceptedAtISO || s.acceptedProgramId) return s;
    const snapName = s.programSnapshot?.name ?? s.programName;
    const match = programs.find(p => p.name === snapName);
    if (!match) return s;
    mutated = true;
    return { ...s, acceptedProgramId: match.id };
  });
  if (mutated) await setJSON(SHARED_PROGRAMS_KEY, next);
}

export async function updateSentProgram(id: string, patch: Partial<SentProgram>): Promise<void> {
  if (isCloudShareId(id)) {
    // Trainer-side review edits/returns map onto the row's review columns; the
    // ORIGINAL snapshot is never touched, the working copy is returned_snapshot.
    const rowPatch: Parameters<typeof updateShareRow>[1] = {};
    if (patch.programSnapshot) rowPatch.returned_snapshot = patch.programSnapshot as unknown as Record<string, unknown>;
    if (patch.programName) rowPatch.program_name = patch.programName;
    if (patch.lastEditedAtISO) rowPatch.last_edited_at = patch.lastEditedAtISO;
    if (patch.trainerComments !== undefined) rowPatch.trainer_comments = patch.trainerComments ?? null;
    if (patch.status === "returned" || patch.returnedAtISO) rowPatch.returned_at = patch.returnedAtISO ?? new Date().toISOString();
    if (patch.appliedAtISO) rowPatch.accepted_at = patch.appliedAtISO;
    if (Object.keys(rowPatch).length === 0) return;
    try {
      await updateShareRow(id, rowPatch);
    } catch (e) {
      warnShares("updateSent", e);
      throw e instanceof Error ? e : new Error("Couldn't update the program.");
    }
    return;
  }
  const existing = await loadLocalSentPrograms();
  const next = existing.map(s => s.id === id ? { ...s, ...patch } : s);
  await setJSON(SENT_PROGRAMS_KEY, next);
}

/** Gym user accepts a returned program: overwrite the original entry in @avenas/programs with the trainer's edited snapshot. */
export async function applyReturnedProgram(id: string): Promise<void> {
  if (isCloudShareId(id)) {
    let row: SharedProgramRow | null = null;
    try {
      row = await fetchShareRow(id);
    } catch (e) {
      warnShares("applyReturned", e);
    }
    if (!row || !row.returned_at || row.accepted_at) return;
    const snap = (row.returned_snapshot ?? row.snapshot) as unknown as SavedProgram;
    // In-place over the sender's original program; a fresh import if it's gone.
    await materialiseSnapshotOverExisting(snap, row.sender_program_id);
    try {
      await updateShareRow(id, { accepted_at: new Date().toISOString() });
    } catch (e) {
      warnShares("applyStamp", e); // local apply done; re-apply is guarded by accepted_at staying null
    }
    return;
  }

  const list = await loadLocalSentPrograms();
  const target = list.find(s => s.id === id);
  if (!target || target.status !== "returned" || target.appliedAtISO) return;
  if (!target.programSnapshot) return;
  await materialiseSnapshotOverExisting(target.programSnapshot, target.programId);
  const nextList = list.map(s => s.id === id ? { ...s, appliedAtISO: new Date().toISOString() } : s);
  await setJSON(SENT_PROGRAMS_KEY, nextList);
}

/** Overwrite `programId` in @avenas/programs with `snap` (preserving id,
 *  status, currentWeek, startDate), or import fresh when it no longer exists. */
async function materialiseSnapshotOverExisting(snap: SavedProgram, programId: string): Promise<void> {
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  const original = programs.find(p => p.id === programId);
  let nextPrograms: SavedProgram[];
  if (original) {
    nextPrograms = programs.map(p => p.id === programId ? {
      ...p,
      name: snap.name,
      totalWeeks: snap.totalWeeks,
      trainingDays: snap.trainingDays,
      cycleDays: snap.cycleDays,
      cyclePattern: snap.cyclePattern,
      workouts: snap.workouts,
    } : p);
  } else {
    const imported: SavedProgram = {
      ...snap,
      id: `program_${Date.now()}`,
      status: "created",
      currentWeek: 0,
      startDate: formatStoredDate(new Date()),
      cycleOffset: undefined,
      completedDate: undefined,
    };
    nextPrograms = [...programs, imported];
  }
  await setJSON(PROGRAMS_KEY, nextPrograms);
}

/** Gym user unsends a program they sent to the trainer. */
export async function removeSentProgram(id: string): Promise<void> {
  if (isCloudShareId(id)) {
    try {
      await deleteShareRow(id); // sender-only per RLS — this is the sender's flow
    } catch (e) {
      warnShares("unsendReview", e);
    }
    return;
  }
  const existing = await loadLocalSentPrograms();
  await setJSON(SENT_PROGRAMS_KEY, existing.filter(s => s.id !== id));
}

/** Remove a share entry. Sender → the row is deleted (unsend; if the client
 *  already accepted, their imported copy in `@avenas/programs` stays — they own
 *  it). Recipient → the row is hidden (deleted_by_recipient_at) so re-accepting
 *  stays possible, mirroring the local model. */
export async function removeSharedProgram(id: string): Promise<void> {
  if (isCloudShareId(id)) {
    try {
      const uid = await getMyUid();
      const row = await fetchShareRow(id);
      if (!row || !uid) return;
      if (row.sender_id === uid) {
        await deleteShareRow(id);
      } else {
        await updateShareRow(id, { deleted_by_recipient_at: new Date().toISOString(), accepted_at: null });
        const meta = await loadShareMeta();
        if (meta[id]) { delete meta[id]; await saveShareMeta(meta); }
      }
    } catch (e) {
      warnShares("remove", e);
    }
    return;
  }
  const existing = await loadLocalSharedPrograms();
  await setJSON(SHARED_PROGRAMS_KEY, existing.filter(s => s.id !== id));
}

/** Generic patch update for a LOCAL SharedProgram entry (cloud entries go
 *  through the batch/accept paths above). */
export async function updateSharedProgram(id: string, patch: Partial<SharedProgram>): Promise<void> {
  const existing = await loadLocalSharedPrograms();
  const next = existing.map(s => s.id === id ? { ...s, ...patch } : s);
  await setJSON(SHARED_PROGRAMS_KEY, next);
}

/**
 * Wipe ALL local trainer-hub data: the client roster + each client's data, the
 * assigned/other trainers, coaches, sent/shared programs, and the demo-seed flag.
 * Called on account delete / account switch (see lib/cloud.clearLocalUserData) so
 * one account's local data never leaks into the next account on this device. The
 * seed flag is cleared too, so a fresh account re-seeds its own demo clients
 * rather than inheriting the previous account's roster.
 */
export async function clearTrainerData(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const clientData = keys.filter(k => k.startsWith(CLIENT_DATA_PREFIX));
  await AsyncStorage.multiRemove([
    CLIENTS_KEY,
    SHARED_PROGRAMS_KEY,
    CLOUD_SHARE_META_KEY,
    PT_SEEDED_KEY,
    ASSIGNED_PT_KEY,
    SENT_PROGRAMS_KEY,
    COACHES_KEY,
    OTHER_TRAINERS_KEY,
    ...clientData,
  ]);
}

export function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
