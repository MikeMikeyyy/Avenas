// Supabase client. Pure JS (works in Expo Go). Credentials come from .env via
// Expo's EXPO_PUBLIC_* convention; the anon key is public-by-design and gated
// server-side by Row Level Security.
//
// Auth sessions persist in AsyncStorage and auto-refresh while the app is
// foregrounded (the AppState wiring below is the Supabase-recommended pattern
// for React Native). Who's signed in at launch is read straight from that
// storage (readSavedSession), never from getSession(), which waits on the
// server to renew an old token (utils/savedSession.ts).

import "react-native-url-polyfill/auto";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type Session } from "@supabase/supabase-js";
import { authStorageKey, endSession, sessionFromStorage } from "../utils/savedSession";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Add them to .env.",
  );
}

/** For the few requests supabase-js can't make well itself: a file streamed
 *  from disk to Storage (lib/exerciseMedia.ts), which its upload() would first
 *  read whole into JS memory. */
export const SUPABASE_URL: string = supabaseUrl;
export const SUPABASE_ANON_KEY: string = supabaseAnonKey;

/** Where supabase-js keeps this phone's sign-in: its own default, named so the
 *  launch can read it (readSavedSession). */
export const AUTH_STORAGE_KEY = authStorageKey(supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    // No URL-based session detection on native (OAuth returns via deep link,
    // which we handle explicitly in the auth flow).
    detectSessionInUrl: false,
    // PKCE is the secure flow for native OAuth: signInWithOAuth returns a code
    // we exchange for a session (see lib/auth.ts).
    flowType: "pkce",
  },
});

// Pause token refresh in the background, resume on foreground.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** The sign-in saved on this phone, read without the server: what the launch
 *  opens on, signal or not (utils/savedSession.ts). */
export async function readSavedSession(): Promise<Session | null> {
  try {
    return sessionFromStorage(await AsyncStorage.getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

// Sign-outs this phone has under way, so AuthContext can tell them from a
// sign-in the server ended (utils/savedSession.ts:signedOutElsewhere).
let ownSignOuts = 0;

/** True while this phone is signing itself out. */
export function isOwnSignOut(): boolean {
  return ownSignOuts > 0;
}

/** Every sign-out the app makes goes through here: Settings' Sign Out (via
 *  lib/auth.ts), Delete Account, a sign-in cancelled to protect the device's
 *  data. Works with no signal (utils/savedSession.ts:endSession). */
export async function signOutHere(): Promise<void> {
  ownSignOuts += 1;
  try {
    await endSession(supabase.auth, () => AsyncStorage.removeItem(AUTH_STORAGE_KEY));
  } finally {
    ownSignOuts -= 1;
  }
}
