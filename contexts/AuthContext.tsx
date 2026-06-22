// Supabase auth session, app-wide. Loads the persisted session on launch and
// tracks changes. On an actual sign-in it kicks off a one-time, non-destructive
// sync (lib/cloud.syncOnLogin) so the user's data reconciles automatically.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { reconcileOnSignIn } from "../lib/cloud";
import { touchLastActive } from "../lib/connections";

interface AuthContextValue {
  /** True once the initial session check has finished (gate waits on this). */
  loaded: boolean;
  session: Session | null;
  userId: string | null;
}

const AuthContext = createContext<AuthContextValue>({ loaded: false, session: null, userId: null });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoaded(true);
      if (data.session) void touchLastActive();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" && s) {
        // Deferred so we don't re-enter supabase from inside the auth callback.
        setTimeout(() => {
          reconcileOnSignIn(s.user.id).catch((e) => {
            if (__DEV__) console.warn("[avenas] reconcileOnSignIn", e);
          });
          void touchLastActive();
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
