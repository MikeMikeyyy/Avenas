// Auth helpers. Email/password is the simple baseline; Google/Apple use
// Supabase's OAuth web flow (works in Expo Go): open the provider in a browser,
// then exchange the returned PKCE code for a session.

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "./supabase";
import { flushCloudPushNow } from "./syncManager";
import { localCounts } from "./cloud";
import { unregisterPushToken } from "./push";

// Lets the in-app browser close cleanly when auth returns.
WebBrowser.maybeCompleteAuthSession();

// Where the provider sends the user back. Expo Go -> exp://…/auth-callback;
// a dev/standalone build -> avenas://auth-callback. Whatever this resolves to
// MUST be added to Supabase -> Authentication -> URL Configuration -> Redirect URLs.
export const oauthRedirectTo = Linking.createURL("auth-callback");

export type OAuthProvider = "google" | "apple";

/** Open the provider's login, then exchange the PKCE code for a Supabase session. */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: oauthRedirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Could not start sign-in.");

  const result = await WebBrowser.openAuthSessionAsync(data.url, oauthRedirectTo);
  if (result.type !== "success") {
    throw new Error(result.type === "cancel" || result.type === "dismiss" ? "Sign-in cancelled." : "Sign-in failed.");
  }

  // Defence-in-depth: the PKCE code from result.url is about to be exchanged
  // for a session, so the URL must come from OUR configured callback. The
  // in-app browser already restricts navigation, but a hostile or stale return
  // URL would otherwise be parsed and forwarded to Supabase without checks.
  if (!result.url.startsWith(oauthRedirectTo)) {
    throw new Error("Sign-in callback URL did not match the expected redirect.");
  }

  const params = new URL(result.url).searchParams;
  const code = params.get("code");
  if (!code) {
    throw new Error(params.get("error_description") ?? params.get("error") ?? "No auth code returned.");
  }
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

/** Thrown when the user dismisses the native Apple sheet. Callers should stay
 *  silent for this — it isn't a failure. */
export class AppleSignInCancelled extends Error {
  constructor() {
    super("Apple sign-in cancelled.");
    this.name = "AppleSignInCancelled";
  }
}

/** True when this device can show the native Sign in with Apple sheet (iOS 13+).
 *  Used to hide the button where it can't work — Android, older iOS, Expo Go. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * NATIVE Sign in with Apple, required by App Store Guideline 4.8 whenever the
 * app also offers another social login (we offer Google). Uses Apple's own
 * sheet rather than the web OAuth flow, then exchanges the returned identity
 * token for a Supabase session via signInWithIdToken.
 *
 * Apple returns the user's name ONLY on the very first authorization for this
 * app, so it's handed back for the caller to seed the profile with; every later
 * sign-in resolves with `fullName: null` and the stored profile is used.
 *
 * Requires: `ios.usesAppleSignIn` (entitlement) and the app's bundle id
 * registered as an authorized client id on Supabase's Apple provider.
 */
export async function signInWithApple(): Promise<{ fullName: string | null }> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    // Apple reports a user-cancelled sheet as ERR_REQUEST_CANCELED.
    const code = (e as { code?: string })?.code;
    if (code === "ERR_REQUEST_CANCELED" || /cancel/i.test(String(e))) throw new AppleSignInCancelled();
    throw e;
  }

  if (!credential.identityToken) {
    throw new Error("Apple didn't return an identity token. Please try again.");
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
  });
  if (error) throw error;

  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return { fullName: fullName || null };
}

/**
 * Which social providers an email logs in with, when the account has NO
 * password identity (migration 0010's login_providers_for_email). The server
 * returns [] for unknown emails and for password accounts alike, so a
 * non-empty result means exactly "this login must go through the returned
 * provider(s)". Fails soft to [] (offline / migration not applied): callers
 * then fall back to the generic invalid-credentials message.
 */
export async function oauthOnlyProvidersForEmail(email: string): Promise<OAuthProvider[]> {
  try {
    const { data, error } = await supabase.rpc("login_providers_for_email", { p_email: email.trim() });
    if (error || !Array.isArray(data)) return [];
    return data.filter((p): p is OAuthProvider => p === "google" || p === "apple");
  } catch {
    return [];
  }
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

/** Thrown when sign-out is refused because the final backup push failed while
 *  this device still holds the account's data. Signing out anyway would let the
 *  next account's sign-in wipe the only up-to-date copy. */
export class SignOutBackupError extends Error {
  constructor() {
    super("We couldn't back up your latest data.");
    this.name = "SignOutBackupError";
  }
}

/**
 * Sign out, backing up the account's latest local data first (a different
 * account signing in afterwards replaces the local cache, so the cloud must be
 * current before we let go). If that backup push fails AND there is local data
 * at stake, this throws SignOutBackupError WITHOUT signing out — callers show
 * the error and can retry, or pass `force: true` as an explicit
 * "sign out anyway" once the user accepts the risk.
 */
export async function signOut(opts?: { force?: boolean }): Promise<void> {
  const backedUp = await flushCloudPushNow();
  if (!backedUp && !opts?.force) {
    const local = await localCounts().catch(() => null);
    const hasData =
      local !== null &&
      local.programs + local.workouts + local.journal + local.customExercises > 0;
    if (hasData) throw new SignOutBackupError();
  }
  // Stop this device receiving the account's pushes. Best effort, and it must
  // run BEFORE auth.signOut() (deleting the row needs the session).
  await unregisterPushToken();
  await supabase.auth.signOut();
}
