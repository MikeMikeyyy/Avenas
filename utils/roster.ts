// utils/roster.ts
//
// Single source of truth for "who am I connected to, and in what role".
//
// A real accepted connection's ROLE comes from the counterpart's account type,
// never from which local list they happen to sit in:
//
//   viewer is a trainer (pt) → connected pt        = one of MY TRAINERS
//                            → connected gym user  = one of MY CLIENTS
//   viewer is a gym user     → connected pt        = one of MY TRAINERS
//                            → connected gym user  = not surfaced (no peer feature yet)
//
// Connecting is symmetric and role-blind (lib/connections.ts → migration 0006),
// so the split has to happen here at read time. Before this module existed the
// trainer-side "My Trainers" page read a local key that only the never-called
// connectTrainer() wrote, so a connected trainer could only ever surface as a
// client.
//
// Local roster entries (demo/mock people, legacy records) merge underneath the
// live ones; a real connection always wins on an id clash so the current name
// and photo are what render. Blocked ids are filtered out here so every caller
// gets the same answer.
//
// This lives outside trainerStore.ts on purpose: utils/moderation.ts already
// imports trainerStore, so reading loadBlockedIds() from there would be a cycle.

import { getMyConnections, type Connection } from "../lib/connections";
import { isCloudContactId } from "../lib/chat";
import { loadBlockedIds } from "./moderation";
import {
  addOtherTrainer,
  loadAssignedPT,
  loadClients,
  loadCoaches,
  loadOtherTrainers,
  makeInitials,
  saveAssignedPT,
  type AssignedPT,
  type Client,
} from "./trainerStore";

/** Everything a resolver needs from the server, or `null` for "couldn't ask".
 *  `null` is not the same as "no connections" — it means offline / signed out,
 *  and callers must fall back to the local roster instead of rendering empty. */
type LiveConnections = { accepted: Connection[]; ids: Set<string> } | null;

/** Blocked ids + the live connections already filtered by them, in one pass.
 *  A block always wins over a live connection: blockContact's server-side sever
 *  can fail offline, and the lingering accepted row must not resurface. */
async function fetchLive(): Promise<{ live: LiveConnections; blocked: Set<string> }> {
  let blocked: Set<string>;
  try {
    blocked = await loadBlockedIds();
  } catch {
    blocked = new Set(); // storage hiccup — better to show them than to hide the roster
  }
  let conns: Connection[];
  try {
    conns = await getMyConnections();
  } catch {
    return { live: null, blocked }; // offline / signed out — keep what's on the device
  }
  const accepted = conns.filter(c => c.status === "accepted" && !blocked.has(c.otherId));
  return { live: { accepted, ids: new Set(accepted.map(c => c.otherId)) }, blocked };
}

const toClient = (c: Connection): Client => ({
  id: c.otherId,
  name: c.name || "User",
  initials: makeInitials(c.name || "User"),
  photoUri: c.photoUri,
  lastActiveISO: c.lastActiveAt,
  streak: 0,
});

const toTrainer = (c: Connection): AssignedPT => ({
  id: c.otherId,
  name: c.name || "Trainer",
  initials: makeInitials(c.name || "Trainer"),
  photoUri: c.photoUri,
});

/**
 * A local snapshot of a REAL account is only trustworthy while that connection
 * is live. Once the server has answered and the id is not among the accepted
 * connections, the link is gone (removed here or from their device) and the
 * leftover local record must not resurrect them. Skipped entirely when the
 * server couldn't be reached, so going offline never empties a roster.
 */
const isStaleCloudEntry = (id: string, live: LiveConnections): boolean =>
  live !== null && isCloudContactId(id) && !live.ids.has(id);

export type TrainerRoster = {
  /** People this trainer coaches. */
  clients: Client[];
  /** Trainers who coach THIS trainer — the "My Trainers" page. */
  trainers: AssignedPT[];
};

/** The trainer-side roster, split by the counterpart's account type. */
export async function resolveTrainerRoster(): Promise<TrainerRoster> {
  const [localClients, localTrainers, { live, blocked }] = await Promise.all([
    loadClients(),
    loadCoaches(),
    fetchLive(),
  ]);

  const liveTrainers = (live?.accepted ?? []).filter(c => c.accountType === "pt").map(toTrainer);
  const liveClients = (live?.accepted ?? []).filter(c => c.accountType !== "pt").map(toClient);
  const trainerIds = new Set(liveTrainers.map(t => t.id));
  const clientIds = new Set(liveClients.map(c => c.id));

  const keepLocal = (id: string, takenBy: Set<string>) =>
    !takenBy.has(id) && !blocked.has(id) && !isStaleCloudEntry(id, live);

  return {
    // A connected trainer is never auto-listed as a client, even when a stale
    // local entry for them survives (older builds persisted the merged roster
    // straight back into CLIENTS_KEY). Coaching a fellow trainer is a
    // deliberate action, not a side effect of connecting.
    clients: [
      ...liveClients,
      ...localClients.filter(c => keepLocal(c.id, clientIds) && !trainerIds.has(c.id)),
    ],
    trainers: [
      ...liveTrainers,
      ...localTrainers.filter(t => keepLocal(t.id, trainerIds)),
    ],
  };
}

export type MyTrainers = {
  /** Every trainer this account is connected to, primary first. */
  all: AssignedPT[];
  /** The one MyPTHome features, or null when there are none. */
  primary: AssignedPT | null;
};

/** The gym-user-side trainer list. `@avenas/gym/assigned_pt` acts as a POINTER
 *  to the chosen primary; the list itself is derived, so a trainer connected on
 *  another device shows up here without any local write. */
export async function resolveMyTrainers(): Promise<MyTrainers> {
  const [saved, localOthers, { live, blocked }] = await Promise.all([
    loadAssignedPT(),
    loadOtherTrainers(),
    fetchLive(),
  ]);

  const all: AssignedPT[] = (live?.accepted ?? []).filter(c => c.accountType === "pt").map(toTrainer);
  const seen = new Set(all.map(t => t.id));
  for (const t of [...(saved ? [saved] : []), ...localOthers]) {
    if (seen.has(t.id) || blocked.has(t.id) || isStaleCloudEntry(t.id, live)) continue;
    seen.add(t.id);
    all.push(t);
  }

  // The saved pointer wins while it still resolves; otherwise the first
  // connected trainer takes the slot so the page is never headless.
  const primary = all.find(t => t.id === saved?.id) ?? all[0] ?? null;
  const ordered = primary ? [primary, ...all.filter(t => t.id !== primary.id)] : all;
  return { all: ordered, primary };
}

/** Make `pt` the primary trainer. The outgoing primary is only written to the
 *  "others" list when it's a LOCAL/mock entry — a real connection is re-derived
 *  from the server on the next resolve, and persisting a copy would resurrect
 *  them after the connection is severed from the other device. */
export async function setPrimaryTrainer(pt: AssignedPT): Promise<void> {
  const current = await loadAssignedPT();
  if (current && current.id !== pt.id && !isCloudContactId(current.id)) {
    await addOtherTrainer(current);
  }
  await saveAssignedPT(pt);
}
