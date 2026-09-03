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

import { fetchAllGroupMessages, fetchGroupReads, fetchMyGroups } from "../lib/groups";
import { getMyUid } from "../lib/chat";
import { countUnreadInThread } from "./chatStore";
import { loadBlockedIds, loadHiddenMessageIds } from "./moderation";
import { getJSON, setJSON } from "./storage";
import { GROUP_FAVOURITES_KEY, type Group, type GroupMessage } from "../constants/groups";

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
        lastText: last
          ? (last.mine ? `You: ${last.text}` : last.text)
          : "Tap to start the conversation",
        lastAtISO: last?.sentAtISO ?? "",
        unreadCount: countUnreadInThread(msgs, reads[group.id]),
      };
    });
  } catch (err) {
    if (__DEV__) console.warn("[avenas] load group rows", err);
    return [];
  }
}

/** Total unread across every group — the group half of the Messages badge. */
export function sumGroupUnread(rows: GroupChatRow[]): number {
  return rows.reduce((n, r) => n + r.unreadCount, 0);
}

// ─── favourites ──────────────────────────────────────────────────────────────

/** Group ids this account has starred. See GROUP_FAVOURITES_KEY. */
export async function loadFavouriteGroupIds(): Promise<Set<string>> {
  return new Set(await getJSON<string[]>(GROUP_FAVOURITES_KEY, []));
}

/** Star or unstar a group. Returns the new set so callers can update state
 *  without a second read. */
export async function toggleFavouriteGroup(groupId: string): Promise<Set<string>> {
  const ids = await getJSON<string[]>(GROUP_FAVOURITES_KEY, []);
  const next = ids.includes(groupId) ? ids.filter(id => id !== groupId) : [...ids, groupId];
  await setJSON(GROUP_FAVOURITES_KEY, next);
  return new Set(next);
}

/**
 * Starred groups first, everything else in the order it arrived.
 *
 * A stable partition rather than a sort: `fetchMyGroups` already returns newest
 * first, and that ordering should survive within each half.
 */
export function sortByFavourite<T extends { id: string }>(groups: T[], favourites: Set<string>): T[] {
  return [
    ...groups.filter(g => favourites.has(g.id)),
    ...groups.filter(g => !favourites.has(g.id)),
  ];
}
