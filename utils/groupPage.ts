// utils/groupPage.ts
//
// Everything a group's page shows (app/trainer/group/[id]), loaded in one pass
// and kept between visits (utils/pageSnapshot.ts), the same way the Trainer
// tab's hubs are (utils/trainerHub.ts). The page is the same screen for a gym
// user and a trainer; what it shows each of them is decided on the page, from
// this data.
//
// A group's page used to show a spinner until its reads came back, every time
// it was opened, and then add each member's active program a moment later.
// Now it opens on the copy saved from the last visit and updates in place, in
// one render, members' programs included. The hub reads each of its groups'
// copies off the device ahead of time (`hydrateGroupPages`), so tapping a group
// has one ready. A group never opened on this device still waits for its first
// load.
//
// A load answers one of three ways, because the page must treat them
// differently: `loaded` (show it), `gone` (the group no longer exists or I'm no
// longer in it: say so and leave, and forget its copy), and `failed` (the
// server couldn't be reached: keep showing what's there).

import { dropSnapshot, GROUP_PAGE_SNAPSHOT_PREFIX, hydrateSnapshot, peekSnapshot, saveSnapshot } from "./pageSnapshot";
import { cycleOnly } from "./trainerHub";
import { loadFavouriteGroupIds, loadFavouriteMemberIds, loadGroupUnread } from "./groupStore";
import { resolveTrainerRoster } from "./roster";
import { loadBlockedIds } from "./moderation";
import {
  loadClientActivePrograms,
  loadGroupReviewPrograms,
  loadGroupSharedPrograms,
  type Client,
  type SentProgram,
  type SharedProgram,
} from "./trainerStore";
import { fetchGroup, fetchGroupMembers } from "../lib/groups";
import { getMyUid } from "../lib/chat";
import type { Group, GroupMember } from "../constants/groups";

/** Everything the group's page shows. Restored from disk, the program lists'
 *  snapshots hold only their cycle until a load replaces them (`cycleOnly`). */
export type GroupPageData = {
  /** Null only in EMPTY_GROUP_PAGE: a loaded page always has its group. */
  group: Group | null;
  /** Owner, then trainers, then by name (get_group_members' order). */
  members: GroupMember[];
  /** My clients who are in this group, for their cards and for "Open client
   *  page", which only ever applies to someone who is actually my client. */
  clients: Client[];
  /** clientId → the name of their active program. Only for people whose
   *  training this account may read; the server leaves everyone else out. */
  activeProgramByClient: Record<string, string>;
  /** Unread messages in the group's chat, the Group Chat button's badge. */
  unread: number;
  /** Whether I've starred this group. */
  isFavourite: boolean;
  /** Starred PEOPLE, oldest star first: the order they're pinned in. */
  favouriteMemberIds: string[];
  /** Programs sent to this group, one row per member per send. Already scoped
   *  to this group, in both directions: a group's noticeboard, not my inbox. */
  groupShares: SharedProgram[];
  /** The group's review queue: programs members posted here, still open, plus
   *  my own requests that have come back until I remove them (see
   *  loadGroupReviewPrograms). A member gets only their own, since RLS gives a
   *  group's reviews to its coaches. */
  groupReviews: SentProgram[];
  /** Members I've blocked. They stay in a group I don't own (0040 only takes
   *  them out of the blocker's own), so the roster says so: their messages and
   *  programs are hidden from me, and this is why. Optional because a copy
   *  saved before it existed has none. */
  blockedMemberIds?: string[];
  myUid: string | null;
};

export const EMPTY_GROUP_PAGE: GroupPageData = {
  group: null,
  members: [],
  clients: [],
  activeProgramByClient: {},
  unread: 0,
  isFavourite: false,
  favouriteMemberIds: [],
  groupShares: [],
  groupReviews: [],
  myUid: null,
};

export type GroupPageLoad =
  | { status: "loaded"; data: GroupPageData }
  /** The group no longer exists, or I'm no longer a member of it. */
  | { status: "gone" }
  /** Couldn't ask (offline, signed out): keep what the page already shows. */
  | { status: "failed" };

const keyFor = (groupId: string) => `${GROUP_PAGE_SNAPSHOT_PREFIX}${groupId}`;

const forDisk = (d: GroupPageData): GroupPageData => ({
  ...d,
  groupShares: d.groupShares.map(cycleOnly),
  groupReviews: d.groupReviews.map(cycleOnly),
});

/** This launch's copy of a group's page, for a first render. */
export const peekGroupPage = (owner: string, groupId: string) =>
  peekSnapshot<GroupPageData>(keyFor(groupId), owner);

/** Record what a group's page shows, so it opens on it next time. */
export const saveGroupPage = (owner: string, groupId: string, data: GroupPageData) =>
  saveSnapshot(keyFor(groupId), owner, data, forDisk);

/** Read a group page's saved copy off the device. */
export const hydrateGroupPage = (owner: string, groupId: string) =>
  hydrateSnapshot(keyFor(groupId), owner);

/** Read every listed group's saved copy off the device, so whichever one is
 *  tapped opens on it. Device reads only, never the network. */
export async function hydrateGroupPages(owner: string, groupIds: string[]): Promise<void> {
  await Promise.all(groupIds.map(id => hydrateGroupPage(owner, id)));
}

/** Forget a group's saved copy: I've left it, deleted it, or been taken out. */
export const dropGroupPage = (groupId: string) => dropSnapshot(keyFor(groupId));

/**
 * A group's page, from the server, in one pass. Every call is its own read
 * (arrival and pull-to-refresh alike). A `loaded` result is saved before it's
 * returned, so a load that outlives the visit still leaves the next one current.
 */
export async function loadGroupPage(owner: string, groupId: string): Promise<GroupPageLoad> {
  try {
    const uid = await getMyUid();
    if (!uid || !groupId) return { status: "failed" };

    // Each member's active program needs the member list, which makes it the
    // one read that waits on another. Everything else runs alongside.
    const membersP = fetchGroupMembers(groupId);
    const activeP = membersP.then(ms => loadClientActivePrograms(ms.map(m => m.id)));
    const [group, members, roster, unread, favGroups, favMembers, groupShares, groupReviews, activeProgramByClient, blocked] =
      await Promise.all([
        fetchGroup(uid, groupId),
        membersP,
        resolveTrainerRoster(),
        loadGroupUnread(groupId),
        loadFavouriteGroupIds(),
        loadFavouriteMemberIds(),
        loadGroupSharedPrograms(groupId),
        loadGroupReviewPrograms(groupId),
        activeP,
        loadBlockedIds(),
      ]);

    if (!group) {
      dropGroupPage(groupId);
      return { status: "gone" };
    }

    const memberIds = new Set(members.map(m => m.id));
    const data: GroupPageData = {
      group,
      members,
      clients: roster.clients.filter(c => memberIds.has(c.id)),
      activeProgramByClient,
      unread,
      isFavourite: favGroups.has(groupId),
      favouriteMemberIds: [...favMembers],
      groupShares,
      groupReviews,
      blockedMemberIds: members.filter(m => blocked.has(m.id)).map(m => m.id),
      myUid: uid,
    };
    saveGroupPage(owner, groupId, data);
    return { status: "loaded", data };
  } catch (err) {
    if (__DEV__) console.warn("[avenas] load group page", err);
    return { status: "failed" };
  }
}
