// Client wrappers for client groups + group chat (migration 0016). RN-only
// (imports the Supabase client).
//
// Mirrors lib/chat.ts for the 1:1 case, with one structural difference: a group
// thread has many authors, so every read resolves the member roster and stamps
// each message with its sender's name + photo. Members are generally NOT
// connected to each other, so that resolution has to go through the
// get_group_members() RPC — profiles stay owner-only under RLS.
//
// Reads fail soft (callers fall back to an empty list); WRITES throw so the UI
// can tell the user instead of pretending a message landed.

import { supabase } from "./supabase";
import { makeInitials } from "../utils/trainerStore";
import type {
  GroupInviteRow,
  GroupMemberWithProfile,
  GroupMessageRow,
  GroupReadRow,
  GroupRow,
} from "./database.types";
import type { Group, GroupInvite, GroupMember, GroupMessage } from "../constants/groups";

/** Every group the signed-in account belongs to (owned or joined), with its
 *  member count. Newest first. */
export async function fetchMyGroups(uid: string): Promise<Group[]> {
  // group_members is readable for groups you're in, and groups_select covers
  // the join, so one nested select gets both without an extra round trip.
  const { data, error } = await supabase
    .from("groups")
    .select("*, group_members(user_id)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load groups: ${error.message}`);
  type Row = GroupRow & { group_members: { user_id: string }[] | null };
  return ((data as Row[] | null) ?? []).map(r => ({
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    isOwner: r.owner_id === uid,
    photoUri: r.avatar_url ?? undefined,
    memberCount: r.group_members?.length ?? 0,
    createdAtISO: r.created_at,
  }));
}

/** One group, or null when it's gone / the caller isn't a member. */
export async function fetchGroup(uid: string, groupId: string): Promise<Group | null> {
  const { data, error } = await supabase
    .from("groups")
    .select("*, group_members(user_id)")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw new Error(`load group: ${error.message}`);
  if (!data) return null;
  const r = data as GroupRow & { group_members: { user_id: string }[] | null };
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    isOwner: r.owner_id === uid,
    photoUri: r.avatar_url ?? undefined,
    memberCount: r.group_members?.length ?? 0,
    createdAtISO: r.created_at,
  };
}

/** The group's roster with safe display fields, owner first. */
export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase.rpc("get_group_members", { p_group: groupId });
  if (error) throw new Error(`load group members: ${error.message}`);
  return ((data as GroupMemberWithProfile[] | null) ?? []).map(r => ({
    id: r.user_id,
    name: r.name || "User",
    initials: makeInitials(r.name || "User"),
    photoUri: r.avatar_url ?? undefined,
    isOwner: r.is_owner,
    // Ownership outranks the stored role: the owner's own row still says
    // "member", because their standing comes from groups.owner_id.
    role: r.is_owner ? "owner" : r.role === "trainer" ? "trainer" : "member",
    // Absent on a roster read that predates 0027; those rows are all accepted.
    accepted: r.accepted !== false,
  }));
}

/** Groups I've been added to but haven't answered yet.
 *
 *  Fails soft: an invite that can't be loaded shouldn't take the hub down with
 *  it, and it'll be there on the next focus. */
export async function fetchMyGroupInvites(): Promise<GroupInvite[]> {
  const { data, error } = await supabase.rpc("get_my_group_invites");
  if (error) {
    if (__DEV__) console.warn("[avenas] load group invites", error.message);
    return [];
  }
  return ((data as GroupInviteRow[] | null) ?? []).map(r => ({
    groupId: r.group_id,
    name: r.name,
    photoUri: r.avatar_url ?? undefined,
    ownerId: r.owner_id,
    ownerName: r.owner_name || "Your trainer",
    ownerInitials: makeInitials(r.owner_name || "Your trainer"),
    ownerPhotoUri: r.owner_avatar ?? undefined,
    memberCount: r.member_count,
    invitedAtISO: r.invited_at,
  }));
}

/** The database's refusal when the account is already in MAX_GROUPS groups
 *  (migration 0035). createGroup and acceptGroupInvite throw it as their error;
 *  screens show the limit prompt for it rather than the raw message. */
export const isGroupLimitError = (e: unknown): boolean =>
  e instanceof Error && e.message.includes("group_limit_reached");

/** Join a group I was invited to. Idempotent in the RPC, so a double tap on a
 *  slow connection is not an error. */
export async function acceptGroupInvite(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("accept_group_invite", { p_group: groupId });
  if (error) throw new Error(error.message);
}

/** Turn down an invite. Refuses to touch an ACCEPTED membership — leaving a
 *  group you're in is `leaveGroup`, a different action with a different prompt. */
export async function declineGroupInvite(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("decline_group_invite", { p_group: groupId });
  if (error) throw new Error(error.message);
}

/** Promote a member to trainer, or demote back. Owner only — enforced in the
 *  RPC, which raises rather than silently no-opping for anyone else. */
export async function setGroupMemberRole(
  groupId: string,
  userId: string,
  role: "member" | "trainer",
): Promise<void> {
  const { error } = await supabase.rpc("set_group_member_role", {
    p_group: groupId,
    p_user: userId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

/** groupId → member ids, for every group the caller belongs to. One round trip
 *  (RLS already scopes group_members to my groups), which is what makes it cheap
 *  enough to feed the program-send recipient picker. Excludes the caller, since
 *  a trainer never sends a program to themselves. */
export async function fetchAllGroupMemberships(uid: string): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from("group_members").select("group_id, user_id");
  if (error) throw new Error(`load group members: ${error.message}`);
  const out: Record<string, string[]> = {};
  for (const r of (data as { group_id: string; user_id: string }[] | null) ?? []) {
    if (r.user_id === uid) continue;
    (out[r.group_id] ??= []).push(r.user_id);
  }
  return out;
}

/** Create a group and seed its members in one atomic call. Returns the new id. */
export async function createGroup(name: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc("create_group", {
    p_name: name.trim(),
    p_member_ids: memberIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const { error } = await supabase.from("groups").update({ name: name.trim() }).eq("id", groupId);
  if (error) throw new Error(`rename group: ${error.message}`);
}

/**
 * Upload (or replace) a group's photo and return its public URL (migration
 * 0030). Owner-only at the database.
 *
 * Same shape as lib/cloud.ts:uploadAvatar, one bucket over: the object lives at
 * "<groupId>/avatar" so a replacement overwrites the last one instead of
 * orphaning it, and the returned URL carries a cache-buster so expo-image
 * refetches rather than showing the copy it already has under that name.
 */
export async function uploadGroupAvatar(groupId: string, localUri: string, mimeType?: string): Promise<string> {
  const bytes = await fetch(localUri).then(r => r.arrayBuffer());
  const path = `${groupId}/avatar`;
  const { error } = await supabase.storage
    .from("group-avatars")
    .upload(path, bytes, { contentType: mimeType ?? "image/jpeg", upsert: true });
  if (error) throw new Error(`upload group photo: ${error.message}`);
  const { data } = supabase.storage.from("group-avatars").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

/** Point the group row at a photo, or clear it. The stored object is left in
 *  place on a clear: the row is what every screen reads, and a delete that
 *  failed would leave the group pointing at nothing. */
export async function setGroupAvatar(groupId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from("groups").update({ avatar_url: url }).eq("id", groupId);
  if (error) throw new Error(`save group photo: ${error.message}`);
}

/** Replace the roster wholesale (owner only). The owner's own membership is
 *  preserved server-side regardless of what's passed. */
export async function setGroupMembers(groupId: string, memberIds: string[]): Promise<void> {
  const { error } = await supabase.rpc("set_group_members", {
    p_group: groupId,
    p_member_ids: memberIds,
  });
  if (error) throw new Error(error.message);
}

/** Delete the group for everyone (owner only). Messages cascade. */
export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from("groups").delete().eq("id", groupId);
  if (error) throw new Error(`delete group: ${error.message}`);
}

/** Leave a group (any member; the owner should delete instead). */
export async function leaveGroup(uid: string, groupId: string): Promise<void> {
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", uid);
  if (error) throw new Error(`leave group: ${error.message}`);
}

const toGroupMessage = (
  r: GroupMessageRow,
  uid: string,
  byId: Map<string, GroupMember>,
): GroupMessage => {
  const author = byId.get(r.sender_id);
  return {
    id: r.id,
    mine: r.sender_id === uid,
    text: r.deleted_at ? "" : r.body,
    sentAtISO: r.created_at,
    deleted: !!r.deleted_at,
    senderId: r.sender_id,
    // A member who has since left the group is no longer in the roster, but
    // their messages stay in the thread — don't render a blank author.
    senderName: author?.name ?? "Someone",
    senderPhotoUri: author?.photoUri,
  };
};

/** One group thread, oldest → newest, with authorship resolved. Pass the roster
 *  when the caller already has it to skip the extra round trip. */
export async function fetchGroupThread(
  uid: string,
  groupId: string,
  members?: GroupMember[],
): Promise<GroupMessage[]> {
  const roster = members ?? (await fetchGroupMembers(groupId));
  const byId = new Map(roster.map(m => [m.id, m]));
  // Newest first, then reversed: the API returns at most 1000 rows, and asking
  // oldest-first meant a thread past that length lost its NEWEST messages.
  const { data, error } = await supabase
    .from("group_messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load group thread: ${error.message}`);
  return ((data as GroupMessageRow[] | null) ?? []).map(r => toGroupMessage(r, uid, byId)).reverse();
}

/** Every group message the caller can see, bucketed by group id, oldest → newest.
 *  One round trip (RLS already scopes it to my groups), and deliberately WITHOUT
 *  author resolution — the conversations list only needs previews and unread
 *  counts, and resolving names would cost one get_group_members call per group.
 *
 *  Fetched newest first: the API caps a read at 1000 rows, and oldest-first
 *  meant that once all my groups together passed that, the rows it dropped were
 *  the newest ones — exactly the ones previews and unread badges are about, so
 *  every group chat badge sat at 0 and every preview went stale. Now a cap can
 *  only cost old history nothing here reads. */
export async function fetchAllGroupMessages(uid: string): Promise<Record<string, GroupMessage[]>> {
  const { data, error } = await supabase
    .from("group_messages")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load group messages: ${error.message}`);
  const out: Record<string, GroupMessage[]> = {};
  const empty = new Map<string, GroupMember>();
  for (const r of (data as GroupMessageRow[] | null) ?? []) {
    (out[r.group_id] ??= []).push(toGroupMessage(r, uid, empty));
  }
  for (const id of Object.keys(out)) out[id].reverse(); // → oldest → newest
  return out;
}

/**
 * Other people's messages in ONE group since `sinceISO` (all of them when I've
 * never opened the thread), newest first. What a single group's unread badge
 * needs and nothing more — rather than every message in every group, which is
 * what the group page used to read to count one badge.
 *
 * Capped at 50: the badge reads "9+" past nine, so a larger exact count would
 * never be shown.
 */
export async function fetchGroupMessagesSince(uid: string, groupId: string, sinceISO?: string): Promise<GroupMessage[]> {
  let q = supabase
    .from("group_messages")
    .select("*")
    .eq("group_id", groupId)
    .neq("sender_id", uid);
  if (sinceISO) q = q.gt("created_at", sinceISO);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(`load group unread: ${error.message}`);
  const empty = new Map<string, GroupMember>();
  return ((data as GroupMessageRow[] | null) ?? []).map(r => toGroupMessage(r, uid, empty));
}

/** Post to a group. Throws when rejected (offline, or no longer a member). */
export async function sendGroupMessage(
  uid: string,
  groupId: string,
  body: string,
  members?: GroupMember[],
): Promise<GroupMessage> {
  const { data, error } = await supabase
    .from("group_messages")
    .insert({ group_id: groupId, sender_id: uid, body })
    .select()
    .single();
  if (error) throw new Error(`send group message: ${error.message}`);
  const byId = new Map((members ?? []).map(m => [m.id, m]));
  return toGroupMessage(data as GroupMessageRow, uid, byId);
}

/** Delete a message I sent to a group (migration 0031). A soft delete: the text
 *  is blanked on the server and the thread shows "Message deleted" in its place
 *  for everyone. Throws when it didn't happen (offline, or not my message). */
export async function deleteMyGroupMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_group_message", { p_message_id: messageId });
  if (error) throw new Error(`delete group message: ${error.message}`);
}

/** Remove one message outright. The owner's moderation path (a reported
 *  message comes out of the group entirely); an author deleting their own
 *  message goes through deleteMyGroupMessage instead, which leaves a marker. */
export async function deleteGroupMessage(messageId: string): Promise<void> {
  const { error } = await supabase.from("group_messages").delete().eq("id", messageId);
  if (error) throw new Error(`delete message: ${error.message}`);
}

/** groupId → last_read_at for my account ({} when none). */
export async function fetchGroupReads(uid: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("group_reads").select("*").eq("user_id", uid);
  if (error) throw new Error(`load group reads: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of (data as GroupReadRow[] | null) ?? []) out[r.group_id] = r.last_read_at;
  return out;
}

/**
 * Stamp a group thread read (upsert on (user, group)).
 *
 * Pass `upToISO`, the newest message the reader actually has on screen. That's
 * a SERVER time, the same clock every message's created_at is on, so "unread"
 * means "arrived after the last message I saw" exactly. Stamping with this
 * phone's clock instead compared two different clocks: a phone running a little
 * fast swallowed the next messages from the badge, and one running slow kept
 * messages you'd already read counted as unread. Falls back to now for an
 * empty thread, where there's nothing to compare against yet.
 */
export async function markGroupRead(uid: string, groupId: string, upToISO?: string): Promise<void> {
  const { error } = await supabase
    .from("group_reads")
    .upsert({ user_id: uid, group_id: groupId, last_read_at: upToISO ?? new Date().toISOString() });
  if (error) throw new Error(`mark group read: ${error.message}`);
}

/** Makes every realtime channel name unique; see subscribeToGroup. */
let channelSeq = 0;

/** Live inbound group messages while a thread is open. Fires with the author's
 *  id on every INSERT into this group, and on every UPDATE (a deletion, 0031),
 *  including my own echo, which the caller skips so sending or deleting doesn't
 *  trigger a redundant refetch. Returns an unsubscribe. Mirrors
 *  lib/chat.ts:subscribeToInbound. */
export function subscribeToGroup(
  groupId: string,
  onMessage: (senderId: string) => void,
  /** Distinguishes a second listener on the same group — the group page's
   *  unread badge alongside the chat thread. Supabase keys channels by name,
   *  so two screens sharing one could see the other's teardown remove theirs. */
  key?: string,
): () => void {
  const filter = `group_id=eq.${groupId}`;
  // A fresh name every time (channelSeq). supabase.channel(name) hands back an
  // EXISTING channel of that name, and removeChannel only drops one from that
  // list once the server confirms the leave. Re-subscribing under the same name
  // before then (leave the page, come straight back) got the old, closing
  // channel back: its new listeners never fired, and the badge stopped
  // updating until the next visit.
  const channel = supabase
    .channel(`group_messages_${groupId}${key ? `_${key}` : ""}_${++channelSeq}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages", filter },
      payload => onMessage((payload.new as GroupMessageRow).sender_id),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "group_messages", filter },
      payload => onMessage((payload.new as GroupMessageRow).sender_id),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
