import { Redirect } from "expo-router";
import { useUserProfile } from "../contexts/UserProfileContext";

export default function Root() {
  const { loaded, onboardingComplete } = useUserProfile();

  // Splash is still covering the screen while the flag loads (see AppShell).
  if (!loaded) return null;

  return <Redirect href={onboardingComplete ? "/home" : "/onboarding"} />;
}
