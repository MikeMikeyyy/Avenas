// Links the system hands the app, before Expo Router turns them into screens.
//
// The one handled here is the Google sign-in return (avenas://auth-callback?code=…),
// which expo-web-browser is already waiting for to finish the sign-in
// (lib/auth.ts: signInWithProvider). On an iPhone the sign-in window catches it
// before the app sees it. Android's browser opens it like any other link, and the
// router would show "page not found" for it, there being no auth-callback page.
// Returning null makes the router ignore it. If Android closed the app during the
// sign-in, the link starts it afresh with nothing waiting: it opens as normal and
// the sign-in is simply tried again.
//
// Every other link passes through unchanged.

import { isOAuthReturn } from "../lib/authRedirect";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  return isOAuthReturn(path) ? null : path;
}
