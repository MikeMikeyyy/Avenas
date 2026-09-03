// lib/appConfig.ts
//
// The remotely-controlled minimum app version (migration 0020). RN-only
// (imports the Supabase client).
//
// Read WITHOUT auth on purpose: the force-update gate runs before sign-in, so a
// signed-out user on an old build still has to be told to update. The row is
// readable by anon and writable by nobody — change it in the dashboard.

import { supabase } from "./supabase";

/** Avenas' App Store "Apple ID" (App Store Connect → App Information). The
 *  itms-apps scheme opens the App Store app straight on the product page rather
 *  than bouncing through Safari. */
export const APP_STORE_ID = "6760699751";

/** Deep link to the store listing. itms-apps avoids a Safari bounce. */
export function appStoreUrl(): string {
  return `itms-apps://apps.apple.com/app/id${APP_STORE_ID}`;
}

/** Web fallback, for when the App Store app can't handle the scheme. */
export function appStoreWebUrl(): string {
  return `https://apps.apple.com/app/id${APP_STORE_ID}`;
}

/**
 * The lowest version allowed to run, or null when it can't be determined.
 *
 * null on ANY failure — offline, signed out, table missing, migration not yet
 * applied. The gate treats null as "don't block": an app that bricks itself
 * because the network was down would be far worse than one stale install
 * slipping through.
 */
export async function fetchMinIosVersion(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("min_ios_version")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (__DEV__) console.warn("[avenas] fetchMinIosVersion", error.message);
      return null;
    }
    return (data?.min_ios_version as string | null) ?? null;
  } catch (err) {
    if (__DEV__) console.warn("[avenas] fetchMinIosVersion", err);
    return null;
  }
}
