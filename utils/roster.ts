// utils/roster.ts
//
// Single source of truth for "who am I connected to, and in what role".
//
// A real accepted connection's ROLE comes from the counterpart's account type,
// never from which local list they happen to sit in:
//
//   viewer is a trainer (pt) → connected pt        = MY TRAINERS, MY CLIENTS or
//                                                    both, as I've filed them
//                                                    (lib/connectionRoles.ts;
//                                                    not filed yet = trainer)
//                            → connected gym user  = one of MY CLIENTS, except
//                                                    a former trainer I haven't
//                                                    decided about (filed
//                                                    "trainer": in neither list,
//                                                    their note asks)
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
import { loadConnectionRoles, type ConnectionRole } from "../lib/connectionRoles";
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
  /** People this trainer coaches. Includes fellow trainers filed as a client
   *  (or both), flagged `isTrainer` so the UI can badge them. */
  clients: Client[];
  /** Trainers who coach THIS trainer — the "My Trainers" page. A trainer can
   *  appear in BOTH lists: they coach you and you coach them. */
  trainers: AssignedPT[];
  /** Which trainer-account connections are also (or only) clients, so the UI
   *  can show the right toggle. */
  trainerClientIds: Set<string>;
  /** How each connection is filed (lib/connectionRoles.ts). A trainer account
   *  with no entry hasn't been decided yet and reads as a trainer. */
  roles: Map<string, ConnectionRole>;
};

/** Which lists a connection belongs in, for a TRAINER viewing it. */
export function placeConnection(accountType: Connection["accountType"], role: ConnectionRole | undefined): { trainer: boolean; client: boolean } {
  if (accountType === "pt") {
    return { trainer: role !== "client", client: role === "client" || role === "both" };
  }
  // A gym account filed "trainer" is a former trainer switched to a gym account
  // whose note is still waiting on my choice (migration 0041): in neither list
  // until I keep them as a client or remove them.
  return { trainer: false, client: role !== "trainer" };
}

/** The trainer-side roster, split by the counterpart's account type and by how
 *  I've filed each trainer. */
export async function resolveTrainerRoster(): Promise<TrainerRoster> {
  const [localClients, localTrainers, roles, { live, blocked }] = await Promise.all([
    loadClients(),
    loadCoaches(),
    loadConnectionRoles(),
    fetchLive(),
  ]);

  const accepted = live?.accepted ?? [];
  const placed = accepted.map(c => ({ c, ...placeConnection(c.accountType, roles.get(c.otherId)) }));
  const liveTrainers = placed.filter(p => p.trainer).map(p => toTrainer(p.c));
  // Trainer accounts I coach are flagged isTrainer so cards and pickers can
  // badge them, and so removing them is distinguishable from an ordinary client.
  const liveClients: Client[] = placed
    .filter(p => p.client)
    .map(p => (p.c.accountType === "pt" ? { ...toClient(p.c), isTrainer: true } : toClient(p.c)));
  const trainerClientIds = new Set(liveClients.filter(c => c.isTrainer).map(c => c.id));

  // A real connection's placement is decided above, hidden or not; the local
  // roster can't put someone back in a list the live answer left them out of.
  // Offline (live null) it's all there is.
  const keepLocal = (id: string, seen: Set<string>) =>
    !seen.has(id) && !(live?.ids.has(id)) && !blocked.has(id) && !isStaleCloudEntry(id, live);
  const clientIds = new Set(liveClients.map(c => c.id));
  const trainerIds = new Set(liveTrainers.map(t => t.id));

  return {
    clients: [
      ...liveClients,
      ...localClients.filter(c => keepLocal(c.id, clientIds) && !trainerIds.has(c.id)),
    ],
    trainers: [
      ...liveTrainers,
      ...localTrainers.filter(t => keepLocal(t.id, trainerIds)),
    ],
    trainerClientIds,
    roles,
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
