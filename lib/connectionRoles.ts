// lib/connectionRoles.ts
//
// How this account files each TRAINER it's connected with, the notes the
// server leaves when someone switches account type, and the switch itself
// (migration 0041). RN-only (imports the Supabase client).
//
// A trainer connected to another trainer can have them as their trainer, as
// their client, or both. utils/roster.ts reads the filing to build My Trainers
// and My Clients; utils/connectionRolePrompt.ts asks when there isn't one yet.
// It lives on the server (connection_roles, the owner's alone), so a new phone
// keeps it. It used to be a list on the phone (TRAINER_CLIENTS_KEY), which is
// imported here once.
//
// The server's copy is the real one. The last one read is kept on the device
// (CONNECTION_ROLES_KEY) for when the server can't be asked, so going offline
// never moves anyone between lists.

import { supabase } from "./supabase";
import { getMyConnections } from "./connections";
import { getJSON, removeKey, setJSON } from "../utils/storage";
import { CONNECTION_ROLES_KEY, TRAINER_CLIENTS_KEY } from "../utils/trainerStore";
import type { AccountType } from "../contexts/AccountTypeContext";

export type ConnectionRole = "trainer" | "client" | "both";

const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

const isRole = (v: unknown): v is ConnectionRole => v === "trainer" || v === "client" || v === "both";

/** Current session's user id, or null when signed out. Local read, no network. */
async function myUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** PostgREST's "no such function / table": a server without this migration. */
function isMissing(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42P01" || error.code === "42883"
    || /could not find the (function|table)/i.test(error.message ?? "");
}

// ─── Filings ─────────────────────────────────────────────────────────────────

/** How I file each connection, as the server has it. Throws when it can't be
 *  asked (offline, signed out, or no 0041), so callers can tell "none" from
 *  "don't know". Refreshes the device's copy. */
export async function fetchConnectionRoles(): Promise<Map<string, ConnectionRole>> {
  const uid = await myUid();
  if (!uid) throw new Error("not signed in");
  const { data, error } = await supabase
    .from("connection_roles")
    .select("other_id, role")
    .eq("owner_id", uid);
  if (error) throw new Error(`load connection roles: ${error.message}`);
  const out = new Map<string, ConnectionRole>();
  for (const r of (data as { other_id: string; role: string }[] | null) ?? []) {
    if (isRole(r.role)) out.set(r.other_id, r.role);
  }
  await setJSON(CONNECTION_ROLES_KEY, Object.fromEntries(out));
  return out;
}

/**
 * How I file each connection, for building the lists: the server's answer when
 * it can be had, otherwise the last one read. Never throws.
 *
 * The phone's old "also my client" list is laid over the top until it has been
 * imported (importLegacyTrainerClients), so nobody leaves My Clients in the
 * meantime: an id on it reads as "both" unless it's already a client.
 */
export async function loadConnectionRoles(): Promise<Map<string, ConnectionRole>> {
  let roles: Map<string, ConnectionRole>;
  try {
    roles = await fetchConnectionRoles();
  } catch {
    const cached = await getJSON<Record<string, string>>(CONNECTION_ROLES_KEY, {});
    roles = new Map(Object.entries(cached ?? {}).filter((e): e is [string, ConnectionRole] => isRole(e[1])));
  }
  for (const id of await getJSON<string[]>(TRAINER_CLIENTS_KEY, [])) {
    const r = roles.get(id);
    if (r !== "client" && r !== "both") roles.set(id, "both");
  }
  return roles;
}

/** File a connection. Needs the server: throws (honestly) when it can't be
 *  reached, and the device's copy only changes once it has been saved. */
export async function setConnectionRole(otherId: string, role: ConnectionRole): Promise<void> {
  const uid = await myUid();
  if (!uid) throw new Error("not signed in");
  const { error } = await supabase
    .from("connection_roles")
    .upsert({ owner_id: uid, other_id: otherId, role, updated_at: new Date().toISOString() }, { onConflict: "owner_id,other_id" });
  if (error) {
    if (__DEV__) console.warn("[avenas] setConnectionRole", error.message);
    throw new Error(UNREACHABLE);
  }
  const cached = await getJSON<Record<string, string>>(CONNECTION_ROLES_KEY, {});
  await setJSON(CONNECTION_ROLES_KEY, { ...(cached ?? {}), [otherId]: role });
  // A choice made now replaces whatever the old list said about them.
  const legacy = await getJSON<string[]>(TRAINER_CLIENTS_KEY, []);
  if (legacy.includes(otherId)) await setJSON(TRAINER_CLIENTS_KEY, legacy.filter(x => x !== otherId));
}

/**
 * Carry this phone's old "also my client" list to the server, once. Each id
 * still connected becomes "both" unless it's already filed as a client; then
 * the list is emptied. Anything that can't be sent stays on the list for next
 * time (and loadConnectionRoles keeps honouring it until then).
 */
export async function importLegacyTrainerClients(): Promise<void> {
  const legacy = await getJSON<string[]>(TRAINER_CLIENTS_KEY, []);
  if (legacy.length === 0) return;
  let roles: Map<string, ConnectionRole>;
  let connected: Set<string>;
  try {
    const [r, conns] = await Promise.all([fetchConnectionRoles(), getMyConnections()]);
    roles = r;
    connected = new Set(conns.filter(c => c.status === "accepted").map(c => c.otherId));
  } catch {
    return; // not now: the list keeps working locally
  }
  const left: string[] = [];
  for (const id of legacy) {
    if (!connected.has(id)) continue; // no longer connected: nothing to carry
    const r = roles.get(id);
    if (r === "client" || r === "both") continue;
    try {
      await setConnectionRole(id, "both");
    } catch {
      left.push(id);
    }
  }
  if (left.length > 0) await setJSON(TRAINER_CLIENTS_KEY, left);
  else await removeKey(TRAINER_CLIENTS_KEY);
}

// ─── Notes left by an account-type switch ────────────────────────────────────

export type ConnectionNoticeKind =
  /** My trainer switched to a gym account: keep them as a client, or remove. */
  | "ex_trainer_choose"
  /** ...they're no longer my trainer, but still my client. */
  | "ex_trainer_client"
  /** ...and we're no longer connected. */
  | "ex_trainer_gone"
  /** My client now has a trainer account: also my trainer? */
  | "new_trainer_client"
  /** Someone I'm connected with is now a trainer (they're in My Trainers). */
  | "new_trainer";

export type ConnectionNotice = {
  id: string;
  otherId: string;
  name: string;
  kind: ConnectionNoticeKind;
  /** Reviews I'd asked them for, withdrawn by the switch. */
  withdrawnReviews: number;
  createdAtISO: string;
};

const NOTICE_KINDS: ConnectionNoticeKind[] = ["ex_trainer_choose", "ex_trainer_client", "ex_trainer_gone", "new_trainer_client", "new_trainer"];

/** My notes, newest first. Throws when it can't be asked. */
export async function fetchConnectionNotices(): Promise<ConnectionNotice[]> {
  const uid = await myUid();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("connection_notices")
    .select("id, other_id, kind, other_name, withdrawn_reviews, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissing(error)) return []; // no 0041: there's nothing to show
    throw new Error(`load notices: ${error.message}`);
  }
  return ((data as { id: string; other_id: string; kind: string; other_name: string | null; withdrawn_reviews: number | null; created_at: string }[] | null) ?? [])
    .filter(r => (NOTICE_KINDS as string[]).includes(r.kind))
    .map(r => ({
      id: r.id,
      otherId: r.other_id,
      name: r.other_name?.trim() || "Someone",
      kind: r.kind as ConnectionNoticeKind,
      withdrawnReviews: r.withdrawn_reviews ?? 0,
      createdAtISO: r.created_at,
    }));
}

/** Put a note away. Throws when the server can't be reached. */
export async function dismissConnectionNotice(id: string): Promise<void> {
  const { error } = await supabase.from("connection_notices").delete().eq("id", id);
  if (error) throw new Error(UNREACHABLE);
}

// ─── The switch ──────────────────────────────────────────────────────────────

/**
 * Switch this account between Trainer and Gym User, with everything that goes
 * with it done by the server for everyone connected (change_account_type).
 * Only the Profile screen's confirmed save calls this; the launch-time drift
 * repair (lib/cloud.ts:reconcileAccountType) writes the column alone.
 *
 * A server without 0041 gets the column write alone, as before this existed.
 */
export async function changeAccountType(accountType: AccountType): Promise<void> {
  const p_account_type = accountType === "pt" ? "pt" : "user";
  const { error } = await supabase.rpc("change_account_type", { p_account_type });
  if (!error) return;
  if (!isMissing(error)) throw new Error(`save account type: ${error.message}`);
  const uid = await myUid();
  if (!uid) throw new Error("not signed in");
  const { error: colError } = await supabase.from("profiles").update({ account_type: p_account_type }).eq("id", uid);
  if (colError) throw new Error(`save account type: ${colError.message}`);
}
