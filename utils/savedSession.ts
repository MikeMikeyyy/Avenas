// utils/savedSession.ts
//
// Who's signed in, decided from what's saved on the phone, never by waiting on
// the server (user report, 2026-10-14: a phone with no signal sat loading and
// never got into the app).
//
// supabase-js answers getSession() only once it has renewed a token over an
// hour old. With no signal it retries for up to 30 seconds, then answers "no
// session" while the sign-in stays saved, so the launch waited on the splash
// and then sent a signed-in person to onboarding. The app now opens on the
// saved session whatever its token's age, and supabase-js renews the token in
// the background (every 30 seconds while the app is open, so within half a
// minute of the signal coming back). Pure, so scripts/verify-offline-launch.ts
// runs it against the real auth library.

import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";

/** The key supabase-js saves the session under: its own default for the
 *  project, so a phone signed in before the key was named stays signed in.
 *  scripts/verify-offline-launch.ts holds it to the library's default. */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/** The saved session, or null when there's none or it can't be read. Its access
 *  token may have run out: offline that's still the person signed in, and the
 *  refresh token is what renews it. The shape supabase-js accepts
 *  (`_isValidSession`), plus the user, whose id everything keys on. */
export function sessionFromStorage(raw: string | null): Session | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<Session>;
  if (typeof s.access_token !== "string" || !s.access_token) return null;
  if (typeof s.refresh_token !== "string" || !s.refresh_token) return null;
  if (!("expires_at" in s)) return null;
  if (!s.user || typeof s.user.id !== "string" || !s.user.id) return null;
  return s as Session;
}

/** Who's signed in after a supabase-js auth event. Only SIGNED_OUT ends a
 *  session. A null INITIAL_SESSION is supabase-js failing to renew an old token
 *  (no signal), not nobody signed in: taken at its word, it signed out every
 *  phone that opened offline. */
export function sessionAfterEvent(
  current: Session | null,
  event: AuthChangeEvent,
  incoming: Session | null,
): Session | null {
  if (event === "SIGNED_OUT") return null;
  return incoming ?? current;
}

/** Whether a SIGNED_OUT came from the server rather than from this phone: the
 *  sign-in was ended elsewhere (signed out on another phone, which signs out
 *  every device, or the account deleted), seen when a renewal is refused. The
 *  app's own sign-outs move to the start themselves; this one needs the app to. */
export function signedOutElsewhere(
  current: Session | null,
  event: AuthChangeEvent,
  ownSignOut: boolean,
): boolean {
  return event === "SIGNED_OUT" && current !== null && !ownSignOut;
}

/**
 * Sign this phone out, with or without a signal. supabase-js signs out on the
 * server first, and when it can't reach it, it returns an error and KEEPS the
 * session, which the next launch would open on again. Then the session is ended
 * on this phone alone: the saved copy removed first (a local sign-out still
 * loads the session, and loading renews an old token over the network), after
 * which the local sign-out needs no server, clears the rest, and tells every
 * listener (SIGNED_OUT).
 */
export async function endSession(
  auth: Pick<SupabaseClient["auth"], "signOut">,
  removeSaved: () => Promise<void>,
): Promise<void> {
  const { error } = await auth.signOut();
  if (!error) return;
  await removeSaved();
  await auth.signOut({ scope: "local" });
}
