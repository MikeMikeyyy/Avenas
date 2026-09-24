// utils/trainerHub.ts
//
// Everything the Trainer tab shows, loaded in one pass and kept between
// launches (utils/pageSnapshot.ts). PTHome and MyPTHome each read one of these.
//
// Why it's shaped like this: the tab used to start empty on every launch and
// run its reads one after another (the trainer hub made about six round trips
// in a row), drawing each section as its read landed, so the page assembled
// itself top to bottom over several seconds. Now:
//
//   - the reads that don't depend on each other run at the same time, so a
//     load costs about two round trips rather than six;
//   - a load arrives as ONE object, which the screen commits in one render, so
//     a refresh changes the page in place instead of growing it;
//   - the last result is saved, and the screen's first render is that copy.
//
// `fetch…Hub` joins a load that's already running (the startup prefetch, or
// the focus that follows it). A pull-to-refresh asks for a `fresh` one, which
// never joins: pulling always reads the server again, rather than handing back
// a load that started before you pulled.
//
// A section whose read FAILS keeps its last-known value instead of going
// empty, so opening the tab offline shows what was there rather than taking
// the groups away.

import { GYM_HUB_SNAPSHOT_KEY, hydrateSnapshot, peekSnapshot, PT_HUB_SNAPSHOT_KEY, saveSnapshot } from "./pageSnapshot";
import { resolveMyTrainers, resolveTrainerRoster } from "./roster";
import { seedMockClientsIfNeeded } from "./mockClientSeed";
import { loadFavouriteGroupIds, loadFavouriteMemberIds, loadGroupRows, sortByFavourite, type GroupChatRow } from "./groupStore";
import {
  backfillAcceptedProgramIds,
  batchKeyOf,
  loadClientActivePrograms,
  loadClients,
  loadDismissedShareKeys,
  loadMyGroupReviews,
  loadSentPrograms,
  loadSharedPrograms,
  migrateBroadcastShares,
  migrateCoachReceivedShares,
  type AssignedPT,
  type Client,
  type SentProgram,
  type SharedProgram,
} from "./trainerStore";
import { fetchAllGroupMemberships, fetchGroupMembers, fetchMyGroupInvites } from "../lib/groups";
import { getMyUid } from "../lib/chat";
import type { Group, GroupInvite } from "../constants/groups";
import type { SavedProgram } from "../constants/programs";
import type { AccountType } from "../contexts/AccountTypeContext";

const warn = (op: string, err: unknown) => {
  if (__DEV__) console.warn("[avenas]", op, err);
};

/** Which hub: the trainer's (PTHome) or a gym user's (MyPTHome). */
export type HubKind = "pt" | "gym";

const HUB_KEYS: Record<HubKind, string> = { pt: PT_HUB_SNAPSHOT_KEY, gym: GYM_HUB_SNAPSHOT_KEY };

// ── The trainer's hub (PTHome) ────────────────────────────────────────────────

/** Everything PTHome shows. Restored from disk, the program lists' snapshots
 *  hold only their cycle until a load replaces them (see `cycleOnly`). */
export type PTHubData = {
  /** People this trainer coaches: live connections over the local roster. */
  clients: Client[];
  /** 1:1 reviews addressed to me. */
  reviews: SentProgram[];
  /** Open reviews posted to a group I coach. Same shape, different route in:
   *  they're addressed to the group's owner, so they reach me through the group
   *  policy rather than through my own inbox. */
  groupReviews: SentProgram[];
  /** Every share row I can see, both directions. */
  sharedOut: SharedProgram[];
  /** clientId → the name of their active program. */
  activeProgramByClient: Record<string, string>;
  /** Starred groups first (sortByFavourite), newest first within each half. */
  groups: Group[];
  /** Groups another trainer has added me to and I haven't answered yet. */
  groupInvites: GroupInvite[];
  /** groupId → its other members' ids, so the send flow can offer "everyone in
   *  this group" without a second load. */
  groupMemberships: Record<string, string[]>;
  /** groupId → unread messages in its thread, one half of a group's badge. */
  unreadByGroup: Record<string, number>;
  /** Starred groups, oldest star first. */
  favouriteGroupIds: string[];
  /** Starred PEOPLE, oldest star first. Set from a client's own page or a group
   *  roster; the hub only reads it. */
  favouriteMemberIds: string[];
  /** Mine, for "is this share addressed to me". */
  myUid: string | null;
};

export const EMPTY_PT_HUB: PTHubData = {
  clients: [],
  reviews: [],
  groupReviews: [],
  sharedOut: [],
  activeProgramByClient: {},
  groups: [],
  groupInvites: [],
  groupMemberships: {},
  unreadByGroup: {},
  favouriteGroupIds: [],
  favouriteMemberIds: [],
  myUid: null,
};

/** A trainer's groups, every group's roster and the invites waiting on them:
 *  three reads in all, not one per group. Null when the read FAILED, which is
 *  not the same as having none. */
async function loadCoachGroups(): Promise<{ rows: GroupChatRow[]; memberships: Record<string, string[]>; invites: GroupInvite[] } | null> {
  try {
    const uid = await getMyUid();
    if (!uid) return { rows: [], memberships: {}, invites: [] };
    // A trainer gets invited to other trainers' groups the same way a gym user
    // does, so the invite list belongs on both hubs. loadGroupRows rather than
    // fetchMyGroups: it's the same groups with each thread's unread count
    // worked out, which is half of what the badge on a group card counts.
    const [rows, memberships, invites] = await Promise.all([
      loadGroupRows(),
      fetchAllGroupMemberships(uid),
      fetchMyGroupInvites(),
    ]);
    return { rows, memberships, invites };
  } catch (e) {
    warn("load groups", e);
    return null;
  }
}

async function loadPTHub(owner: string): Promise<PTHubData> {
  const prev = peekSnapshot<PTHubData>(HUB_KEYS.pt, owner);

  // The demo seed writes the local roster everything below starts from.
  const seeded = await seedMockClientsIfNeeded();

  // Live connections joined with the local roster, bucketed by the
  // counterpart's account type — a connected TRAINER belongs on the My
  // Trainers page, not in here. Blocked ids and stale local snapshots of
  // severed connections are filtered inside the resolver; offline it degrades
  // to the local roster. Each client's active program needs the ids, which
  // makes it the one read that waits on another.
  const clientsP = resolveTrainerRoster().then(r => r.clients);
  const activeP = clientsP.then(cs => loadClientActivePrograms(cs.map(c => c.id)));
  // The share migrations rewrite the local list loadSharedPrograms reads, so
  // they run ahead of it (all on-device, no network).
  const sharedP = (async () => {
    await migrateBroadcastShares(seeded.length > 0 ? seeded : await loadClients());
    await migrateCoachReceivedShares();
    return loadSharedPrograms();
  })();

  const [clients, activeProgramByClient, reviews, groupReviews, sharedOut, coachGroups, favGroups, favMembers, myUid] =
    await Promise.all([
      clientsP,
      activeP,
      loadSentPrograms(),
      loadMyGroupReviews(),
      sharedP,
      loadCoachGroups(),
      loadFavouriteGroupIds(),
      loadFavouriteMemberIds(),
      getMyUid().catch(() => null),
    ]);

  return {
    clients,
    reviews,
    groupReviews,
    sharedOut,
    activeProgramByClient,
    groups: coachGroups ? sortByFavourite(coachGroups.rows.map(r => r.group), favGroups) : prev?.groups ?? [],
    groupInvites: coachGroups ? coachGroups.invites : prev?.groupInvites ?? [],
    groupMemberships: coachGroups ? coachGroups.memberships : prev?.groupMemberships ?? {},
    unreadByGroup: coachGroups
      ? Object.fromEntries(coachGroups.rows.map(r => [r.group.id, r.unreadCount]))
      : prev?.unreadByGroup ?? {},
    favouriteGroupIds: [...favGroups],
    favouriteMemberIds: [...favMembers],
    myUid,
  };
}

// ── A gym user's hub (MyPTHome) ───────────────────────────────────────────────

/** The trainer who runs a group, as its card shows them. */
export type GroupOwner = { name: string; initials: string; photoUri?: string };

/** Everything MyPTHome shows. Restored from disk, the program lists' snapshots
 *  hold only their cycle until a load replaces them (see `cycleOnly`). */
export type GymHubData = {
  /** The featured trainer, or null when there isn't one. */
  pt: AssignedPT | null;
  /** Programs a trainer sent me, one card per send. */
  received: SharedProgram[];
  /** Programs I sent for review, waiting or come back. */
  sent: SentProgram[];
  /** What I've removed from my received list (see DISMISSED_SHARES_KEY). The
   *  shares are filtered at the load layer; this is for returned reviews, which
   *  come from my SENT list and aren't. */
  dismissedKeys: string[];
  /** Groups I've joined. */
  groups: GroupChatRow[];
  /** groupId → who runs it, for the line under each group's name. Absent for a
   *  group I own. */
  groupOwners: Record<string, GroupOwner>;
  /** Every share row I can see, BEFORE the per-send dedupe, for the per-group
   *  badge: a group send writes one row per member and only mine counts. */
  shares: SharedProgram[];
  /** Open group reviews I could pick up, for the group badges. Only ever
   *  non-empty when a group's owner has made me a trainer there. */
  groupReviewsToDo: SentProgram[];
  /** Groups I've been invited to and haven't answered. They come from their own
   *  RPC: until you accept, the group itself isn't readable (migration 0027). */
  groupInvites: GroupInvite[];
  myUid: string | null;
};

export const EMPTY_GYM_HUB: GymHubData = {
  pt: null,
  received: [],
  sent: [],
  dismissedKeys: [],
  groups: [],
  groupOwners: {},
  shares: [],
  groupReviewsToDo: [],
  groupInvites: [],
  myUid: null,
};

/** One card per send, from a trainer, for "From Your Trainer". */
function receivedFromTrainers(rows: SharedProgram[], myUid: string | null): SharedProgram[] {
  // Dedupe per batch: broadcasts expand into N per-client entries, but the gym
  // user represents all recipients on this device and should see one card per
  // batch.
  const seen = new Set<string>();
  const out: SharedProgram[] = [];
  for (const entry of rows) {
    // Skip trainer-to-trainer programs: they belong on the trainer-side My
    // Trainers page, not a gym user's My Trainer feed.
    if (entry.receivedFromCoachId) continue;
    // Skip programs I SENT. loadSharedPrograms returns both directions, and a
    // gym user who holds a group's trainer role can send a program into that
    // group, so without this their own send was listed here as if it had come
    // from their trainer. It belongs on the group's page, where it already is.
    // It also couldn't be removed from here: the dismissed list never hides a
    // row I sent, so it came back on the next load.
    if (myUid && entry.senderId === myUid) continue;
    const k = batchKeyOf(entry);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(entry);
  }
  return out;
}

/**
 * Who runs each group, for its card: a gym user can be in groups from several
 * trainers, and "Monday Strength" alone doesn't say whose it is.
 *
 * Almost always one of my connected trainers (being added needed an accepted
 * connection), so their name and photo come from the trainer list the hub
 * already loads. A group whose owner I've since disconnected from falls back to
 * that group's roster, which always includes the owner.
 */
async function resolveGroupOwners(groups: GroupChatRow[], trainers: AssignedPT[]): Promise<Record<string, GroupOwner>> {
  const out: Record<string, GroupOwner> = {};
  await Promise.all(groups.map(async ({ group }) => {
    if (group.isOwner) return;
    const known = trainers.find(t => t.id === group.ownerId);
    if (known) {
      out[group.id] = { name: known.name, initials: known.initials, photoUri: known.photoUri };
      return;
    }
    try {
      const owner = (await fetchGroupMembers(group.id)).find(m => m.isOwner);
      if (owner) out[group.id] = { name: owner.name, initials: owner.initials, photoUri: owner.photoUri };
    } catch (err) {
      // No owner line on that card rather than no card.
      if (__DEV__) console.warn("[avenas] group owner", group.id, err);
    }
  }));
  return out;
}

async function loadGymHub(owner: string): Promise<GymHubData> {
  const prev = peekSnapshot<GymHubData>(HUB_KEYS.gym, owner);

  // The featured trainer is whichever one is primary on /my-trainers; the
  // resolver honours that choice, falls back to the first connected trainer,
  // and only fills this slot with a PT-typed account. Blocked ids and
  // severed-but-still-local entries are filtered there too.
  const trainersP = resolveMyTrainers().catch(err => {
    warn("resolve trainers", err);
    return null;
  });

  const programsP = (async () => {
    try {
      // Backfill acceptedProgramId on any pre-existing accepted shares so the
      // "tap to view in /programs" navigation can find the local program by id.
      await backfillAcceptedProgramIds();
      await migrateBroadcastShares(await loadClients());
      const [shares, sent, groups, groupInvites, dismissed, myUid, groupReviewsToDo] = await Promise.all([
        loadSharedPrograms(),
        loadSentPrograms(),
        loadGroupRows(),
        fetchMyGroupInvites(),
        loadDismissedShareKeys(),
        getMyUid().catch(() => null),
        // Fails soft to [] (see loadMyGroupReviews): only the badge needs it.
        loadMyGroupReviews(),
      ]);
      return { shares, sent, groups, groupInvites, dismissed, myUid, groupReviewsToDo };
    } catch (err) {
      warn("load trainer hub", err);
      return null;
    }
  })();

  const [trainers, programs] = await Promise.all([trainersP, programsP]);
  const groups = programs ? programs.groups : prev?.groups ?? [];

  return {
    pt: trainers ? trainers.primary : prev?.pt ?? null,
    received: programs ? receivedFromTrainers(programs.shares, programs.myUid) : prev?.received ?? [],
    sent: programs ? programs.sent : prev?.sent ?? [],
    dismissedKeys: programs ? [...programs.dismissed] : prev?.dismissedKeys ?? [],
    groups,
    groupOwners: programs
      ? await resolveGroupOwners(groups, trainers?.all ?? [])
      : prev?.groupOwners ?? {},
    shares: programs ? programs.shares : prev?.shares ?? [],
    groupReviewsToDo: programs ? programs.groupReviewsToDo : prev?.groupReviewsToDo ?? [],
    groupInvites: programs ? programs.groupInvites : prev?.groupInvites ?? [],
    myUid: programs ? programs.myUid : prev?.myUid ?? null,
  };
}

// ── Loading, joining and saving ───────────────────────────────────────────────

/** Which hub an account type sees. */
export const hubKindFor = (accountType: AccountType): HubKind => (accountType === "pt" ? "pt" : "gym");

/**
 * What the copy on the DEVICE keeps of a program: its cycle, which is all the
 * hub's cards draw from it.
 *
 * Every share row carries the whole program (a group send writes one row per
 * member), so saving them whole would grow the copy with every send, and it's
 * read back on the way to the tab's first frame. So a hub restored from disk
 * has `programSnapshot` holding only `cyclePattern` until its load replaces it
 * a moment later. Nothing on the hub (or a group's page, utils/groupPage.ts)
 * reads more than that; a screen that needs the whole program (review,
 * program-view) loads it by id.
 */
export function cycleOnly<T extends { programSnapshot?: SavedProgram }>(entry: T): T {
  if (!entry.programSnapshot) return entry;
  return { ...entry, programSnapshot: { cyclePattern: entry.programSnapshot.cyclePattern } as SavedProgram };
}

const ptForDisk = (d: PTHubData): PTHubData => ({
  ...d,
  reviews: d.reviews.map(cycleOnly),
  groupReviews: d.groupReviews.map(cycleOnly),
  sharedOut: d.sharedOut.map(cycleOnly),
});

const gymForDisk = (d: GymHubData): GymHubData => ({
  ...d,
  received: d.received.map(cycleOnly),
  sent: d.sent.map(cycleOnly),
  shares: d.shares.map(cycleOnly),
  groupReviewsToDo: d.groupReviewsToDo.map(cycleOnly),
});

/** This launch's copy of the trainer hub, for a first render. */
export const peekPTHub = (owner: string) => peekSnapshot<PTHubData>(HUB_KEYS.pt, owner);
/** This launch's copy of the gym user's hub, for a first render. */
export const peekGymHub = (owner: string) => peekSnapshot<GymHubData>(HUB_KEYS.gym, owner);
/** Record what the trainer hub shows, so it opens on it next time. */
export const savePTHub = (owner: string, data: PTHubData) => saveSnapshot(HUB_KEYS.pt, owner, data, ptForDisk);
/** Record what the gym user's hub shows, so it opens on it next time. */
export const saveGymHub = (owner: string, data: GymHubData) => saveSnapshot(HUB_KEYS.gym, owner, data, gymForDisk);
/** Read a hub's saved copy off the device, so its first render can have it. */
export const hydrateTrainerHub = (kind: HubKind, owner: string) => hydrateSnapshot(HUB_KEYS[kind], owner);

/** The load currently running for each hub, so a second caller can join it. */
const inflight: Partial<Record<HubKind, { owner: string; promise: Promise<unknown> }>> = {};

function runLoad<T>(
  kind: HubKind,
  owner: string,
  fresh: boolean,
  load: (owner: string) => Promise<T>,
  save: (owner: string, data: T) => void,
  empty: T,
): Promise<T> {
  const running = inflight[kind];
  if (!fresh && running && running.owner === owner) return running.promise as Promise<T>;

  // Never rejects. A load that throws outright hands back the last-known copy
  // (or an empty page when there's none, so the screen settles on an honest
  // empty state rather than a blank one) and saves nothing.
  const promise = load(owner).then(
    data => {
      save(owner, data);
      return data;
    },
    err => {
      warn(`load ${kind} hub`, err);
      return peekSnapshot<T>(HUB_KEYS[kind], owner) ?? empty;
    },
  );
  const entry = { owner, promise };
  inflight[kind] = entry;
  void promise.then(() => {
    if (inflight[kind] === entry) delete inflight[kind];
  });
  return promise;
}

/** The trainer hub's data, from the server. Joins a load already running for
 *  this account unless `fresh`. Never rejects. */
export function fetchPTHub(owner: string, opts: { fresh?: boolean } = {}): Promise<PTHubData> {
  return runLoad("pt", owner, !!opts.fresh, loadPTHub, savePTHub, EMPTY_PT_HUB);
}

/** The gym user's hub data, from the server. Joins a load already running for
 *  this account unless `fresh`. Never rejects. */
export function fetchGymHub(owner: string, opts: { fresh?: boolean } = {}): Promise<GymHubData> {
  return runLoad("gym", owner, !!opts.fresh, loadGymHub, saveGymHub, EMPTY_GYM_HUB);
}

/**
 * Bring this account's hub up to date without it being open, so opening it
 * later shows current data straight away (hooks/useTrainerHubPrefetch.ts).
 * Reads the saved copy first, so a section that fails to load falls back to it
 * rather than to nothing.
 */
export async function prefetchTrainerHub(accountType: AccountType, owner: string): Promise<void> {
  const kind = hubKindFor(accountType);
  await hydrateTrainerHub(kind, owner);
  await (kind === "pt" ? fetchPTHub(owner) : fetchGymHub(owner));
}
