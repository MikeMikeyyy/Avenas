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
  /** The group photo, set by the owner (migration 0030). Absent = no photo, and
   *  every surface falls back to the people icon rather than a blank circle. */
  photoUri?: string;
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
  /** False while their invite is outstanding (migration 0027). They're listed
   *  anyway — an unanswered invite is something the owner needs to see, and a
   *  group program send goes to everyone invited. */
  accepted: boolean;
};

/** One face in a group's member stack (components/trainer/MemberStack.tsx): as
 *  much of a GroupMember as a face draws, so the Trainer tab's saved copy keeps
 *  only that for each group's card. */
export type MemberFace = Pick<GroupMember, "id" | "initials" | "photoUri">;

/** A roster's faces, in its order. */
export const memberFaces = (members: GroupMember[]): MemberFace[] =>
  members.map(m => ({ id: m.id, initials: m.initials, photoUri: m.photoUri }));

/**
 * A group someone has been added to but hasn't answered yet.
 *
 * Deliberately thin: this is everything a pending invitee may know about the
 * group, and it comes from get_my_group_invites() rather than from the group
 * row, so declining leaves them having seen nothing more than this.
 */
export type GroupInvite = {
  groupId: string;
  name: string;
  /** The group's own photo, so the invite shows what you're being invited to
   *  and not just who invited you. */
  photoUri?: string;
  ownerId: string;
  ownerName: string;
  ownerInitials: string;
  ownerPhotoUri?: string;
  /** Accepted members only. */
  memberCount: number;
  invitedAtISO: string;
};

/** Whether this person may send programs to the group. Owner and trainer only —
 *  mirrors can_coach_in_group(), which is what the database actually enforces. */
export const canCoachGroup = (role: GroupRole): boolean => role === "owner" || role === "trainer";

/**
 * The group limits (user decision, 2026-10-01), two separate ones per account
 * and one per group. The database enforces the same numbers (migration 0042,
 * keep them in step); the app checks first so the prompt comes before a form
 * is filled in. Never shown as a count: a limit only ever surfaces as its
 * prompt below.
 *
 * Groups an account has CREATED. Its own groups never count toward the next.
 */
export const MAX_OWNED_GROUPS = 3;

/** Groups someone ELSE created that an account is in. Pending invites don't
 *  count: an invite can always be sent, and waits until there's room. */
export const MAX_JOINED_GROUPS = 3;

/** People in one group: its owner, its members, and anyone invited who hasn't
 *  answered yet. An invite holds a place, so nobody who taps Accept is ever
 *  told the group is full. */
export const MAX_GROUP_MEMBERS = 10;

/** The prompt at the creating or joining limit. */
export const GROUP_LIMIT_TITLE = "Group limit reached";

/** The prompt's body, for creating a group or accepting an invite. Someone who
 *  runs a group is told those don't count toward joining; nobody else is,
 *  since a gym user has none. */
export function groupLimitMessage(action: "create" | "join", ownsAGroup: boolean): string {
  return action === "create"
    ? `You can create up to ${MAX_OWNED_GROUPS} groups. Delete one of yours to create a new one.`
    : `You can be in up to ${MAX_JOINED_GROUPS} groups at a time${ownsAGroup ? ", besides the ones you've created" : ""}. Leave one to accept this invite. It'll wait here until then.`;
}

/** The prompt when a group has no room for someone else. */
export const GROUP_FULL_TITLE = "Group is full";
export const GROUP_FULL_MESSAGE =
  `A group can have up to ${MAX_GROUP_MEMBERS} people, including you and anyone who hasn't accepted their invite yet. Untick someone to make room.`;

/** A message in a group thread. Extends the 1:1 ChatMessage shape with author
 *  identity, which a group needs and a 1:1 thread does not. */
export type GroupMessage = {
  id: string;
  /** true = sent by the current account. */
  mine: boolean;
  /** "" once deleted. */
  text: string;
  sentAtISO: string;
  /** Its sender deleted it (migration 0031). See ChatMessage.deleted. */
  deleted?: boolean;
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

/** Starred PEOPLE, by account id — the group roster's counterpart to
 *  GROUP_FAVOURITES_KEY. Both are `string[]` in the order they were starred,
 *  OLDEST FIRST, which is the order they're pinned to the top of a list in.
 *  Local-only preference, never synced. */
export const MEMBER_FAVOURITES_KEY = "@avenas/pt/member_favourites";

/** Prefix that marks a chat-list row / recipient as a GROUP rather than a
 *  person. Group ids and account ids are both uuids, so the id alone can't
 *  disambiguate them once they share a list. */
export const GROUP_ID_PREFIX = "group:";

export const toGroupKey = (groupId: string): string => `${GROUP_ID_PREFIX}${groupId}`;
export const isGroupKey = (key: string): boolean => key.startsWith(GROUP_ID_PREFIX);
export const groupIdFromKey = (key: string): string => key.slice(GROUP_ID_PREFIX.length);
