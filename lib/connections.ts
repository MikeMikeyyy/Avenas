// Client wrappers for the account-to-account connection RPCs (migration 0006).
// RN-only (imports the Supabase client). Connecting is a request → accept
// handshake; once accepted, each side can read the other's SAFE profile fields
// (name + photo + account type) via get_my_connections().

import { supabase } from "./supabase";
import type { AccountType } from "../contexts/AccountTypeContext";
import type { ConnectionWithProfile } from "./database.types";

/** App-facing connection (DB account_type "user"/"pt" mapped to "gym_user"/"pt"). */
export type Connection = {
  connectionId: string;
  otherId: string;
  name: string;
  photoUri?: string;
  accountType: AccountType;
  /** ISO timestamp the connected account was last active on the app (or undefined). */
  lastActiveAt?: string;
  status: "pending" | "accepted" | "declined";
  direction: "accepted" | "incoming" | "outgoing";
};

/** Result of a connect attempt. Mirrors request_connection()'s return values. */
export type RequestResult = "requested" | "connected" | "already" | "self" | "not_found";

const toAppAccountType = (a: string | null): AccountType => (a === "pt" ? "pt" : "gym_user");

/** This account's shareable connect code (the value behind the QR + text code). */
export async function getMyCode(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("connect_code")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`load connect code: ${error.message}`);
  return (data?.connect_code as string | null) ?? null;
}

/** Send a connection request to whoever owns `code`. */
export async function requestConnection(code: string): Promise<RequestResult> {
  const { data, error } = await supabase.rpc("request_connection", { p_code: code });
  if (error) throw new Error(error.message);
  return (data as RequestResult) ?? "not_found";
}

/** Accept or decline a pending request addressed to me. */
export async function respondConnection(connectionId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_connection", { p_id: connectionId, p_accept: accept });
  if (error) throw new Error(error.message);
}

/** Remove a connection (or cancel an outgoing request) from either side. */
export async function disconnect(connectionId: string): Promise<void> {
  const { error } = await supabase.from("connections").delete().eq("id", connectionId);
  if (error) throw new Error(error.message);
}

/** Sever any live connection (accepted or pending, either direction) with a given
 *  account id. No-op when there's no such row or we're signed out. Used by the
 *  block flow so blocking someone also drops the connection itself. */
export async function disconnectByOtherId(otherId: string): Promise<void> {
  const conns = await getMyConnections();
  for (const c of conns.filter(c => c.otherId === otherId)) {
    await disconnect(c.connectionId);
  }
}

/** All of my connections (accepted + pending), with the counterpart's safe profile. */
export async function getMyConnections(): Promise<Connection[]> {
  const { data, error } = await supabase.rpc("get_my_connections");
  if (error) throw new Error(error.message);
  const rows = (data as ConnectionWithProfile[] | null) ?? [];
  return rows.map((r) => ({
    connectionId: r.connection_id,
    otherId: r.other_id,
    name: r.name ?? "",
    photoUri: r.avatar_url ?? undefined,
    accountType: toAppAccountType(r.account_type),
    lastActiveAt: r.last_active_at ?? undefined,
    status: r.status,
    direction: r.direction,
  }));
}

/** Bump this account's "last active" to server-now (presence heartbeat). No-ops
 *  silently when signed out. Keeps running even when share_activity is off —
 *  visibility is gated server-side at read time (migration 0009). */
export async function touchLastActive(): Promise<void> {
  const { error } = await supabase.rpc("touch_last_active");
  if (error && __DEV__) console.warn("[avenas] touch_last_active", error.message);
}

/** Whether connections may see this account's activity status. Throws when
 *  signed out or the profile can't be read (callers gate the toggle on it). */
export async function getShareActivity(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  const { data, error } = await supabase
    .from("profiles")
    .select("share_activity")
    .eq("id", user.id)
    .single();
  if (error) throw new Error(`load share_activity: ${error.message}`);
  return (data?.share_activity as boolean | null) ?? true;
}

/** Set whether connections may see this account's activity status. Enforced
 *  server-side: when off, get_my_connections returns NULL last_active_at for
 *  this account, so other devices never receive the timestamp. */
export async function setShareActivity(share: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({ share_activity: share })
    .eq("id", user.id);
  if (error) throw new Error(`save share_activity: ${error.message}`);
}
