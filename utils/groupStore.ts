// utils/groupStore.ts
//
// The one place the conversations list and the unread badge both read group
// chats from, so the header total always equals the sum of the per-row badges
// (the same contract app/trainer/messages.tsx and hooks/useUnreadMessages.ts
// already keep for 1:1 threads).
//
// Cloud-only by design: a group has no meaning without the other accounts in
// it, so signed out / offline simply yields an empty list rather than falling
// back to a local blob the way chatStore does for the mock roster.

import { fetchAllGroupMessages, fetchGroupMessagesSince, fetchGroupReads, fetchMyGroups } from "../lib/groups";
import { getMyUid } from "../lib/chat";
import { countUnreadInThread, previewText } from "./chatStore";
import { loadBlockedIds, loadHiddenMessageIds } from "./moderation";
import { getJSON, setJSON } from "./storage";
import { GROUP_FAVOURITES_KEY, MEMBER_FAVOURITES_KEY, type Group, type GroupMessage } from "../constants/groups";

/** A group as the conversations list renders it. */
export type GroupChatRow = {
  group: Group;
  /** Preview text for the list ("You: …" for your own last message). */
  lastText: string;
  /** ISO time of the last message, or "" when the thread is empty. */
  lastAtISO: string;
  unreadCount: number;
};

/**
 * Every group the account belongs to, with preview + unread count.
 * Returns [] when signed out or the fetch fails — group chat degrades to
 * "not shown" rather than blocking the rest of the conversations list.
 */
export async function loadGroupRows(): Promise<GroupChatRow[]> {
  const uid = await getMyUid();
  if (!uid) return [];
  try {
    const [groups, byGroup, reads, hidden, blocked] = await Promise.all([
      fetchMyGroups(uid),
      fetchAllGroupMessages(uid),
      fetchGroupReads(uid),
      loadHiddenMessageIds(),
      loadBlockedIds(),
    ]);
    return groups.map(group => {
      // Blocking severs a CONNECTION; group membership is independent of that,
      // so the server still delivers a blocked member's rows. Filter here so a
      // block stays meaningful inside a group.
      const msgs = (byGroup[group.id] ?? []).filter(
        m => !hidden.has(m.id) && !blocked.has(m.senderId),
      );
      const last: GroupMessage | undefined = msgs[msgs.length - 1];
      return {
        group,
        lastText: previewText(last),
        lastAtISO: last?.sentAtISO ?? "",
        unreadCount: countUnreadInThread(msgs, reads[group.id]),
      };
    });
  } catch (err) {
    if (__DEV__) console.warn("[avenas] load group rows", err);
    return [];
  }
}

/**
 * Unread messages in ONE group — the group page's Group Chat badge.
 *
 * Reads just this group's messages since my read stamp instead of every
 * message in every group (loadGroupRows), which is both lighter and immune to
 * the API's row cap. Same rules as every other unread count: other people's
 * messages only, never a deleted one, never a hidden (reported) one or one
 * from someone I've blocked. 0 when signed out or on any failure — a badge
 * isn't worth an error.
 */
export async function loadGroupUnread(groupId: string): Promise<number> {
  const uid = await getMyUid();
  if (!uid) return 0;
  try {
    const [reads, hidden, blocked] = await Promise.all([
      fetchGroupReads(uid),
      loadHiddenMessageIds(),
      loadBlockedIds(),
    ]);
    const since = reads[groupId];
    const msgs = await fetchGroupMessagesSince(uid, groupId, since);
    return countUnreadInThread(msgs.filter(m => !hidden.has(m.id) && !blocked.has(m.senderId)), since);
  } catch (err) {
    if (__DEV__) console.warn("[avenas] load group unread", groupId, err);
    return 0;
  }
}

/** Total unread across every group — the group half of the Messages badge. */
export function sumGroupUnread(rows: GroupChatRow[]): number {
  return rows.reduce((n, r) => n + r.unreadCount, 0);
}

// ─── favourites ──────────────────────────────────────────────────────────────

// Both favourite lists are stored as `string[]` in the order things were
// starred, and every read keeps that order: a Set built from an array iterates
// in insertion order (ES2015, guaranteed), so the Set these return is an
// ORDERED set, oldest favourite first. `sortByFavourite` reads that order —
// don't rebuild either Set from something unordered.

/** Group ids this account has starred, oldest first. See GROUP_FAVOURITES_KEY. */
export async function loadFavouriteGroupIds(): Promise<Set<string>> {
  return new Set(await getJSON<string[]>(GROUP_FAVOURITES_KEY, []));
}

/** Star or unstar a group. Returns the new set so callers can update state
 *  without a second read. A new favourite is APPENDED, which is what puts it
 *  below the ones starred before it. */
export async function toggleFavouriteGroup(groupId: string): Promise<Set<string>> {
  const ids = await getJSON<string[]>(GROUP_FAVOURITES_KEY, []);
  const next = ids.includes(groupId) ? ids.filter(id => id !== groupId) : [...ids, groupId];
  await setJSON(GROUP_FAVOURITES_KEY, next);
  return new Set(next);
}

/** Account ids this person has starred, oldest first. See MEMBER_FAVOURITES_KEY. */
export async function loadFavouriteMemberIds(): Promise<Set<string>> {
  return new Set(await getJSON<string[]>(MEMBER_FAVOURITES_KEY, []));
}

/** Star or unstar a person. Same shape as the group one, and deliberately NOT
 *  scoped to a group: someone you've starred is someone you want at the top of
 *  whichever roster they appear in. */
export async function toggleFavouriteMember(memberId: string): Promise<Set<string>> {
  const ids = await getJSON<string[]>(MEMBER_FAVOURITES_KEY, []);
  const next = ids.includes(memberId) ? ids.filter(id => id !== memberId) : [...ids, memberId];
  await setJSON(MEMBER_FAVOURITES_KEY, next);
  return new Set(next);
}

/**
 * Starred items first, OLDEST favourite at the top; everything else in the
 * order it arrived.
 *
 * The unstarred half is a stable partition on purpose — `fetchMyGroups` returns
 * newest first and `get_group_members` returns owner, then trainers, then name,
 * and those orders should survive underneath the pinned ones. The starred half
 * is ranked by `favourites`' own iteration order rather than by the incoming
 * list, so a group starred months ago stays above one starred today however new
 * either of them is.
 */
export function sortByFavourite<T extends { id: string }>(items: T[], favourites: Set<string>): T[] {
  const rank = new Map<string, number>();
  let i = 0;
  for (const id of favourites) rank.set(id, i++);
  const starred = items
    .filter(x => rank.has(x.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...starred, ...items.filter(x => !rank.has(x.id))];
}
