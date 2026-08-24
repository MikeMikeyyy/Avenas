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
  GroupMemberWithProfile,
  GroupMessageRow,
  GroupReadRow,
  GroupRow,
} from "./database.types";
import type { Group, GroupMember, GroupMessage } from "../constants/groups";

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
  }));
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
    text: r.body,
    sentAtISO: r.created_at,
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
  const { data, error } = await supabase
    .from("group_messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`load group thread: ${error.message}`);
  return ((data as GroupMessageRow[] | null) ?? []).map(r => toGroupMessage(r, uid, byId));
}

/** Every group message the caller can see, bucketed by group id, oldest → newest.
 *  One round trip (RLS already scopes it to my groups), and deliberately WITHOUT
 *  author resolution — the conversations list only needs previews and unread
 *  counts, and resolving names would cost one get_group_members call per group. */
export async function fetchAllGroupMessages(uid: string): Promise<Record<string, GroupMessage[]>> {
  const { data, error } = await supabase
    .from("group_messages")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`load group messages: ${error.message}`);
  const out: Record<string, GroupMessage[]> = {};
  const empty = new Map<string, GroupMember>();
  for (const r of (data as GroupMessageRow[] | null) ?? []) {
    (out[r.group_id] ??= []).push(toGroupMessage(r, uid, empty));
  }
  return out;
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

/** Delete one message. Authors delete their own; a group owner can delete any
 *  message in their group (moderation). */
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

/** Stamp a group thread read as of now (upsert on (user, group)). */
export async function markGroupRead(uid: string, groupId: string): Promise<void> {
  const { error } = await supabase
    .from("group_reads")
    .upsert({ user_id: uid, group_id: groupId, last_read_at: new Date().toISOString() });
  if (error) throw new Error(`mark group read: ${error.message}`);
}

/** Live inbound group messages while a thread is open. Fires with the author's
 *  id on every INSERT into this group — including my own echo, which the caller
 *  skips so sending doesn't trigger a redundant refetch. Returns an
 *  unsubscribe. Mirrors lib/chat.ts:subscribeToInbound. */
export function subscribeToGroup(groupId: string, onMessage: (senderId: string) => void): () => void {
  const channel = supabase
    .channel(`group_messages_${groupId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
      payload => onMessage((payload.new as GroupMessageRow).sender_id),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
