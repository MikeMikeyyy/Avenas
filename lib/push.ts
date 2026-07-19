// lib/push.ts
//
// Expo push token registration for SERVER-SENT notifications (coach/client
// messages, connection requests, program shares — the PUSH_CATEGORIES in
// constants/notifications.ts). Local reminders never touch this file; they're
// scheduled on-device by utils/notificationScheduler.ts.
//
// Each signed-in device upserts one row into public.push_tokens (migration
// 0012): its Expo push token plus the EFFECTIVE value (master && category) of
// each push category. The database triggers that send push read that column,
// so a silenced category is silenced server-side — the push is never sent, not
// merely hidden on arrival.
//
// Requirements for a token to exist at all (all fail soft to "not registered"):
//   - a physical device (simulators have no push service)
//   - OS notification permission granted
//   - an EAS projectId in app config (`eas init` writes extra.eas.projectId) —
//     this is why remote push needs a dev/EAS build and never works in Expo Go.

import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

import { supabase } from "./supabase";
import { getJSON, setJSON, removeKey } from "../utils/storage";
import { loadNotificationPrefs } from "../utils/notifications";
import { PUSH_CATEGORIES, type NotificationPrefs } from "../constants/notifications";

/** The token this device last registered, so sign-out can delete exactly that
 *  row without another round-trip to Expo. Local-only, never synced. */
const PUSH_TOKEN_KEY = "@avenas/push_token";

const warn = (op: string, err: unknown) => {
  if (__DEV__) console.warn("[avenas] push", op, err);
};

/** The effective per-category values the server checks before sending. */
function effectivePushCategories(prefs: NotificationPrefs): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of PUSH_CATEGORIES) out[c] = prefs.master && prefs.categories[c];
  return out;
}

async function currentUid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Fetch this device's Expo push token, or null when push isn't possible here
 *  (web, simulator, Expo Go / no EAS projectId, permission denied). */
async function getPushToken(): Promise<string | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  const perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) return null;
  const projectId: unknown =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== "string" || !projectId) return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/** Upsert via the register_push_token RPC — the only write path the server
 *  allows, because it also re-claims the token from any previous account on
 *  this device (a token belongs to exactly one account at a time). */
async function upsertToken(token: string, prefs: NotificationPrefs): Promise<void> {
  const { error } = await supabase.rpc("register_push_token", {
    p_token: token,
    p_platform: Platform.OS,
    p_categories: effectivePushCategories(prefs),
  });
  if (error) throw new Error(error.message);
  await setJSON(PUSH_TOKEN_KEY, token);
}

/**
 * Register (or refresh) this device's push token for the signed-in user,
 * mirroring the current effective category prefs. Idempotent — call it after
 * sign-in, after a permission grant, and on app start. No-ops when signed out
 * or when push isn't possible on this device.
 */
export async function registerPushToken(): Promise<void> {
  try {
    const uid = await currentUid();
    if (!uid) return;
    const token = await getPushToken();
    if (!token) return;
    await upsertToken(token, await loadNotificationPrefs());
  } catch (e) {
    warn("register", e);
  }
}

/**
 * Mirror a prefs change to this device's push_tokens row. Uses the cached
 * token (no Expo round-trip); falls back to a full register when the device
 * hasn't registered yet this install.
 */
export async function syncPushCategories(prefs: NotificationPrefs): Promise<void> {
  try {
    const uid = await currentUid();
    if (!uid) return;
    const token = await getJSON<string | null>(PUSH_TOKEN_KEY, null);
    if (!token) {
      await registerPushToken();
      return;
    }
    await upsertToken(token, prefs);
  } catch (e) {
    warn("syncCategories", e);
  }
}

/**
 * Delete this device's token row so a signed-out (or switched) account stops
 * receiving that account's pushes here. Must run while still authenticated —
 * callers invoke it right before supabase.auth.signOut(). Best effort: a
 * failure never blocks the sign-out itself.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    const uid = await currentUid();
    const token = await getJSON<string | null>(PUSH_TOKEN_KEY, null);
    await removeKey(PUSH_TOKEN_KEY);
    if (!uid || !token) return;
    const { error } = await supabase
      .from("push_tokens")
      .delete()
      .eq("user_id", uid)
      .eq("token", token);
    if (error) throw new Error(error.message);
  } catch (e) {
    warn("unregister", e);
  }
}
