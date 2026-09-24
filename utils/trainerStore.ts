// Data layer for the Trainer feature.
//
// A real client's training (programs, workouts, journal) is read from their own
// cloud backup (migration 0032, lib/clientTraining.ts) and cached on this
// device; mock-roster people keep their on-device copy. Program sharing is
// REAL for connected accounts too: entries whose counterpart id is an auth
// uid ride supabase's shared_programs table (migration 0013, full program
// snapshot per row) while mock-roster people keep the on-device path — the
// same routing pattern utils/chatStore.ts uses for messages. Loads merge
// cloud + local into the existing SharedProgram / SentProgram shapes, so the
// screens never know the difference; mutations route by id (uuid → cloud).
// Cloud loads fail soft to local-only when offline.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getJSON, removeKey, setJSON } from "./storage";
import { forgetSnapshots, isPageSnapshotKey } from "./pageSnapshot";
import { formatStoredDate } from "./dates";
import { forkChangedDayIds, normalizeDayIds } from "./programDays";
import { PROGRAMS_KEY, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import type { CustomExercise } from "../constants/exercises";
import { GROUP_FAVOURITES_KEY } from "../constants/groups";
import { ACCOUNT_TYPE_KEY } from "../contexts/AccountTypeContext";
import { isCloudContactId } from "../lib/chat";
import { fetchClientTraining, fetchClientsActivePrograms } from "../lib/clientTraining";
import {
  deleteShareRow,
  fetchGroupShareRows,
  fetchMyGroupReviewRows,
  fetchMyShareRows,
  fetchShareRow,
  getMyUid,
  insertShareRows,
  setGroupReviewCompleted,
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

// The gym user's PRIMARY trainer — now a pointer, not the list. The list of
// trainers is derived from live connections (utils/roster.ts); this records
// which of them MyPTHome features.
export const ASSIGNED_PT_KEY = "@avenas/gym/assigned_pt";
export const SENT_PROGRAMS_KEY = "@avenas/gym/sent_programs";

// Programs sent TO me that I've removed from my received lists (the trainer
// page's "From Your Trainer", a group's "Programs Sent", a trainer's My
// Trainers page) — batchKeyOf() keys,
// so one entry covers every row of that send. A review I sent that's come BACK
// is in the same list under sentKeyOf(), since it shows among received ones. A recipient can't delete a share
// row (the database allows only the sender or a group coach), and
// deleted_by_recipient_at already means something else (you deleted your
// accepted copy; the trainer sees "Removed"), so this is a hide on the
// RECIPIENT's side only. The trainer's view is untouched, and an accepted copy
// in My Programs is never affected. Local-only, never synced.
export const DISMISSED_SHARES_KEY = "@avenas/gym/dismissed_shares";

// Trainers a TRAINER receives programs from. Legacy/mock leftovers only — see
// loadCoaches(); real ones come from the connections table.
export const COACHES_KEY = "@avenas/pt/coaches";

// A gym user's non-primary trainers. Same story: legacy/mock leftovers, merged
// underneath the derived list.
export const OTHER_TRAINERS_KEY = "@avenas/gym/other_trainers";

// Connected TRAINERS this account has also taken on as a client — a uuid[].
// Connecting alone never does this (utils/roster.ts routes a PT connection to
// My Trainers), so coaching a fellow trainer is an explicit opt-in recorded
// here. Local-only and never synced: it's how THIS account chooses to file a
// connection, and the other side has their own independent view of it.
export const TRAINER_CLIENTS_KEY = "@avenas/pt/trainer_clients";

export type Client = {
  id: string;
  name: string;
  initials: string;
  note?: string;
  lastActiveISO?: string;
  streak?: number;
  /** True when this "client" is actually a fellow trainer. Connecting alone no
   *  longer puts a trainer in the roster (utils/roster.ts routes them to My
   *  Trainers instead) — the flag marks the ones you've deliberately taken on as
   *  a client, so the UI can badge them. */
  isTrainer?: boolean;
  /** Profile photo URL for real connected accounts (migration 0006). Absent for
   *  local/mock clients, which fall back to initials. */
  photoUri?: string;
};

export type ClientData = {
  workoutHistory: CompletedWorkout[];
  programs: SavedProgram[];
  journal: JournalEntry[];
  /** Their custom exercises, so the Progress tab can place them on the muscle
   *  radar. Absent on mock-seeded entries. */
  customExercises?: CustomExercise[];
  /** When the client's phone last backed up (ISO), shown as "Synced 3h ago"
   *  so a trainer knows how current this is. Absent for mock clients and for
   *  someone with nothing backed up. */
  backedUpAt?: string;
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
  /**
   * The group this share was sent to, when it came from a group's Send Program
   * rather than a direct send. A group send still writes ONE entry per member —
   * that's what drives the per-recipient pending list — so this is the only
   * thing tying them back to the group they came from.
   *
   * Absent on direct sends and on anything sent before this existed, which both
   * read as "sent individually". Only the id is stored: the group's name is
   * looked up live, so renaming a group updates its past sends instead of
   * leaving them showing a stale name.
   */
  groupId?: string;
  /**
   * Who sent this share. Read straight off the cloud row's `sender_id`, so it
   * is authoritative rather than inferred.
   *
   * Direction used to be worked out by asking "is the recipient in my client
   * roster?", which breaks for a group send: a group member need not be one of
   * your own clients, so your own send read as incoming and offered you an
   * Accept button for a program you had just sent. Absent on local/mock
   * entries, where the roster heuristic is still the only option.
   */
  senderId?: string;
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
  /** Set when this was posted to a GROUP for review rather than sent to one
   *  trainer (migration 0028). Any coach of that group can review it, and it
   *  appears in that group's queue — a direct send to a trainer has no groupId
   *  and must never show up there. */
  groupId?: string;
  /** Who asked for the review. A group queue is a list of other people's
   *  requests, so it needs a name against each one; a 1:1 review doesn't,
   *  because there's only ever one person it can be from. Absent on local
   *  (mock-roster) entries, which have no accounts behind them. */
  senderId?: string;
  /** A group coach marked it dealt with, so it leaves the group's queue. The
   *  sender keeps it on their own page regardless: it's their record of having
   *  asked, not the coaches' to-do item. */
  completedAtISO?: string;
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
    groupId: row.group_id ?? undefined,
    senderId: row.sender_id,
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
    groupId: row.group_id ?? undefined,
    senderId: row.sender_id,
    completedAtISO: row.completed_at ?? undefined,
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
/**
 * Day ids for a local program being overwritten by an incoming snapshot.
 *
 * The recipient's history points at the LOCAL ids, so those are what survive —
 * but a day the sender both renamed and re-stocked is a different workout now,
 * and gets a fresh id so its old sessions stay with the day they were actually
 * performed on. Same rule the program builder applies to a local edit; the two
 * write paths must not disagree, or the same change would split the Progress
 * page one way when you make it and another way when your trainer does.
 */
function mergedDayIds(local: SavedProgram, snap: SavedProgram): string[] {
  return forkChangedDayIds(
    {
      cyclePattern: local.cyclePattern,
      dayIds: normalizeDayIds(local.dayIds, local.cyclePattern.length),
      workouts: local.workouts ?? {},
    },
    {
      cyclePattern: snap.cyclePattern,
      dayIds: normalizeDayIds(local.dayIds, snap.cyclePattern.length),
      workouts: snap.workouts ?? {},
    },
  );
}

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
      // Keep the LOCAL day ids — the recipient's logged sessions point at these,
      // so adopting the sender's would cut this program's own history loose.
      // They're then run through the same fork rule a local edit uses, so a day
      // the sender renamed AND re-stocked splits from its old sessions exactly
      // as it would if the recipient had made that edit themselves.
      dayIds: mergedDayIds(p, snap),
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
    // The sender's run-state never comes with the programming. Their hold
    // would start this copy already paused, and their rest/push/pull days are
    // all dated before this copy's startDate — so every one of them would count
    // as drift against day 1, landing the recipient several cycle slots in and
    // moving their finish date out by the same amount. Same reasoning as
    // re-activating a program in app/programs.tsx.
    pausedAt: undefined,
    skippedDates: undefined,
    pushedDates: undefined,
    pulledDates: undefined,
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

const emptyClientData = (): ClientData => ({ workoutHistory: [], programs: [], journal: [] });

/**
 * A client's training: programs, logged workouts, journal, custom exercises.
 *
 * For a real account it's read from their own cloud backup, which every
 * workout, program edit and journal change already pushes (lib/syncManager.ts),
 * so a client's edits reach this page on its next load. The copy is cached
 * here and served when the server can't be reached. A refusal is different: it
 * means the connection is gone (or this account isn't a trainer), so the cached
 * copy is dropped rather than shown. A mock-roster person has only the local copy.
 */
export async function loadClientData(clientId: string): Promise<ClientData> {
  const key = clientDataKey(clientId);
  if (!isCloudContactId(clientId)) return getJSON<ClientData>(key, emptyClientData());
  try {
    const fresh = await fetchClientTraining(clientId);
    if (!fresh) {
      await removeKey(key);
      return emptyClientData();
    }
    await setJSON(key, fresh);
    return fresh;
  } catch (e) {
    if (__DEV__) console.warn("[avenas] client training", clientId, e);
    return getJSON<ClientData>(key, emptyClientData());
  }
}

/**
 * The copy of a client's training that the client page last loaded, with no
 * network. For screens opened FROM that page (a workout tapped on their
 * journal): every backup the client makes re-mints their workout ids, so a
 * fresh read could miss the very workout that was tapped, where this copy is
 * the one the ids came from.
 */
export async function loadCachedClientData(clientId: string): Promise<ClientData> {
  return getJSON<ClientData>(clientDataKey(clientId), emptyClientData());
}

/**
 * Each client's active program name, for the line under them on the hub and a
 * group's roster. One batched read for real accounts rather than each client's
 * whole history; offline, the names come from whatever copy is cached.
 */
export async function loadClientActivePrograms(clientIds: string[]): Promise<Record<string, string>> {
  const fromCache = async (ids: string[]) => {
    const out: Record<string, string> = {};
    await Promise.all(ids.map(async id => {
      const data = await getJSON<ClientData>(clientDataKey(id), emptyClientData());
      const active = data.programs.find(p => p.status === "active");
      if (active) out[id] = active.name;
    }));
    return out;
  };
  const cloudIds = clientIds.filter(isCloudContactId);
  const local = await fromCache(clientIds.filter(id => !isCloudContactId(id)));
  try {
    return { ...local, ...(await fetchClientsActivePrograms(cloudIds)) };
  } catch (e) {
    if (__DEV__) console.warn("[avenas] client active programs", e);
    return { ...local, ...(await fromCache(cloudIds)) };
  }
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
  if (!cloud) return withoutDismissed(local, null);
  const [isPT, meta] = await Promise.all([viewerIsPT(), loadShareMeta()]);
  const mapped = cloud.rows
    .filter(r => r.kind === "share")
    .map(r => rowToShared(r, cloud.uid, isPT, meta));
  return withoutDismissed([...mapped, ...local], cloud.uid).then(list => list.sort(
    (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
  ));
}

/** Batch keys of programs sent to me that I've removed. See DISMISSED_SHARES_KEY. */
export async function loadDismissedShareKeys(): Promise<Set<string>> {
  return new Set(await getJSON<string[]>(DISMISSED_SHARES_KEY, []));
}

/** Remove a program someone sent me from my received lists. Hides that SEND —
 *  every row sharing its batch key — on this device. Idempotent. */
export async function dismissSharedBatch(batchKey: string): Promise<void> {
  const keys = await getJSON<string[]>(DISMISSED_SHARES_KEY, []);
  if (keys.includes(batchKey)) return;
  await setJSON(DISMISSED_SHARES_KEY, [...keys, batchKey]);
}

/**
 * Drop the sends I've removed, at the load layer, so every list, badge and
 * lookup agrees without each screen filtering for itself: the received cards,
 * a group's Programs Sent, and the group alert count (a program I removed is no
 * longer "waiting on me").
 *
 * Only ever drops a row I RECEIVED. My own sends are never filtered, whatever
 * is in the list — a trainer's outgoing history can't be hidden by accident.
 */
async function withoutDismissed(list: SharedProgram[], myUid: string | null): Promise<SharedProgram[]> {
  const dismissed = await loadDismissedShareKeys();
  if (dismissed.size === 0) return list;
  return list.filter(s => !(dismissed.has(batchKeyOf(s)) && (!myUid || s.senderId !== myUid)));
}

/** Everything sent to one group, from the group's point of view rather than
 *  mine.
 *
 *  `loadSharedPrograms` can only ever return my own row out of a group send,
 *  because the query behind it narrows to rows I'm a party to. A coach of the
 *  group needs the whole batch — that's what makes "3 of 5 opened" true and
 *  what a delete has to remove. RLS returns just my own row to a plain member,
 *  so the same call serves both and the UI doesn't have to ask which I am.
 *
 *  Local mock entries are merged in the same way, matched on `groupId`. */
export async function loadGroupSharedPrograms(groupId: string): Promise<SharedProgram[]> {
  const local = (await loadLocalSharedPrograms()).filter(s => s.groupId === groupId);
  const uid = await getMyUid().catch(() => null);
  if (!uid) return withoutDismissed(local, null);
  let rows: SharedProgramRow[];
  try {
    rows = await fetchGroupShareRows(groupId);
  } catch (e) {
    warnShares("loadGroupShares", e);
    return withoutDismissed(local, uid);
  }
  const [isPT, meta] = await Promise.all([viewerIsPT(), loadShareMeta()]);
  const mapped = rows
    .filter(r => r.kind === "share")
    .map(r => rowToShared(r, uid, isPT, meta));
  return withoutDismissed([...mapped, ...local], uid).then(list => list.sort(
    (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
  ));
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
        groupId: e.groupId,
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

/** The same key for a review I sent, once it's come back and sits in my
 *  received list — so removing it there goes into the same dismissed list
 *  (DISMISSED_SHARES_KEY) as a program a trainer sent me. */
export function sentKeyOf(s: SentProgram): string {
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

/** Remove a group send in full, for any coach of that group — not only the one
 *  who sent it.
 *
 *  `removeSharedProgramBatch` scopes its cloud deletes to rows I sent, which is
 *  correct for "unsend mine" but would leave a co-trainer deleting only their
 *  own copy while the program stayed in the group for everyone else. Here the
 *  batch is resolved from the GROUP's rows and the database decides what may
 *  actually go (migration 0026: the sender, or any coach of the group).
 *
 *  THROWS when there was something to remove and none of it went — offline, or
 *  not allowed — so the screen can say so. It used to swallow that, and a
 *  refused Remove looked exactly like a button that did nothing. */
export async function removeGroupSharedProgramBatch(groupId: string, batchKey: string): Promise<void> {
  const existing = await loadLocalSharedPrograms();
  await setJSON(
    SHARED_PROGRAMS_KEY,
    existing.filter(s => !(s.groupId === groupId && batchKeyOf(s) === batchKey)),
  );
  let rows: SharedProgramRow[];
  try {
    rows = await fetchGroupShareRows(groupId);
  } catch (e) {
    warnShares("unsendGroupBatch", e);
    throw new Error("Couldn't reach the server to remove it.");
  }
  const batch = rows.filter(r => r.kind === "share" && `${r.sender_program_id}|${r.sent_key}` === batchKey);
  let removed = 0;
  for (const r of batch) {
    try {
      removed += await deleteShareRow(r.id);
    } catch (e) {
      warnShares("unsendGroupBatch", e);
    }
  }
  if (batch.length > 0 && removed === 0) {
    throw new Error("Only the trainer who sent it or someone who runs the group can remove it.");
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

/** Ids of connected trainers this account also coaches. See TRAINER_CLIENTS_KEY. */
export async function loadTrainerClientIds(): Promise<Set<string>> {
  return new Set(await getJSON<string[]>(TRAINER_CLIENTS_KEY, []));
}

/** Take a connected trainer on as a client (idempotent). */
export async function addTrainerAsClient(id: string): Promise<void> {
  const ids = await getJSON<string[]>(TRAINER_CLIENTS_KEY, []);
  if (ids.includes(id)) return;
  await setJSON(TRAINER_CLIENTS_KEY, [...ids, id]);
}

/** Stop coaching a connected trainer. The CONNECTION is untouched — they stay
 *  in My Trainers, you just no longer treat them as one of your clients. */
export async function removeTrainerAsClient(id: string): Promise<void> {
  const ids = await getJSON<string[]>(TRAINER_CLIENTS_KEY, []);
  await setJSON(TRAINER_CLIENTS_KEY, ids.filter(x => x !== id));
}

/** Legacy/mock entries only — read + delete. Nothing writes new ones: the
 *  trainers who coach a trainer are derived from live connections in
 *  utils/roster.ts, which merges whatever is still stored here underneath. */
export async function loadCoaches(): Promise<AssignedPT[]> {
  return getJSON<AssignedPT[]>(COACHES_KEY, []);
}
export async function removeCoach(id: string): Promise<void> {
  const existing = await loadCoaches();
  await setJSON(COACHES_KEY, existing.filter(c => c.id !== id));
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
 *  (recipient side, minus ones they dismissed), a gym user their SENT list.
 *
 *  Group reviews are excluded HERE because this query only reaches rows I'm a
 *  party to, and a group review is addressed to the group's owner — surfacing
 *  them from this call would put every group's backlog on the owner's hub and
 *  nobody else's. `loadMyGroupReviews` is the one that gathers them for a
 *  coach, through the group policy rather than through the address. The
 *  SENDER's side is unfiltered — a program they posted to a group is still a
 *  program they sent, and belongs on their own page. */
export async function loadSentPrograms(): Promise<SentProgram[]> {
  const local = await loadLocalSentPrograms();
  const cloud = await fetchCloudRowsSafe();
  if (!cloud) return local;
  const isPT = await viewerIsPT();
  const mapped = cloud.rows
    .filter(r => r.kind === "review")
    .filter(r => (isPT
      ? r.recipient_id === cloud.uid && !r.deleted_by_recipient_at && !r.group_id
      : r.sender_id === cloud.uid))
    .map(rowToSent);
  return [...mapped, ...local].sort(
    (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
  );
}

/**
 * One group's review queue, from the group's point of view rather than mine.
 *
 * A group review is a single row addressed to the group's owner, so
 * `loadSentPrograms` would only ever surface it to that one person. Every coach
 * of the group is entitled to it (migration 0028), and RLS is what decides
 * that, so the same call serves a trainer and returns nothing to a member.
 *
 * Completed reviews are dropped: the queue is what's still to do.
 */
export async function loadGroupReviewPrograms(groupId: string): Promise<SentProgram[]> {
  const uid = await getMyUid().catch(() => null);
  if (!uid) return [];
  let rows: SharedProgramRow[];
  try {
    rows = await fetchGroupShareRows(groupId);
  } catch (e) {
    warnShares("loadGroupReviews", e);
    return [];
  }
  return rows
    .filter(r => r.kind === "review" && !r.completed_at)
    .map(rowToSent);
}

/**
 * Every open group review waiting on ME as a coach, across all my groups.
 *
 * `loadGroupReviewPrograms` is one group's queue, read on that group's page.
 * This is the same items gathered for the trainer hub, so a coach sees a
 * member's request beside the 1:1 ones instead of having to open each group to
 * find out there's work in it.
 *
 * Reviews I SENT are dropped: RLS hands me my own rows as the sender, but a
 * program I asked someone else to look at is not one of my review jobs. It
 * stays visible to me in its group's queue, which is where I posted it.
 */
export async function loadMyGroupReviews(): Promise<SentProgram[]> {
  const uid = await getMyUid().catch(() => null);
  if (!uid) return [];
  let rows: SharedProgramRow[];
  try {
    rows = await fetchMyGroupReviewRows();
  } catch (e) {
    warnShares("loadMyGroupReviews", e);
    return [];
  }
  return rows.filter(r => r.sender_id !== uid).map(rowToSent);
}

/** Mark a group review dealt with (or reopen it). Coach-only — the RPC raises
 *  for anyone else rather than silently no-opping. */
export async function setGroupReviewDone(id: string, done: boolean): Promise<void> {
  await setGroupReviewCompleted(id, done);
}

/** Send a program for review. When the trainer is a REAL account (uuid),
 *  the entry rides the cloud table and THROWS on failure so callers can tell
 *  the user; a local/mock trainer keeps the on-device path.
 *
 *  `entry.groupId` makes it a GROUP review: `recipientId` is then the group's
 *  owner (the column is NOT NULL and they're the group's responsible party),
 *  but group_id is what decides which coaches can act on it. */
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
      groupId: entry.groupId,
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
      // Keep the LOCAL day ids — the recipient's logged sessions point at these,
      // so adopting the sender's would cut this program's own history loose.
      // They're then run through the same fork rule a local edit uses, so a day
      // the sender renamed AND re-stocked splits from its old sessions exactly
      // as it would if the recipient had made that edit themselves.
      dayIds: mergedDayIds(p, snap),
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

/**
 * A TRAINER takes a 1:1 review off their Programs Received.
 *
 * Stamps `deleted_by_recipient_at` on the row, which `loadSentPrograms`
 * already filters out of a trainer's inbox — so this is a hide on the
 * trainer's side, allowed by the update policy (sender or recipient). The
 * person who sent it still has their copy and still sees where it stands.
 *
 * Not for group reviews: those are the GROUP's queue, cleared for every coach
 * at once with setGroupReviewDone.
 */
export async function dismissReceivedReview(id: string): Promise<void> {
  if (isCloudShareId(id)) {
    try {
      await updateShareRow(id, { deleted_by_recipient_at: new Date().toISOString() });
    } catch (e) {
      warnShares("dismissReview", e);
      throw e instanceof Error ? e : new Error("Couldn't remove the program.");
    }
    return;
  }
  const existing = await loadLocalSentPrograms();
  await setJSON(SENT_PROGRAMS_KEY, existing.filter(s => s.id !== id));
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
 * assigned/other trainers, coaches, sent/shared programs, the saved copies of
 * the hubs and group pages (utils/pageSnapshot.ts), and the demo-seed flag.
 * Called on account delete / account switch (see lib/cloud.clearLocalUserData) so
 * one account's local data never leaks into the next account on this device. The
 * seed flag is cleared too, so a fresh account re-seeds its own demo clients
 * rather than inheriting the previous account's roster.
 */
export async function clearTrainerData(): Promise<void> {
  forgetSnapshots();
  const keys = await AsyncStorage.getAllKeys();
  const clientData = keys.filter(k => k.startsWith(CLIENT_DATA_PREFIX));
  await AsyncStorage.multiRemove([
    ...keys.filter(isPageSnapshotKey),
    CLIENTS_KEY,
    SHARED_PROGRAMS_KEY,
    CLOUD_SHARE_META_KEY,
    PT_SEEDED_KEY,
    ASSIGNED_PT_KEY,
    SENT_PROGRAMS_KEY,
    COACHES_KEY,
    OTHER_TRAINERS_KEY,
    TRAINER_CLIENTS_KEY,
    GROUP_FAVOURITES_KEY,
    ...clientData,
  ]);
}

export function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
