import { Stack, useRouter, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import { useFonts, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold } from "@expo-google-fonts/nunito";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { View, AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ThemeProvider } from "../contexts/ThemeContext";
import { StreakProvider } from "../contexts/StreakContext";
import { WorkoutTimerProvider } from "../contexts/WorkoutTimerContext";
import { RestTimerProvider } from "../contexts/RestTimerContext";
import { UnitProvider } from "../contexts/UnitContext";
import { AccountTypeProvider } from "../contexts/AccountTypeContext";
import { UserProfileProvider, useUserProfile } from "../contexts/UserProfileContext";
import { NotificationPrefsProvider } from "../contexts/NotificationPrefsContext";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { APP_DARK, APP_LIGHT } from "../constants/theme";
import WorkoutActiveBar from "../components/WorkoutActiveBar";
import { flushCloudPush } from "../lib/syncManager";
import { touchLastActive } from "../lib/connections";
import { runWeightUnitMigrationIfNeeded } from "../utils/weightMigration";
import { initNotifications, resyncScheduledNotifications } from "../utils/notificationScheduler";

SplashScreen.preventAutoHideAsync();

// How often to refresh "last active" while the app is foregrounded, so connected
// accounts can show "active now". Cleared on background.
const HEARTBEAT_MS = 120000;

// Insights modal options. `detachPreviousScreen: false` keeps Home mounted behind
// the modal — without it the native stack tears Home down while the modal is up
// and rebuilds it on dismiss, so Home blanks then repopulates. It's a valid
// native-stack runtime option but isn't in Expo Router's option types yet; a
// named (non-fresh) const sidesteps the excess-property check without `any`.
const INSIGHTS_MODAL_OPTIONS = { presentation: "modal" as const, detachPreviousScreen: false };

function AppShell() {
  const { isDark } = useTheme();
  const { loaded: profileLoaded } = useUserProfile();
  const { loaded: authLoaded } = useAuth();
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
  // (e.g. a message push opens that chat). Covers cold starts too — the hook
  // replays the response that launched the app.
  const notifResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = notifResponse?.notification.request.content.data?.url;
    if (typeof url === "string" && url.startsWith("/")) router.navigate(url as Href);
  }, [notifResponse, router]);

  // Hold the native splash until both the profile flag and the auth session are
  // read, so app/index.tsx can redirect to the right first screen (login vs
  // home) without a blank flash or flicker.
  useEffect(() => {
    if (profileLoaded && authLoaded) SplashScreen.hideAsync();
  }, [profileLoaded, authLoaded]);

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
        if (!beat) beat = setInterval(() => void touchLastActive(), HEARTBEAT_MS);
      }
    });
    return () => { sub.remove(); if (beat) clearInterval(beat); };
  }, []);

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
            <View style={{ flex: 1, backgroundColor: navBg }}>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: navBg } }}>
                <Stack.Screen name="insights" options={INSIGHTS_MODAL_OPTIONS} />
              </Stack>
              <WorkoutActiveBar />
            </View>
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

  // One-shot lb→kg weight migration. Gate the whole app on it so no screen ever
  // renders pre-migration data through the new kg-canonical display lens.
  const [migrated, setMigrated] = useState(false);
  useEffect(() => {
    runWeightUnitMigrationIfNeeded().finally(() => setMigrated(true));
  }, []);

  // Splash stays up until fonts load here, then until the profile context
  // reports `loaded` (see AppShell) — so the first redirect never flickers.
  if (!loaded || !migrated) return null;

  return (
    <KeyboardProvider>
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
    </KeyboardProvider>
  );
}
