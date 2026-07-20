// Supabase auth session, app-wide. Loads the persisted session on launch and
// tracks changes. On an actual sign-in it reconciles the local cache to the
// account (lib/cloud.reconcileOnSignIn) with data-loss protection:
//   - a failed download during an account switch CANCELS the sign-in (the
//     device is left untouched) instead of leaving a wiped cache;
//   - unclaimed on-device data (pre-backend installs) triggers an explicit
//     "import or start fresh?" prompt rather than a silent wipe.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
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
  /** True once the initial session check has finished (gate waits on this). */
  loaded: boolean;
  session: Session | null;
  userId: string | null;
}

const AuthContext = createContext<AuthContextValue>({ loaded: false, session: null, userId: null });

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
      await supabase.auth.signOut().catch(() => {});
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoaded(true);
      if (data.session) {
        void touchLastActive();
        // Keep this device's push token fresh (no-ops in Expo Go / simulator /
        // when permission isn't granted).
        void registerPushToken();
        // Deliver any reports filed while offline (no-op when none queued).
        void flushPendingReports();
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" && s) {
        // Deferred so we don't re-enter supabase from inside the auth callback.
        setTimeout(() => {
          void handleSignedIn(s.user.id);
          void touchLastActive();
          void registerPushToken();
        }, 0);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({ loaded, session, userId: session?.user.id ?? null }),
    [loaded, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
