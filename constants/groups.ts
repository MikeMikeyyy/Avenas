// constants/groups.ts
//
// Client-group types for the Trainer hub (migration 0016). A group is a named
// set of a trainer's connected clients with its own shared chat thread that
// every member can post to — unlike a broadcast, which is N private 1:1
// messages that recipients cannot see each other in.
//
// Groups are cloud-only. There is no local/mock fallback the way chatStore and
// trainerStore keep one for the demo roster: a group has no meaning without the
// other accounts in it, so signed-out or offline simply means "no groups".

/** A group as the screens consume it. */
export type Group = {
  id: string;
  /** The trainer who created it. Only they can rename it or change membership. */
  ownerId: string;
  name: string;
  /** True when the current account owns this group (drives the manage affordances). */
  isOwner: boolean;
  /** Member count including the owner. */
  memberCount: number;
  createdAtISO: string;
};

/**
 * Standing inside a group. "owner" is derived from groups.owner_id rather than
 * stored, so it can never be taken away by a role change; the other two live in
 * group_members.role (migration 0022).
 */
export type GroupRole = "owner" | "trainer" | "member";

/** A member of a group, resolved through get_group_members(). */
export type GroupMember = {
  id: string;
  name: string;
  initials: string;
  photoUri?: string;
  isOwner: boolean;
  role: GroupRole;
};

/** Whether this person may send programs to the group. Owner and trainer only —
 *  mirrors can_coach_in_group(), which is what the database actually enforces. */
export const canCoachGroup = (role: GroupRole): boolean => role === "owner" || role === "trainer";

/** A message in a group thread. Extends the 1:1 ChatMessage shape with author
 *  identity, which a group needs and a 1:1 thread does not. */
export type GroupMessage = {
  id: string;
  /** true = sent by the current account. */
  mine: boolean;
  text: string;
  sentAtISO: string;
  senderId: string;
  /** Resolved from the group roster; falls back to "Someone" if a member left. */
  senderName: string;
  senderPhotoUri?: string;
};

/**
 * Group ids this account has starred, as a `string[]`.
 *
 * Local-only and never synced: it's a personal ordering preference, and every
 * member of a group stars it independently. Losing it on a reinstall is a
 * shrug, which is why it doesn't carry the weight of a synced column.
 */
export const GROUP_FAVOURITES_KEY = "@avenas/pt/group_favourites";

/** Prefix that marks a chat-list row / recipient as a GROUP rather than a
 *  person. Group ids and account ids are both uuids, so the id alone can't
 *  disambiguate them once they share a list. */
export const GROUP_ID_PREFIX = "group:";

export const toGroupKey = (groupId: string): string => `${GROUP_ID_PREFIX}${groupId}`;
export const isGroupKey = (key: string): boolean => key.startsWith(GROUP_ID_PREFIX);
export const groupIdFromKey = (key: string): string => key.slice(GROUP_ID_PREFIX.length);
