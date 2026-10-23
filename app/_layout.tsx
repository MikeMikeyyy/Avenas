import { Stack, useRouter, DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider, type Theme } from "expo-router";
import * as Notifications from "expo-notifications";
import { useFonts, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold } from "@expo-google-fonts/nunito";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { View, AppState, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ThemeProvider } from "../contexts/ThemeContext";
import { StreakProvider } from "../contexts/StreakContext";
import { WorkoutTimerProvider } from "../contexts/WorkoutTimerContext";
import { RestTimerProvider } from "../contexts/RestTimerContext";
import { UnitProvider } from "../contexts/UnitContext";
import { AccountTypeProvider, useAccountType } from "../contexts/AccountTypeContext";
import { UserProfileProvider, useUserProfile } from "../contexts/UserProfileContext";
import { NotificationPrefsProvider } from "../contexts/NotificationPrefsContext";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { ConnectivityProvider, useOffline } from "../contexts/ConnectivityContext";
import { useTheme } from "../contexts/ThemeContext";
import { APP_DARK, APP_LIGHT, NEU_BG, NEU_BG_DARK } from "../constants/theme";
import WorkoutActiveBar from "../components/WorkoutActiveBar";
import UnfinishedWorkoutWatcher from "../components/UnfinishedWorkoutWatcher";
import RestTimerBanner from "../components/RestTimerBanner";
import ForceUpdateGate from "../components/ForceUpdateGate";
import { flushCloudPush, pushOwedBackup } from "../lib/syncManager";
import { reconcileAccountType, reconcileUnit } from "../lib/cloud";
import { touchLastActive } from "../lib/connections";
import { runWeightUnitMigrationIfNeeded } from "../utils/weightMigration";
import { runDayIdMigrationIfNeeded } from "../utils/dayIdMigration";
import { runHoldMigrationIfNeeded } from "../utils/holdMigration";
import { runExerciseRenames } from "../utils/exerciseRenameMigration";
import { linkAcceptedCopies } from "../utils/trainerStore";
import { fileStaleDraft } from "../utils/unfinishedSessionStore";
import { autoPauseIfIdle } from "../utils/programPause";
import { initNotifications, resyncScheduledNotifications } from "../utils/notificationScheduler";
import { notificationSteps } from "../utils/notificationRoute";

SplashScreen.preventAutoHideAsync();

// How often to refresh "last active" while the app is foregrounded, so connected
// accounts can show "active now". Cleared on background.
const HEARTBEAT_MS = 120000;

// How long after launch a backup owed from before the app closed goes: clear of
// the splash and Home's first draw (lib/syncManager.ts pushOwedBackup).
const OWED_BACKUP_DELAY_MS = 2000;

// Insights modal options. `detachPreviousScreen: false` keeps Home mounted behind
// the modal — without it the native stack tears Home down while the modal is up
// and rebuilds it on dismiss, so Home blanks then repopulates. It's a valid
// native-stack runtime option but isn't in Expo Router's option types yet; a
// named (non-fresh) const sidesteps the excess-property check without `any`.
const INSIGHTS_MODAL_OPTIONS = { presentation: "modal" as const, detachPreviousScreen: false };

// The navigators' own theme, in the app's colours. The native stack paints its
// NATIVE container (the view behind every pushed screen) with `colors.background`,
// and with no theme given that's the library default, near-white rgb(242,242,242)
// in both modes. iOS rounds a screen's corners while it slides in or out, so in
// dark mode that container showed as white corners on every push (My Programs,
// Journal). The Stack's contentStyle and the system root colour sit on other
// views and can't reach it.
const NAV_LIGHT: Theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: APP_LIGHT.bg, card: NEU_BG, text: APP_LIGHT.tp, border: APP_LIGHT.div },
};
const NAV_DARK: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: APP_DARK.bg, card: NEU_BG_DARK, text: APP_DARK.tp, border: APP_DARK.div },
};

function AppShell() {
  const { isDark, loaded: themeLoaded } = useTheme();
  const { loaded: profileLoaded } = useUserProfile();
  const { loaded: authLoaded, userId, endedElsewhere } = useAuth();
  const router = useRouter();

  // Local notifications: install the foreground-presentation handler once, then
  // rebuild the pending 7-day schedule on launch and on every background —
  // leaving the app is when the schedule must reflect the state left behind
  // (workout done → today's reminder gone; program changed → new days).
  useEffect(() => {
    initNotifications();
    resyncScheduledNotifications();
  }, []);

  // Tapping a notification (push or local) routes to the screen in its data.url
  // (e.g. a message push opens that chat; utils/notificationRoute.ts has the
  // one that opens more than its url). Covers cold starts too — the hook
  // replays the response that launched the app. It waits for the account type,
  // which decides where a message goes, and handles each response once, since
  // the effect runs again when that arrives.
  const notifResponse = Notifications.useLastNotificationResponse();
  const { accountType, loaded: accountTypeLoaded } = useAccountType();
  const handledNotif = useRef<string | null>(null);
  useEffect(() => {
    const url = notifResponse?.notification.request.content.data?.url;
    if (typeof url !== "string" || !url.startsWith("/") || !accountTypeLoaded || !authLoaded) return;
    const id = notifResponse?.notification.request.identifier ?? url;
    if (handledNotif.current === id) return;
    handledNotif.current = id;
    void notificationSteps(url, accountType, userId ?? "").then(steps => {
      steps.forEach((step, i) => (i === 0 ? router.navigate(step) : router.push(step)));
    });
  }, [notifResponse, router, accountType, accountTypeLoaded, authLoaded, userId]);

  // Hold the native splash until the profile flag and the auth session are
  // read, so app/index.tsx can redirect to the right first screen (login vs
  // home) without a blank flash or flicker, and the saved theme, so that
  // screen isn't drawn light for a frame before turning dark. All three are
  // read off the phone: nothing on the way to Home may wait on the server,
  // which with no signal can be forever (user report, 2026-10-14).
  useEffect(() => {
    if (profileLoaded && authLoaded && themeLoaded) SplashScreen.hideAsync();
  }, [profileLoaded, authLoaded, themeLoaded]);

  // The server ended this phone's sign-in (signed out on another phone, the
  // account deleted elsewhere), seen when a token renewal is refused. The app's
  // own sign-outs go to the start themselves; this one would leave the person
  // in the app signed out, every backup skipped. A workout in progress stays on
  // the phone and comes back when the same account signs in again.
  useEffect(() => {
    if (endedElsewhere === 0) return;
    if (router.canDismiss()) router.dismissAll();
    router.replace("/onboarding");
    Alert.alert("You've been signed out", "Sign in again to keep backing up your training.");
  }, [endedElsewhere, router]);

  // A backup owed from before the app closed (a workout logged with no
  // signal) goes a moment after launch, once per launch. Offline it fails and
  // stays owed for when the signal comes back (below).
  const owedChecked = useRef(false);
  useEffect(() => {
    if (!authLoaded || !userId || owedChecked.current) return;
    const id = setTimeout(() => {
      owedChecked.current = true;
      void pushOwedBackup();
    }, OWED_BACKUP_DELAY_MS);
    return () => clearTimeout(id);
  }, [authLoaded, userId]);

  // Repair accounts whose server-side account_type drifted from the one this
  // device uses (the Profile toggle was local-only before migration 0015). Until
  // it matches, connected accounts see this user under the wrong role. No-ops
  // when signed out or already in sync.
  useEffect(() => { void reconcileAccountType(); }, []);

  // Same repair for kg/lb, which a trainer now reads to show this person's
  // numbers in their unit (0036). The Settings toggle never reached the cloud
  // before this build, so the server may still hold the sign-up choice.
  useEffect(() => { void reconcileUnit(); }, []);

  // A full week with nothing logged puts the active program on hold by itself,
  // so it isn't silently marching through weeks you didn't train. No-ops once
  // paused; also runs on foreground below, since the app is often left open.
  useEffect(() => { void autoPauseIfIdle(); }, []);

  // Two foreground/background jobs:
  //  - Cloud-backup safety net: on leaving the foreground, push any changes from
  //    the last debounce window (flushCloudPush no-ops when signed out / wrong owner).
  //  - Presence heartbeat: refresh "last active" on mount, on every foreground,
  //    and on a light interval while foregrounded (touchLastActive no-ops when
  //    signed out), so connected accounts can show "active now".
  useEffect(() => {
    void touchLastActive();
    let beat: ReturnType<typeof setInterval> | null = setInterval(() => void touchLastActive(), HEARTBEAT_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        flushCloudPush();
        resyncScheduledNotifications();
        if (beat) { clearInterval(beat); beat = null; }
      } else if (state === "active") {
        void touchLastActive();
        void autoPauseIfIdle();
        // Also resync on the way IN, not just on the way out. iOS keeps this app
        // resident for days, so a return from the background is often the first
        // time a new day is seen — and the schedule left behind still assumes
        // the app went unopened. Without this, the streak reminder queued for
        // tonight survives right up until the next background, and fires on a
        // day the user did open the app.
        resyncScheduledNotifications();
        if (!beat) beat = setInterval(() => void touchLastActive(), HEARTBEAT_MS);
      }
    });
    return () => { sub.remove(); if (beat) clearInterval(beat); };
  }, []);

  // Back online: a backup owed while the phone had no signal goes now, which
  // is what the Workout page's offline banner promises a session logged then.
  // Only on the change back; at launch it's the delayed check above.
  const offline = useOffline();
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (wasOffline.current && !offline) void pushOwedBackup();
    wasOffline.current = offline;
  }, [offline]);

  // Theme the navigator's screen background. React Navigation's default screen
  // background is white, which flashes through during the Insights modal's dismiss
  // transition (and the window re-measure it triggers) before Home repaints.
  // Giving every screen a themed contentStyle bg removes the white flash.
  const navBg = isDark ? APP_DARK.bg : APP_LIGHT.bg;

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <StreakProvider>
        <WorkoutTimerProvider>
          <RestTimerProvider>
            {/* Wraps the navigator, so a blocked build can't reach ANY screen —
                including via a deep link or a notification tap. */}
            <ForceUpdateGate>
              <NavThemeProvider value={isDark ? NAV_DARK : NAV_LIGHT}>
                <View style={{ flex: 1, backgroundColor: navBg }}>
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: navBg } }}>
                    <Stack.Screen name="insights" options={INSIGHTS_MODAL_OPTIONS} />
                  </Stack>
                  {/* Over every screen: the workout bar, which grows to hold a
                      rest off the Workout page, and the rest pill, which shows
                      it on that page and above the keyboard
                      (constants/floatingBars.ts). */}
                  <WorkoutActiveBar />
                  <RestTimerBanner />
                  {/* A workout forgotten: asks to finish it, says when one
                      was saved to the Journal unfinished, and reminds on the
                      way out. Draws nothing. */}
                  <UnfinishedWorkoutWatcher />
                </View>
              </NavThemeProvider>
            </ForceUpdateGate>
          </RestTimerProvider>
        </WorkoutTimerProvider>
      </StreakProvider>
    </>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
  });

  // One-shot data migrations, run in sequence (each rewrites
  // @avenas/workout_history, and the first two @avenas/programs too, so they
  // must not interleave). The whole app is gated on them: no screen may render
  // pre-migration data through the new kg-canonical display lens, read a
  // program day before it has a stable id, or count a plank's seconds as reps.
  // Then the catalogue's exercise renames, on every launch (programs and
  // favourites only; utils/exerciseRenameMigration.ts), and each accepted copy's
  // origin learnt from this phone's share links while they're here, so the
  // next backup carries it (utils/trainerStore.ts linkAcceptedCopies). Last, a
  // workout left unfinished on a day that's over goes to the Journal with what
  // was entered in it, so Home and the Journal open with it and the Workout
  // tab and its clock start on the new day (utils/unfinishedSessionStore.ts).
  const [migrated, setMigrated] = useState(false);
  useEffect(() => {
    runWeightUnitMigrationIfNeeded()
      .then(runDayIdMigrationIfNeeded)
      .then(runHoldMigrationIfNeeded)
      .then(runExerciseRenames)
      .then(linkAcceptedCopies)
      .then(() => fileStaleDraft())
      .finally(() => setMigrated(true));
  }, []);

  // Splash stays up until fonts load here, then until the profile context
  // reports `loaded` (see AppShell) — so the first redirect never flickers.
  if (!loaded || !migrated) return null;

  return (
    <KeyboardProvider>
      <ConnectivityProvider>
        <ThemeProvider>
          <UnitProvider>
            <AccountTypeProvider>
              <UserProfileProvider>
                <NotificationPrefsProvider>
                  <AuthProvider>
                    <AppShell />
                  </AuthProvider>
                </NotificationPrefsProvider>
              </UserProfileProvider>
            </AccountTypeProvider>
          </UnitProvider>
        </ThemeProvider>
      </ConnectivityProvider>
    </KeyboardProvider>
  );
}
