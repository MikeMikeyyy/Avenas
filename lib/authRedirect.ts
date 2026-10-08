// Where a Google sign-in sends the user back, kept apart from lib/auth.ts so the
// router's link handling (app/+native-intent.tsx) can read it without loading
// the Supabase client and the sync layer.

import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Linking from "expo-linking";

// Where the provider sends the user back: avenas://auth-callback, which MUST stay
// in Supabase -> Authentication -> URL Configuration -> Redirect URLs.
//
// A build gets that from createURL. Expo Go on iOS is given it explicitly:
// createURL there returns exp://<this PC's LAN IP>:8081/--/auth-callback, and
// Supabase never allow-lists an IP host (not by wildcard, not even exactly), so
// it fell back to the Site URL and the check in signInWithProvider failed with
// "did not match the expected redirect" whenever the IP wasn't the Site URL's.
// The address doesn't need to reach Expo Go anyway: iOS's sign-in browser
// catches the redirect by its scheme and hands it straight back without opening
// it, so the scheme needn't be registered. Android's browser does open it, so
// Android keeps createURL.
const APP_SCHEME = [Constants.expoConfig?.scheme].flat()[0] ?? "avenas";
export const oauthRedirectTo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient && Platform.OS === "ios"
    ? `${APP_SCHEME}://auth-callback`
    : Linking.createURL("auth-callback");

/** True for the sign-in return link itself (`…auth-callback?code=…`). */
export function isOAuthReturn(url: string): boolean {
  return url.startsWith(oauthRedirectTo);
}
