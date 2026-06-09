import { Redirect } from "expo-router";
import { useAuth } from "../contexts/AuthContext";

export default function Root() {
  const { loaded, session } = useAuth();

  // Splash is still covering the screen while the session loads (see AppShell).
  if (!loaded) return null;

  // Require sign-in: a session goes to the app, otherwise into onboarding/login.
  return <Redirect href={session ? "/home" : "/onboarding"} />;
}
