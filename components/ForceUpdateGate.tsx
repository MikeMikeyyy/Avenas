// Blocks the app when it's running below the minimum version set in Supabase
// (migration 0020), and sends the user to the App Store.
//
// iPhone only. The minimum is the App Store's (`min_ios_version`) and the only
// way out is the App Store. An Android copy is sent by hand as an APK, with no
// store behind it, so blocked it would sit behind a button that can't help it.
//
// Two layers on purpose:
//   1. A full-screen view rendered INSTEAD of the app. An iOS alert closes as
//      soon as its button is tapped, so an alert alone would leave the app
//      usable underneath the moment it's dismissed.
//   2. The native Alert on top, which is what the request asked for and what
//      users read as "you must do this".
// The alert is re-presented whenever the app returns to the foreground without
// having been updated, so there's no way to tap past it and carry on.
//
// FAILS OPEN. Offline, signed out, migration not applied, unparseable version:
// with no minimum saved, every one of those renders the app normally. A gate
// that bricks a working install on a network blip is far worse than one stale
// build slipping through.
//
// NEVER WAITS ON THE SERVER. It decides at launch from the last minimum the
// server gave, saved on the phone, then asks the server in the background and
// blocks if the answer says to. It used to put a spinner in place of the app
// until the server answered, which on a phone with no signal, or a connection
// that hangs, was forever (user report, 2026-10-14). The cost: on the one
// launch after the minimum is first raised, the app shows for a moment before
// the gate does.

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Platform, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";

import BounceButton from "./BounceButton";
import { APP_DARK, APP_LIGHT, ACCT, FontFamily } from "../constants/theme";
import { darkGlow } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import {
  APP_STORE_ID, appStoreUrl, appStoreWebUrl,
  fetchMinIosVersion, loadSavedMinIosVersion, saveMinIosVersion,
} from "../lib/appConfig";
import { isBelowMinimum } from "../utils/version";

const TITLE = "Update Required";
const BODY =
  "A new version of Avenas is available. Update to keep going, this one is out of date.";

/** Whether this platform is gated at all (see the header). */
const GATED = Platform.OS === "ios";

/** The running app's version, from the build's own config. */
function currentVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

async function openAppStore(): Promise<void> {
  // No id configured: opening a malformed link would dump the user on an error
  // page, which is worse than nothing. Better to leave the gate visible.
  if (!APP_STORE_ID) {
    if (__DEV__) console.warn("[avenas] APP_STORE_ID is not set — see lib/appConfig.ts");
    return;
  }
  try {
    await Linking.openURL(appStoreUrl());
  } catch {
    // The itms-apps scheme can fail in a simulator or an odd environment;
    // the https link still resolves to the same listing.
    try { await Linking.openURL(appStoreWebUrl()); } catch { /* nothing more to try */ }
  }
}

export default function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // null = the saved minimum not read yet: a moment, off the phone.
  const [blocked, setBlocked] = useState<boolean | null>(GATED ? null : false);
  const alerting = useRef(false);

  // The server's answer, saved for the next launch. No answer (offline) keeps
  // the decision made from the saved one.
  const takeAnswer = useCallback((min: string | null | undefined) => {
    if (min === undefined) return;
    void saveMinIosVersion(min);
    setBlocked(isBelowMinimum(currentVersion(), min));
  }, []);

  useEffect(() => {
    if (!GATED) return;
    // From the phone first; the server's answer wins whenever it comes.
    void loadSavedMinIosVersion().then(saved => {
      setBlocked(prev => prev ?? isBelowMinimum(currentVersion(), saved));
    });
    void fetchMinIosVersion().then(takeAnswer);
  }, [takeAnswer]);

  // Re-check on foreground: the user may have just updated, and if they didn't
  // the alert needs re-presenting.
  useEffect(() => {
    if (!GATED) return;
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") void fetchMinIosVersion().then(takeAnswer);
    });
    return () => sub.remove();
  }, [takeAnswer]);

  const promptUpdate = useCallback(() => {
    if (alerting.current) return; // never stack alerts
    alerting.current = true;
    Alert.alert(
      TITLE,
      BODY,
      [{ text: "Update Now", onPress: () => { alerting.current = false; void openAppStore(); } }],
      // No cancel button and not dismissible: the only way out is the App Store.
      { cancelable: false },
    );
  }, []);

  // Present the native alert as soon as we know the app is blocked.
  useEffect(() => {
    if (blocked) promptUpdate();
  }, [blocked, promptUpdate]);

  // One read off the phone, which the splash normally still covers: no spinner,
  // just the page's colour for the moment it takes.
  if (blocked === null) return <View style={[styles.root, { backgroundColor: t.bg }]} />;

  if (!blocked) return <>{children}</>;

  return (
    <View style={[styles.root, styles.gate, { backgroundColor: t.bg }]}>
      <View style={[styles.icon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
        <Ionicons name="arrow-up-circle" size={40} color={ACCT} />
      </View>
      <Text style={[styles.title, { color: t.tp }]}>{TITLE}</Text>
      <Text style={[styles.body, { color: t.ts }]}>{BODY}</Text>
      {/* The persistent affordance. The native alert closes on tap; this stays,
          so the screen is never a dead end. */}
      <BounceButton onPress={() => void openAppStore()} accessibilityLabel="Update now" accessibilityRole="button">
        <View style={[styles.cta, { backgroundColor: ACCT, shadowColor: ACCT }, darkGlow(styles.cta, isDark)]}>
          <Text style={styles.ctaText}>Update Now</Text>
        </View>
      </BounceButton>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, alignItems: "center", justifyContent: "center" },
  gate:    { paddingHorizontal: 36, gap: 14 },
  icon:    { width: 76, height: 76, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title:   { fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center" },
  body:    { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 10 },
  cta:     { borderRadius: 50, paddingVertical: 15, paddingHorizontal: 40, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  ctaText: { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff" },
});
