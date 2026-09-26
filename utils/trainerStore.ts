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
import { UNIT_KEY, stampWeightUnits, type WeightUnit } from "./units";
import { GROUP_FAVOURITES_KEY } from "../constants/groups";
import { BLOCKED_USERS_KEY, type BlockedUser } from "../constants/chat";
import { ACCOUNT_TYPE_KEY } from "../contexts/AccountTypeContext";
import { isCloudContactId } from "../lib/chat";
import { fetchClientTraining, fetchClientsActivePrograms } from "../lib/clientTraining";
import { detailsForSend } from "../lib/exerciseMedia";
import {
  deleteShareRow,
  fetchGroupShareRows,
  fetchMyGroupReviewRows,
  fetchMyShareRows,
  fetchShareRow,
  getMyUid,
  insertShareRows,
  returnSharedReview,
  setGroupReviewCompleted,
  setShareArchived,
  stampReviewApplied,
  stampShareAccepted,
  updateShareRow,
  type NewShareRow,
  type SharedProgramRow,
} from "../lib/shares";

const warnShares = (op: string, err: unknown) => {
  if (__DEV__) console.warn("[avenas] shares", op, err);
};

/**
 * One of this phone's program actions at a time. Accepting reads My Programs,
 * the share meta and the removed list, waits on the server, then writes what
 * it read back with its change; two at once (a double tap, Accept on two cards
 * before the first finished, or the same program's Accept on two screens)
 * each wrote back its own read, so the program was added twice or the other
 * change was lost. Same pattern as utils/achievementStore.ts.
 *
 * Never call one exclusive function from inside another: it would wait on
 * itself forever.
 */
let localChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = localChain.then(fn);
  localChain = run.catch(() => {});
  return run;
}

/**
 * Accept found nothing to accept: the program was deleted, taken back, or
 * archived after the card was drawn. The screen says so rather than claiming
 * it was added.
 */
export class ShareUnavailableError extends Error {
  constructor(message = "This program is no longer available. Your trainer may have removed or archived it.") {
    super(message);
    this.name = "ShareUnavailableError";
  }
}

/** What a program action says when the server couldn't be reached. Every
 *  action that needs the server throws this (or its own words) rather than
 *  carrying on as if it had worked. */
const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

/** A review the person who asked has withdrawn while the trainer had it open. */
const reviewWithdrawn = () =>
  new ShareUnavailableError("This program is no longer available. The person who asked may have withdrawn it.");

/** A new program's local id. Not `program_${Date.now()}` alone: two imports in
 *  the same millisecond (one accept straight after another) got the same id,
 *  and from then on every edit or delete of one hit both. */
const newLocalProgramId = () => `program_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
// is in the same list under returnedKeyOf(), since it shows among received
// ones; that key carries the send-back time, so a trainer's update shows
// again (older entries are a bare sentKeyOf(), see isReturnedDismissed). A recipient can't delete a share
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
  /** The unit they log in, so their numbers are shown in it (0036). Absent
   *  for mock clients and from a server without it: the trainer's own unit
   *  is used then, as before. */
  unit?: WeightUnit;
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
  /**
   * The sender (or a trainer of its group) archived this send (migration
   * 0037). Every load leaves archived rows out, for the people it was sent to
   * as much as for the sender, so it's only ever set on what the archive page
   * reads (loadTrainerArchive / loadGroupArchive). Restoring clears it, and the
   * send is back on every list it was on, except for a recipient who removed it
   * themselves (DISMISSED_SHARES_KEY), which is theirs and outlives a restore.
   */
  archivedAtISO?: string;
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
  /** The program, as THIS viewer should see it (see rowToSent): to the person
   *  who asked, what they sent until it's sent back, then what came back; to
   *  the trainer, their working copy. */
  programSnapshot?: SavedProgram;
  returnedAtISO?: string;
  trainerComments?: string;
  /** Stamped when the gym user accepts the trainer's edits — the local program in @avenas/programs has been overwritten. */
  appliedAtISO?: string;
  /** Stamped whenever the trainer saves edits in the program builder during review. Used to detect unsent updates after a Send Back. */
  lastEditedAtISO?: string;
  /** The trainer has builder edits the client hasn't been sent yet (a cloud
   *  row's draft_snapshot, migration 0034). Absent on local entries, which
   *  compare lastEditedAtISO with returnedAtISO instead. */
  unsentEdits?: boolean;
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
  /** The trainer (or, for a group review, a trainer of the group) archived it
   *  off Programs Received (migration 0037). The person who asked never sees
   *  this: it leaves the trainers' lists only, and the loads that serve the
   *  person who asked ignore it. */
  archivedAtISO?: string;
};

export const clientDataKey = (clientId: string) => `${CLIENT_DATA_PREFIX}${clientId}`;

// ─── cloud share plumbing ─────────────────────────────────────────────────────

/** Per-cloud-share local state the server doesn't need: which LOCAL program a
 *  recipient's accept materialised, so re-accepts update in place. */
export const CLOUD_SHARE_META_KEY = "@avenas/pt/cloud_share_meta";
type CloudShareMeta = Record<string, {
  /** A share: the local program its accept made or updated. */
  acceptedProgramId?: string;
  /** A review I asked for: the local program accepting what came back wrote
   *  to, when my original was gone and it made a new one. Separate from
   *  acceptedProgramId on purpose: deleting that program must not stamp the
   *  review "removed" (removeSharedProgramByLocalId), which would take it off
   *  the trainer's inbox. */
  appliedProgramId?: string;
}>;

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
    archivedAtISO: row.archived_at ?? undefined,
  };
}

/** Map a cloud 'review' row into the SentProgram shape. Serves both sides:
 *  the gym user (sender) sees their sent list, the trainer (recipient) their
 *  reviews inbox.
 *
 *  Which copy of the program each side sees (migration 0034): the person who
 *  asked sees what they sent until it's sent back, then what was sent back —
 *  never the trainer's edits in progress. The trainer sees their working copy:
 *  the draft, else what they last sent back, else the original. A row reviewed
 *  before 0034 keeps its working copy in returned_snapshot, which this order
 *  reads as the draft until it's sent back. The name follows the copy, since a
 *  rename in the builder is an edit like any other. */
function rowToSent(row: SharedProgramRow, uid: string): SentProgram {
  const mine = row.sender_id === uid;
  const snap = (mine
    ? (row.returned_at ? row.returned_snapshot ?? row.snapshot : row.snapshot)
    : row.draft_snapshot ?? row.returned_snapshot ?? row.snapshot) as unknown as SavedProgram | null;
  return {
    id: row.id,
    programId: row.sender_program_id,
    programName: snap?.name || row.program_name,
    sentAtISO: row.sent_key,
    status: row.returned_at ? "returned" : "sent",
    programSnapshot: snap ?? undefined,
    returnedAtISO: row.returned_at ?? undefined,
    trainerComments: row.trainer_comments ?? undefined,
    appliedAtISO: row.accepted_at ?? undefined,
    lastEditedAtISO: row.last_edited_at ?? undefined,
    unsentEdits: row.draft_snapshot != null,
    groupId: row.group_id ?? undefined,
    senderId: row.sender_id,
    completedAtISO: row.completed_at ?? undefined,
    archivedAtISO: row.archived_at ?? undefined,
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
      // Accepting a trainer's new version is asking for the program, so an
      // archived copy comes back to My Programs rather than updating unseen.
      archivedAt: undefined,
    } : p);
    await setJSON(PROGRAMS_KEY, updated);
    return existing.id;
  }
  const importedId = newLocalProgramId();
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
    archivedAt: undefined,
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
 *  'share' rows (both directions), newest first. Archived sends are left out in
 *  both directions (see SharedProgram.archivedAtISO); the archive page has its
 *  own read. */
export async function loadSharedPrograms(): Promise<SharedProgram[]> {
  // Anything I did offline that the server is still waiting to hear, first,
  // so what loads already includes it.
  await flushPendingShareUnlinks();
  const local = (await loadLocalSharedPrograms()).filter(s => !s.archivedAtISO);
  const cloud = await fetchCloudRowsSafe();
  if (!cloud) return withoutDismissed(local, null);
  const [isPT, meta] = await Promise.all([viewerIsPT(), loadShareMeta()]);
  const mapped = cloud.rows
    .filter(r => r.kind === "share" && !r.archived_at)
    .map(r => rowToShared(r, cloud.uid, isPT, meta));
  return withoutDismissed([...mapped, ...local], cloud.uid).then(list => list.sort(
    (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
  ));
}

/** Batch keys of programs sent to me that I've removed. See DISMISSED_SHARES_KEY. */
export async function loadDismissedShareKeys(): Promise<Set<string>> {
  return new Set(await getJSON<string[]>(DISMISSED_SHARES_KEY, []));
}

/** Remove a program someone sent me from my received lists, on this device.
 *  `key` is `dismissKeyOf(share)`, or `returnedKeyOf(review)` for a review sent
 *  back. Idempotent. */
export function dismissSharedBatch(key: string): Promise<void> {
  return exclusive(async () => {
    const keys = await getJSON<string[]>(DISMISSED_SHARES_KEY, []);
    if (keys.includes(key)) return;
    await setJSON(DISMISSED_SHARES_KEY, [...keys, key]);
  });
}

/**
 * What removing a received program hides: THIS version of that send, every
 * row of it. The key carries the trainer's last edit, so their Send Update
 * brings the card back with Accept on it, as `returnedKeyOf` does for a review
 * sent back. Keyed on the send alone, a removed card stayed hidden through
 * every update: the client could never take the new version, and the trainer
 * saw them as not having accepted it, for good.
 */
export function dismissKeyOf(s: SharedProgram): string {
  return `${batchKeyOf(s)}|${s.lastEditedAtISO ?? ""}`;
}

/**
 * Drop the sends I've removed, at the load layer, so every list, badge and
 * lookup agrees without each screen filtering for itself: the received cards,
 * a group's Programs Sent, and the group alert count (a program I removed is no
 * longer "waiting on me").
 *
 * Only ever drops a row I RECEIVED. My own sends are never filtered, whatever
 * is in the list — a trainer's outgoing history can't be hidden by accident.
 *
 * A bare batch key is how a removal was recorded before `dismissKeyOf`, and
 * still hides every version: showing those again would undo what the user
 * tidied away.
 *
 * Anything sent by someone I've blocked goes the same way (see
 * `loadBlockedSenderIds`), which is what keeps a block meaningful inside a
 * group: they stay a member, and their programs stop reaching my lists.
 */
async function withoutDismissed(list: SharedProgram[], myUid: string | null): Promise<SharedProgram[]> {
  const [dismissed, blocked] = await Promise.all([loadDismissedShareKeys(), loadBlockedSenderIds()]);
  if (dismissed.size === 0 && blocked.size === 0) return list;
  const removed = (s: SharedProgram) =>
    dismissed.has(dismissKeyOf(s)) || dismissed.has(batchKeyOf(s)) || (!!s.senderId && blocked.has(s.senderId));
  return list.filter(s => !(removed(s) && (!myUid || s.senderId !== myUid)));
}

/**
 * Everyone I've blocked, whose programs and review requests leave my lists
 * (utils/moderation.ts owns the list; it's read here directly because
 * moderation imports this file). Blocking severs the connection, but group
 * membership doesn't need one, so a blocked member of a group I don't own is
 * still in it (0040 only removes them from groups I own) and their rows still
 * come back from the server. Only ever applied to rows I RECEIVED.
 */
async function loadBlockedSenderIds(): Promise<Set<string>> {
  return new Set((await getJSON<BlockedUser[]>(BLOCKED_USERS_KEY, [])).map(b => b.id));
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
 *  Local mock entries are merged in the same way, matched on `groupId`.
 *  Archived sends are left out for everyone, coaches included: they're in the
 *  group's archive (loadGroupArchive). */
export async function loadGroupSharedPrograms(groupId: string): Promise<SharedProgram[]> {
  const local = (await loadLocalSharedPrograms()).filter(s => s.groupId === groupId && !s.archivedAtISO);
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
    .filter(r => r.kind === "share" && !r.archived_at)
    .map(r => rowToShared(r, uid, isPT, meta));
  return withoutDismissed([...mapped, ...local], uid).then(list => list.sort(
    (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
  ));
}

/** The unit this device's person reads weights in: the sender, for a send. */
async function senderUnit(): Promise<WeightUnit> {
  const saved = await AsyncStorage.getItem(UNIT_KEY).catch(() => null);
  return saved === "lbs" ? "lb" : "kg";
}

/**
 * A program on its way out, with every weight from before units were recorded
 * stamped in the sender's unit, which is how they were reading it, so the
 * recipient reads the same numbers (a prescribed weight shows in the unit it
 * was entered in: utils/units.ts prescribedWeight). Weights the builder
 * already tagged are left alone.
 */
function withSenderUnits(snapshot: SavedProgram, unit: WeightUnit): SavedProgram {
  const workouts = stampWeightUnits(snapshot.workouts ?? {}, unit);
  return workouts === snapshot.workouts ? snapshot : { ...snapshot, workouts };
}

/**
 * Everything a snapshot needs before it leaves this phone: weights in the
 * sender's unit, and every custom exercise carrying its details with its
 * photo and video uploaded, so the other end sees the exercise its author
 * made rather than a bare name (lib/exerciseMedia.ts detailsForSend). Every
 * write of a snapshot to another person goes through here.
 */
async function prepareSnapshot(snapshot: SavedProgram, unit: WeightUnit): Promise<SavedProgram> {
  return detailsForSend(withSenderUnits(snapshot, unit));
}

/** Send program shares. Entries addressed to REAL accounts (uuid clientId) go
 *  through the cloud table — and THROW when that fails (offline / not
 *  connected), so callers can tell the user instead of faking success. Mock
 *  roster entries keep the local path. */
export async function appendSharedPrograms(entries: SharedProgram[]): Promise<void> {
  const unit = await senderUnit();
  const cloudEntries = entries.filter(e => e.clientId !== "all" && isCloudContactId(e.clientId));
  const localEntries = entries
    .filter(e => !cloudEntries.includes(e))
    .map(e => (e.programSnapshot ? { ...e, programSnapshot: withSenderUnits(e.programSnapshot, unit) } : e));
  if (cloudEntries.length > 0) {
    const uid = await getMyUid();
    if (!uid) throw new Error("Sign in to send programs to connected accounts.");
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    // One send is one program to many people: prepare each distinct snapshot
    // once, so its media upload once, not once per recipient.
    const prepared = new Map<SavedProgram, SavedProgram>();
    const rows: NewShareRow[] = [];
    for (const e of cloudEntries) {
      const snapshot = e.programSnapshot ?? programs.find(p => p.id === e.programId);
      if (!snapshot) throw new Error(`Program "${e.programName}" was not found.`);
      if (!prepared.has(snapshot)) prepared.set(snapshot, await prepareSnapshot(snapshot, unit));
      rows.push({
        recipientId: e.clientId as string,
        kind: "share",
        senderProgramId: e.programId,
        programName: e.programName,
        snapshot: prepared.get(snapshot)!,
        sentKey: e.sentAtISO,
        groupId: e.groupId,
      });
    }
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

/** A review I sent, by the same programId|sentAtISO form as batchKeyOf. */
export function sentKeyOf(s: SentProgram): string {
  return `${s.programId}|${s.sentAtISO}`;
}

/**
 * The key that removing a review that's come back to me writes into the
 * dismissed list (DISMISSED_SHARES_KEY), the same list as a program a trainer
 * sent me.
 *
 * It carries the send-back time, so it hides THAT version: when the trainer
 * sends an update, returnedAtISO moves and the card comes back with Accept on
 * it. Keyed on sentKeyOf alone, a removed review stayed hidden through every
 * update, so the update never reached anyone who'd tidied their list.
 */
export function returnedKeyOf(s: SentProgram): string {
  return `${sentKeyOf(s)}|${s.returnedAtISO ?? ""}`;
}

/** Whether I've removed this returned review from my lists. A bare sentKeyOf
 *  still counts: that's how a removal was recorded before returnedKeyOf, and
 *  showing all of those again would undo what the user tidied away. */
export function isReturnedDismissed(s: SentProgram, dismissed: Set<string>): boolean {
  return dismissed.has(returnedKeyOf(s)) || dismissed.has(sentKeyOf(s));
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
export function acceptSharedProgramBatch(batchKey: string): Promise<string | null> {
  return exclusive(async () => {
    const acceptedAt = new Date().toISOString();
    const list = await loadLocalSharedPrograms();
    const localTargets = list.filter(s => batchKeyOf(s) === batchKey && !s.archivedAtISO);

    const cloud = await fetchCloudRowsSafe();
    const meta = await loadShareMeta();
    // An archived send is off every recipient's list, so accepting it from a
    // screen drawn before it was archived is refused like a deleted one.
    const cloudTargets = (cloud?.rows ?? []).filter(
      r => r.kind === "share" && r.recipient_id === cloud?.uid && !r.archived_at && rowBatchKey(r) === batchKey,
    );
    if (localTargets.length === 0 && cloudTargets.length === 0) {
      if (!cloud) throw new Error(UNREACHABLE);
      throw new ShareUnavailableError();
    }

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
    let importedId = await materialiseSnapshot(snap, priorId);

    if (localTargets.length > 0) {
      const next = list.map(s => batchKeyOf(s) === batchKey
        ? { ...s, acceptedAtISO: acceptedAt, acceptedProgramId: importedId, deletedByRecipientAtISO: undefined }
        : s
      );
      await setJSON(SHARED_PROGRAMS_KEY, next);
    }
    // Recorded before the stamp: if the stamp fails, a second Accept still
    // lands on this copy instead of adding another.
    for (const r of cloudTargets) meta[r.id] = { acceptedProgramId: importedId };
    await saveShareMeta(meta);
    for (const r of cloudTargets) {
      try {
        importedId = await stampAcceptedRow(r, importedId, acceptedAt);
      } catch (e) {
        // The copy is in My Programs; the card just shows unaccepted until the
        // next Accept, which updates the same copy.
        warnShares("acceptBatch", e);
      }
    }
    await dropPendingUnlinks(cloudTargets.map(r => r.id));
    return importedId;
  });
}

/**
 * Record my accept on a row, but only against the version I added. If the
 * sender saved an update between my reading the row and this write, that
 * version is taken over the same copy and stamped instead, so "accepted" (what
 * the trainer sees, and what clears my card) never sits on a version I don't
 * have. It used to stamp unconditionally, so accepting while the trainer saved
 * an update left the client on the old program with the trainer told they had
 * the new one. A row deleted meanwhile keeps what I took, as if I'd accepted
 * just before it went. Returns the local program id.
 */
async function stampAcceptedRow(row: SharedProgramRow, localId: string, acceptedAt: string): Promise<string> {
  let current = row;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await stampShareAccepted(current.id, current.last_edited_at ?? null, acceptedAt)) return localId;
    const fresh = await fetchShareRow(current.id);
    if (!fresh) return localId;
    localId = await materialiseSnapshot(fresh.snapshot as unknown as SavedProgram, localId);
    current = fresh;
  }
  throw new Error("The program kept changing while it was being added. Try again.");
}

/**
 * Unsend a whole batch (local entries + my outgoing cloud rows).
 *
 * THROWS when it didn't go (offline, or the connection dropped part way), so
 * the screen keeps the card and says so. It used to swallow that, and with no
 * signal the card vanished and came back on the next load.
 */
export async function removeSharedProgramBatch(batchKey: string): Promise<void> {
  const existing = await loadLocalSharedPrograms();
  const localHit = existing.some(s => batchKeyOf(s) === batchKey);
  if (localHit) await setJSON(SHARED_PROGRAMS_KEY, existing.filter(s => batchKeyOf(s) !== batchKey));
  const uid = await getMyUid().catch(() => null);
  if (!uid) return; // a mock-roster send, which lives on the device
  let rows: SharedProgramRow[];
  try {
    rows = await fetchMyShareRows(uid);
  } catch (e) {
    warnShares("unsendBatch", e);
    if (localHit) return;
    throw new Error(UNREACHABLE);
  }
  const mine = rows.filter(r => r.kind === "share" && r.sender_id === uid && rowBatchKey(r) === batchKey);
  let removed = 0;
  let unreachable = false;
  for (const r of mine) {
    try {
      removed += await deleteShareRow(r.id);
    } catch (e) {
      warnShares("unsendBatch", e);
      unreachable = true;
    }
  }
  if (unreachable) throw new Error(UNREACHABLE);
  if (mine.length > 0 && removed === 0 && await batchStillThere(undefined, batchKey)) {
    throw new Error("Only the trainer who sent it can remove it.");
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
    throw new Error(UNREACHABLE);
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
  if (batch.length > 0 && removed === 0 && await batchStillThere(groupId, batchKey)) {
    throw new Error("Only the trainer who sent it or someone who runs the group can remove it.");
  }
}

/**
 * Whether any row of a group send still exists, after a remove or archive of
 * it moved nothing. Nothing moving means "not allowed" only if the rows are
 * still there: when another trainer removed the send a moment earlier (or the
 * same trainer on another screen), it's already done, and saying "only the
 * trainer who sent it can" was wrong. Assumes it's there if it can't check.
 */
async function batchStillThere(groupId: string | undefined, batchKey: string): Promise<boolean> {
  try {
    const uid = await getMyUid();
    const rows = groupId ? await fetchGroupShareRows(groupId) : uid ? await fetchMyShareRows(uid) : [];
    return rows.some(r => r.kind === "share" && rowBatchKey(r) === batchKey);
  } catch {
    return true;
  }
}

/** Apply a patch to every entry in the batch. Used by the post-send edit flow. */
export async function updateSharedProgramBatch(batchKey: string, patch: Partial<SharedProgram>): Promise<void> {
  // Units are already stamped by the builder, which is the only caller with a
  // snapshot; the custom exercises it uses still have to travel with it.
  if (patch.programSnapshot) patch = { ...patch, programSnapshot: await detailsForSend(patch.programSnapshot) };
  const existing = await loadLocalSharedPrograms();
  const localHit = existing.some(s => batchKeyOf(s) === batchKey);
  if (localHit) await setJSON(SHARED_PROGRAMS_KEY, existing.map(s => batchKeyOf(s) === batchKey ? { ...s, ...patch } : s));
  const rowPatch: Parameters<typeof updateShareRow>[1] = {};
  if (patch.programSnapshot) rowPatch.snapshot = patch.programSnapshot as unknown as Record<string, unknown>;
  if (patch.programName) rowPatch.program_name = patch.programName;
  if (patch.lastEditedAtISO) rowPatch.last_edited_at = patch.lastEditedAtISO;
  // An explicit `acceptedAtISO: undefined` in the patch is the sender resetting
  // acceptance after an edit — mirror that as a NULL, not "leave unchanged".
  if ("acceptedAtISO" in patch) rowPatch.accepted_at = patch.acceptedAtISO ?? null;
  if (Object.keys(rowPatch).length === 0) return;
  // THROWS when the update didn't reach everyone, so the builder stays open
  // and says so. With no signal it used to close as if saved, and the clients
  // never got the new version.
  const cloud = await fetchCloudRowsSafe();
  if (!cloud) {
    if (localHit) return; // a mock-roster send, which lives on the device
    throw new Error(UNREACHABLE);
  }
  let unreachable = false;
  for (const r of cloud.rows.filter(r => r.kind === "share" && r.sender_id === cloud.uid && rowBatchKey(r) === batchKey)) {
    try {
      await updateShareRow(r.id, rowPatch);
    } catch (e) {
      warnShares("editBatch", e);
      unreachable = true;
    }
  }
  if (unreachable) throw new Error(UNREACHABLE);
}

/** Accept a shared program. On first accept the snapshot is appended to @avenas/programs.
 *  On a re-accept (trainer edited after the user previously accepted) the existing local program is updated in place. */
export function acceptSharedProgram(shareId: string): Promise<string | null> {
  return exclusive(async () => {
    if (isCloudShareId(shareId)) {
      let row: SharedProgramRow | null;
      try {
        row = await fetchShareRow(shareId);
      } catch (e) {
        warnShares("accept", e);
        throw new Error(UNREACHABLE);
      }
      // Gone, or archived after this screen was drawn (see acceptSharedProgramBatch).
      if (!row || row.archived_at) throw new ShareUnavailableError();
      const meta = await loadShareMeta();
      let importedId = await materialiseSnapshot(
        row.snapshot as unknown as SavedProgram,
        meta[row.id]?.acceptedProgramId,
      );
      meta[row.id] = { acceptedProgramId: importedId };
      await saveShareMeta(meta);
      try {
        importedId = await stampAcceptedRow(row, importedId, new Date().toISOString());
      } catch (e) {
        warnShares("acceptStamp", e); // local import done; re-accept updates the same copy
      }
      await dropPendingUnlinks([row.id]);
      return importedId;
    }

    const list = await loadLocalSharedPrograms();
    const target = list.find(s => s.id === shareId && !s.archivedAtISO);
    if (!target) throw new ShareUnavailableError();
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
  });
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
 *  program they sent, and belongs on their own page. That includes one their
 *  trainer archived: archiving tidies the trainer's inbox, never the asker's. */
export async function loadSentPrograms(): Promise<SentProgram[]> {
  const isPT = await viewerIsPT();
  const local = (await loadLocalSentPrograms()).filter(s => !(isPT && s.archivedAtISO));
  const [cloud, blocked] = await Promise.all([fetchCloudRowsSafe(), loadBlockedSenderIds()]);
  if (!cloud) return local;
  const mapped = cloud.rows
    .filter(r => r.kind === "review")
    .filter(r => (isPT
      ? r.recipient_id === cloud.uid && !r.deleted_by_recipient_at && !r.group_id && !r.archived_at && !blocked.has(r.sender_id)
      : r.sender_id === cloud.uid))
    .map(r => rowToSent(r, cloud.uid));
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
 * that, so the same call serves a trainer and, to a member, only their own.
 *
 * Other people's completed reviews are dropped: the queue is what's still to
 * do. MY OWN request is different, because it's mine rather than the queue's:
 * once it's been sent back it stays until I remove it myself (the same
 * dismissed list as my trainer page, applied here so the group page, its
 * lookups and the program view all agree), even after a coach clears it from
 * the queue. For a trainer who asked a group they're a plain member of, this
 * is the only place it ever shows, and a coach's Remove used to take it away
 * before they'd accepted it. One never sent back leaves with the queue:
 * there's nothing on it to act on.
 *
 * Someone else's review a trainer ARCHIVED is out of the queue too (it's in the
 * group's archive, loadGroupArchive). My own request never is: archiving is the
 * trainers tidying their list, and the person who asked doesn't see it.
 */
export async function loadGroupReviewPrograms(groupId: string): Promise<SentProgram[]> {
  const uid = await getMyUid().catch(() => null);
  if (!uid) return [];
  let rows: SharedProgramRow[];
  let dismissed: Set<string>;
  let blocked: Set<string>;
  try {
    [rows, dismissed, blocked] = await Promise.all([fetchGroupShareRows(groupId), loadDismissedShareKeys(), loadBlockedSenderIds()]);
  } catch (e) {
    warnShares("loadGroupReviews", e);
    return [];
  }
  return rows
    .filter(r => r.kind === "review")
    .map(r => rowToSent(r, uid))
    .filter(s => {
      if (s.senderId === uid && s.status === "returned") return !isReturnedDismissed(s, dismissed);
      if (s.completedAtISO) return false;
      if (s.senderId && s.senderId !== uid && blocked.has(s.senderId)) return false;
      return s.senderId === uid || !s.archivedAtISO;
    });
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
 *
 * Archived ones are dropped as well: they're in the Trainer tab's archive.
 */
export async function loadMyGroupReviews(): Promise<SentProgram[]> {
  const uid = await getMyUid().catch(() => null);
  if (!uid) return [];
  let rows: SharedProgramRow[];
  let blocked: Set<string>;
  try {
    [rows, blocked] = await Promise.all([fetchMyGroupReviewRows(), loadBlockedSenderIds()]);
  } catch (e) {
    warnShares("loadMyGroupReviews", e);
    return [];
  }
  return rows
    .filter(r => r.sender_id !== uid && !r.archived_at && !blocked.has(r.sender_id))
    .map(r => rowToSent(r, uid));
}

/** Mark a group review dealt with (or reopen it). Coach-only — the RPC raises
 *  for anyone else rather than silently no-opping. One withdrawn meanwhile is
 *  already out of the queue, so that isn't an error ("not a group program" is
 *  the RPC finding no row). */
export async function setGroupReviewDone(id: string, done: boolean): Promise<void> {
  try {
    await setGroupReviewCompleted(id, done);
  } catch (e) {
    if (done && !(await fetchShareRow(id).catch(() => true))) return;
    throw e;
  }
}

// ─── archive (migration 0037) ─────────────────────────────────────────────────
//
// The other choice beside Remove on a trainer's program cards: off the list,
// into the page's archive, and back again with Restore. What it reaches is the
// column's comment in 0037: an archived SEND is hidden from the people it went
// to as well; an archived REVIEW only leaves the trainers' lists. Every load
// above leaves archived rows out, and the archive page reads them here.

/** What an archive page lists: the sends and the reviews archived there. */
export type ProgramArchive = { sends: SharedProgram[]; reviews: SentProgram[] };

const rowBatchKey = (r: SharedProgramRow) => `${r.sender_program_id}|${r.sent_key}`;

/** Most recently archived first. */
function byArchivedDesc<T extends { archivedAtISO?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const x = a.archivedAtISO ?? "";
    const y = b.archivedAtISO ?? "";
    return x < y ? 1 : x > y ? -1 : 0;
  });
}

/**
 * Archive a whole send, or restore it: every row of the batch in one call, so
 * it leaves (and comes back to) every recipient's list at once.
 *
 * `groupId` for a group send: its rows are resolved from the GROUP, so a
 * trainer of it can archive a send another trainer made (the database decides,
 * as it does for Remove: the sender, or a trainer of the group). Without it,
 * my own sends.
 *
 * THROWS when it didn't happen (offline, not allowed, or a server without
 * 0037) so the screen can say so, rather than show a card that comes back on
 * the next load.
 */
export async function setSendBatchArchived(batchKey: string, archived: boolean, groupId?: string): Promise<void> {
  const stamp = archived ? new Date().toISOString() : undefined;
  const local = await loadLocalSharedPrograms();
  const inBatch = (s: SharedProgram) => batchKeyOf(s) === batchKey && (!groupId || s.groupId === groupId);
  const localHit = local.some(inBatch);
  if (localHit) await setJSON(SHARED_PROGRAMS_KEY, local.map(s => (inBatch(s) ? { ...s, archivedAtISO: stamp } : s)));

  const uid = await getMyUid().catch(() => null);
  if (!uid) {
    if (localHit) return;
    throw new Error("Sign in to archive programs.");
  }
  let rows: SharedProgramRow[];
  try {
    rows = groupId ? await fetchGroupShareRows(groupId) : await fetchMyShareRows(uid);
  } catch (e) {
    warnShares("archiveBatch", e);
    // A mock-roster send lives on the device and is already done.
    if (localHit) return;
    throw new Error(UNREACHABLE);
  }
  const ids = rows
    .filter(r => r.kind === "share" && rowBatchKey(r) === batchKey && (groupId ? true : r.sender_id === uid))
    .map(r => r.id);
  if (ids.length === 0) return;
  if ((await setShareArchived(ids, archived)) === 0 && await batchStillThere(groupId, batchKey)) {
    throw new Error("Only the trainer who sent it, or a trainer of its group, can do that.");
  }
}

/**
 * Archive a review off Programs Received, or restore it. A group review goes
 * for every trainer of the group, as Remove does; a 1:1 one is mine alone.
 * Either way the person who asked sees no change. THROWS when it didn't happen.
 */
export async function setReviewArchived(id: string, archived: boolean): Promise<void> {
  if (isCloudShareId(id)) {
    // Nothing moved and nothing there: withdrawn meanwhile, so it's already
    // off the list, which is all archiving (or its Delete) was for.
    if ((await setShareArchived([id], archived)) === 0 && await fetchShareRow(id).catch(() => true)) {
      throw new Error("Only the trainer it was sent to can do that.");
    }
    return;
  }
  const stamp = archived ? new Date().toISOString() : undefined;
  const existing = await loadLocalSentPrograms();
  await setJSON(SENT_PROGRAMS_KEY, existing.map(s => (s.id === id ? { ...s, archivedAtISO: stamp } : s)));
}

/**
 * The Trainer tab's archive: sends I made (direct and to groups, as its
 * Programs Sent lists them) and the reviews archived off its Programs Received
 * (1:1 ones addressed to me, and group reviews in groups I coach).
 *
 * Null when the server can't be reached, so the page can say that rather than
 * claim there's nothing archived.
 */
export async function loadTrainerArchive(): Promise<ProgramArchive | null> {
  const [localSends, localReviews] = await Promise.all([loadLocalSharedPrograms(), loadLocalSentPrograms()]);
  const local: ProgramArchive = {
    sends: localSends.filter(s => s.archivedAtISO && !s.receivedFromCoachId),
    reviews: localReviews.filter(s => s.archivedAtISO),
  };
  const uid = await getMyUid().catch(() => null);
  if (!uid) return local;
  try {
    const [rows, groupRows, isPT, meta] = await Promise.all([
      fetchMyShareRows(uid),
      fetchMyGroupReviewRows(),
      viewerIsPT(),
      loadShareMeta(),
    ]);
    const sends = rows
      .filter(r => r.kind === "share" && r.sender_id === uid && r.archived_at)
      .map(r => rowToShared(r, uid, isPT, meta));
    const reviews = [
      ...rows.filter(r => r.kind === "review" && r.recipient_id === uid && !r.group_id && !r.deleted_by_recipient_at && r.archived_at),
      ...groupRows.filter(r => r.sender_id !== uid && r.archived_at),
    ].map(r => rowToSent(r, uid));
    return {
      sends: byArchivedDesc([...sends, ...local.sends]),
      reviews: byArchivedDesc([...reviews, ...local.reviews]),
    };
  } catch (e) {
    warnShares("loadTrainerArchive", e);
    return null;
  }
}

/**
 * One group's archive, for its trainers: sends archived out of Group Programs,
 * whoever sent them, and other people's reviews archived out of its Programs
 * Received. A review a trainer has since Deleted (completed) isn't here: that
 * one is gone from the group for good. Null when the server can't be reached.
 */
export async function loadGroupArchive(groupId: string): Promise<ProgramArchive | null> {
  const local = (await loadLocalSharedPrograms()).filter(s => s.groupId === groupId && s.archivedAtISO);
  const uid = await getMyUid().catch(() => null);
  if (!uid) return { sends: local, reviews: [] };
  try {
    const [rows, isPT, meta] = await Promise.all([fetchGroupShareRows(groupId), viewerIsPT(), loadShareMeta()]);
    const sends = rows
      .filter(r => r.kind === "share" && r.archived_at)
      .map(r => rowToShared(r, uid, isPT, meta));
    const reviews = rows
      .filter(r => r.kind === "review" && r.archived_at && !r.completed_at && r.sender_id !== uid)
      .map(r => rowToSent(r, uid));
    return { sends: byArchivedDesc([...sends, ...local]), reviews: byArchivedDesc(reviews) };
  } catch (e) {
    warnShares("loadGroupArchive", e);
    return null;
  }
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
      // The client's own weights reach the trainer as the client typed them,
      // and their own custom exercises as they made them.
      snapshot: await prepareSnapshot(snapshot, await senderUnit()),
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
export function removeSharedProgramByLocalId(localProgramId: string): Promise<void> {
  return exclusive(() => unlinkSharesFromProgram(localProgramId));
}

async function unlinkSharesFromProgram(localProgramId: string): Promise<void> {
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
  // With no signal the copy still goes (it's mine, on this phone); the notice
  // waits and goes when it can. It used to be dropped, and the trainer's page
  // said "accepted" for good about a copy that no longer existed.
  const meta = await loadShareMeta();
  const affected = Object.entries(meta).filter(([, m]) => m.acceptedProgramId === localProgramId);
  if (affected.length === 0) return;
  const waiting: PendingUnlink[] = [];
  for (const [id] of affected) {
    delete meta[id];
    try {
      await updateShareRow(id, { deleted_by_recipient_at: now, accepted_at: null });
    } catch (e) {
      warnShares("hideByLocalId", e);
      waiting.push({ id, at: now });
    }
  }
  await saveShareMeta(meta);
  if (waiting.length > 0) {
    const pending = await getJSON<PendingUnlink[]>(PENDING_SHARE_UNLINKS_KEY, []);
    await setJSON(PENDING_SHARE_UNLINKS_KEY, [...pending.filter(p => !waiting.some(w => w.id === p.id)), ...waiting]);
  }
}

/**
 * "I deleted my copy" notices that couldn't reach the server at the time
 * (offline). Local-only: a row id and when it happened.
 */
export const PENDING_SHARE_UNLINKS_KEY = "@avenas/pt/pending_share_unlinks";
type PendingUnlink = { id: string; at: string };

/**
 * Send the waiting "deleted my copy" notices: before every load of my shares,
 * and when the phone comes back online (hooks/useOnline.ts). Stops at the
 * first that still can't go, and keeps it. A row that's gone just drops off
 * (the update changes nothing), and one I've accepted again was taken off the
 * list by that accept.
 */
export function flushPendingShareUnlinks(): Promise<void> {
  return exclusive(async () => {
    const pending = await getJSON<PendingUnlink[]>(PENDING_SHARE_UNLINKS_KEY, []);
    if (pending.length === 0) return;
    const left = [...pending];
    while (left.length > 0) {
      try {
        await updateShareRow(left[0].id, { deleted_by_recipient_at: left[0].at, accepted_at: null });
      } catch {
        break; // still offline: the rest wait too
      }
      left.shift();
    }
    await setJSON(PENDING_SHARE_UNLINKS_KEY, left);
  });
}

/** An accept supersedes a waiting "deleted my copy" for the same row. Called
 *  from inside the exclusive accepts, so not exclusive itself. */
async function dropPendingUnlinks(ids: string[]): Promise<void> {
  const pending = await getJSON<PendingUnlink[]>(PENDING_SHARE_UNLINKS_KEY, []);
  const left = pending.filter(p => !ids.includes(p.id));
  if (left.length !== pending.length) await setJSON(PENDING_SHARE_UNLINKS_KEY, left);
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

/**
 * Save the trainer's edits to a review. They go into the DRAFT (migration
 * 0034) and reach the client only when the trainer sends it back
 * (returnReview); the original the client sent is never touched.
 *
 * Deliberately can't send anything back: returned_at and the client's copy are
 * written only by returnReview, together, so the client can never be shown a
 * new send-back time on the previous version.
 */
export async function updateSentProgram(
  id: string,
  patch: Pick<Partial<SentProgram>, "programSnapshot" | "programName" | "lastEditedAtISO" | "trainerComments">,
): Promise<void> {
  if (isCloudShareId(id)) {
    const rowPatch: Parameters<typeof updateShareRow>[1] = {};
    // Not prepareSnapshot: a review's untagged weights are the CLIENT's, and the
    // builder stamps them with the client's unit. Only the custom exercises the
    // trainer added still need to travel with it.
    if (patch.programSnapshot) {
      rowPatch.draft_snapshot = await detailsForSend(patch.programSnapshot) as unknown as Record<string, unknown>;
    }
    if (patch.programName) rowPatch.program_name = patch.programName;
    if (patch.lastEditedAtISO) rowPatch.last_edited_at = patch.lastEditedAtISO;
    if (patch.trainerComments !== undefined) rowPatch.trainer_comments = patch.trainerComments ?? null;
    if (Object.keys(rowPatch).length === 0) return;
    let changed: number;
    try {
      changed = await updateShareRow(id, rowPatch);
    } catch (e) {
      warnShares("updateSent", e);
      throw e instanceof Error ? e : new Error("Couldn't update the program.");
    }
    // Nothing changed means the row's gone: withdrawn while the builder was
    // open. It used to "save" into nothing, and the edits were lost unseen.
    if (changed === 0) throw reviewWithdrawn();
    return;
  }
  const existing = await loadLocalSentPrograms();
  const next = existing.map(s => s.id === id ? { ...s, ...patch } : s);
  await setJSON(SENT_PROGRAMS_KEY, next);
}

/**
 * Send Back, and Send Update after it: the client gets the trainer's current
 * version and an Accept for it, even if they accepted an earlier one.
 *
 * A cloud review goes through the return_shared_review RPC, which copies the
 * draft into the client's copy, stamps the send-back time and clears their
 * accept in one step. Clearing the accept was the part that never happened
 * before: it was patched with `undefined`, which a column patch drops, so an
 * update never reached anyone who'd accepted the first version. THROWS so the
 * review screen can say it didn't go.
 *
 * A local (mock-roster) entry has one copy, already holding the edits.
 */
export async function returnReview(id: string): Promise<void> {
  if (isCloudShareId(id)) {
    try {
      await returnSharedReview(id);
    } catch (e) {
      // "not a review" is the RPC finding no row: withdrawn meanwhile. Said in
      // words rather than as the database's message.
      if (e instanceof Error && /not a review/.test(e.message)) throw reviewWithdrawn();
      warnShares("returnReview", e);
      throw e instanceof Error ? e : new Error("Couldn't send it back.");
    }
    return;
  }
  const existing = await loadLocalSentPrograms();
  const now = new Date().toISOString();
  await setJSON(SENT_PROGRAMS_KEY, existing.map(s => (s.id === id
    ? { ...s, status: "returned" as const, returnedAtISO: now, appliedAtISO: undefined }
    : s)));
}

/**
 * Gym user accepts a returned program: overwrite the original entry in
 * @avenas/programs with the trainer's edited snapshot.
 *
 * The accept is recorded only against the version applied (the row's
 * `returned_at`), for the same reason as `stampAcceptedRow`: a Send Update
 * landing mid-apply used to be marked accepted while the client kept the
 * version before it. Then the newer one is applied over the same program.
 */
export function applyReturnedProgram(id: string): Promise<void> {
  return exclusive(async () => {
    if (isCloudShareId(id)) {
      let row: SharedProgramRow | null;
      try {
        row = await fetchShareRow(id);
      } catch (e) {
        warnShares("applyReturned", e);
        throw new Error(UNREACHABLE);
      }
      if (!row || !row.returned_at) throw new Error("This review is no longer available.");
      // Over my original program; if I've deleted it, over the copy an earlier
      // accept of this review made in its place. That fallback is what stops
      // every Send Update I accept adding another copy.
      const meta = await loadShareMeta();
      let target = [row.sender_program_id, meta[row.id]?.appliedProgramId].filter((x): x is string => !!x);
      for (let attempt = 0; attempt < 3 && row && row.returned_at && !row.accepted_at; attempt++) {
        const written = await materialiseSnapshotOverExisting(
          (row.returned_snapshot ?? row.snapshot) as unknown as SavedProgram,
          target,
        );
        if (written !== row.sender_program_id && meta[row.id]?.appliedProgramId !== written) {
          meta[row.id] = { ...meta[row.id], appliedProgramId: written };
          await saveShareMeta(meta);
        }
        target = [written];
        try {
          if (await stampReviewApplied(row.id, row.returned_at)) return;
          row = await fetchShareRow(id);
        } catch (e) {
          warnShares("applyStamp", e); // applied locally; the card offers Accept again, over the same program
          return;
        }
      }
      return;
    }

    const list = await loadLocalSentPrograms();
    const target = list.find(s => s.id === id);
    if (!target || target.status !== "returned" || target.appliedAtISO) return;
    if (!target.programSnapshot) return;
    await materialiseSnapshotOverExisting(target.programSnapshot, [target.programId]);
    const nextList = list.map(s => s.id === id ? { ...s, appliedAtISO: new Date().toISOString() } : s);
    await setJSON(SENT_PROGRAMS_KEY, nextList);
  });
}

/** Overwrite the first of `candidates` still in @avenas/programs with `snap`
 *  (preserving id, status, currentWeek, startDate), or import fresh when none
 *  is. Returns the id written to. */
async function materialiseSnapshotOverExisting(snap: SavedProgram, candidates: string[]): Promise<string> {
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  const original = candidates.map(id => programs.find(p => p.id === id)).find(Boolean);
  const programId = original?.id ?? "";
  let nextPrograms: SavedProgram[];
  let writtenId = programId;
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
      // Taking the trainer's changes brings an archived original back.
      archivedAt: undefined,
    } : p);
  } else {
    const imported: SavedProgram = {
      ...snap,
      id: newLocalProgramId(),
      status: "created",
      currentWeek: 0,
      startDate: formatStoredDate(new Date()),
      cycleOffset: undefined,
      completedDate: undefined,
      archivedAt: undefined,
    };
    writtenId = imported.id;
    nextPrograms = [...programs, imported];
  }
  await setJSON(PROGRAMS_KEY, nextPrograms);
  return writtenId;
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

/** Gym user unsends a program they sent to the trainer. THROWS when it didn't
 *  reach the server: with no signal it used to leave their list while the
 *  trainer still had it. */
export async function removeSentProgram(id: string): Promise<void> {
  if (isCloudShareId(id)) {
    try {
      await deleteShareRow(id); // sender-only per RLS — this is the sender's flow
    } catch (e) {
      warnShares("unsendReview", e);
      throw new Error(UNREACHABLE);
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
export function removeSharedProgram(id: string): Promise<void> {
  return exclusive(async () => {
    if (isCloudShareId(id)) {
      // THROWS when it didn't reach the server, so the card stays and the
      // screen says so; it used to vanish and come back on the next load.
      try {
        const uid = await getMyUid();
        const row = await fetchShareRow(id);
        if (!row || !uid) return; // already gone
        if (row.sender_id === uid) {
          await deleteShareRow(id);
        } else {
          await updateShareRow(id, { deleted_by_recipient_at: new Date().toISOString(), accepted_at: null });
          const meta = await loadShareMeta();
          if (meta[id]) { delete meta[id]; await saveShareMeta(meta); }
        }
      } catch (e) {
        warnShares("remove", e);
        throw new Error(UNREACHABLE);
      }
      return;
    }
    const existing = await loadLocalSharedPrograms();
    await setJSON(SHARED_PROGRAMS_KEY, existing.filter(s => s.id !== id));
  });
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
    PENDING_SHARE_UNLINKS_KEY,
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
