// lib/appConfig.ts
//
// The remotely-controlled minimum app version (migration 0020). RN-only
// (imports the Supabase client).
//
// Read WITHOUT auth on purpose: the force-update gate runs before sign-in, so a
// signed-out user on an old build still has to be told to update. The row is
// readable by anon and writable by nobody — change it in the dashboard.

import { supabase } from "./supabase";
import { getJSON, removeKey, setJSON } from "../utils/storage";

/** The last minimum the server gave, so the gate decides at launch from the
 *  phone. A gate that waited on the server kept a phone with no signal out of
 *  the app (user report, 2026-10-14). Not account data: kept across sign-ins. */
export const MIN_IOS_VERSION_KEY = "@avenas/min_ios_version";

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

/** The listing with its "Write a Review" sheet already open. `action=write-review`
 *  is Apple's documented way to rate from a button: the SKStoreReviewController
 *  prompt is rate-limited and may show nothing, which is fine unprompted and
 *  broken when the user asked for it. */
export function appStoreReviewUrl(): string {
  return `${appStoreUrl()}?action=write-review`;
}

/** Web fallback for `appStoreReviewUrl`. */
export function appStoreReviewWebUrl(): string {
  return `${appStoreWebUrl()}?action=write-review`;
}

/**
 * The lowest version allowed to run, null when none is set, or undefined when
 * the server couldn't be read: offline, table missing, migration not yet
 * applied. The gate keeps the minimum it last saved on undefined, and treats
 * null as "don't block": an app that bricks itself because the network was
 * down would be far worse than one stale install slipping through.
 */
export async function fetchMinIosVersion(): Promise<string | null | undefined> {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("min_ios_version")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (__DEV__) console.warn("[avenas] fetchMinIosVersion", error.message);
      return undefined;
    }
    return (data?.min_ios_version as string | null) ?? null;
  } catch (err) {
    if (__DEV__) console.warn("[avenas] fetchMinIosVersion", err);
    return undefined;
  }
}

/** The minimum the server last gave (MIN_IOS_VERSION_KEY), or null. */
export function loadSavedMinIosVersion(): Promise<string | null> {
  return getJSON<string | null>(MIN_IOS_VERSION_KEY, null);
}

/** Saves the server's answer for the next launch; null forgets it. */
export async function saveMinIosVersion(min: string | null): Promise<void> {
  if (min) await setJSON(MIN_IOS_VERSION_KEY, min);
  else await removeKey(MIN_IOS_VERSION_KEY);
}
