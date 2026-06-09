import { Stack } from "expo-router";
import { useFonts, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold } from "@expo-google-fonts/nunito";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ThemeProvider } from "../contexts/ThemeContext";
import { StreakProvider } from "../contexts/StreakContext";
import { WorkoutTimerProvider } from "../contexts/WorkoutTimerContext";
import { RestTimerProvider } from "../contexts/RestTimerContext";
import { UnitProvider } from "../contexts/UnitContext";
import { AccountTypeProvider } from "../contexts/AccountTypeContext";
import { UserProfileProvider, useUserProfile } from "../contexts/UserProfileContext";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import WorkoutActiveBar from "../components/WorkoutActiveBar";

SplashScreen.preventAutoHideAsync();

function AppShell() {
  const { isDark } = useTheme();
  const { loaded: profileLoaded } = useUserProfile();
  const { loaded: authLoaded } = useAuth();

  // Hold the native splash until both the profile flag and the auth session are
  // read, so app/index.tsx can redirect to the right first screen (login vs
  // home) without a blank flash or flicker.
  useEffect(() => {
    if (profileLoaded && authLoaded) SplashScreen.hideAsync();
  }, [profileLoaded, authLoaded]);

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <StreakProvider>
        <WorkoutTimerProvider>
          <RestTimerProvider>
            <View style={{ flex: 1 }}>
              <Stack screenOptions={{ headerShown: false }} />
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

  // Splash stays up until fonts load here, then until the profile context
  // reports `loaded` (see AppShell) — so the first redirect never flickers.
  if (!loaded) return null;

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <UnitProvider>
          <AccountTypeProvider>
            <UserProfileProvider>
              <AuthProvider>
                <AppShell />
              </AuthProvider>
            </UserProfileProvider>
          </AccountTypeProvider>
        </UnitProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
