// Supabase client. Pure JS (works in Expo Go). Credentials come from .env via
// Expo's EXPO_PUBLIC_* convention; the anon key is public-by-design and gated
// server-side by Row Level Security.
//
// Auth sessions persist in AsyncStorage and auto-refresh while the app is
// foregrounded (the AppState wiring below is the Supabase-recommended pattern
// for React Native).

import "react-native-url-polyfill/auto";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Add them to .env.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
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
