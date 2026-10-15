// Supabase auth session, app-wide. Opens on the sign-in saved on the phone and
// follows supabase-js's events from there, so the launch never waits on the
// server: offline with a token over an hour old, getSession() took up to half a
// minute and then said nobody was signed in, which held the splash and sent a
// signed-in person to onboarding (user report, 2026-10-14; utils/savedSession.ts).
// On an actual sign-in it reconciles the local cache to the
// account (lib/cloud.reconcileOnSignIn) with data-loss protection:
//   - a failed download during an account switch CANCELS the sign-in (the
//     device is left untouched) instead of leaving a wiped cache;
//   - unclaimed on-device data (pre-backend installs) triggers an explicit
//     "import or start fresh?" prompt rather than a silent wipe.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { isOwnSignOut, readSavedSession, signOutHere, supabase } from "../lib/supabase";
import { sessionAfterEvent, signedOutElsewhere } from "../utils/savedSession";
import {
  reconcileOnSignIn,
  keepDeviceData,
  replaceWithCloudData,
  cloudCounts,
  AccountSwitchLoadError,
} from "../lib/cloud";
import { touchLastActive } from "../lib/connections";
import { registerPushToken } from "../lib/push";
import { flushPendingReports } from "../utils/moderation";

interface AuthContextValue {
  /** True once the saved sign-in has been read off the phone (the splash waits
   *  on this, never on the server). */
  loaded: boolean;
  /** Its access token may be out of date while there's no signal; supabase-js
   *  renews it in the background, and every request it makes renews it first. */
  session: Session | null;
  userId: string | null;
  /** How many times the server has ended this phone's sign-in while the app was
   *  open (signed out on another phone, the account deleted elsewhere). AppShell
   *  takes the person to sign in again; the app's own sign-outs never count. */
  endedElsewhere: number;
}

const AuthContext = createContext<AuthContextValue>({ loaded: false, session: null, userId: null, endedElsewhere: 0 });

// Unclaimed local data (no cache owner): ask whose it is instead of wiping it.
// It may be months of offline training from before this account existed.
// cancelable: false — dismissing without choosing would leave the cache
// unclaimed and the question unanswered.
function promptImportChoice(userId: string) {
  void (async () => {
    let cloudHasData = false;
    try {
      const c = await cloudCounts(userId);
      cloudHasData = c.programs + c.workouts + c.journal + c.customExercises > 0;
    } catch { /* can't read the cloud — the copy below still offers both paths */ }

    const fail = () =>
      Alert.alert(
        "That didn't work",
        "We couldn't finish setting up your data. Everything on this device is unchanged. It will ask again next time you sign in.",
      );
    const keep = () => { keepDeviceData(userId).catch(fail); };
    const cloud = () => { replaceWithCloudData(userId).catch(fail); };

    if (cloudHasData) {
      Alert.alert(
        "Data found on this device",
        "This device has workout data that isn't linked to an account, and your account also has a cloud backup. Which one do you want to use? The other will be replaced.",
        [
          { text: "Use Cloud Backup", onPress: cloud },
          { text: "Keep Device Data", onPress: keep },
        ],
        { cancelable: false },
      );
    } else {
      Alert.alert(
        "Data found on this device",
        "This device has workout data that isn't linked to an account yet. Do you want to import it into this account?",
        [
          { text: "Start Fresh", style: "destructive", onPress: cloud },
          { text: "Import My Data", onPress: keep },
        ],
        { cancelable: false },
      );
    }
  })();
}

async function handleSignedIn(userId: string) {
  try {
    const result = await reconcileOnSignIn(userId);
    if (result === "import_choice") promptImportChoice(userId);
  } catch (e) {
    if (e instanceof AccountSwitchLoadError) {
      // The switch aborted with the device untouched. Cancel the sign-in too,
      // so the previous account's local data is never shown to this account.
      await signOutHere().catch(() => {});
      Alert.alert(
        "Couldn't load your data",
        "We couldn't download this account's data, so the sign-in was cancelled to protect the data stored on this device. Check your connection and try again.",
      );
      return;
    }
    if (__DEV__) console.warn("[avenas] reconcileOnSignIn", e);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [endedElsewhere, setEndedElsewhere] = useState(0);

  useEffect(() => {
    // The session as of the last event, which the next one is read against.
    let current: Session | null = null;
    // supabase-js has said who's signed in, so the saved copy is out of date.
    let heard = false;
    // The jobs that need the server, once per launch, as soon as supabase-js
    // has a session it could renew.
    let jobsRan = false;
    const runSessionJobs = () => {
      if (jobsRan) return;
      jobsRan = true;
      void touchLastActive();
      // Keep this device's push token fresh (no-ops in Expo Go / simulator /
      // when permission isn't granted).
      void registerPushToken();
      // Deliver any reports filed while offline (no-op when none queued).
      void flushPendingReports();
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (signedOutElsewhere(current, event, isOwnSignOut())) setEndedElsewhere(n => n + 1);
      if (event !== "INITIAL_SESSION" || s) heard = true;
      current = sessionAfterEvent(current, event, s);
      setSession(current);
      // The token renewed once the signal came back, after a launch without it.
      if (event === "TOKEN_REFRESHED" && s) runSessionJobs();
      // A reset code from Forgot Password (app/forgot-password.tsx) signs in
      // as PASSWORD_RECOVERY instead of SIGNED_IN; it's a sign-in all the same,
      // and must load this account's data like any other.
      if ((event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") && s) {
        // Deferred so we don't re-enter supabase from inside the auth callback.
        setTimeout(() => {
          void handleSignedIn(s.user.id);
          void touchLastActive();
          void registerPushToken();
        }, 0);
      }
    });

    // Who's signed in, off the phone alone, so the splash lifts at once with or
    // without a signal.
    void readSavedSession().then((saved) => {
      if (!heard) {
        current = saved;
        setSession(saved);
      }
      setLoaded(true);
    });

    // getSession() renews an old token before answering: with no signal that's
    // up to half a minute and then no session, and the jobs wait for the
    // renewal instead (TOKEN_REFRESHED above).
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) runSessionJobs();
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({ loaded, session, userId: session?.user.id ?? null, endedElsewhere }),
    [loaded, session, endedElsewhere],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
