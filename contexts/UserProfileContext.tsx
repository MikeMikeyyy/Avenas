import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { getJSON, setJSON, removeKey } from "../utils/storage";

// Local-only user profile + first-launch onboarding flag.
// The app has no backend yet, so "signup" is a local profile capture:
//   - @avenas/user_profile      → { name, email } (powers the Settings avatar)
//   - @avenas/onboarding_complete → true once the hero deck + signup are done
//     (or skipped), so the flow only ever appears on first launch.
// Keys are defined + exported here, mirroring AccountTypeContext's precedent.
export const USER_PROFILE_KEY = "@avenas/user_profile";
export const ONBOARDING_COMPLETE_KEY = "@avenas/onboarding_complete";

export interface UserProfile {
  name: string;
  email: string;
  /** Public URL of the profile photo (synced via the cloud profile). Undefined
   *  when none is set — callers fall back to initials. */
  photoUri?: string;
}

const EMPTY_PROFILE: UserProfile = { name: "", email: "" };

/** Up-to-two-letter avatar initials from a display name ("" when blank).
 *  Digits are stripped first, so "Test Mikey 1" → "TM" (first + last word). */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).map((p) => p.replace(/[0-9]/g, "")).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface UserProfileContextValue {
  loaded: boolean;
  onboardingComplete: boolean;
  profile: UserProfile;
  setProfile: (p: UserProfile) => void;
  /** Marks onboarding done (and optionally saves the captured profile). */
  completeOnboarding: (p?: UserProfile) => void;
  /** Clears the saved profile + onboarding flag (used by the dev reset). */
  resetOnboarding: () => void;
}

const UserProfileContext = createContext<UserProfileContextValue>({
  loaded: false,
  onboardingComplete: false,
  profile: EMPTY_PROFILE,
  setProfile: () => {},
  completeOnboarding: () => {},
  resetOnboarding: () => {},
});

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [profile, setProfileState] = useState<UserProfile>(EMPTY_PROFILE);

  useEffect(() => {
    (async () => {
      const [savedProfile, complete] = await Promise.all([
        getJSON<UserProfile>(USER_PROFILE_KEY, EMPTY_PROFILE),
        getJSON<boolean>(ONBOARDING_COMPLETE_KEY, false),
      ]);
      setProfileState(savedProfile);
      setOnboardingComplete(complete === true);
      setLoaded(true);
    })();
  }, []);

  const setProfile = useCallback((p: UserProfile) => {
    setProfileState(p);
    setJSON(USER_PROFILE_KEY, p);
  }, []);

  const completeOnboarding = useCallback((p?: UserProfile) => {
    if (p) {
      setProfileState(p);
      setJSON(USER_PROFILE_KEY, p);
    }
    setOnboardingComplete(true);
    setJSON(ONBOARDING_COMPLETE_KEY, true);
  }, []);

  const resetOnboarding = useCallback(() => {
    setProfileState(EMPTY_PROFILE);
    setOnboardingComplete(false);
    removeKey(USER_PROFILE_KEY);
    removeKey(ONBOARDING_COMPLETE_KEY);
  }, []);

  const value = useMemo(
    () => ({ loaded, onboardingComplete, profile, setProfile, completeOnboarding, resetOnboarding }),
    [loaded, onboardingComplete, profile, setProfile, completeOnboarding, resetOnboarding],
  );

  return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>;
}

export function useUserProfile() {
  return useContext(UserProfileContext);
}
