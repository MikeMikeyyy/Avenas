// Auth helpers. Email/password is the simple baseline; Google/Apple use
// Supabase's OAuth web flow (works in Expo Go): open the provider in a browser,
// then exchange the returned PKCE code for a session.

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

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

  const params = new URL(result.url).searchParams;
  const code = params.get("code");
  if (!code) {
    throw new Error(params.get("error_description") ?? params.get("error") ?? "No auth code returned.");
  }
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
