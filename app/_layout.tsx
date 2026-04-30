import { Stack } from "expo-router";
import { useFonts, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold } from "@expo-google-fonts/nunito";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider } from "../contexts/ThemeContext";
import { StreakProvider } from "../contexts/StreakContext";
import { WorkoutTimerProvider } from "../contexts/WorkoutTimerContext";
import { useTheme } from "../contexts/ThemeContext";

SplashScreen.preventAutoHideAsync();

function AppShell() {
  const { isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <StreakProvider>
        <WorkoutTimerProvider>
          <Stack screenOptions={{ headerShown: false }} />
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

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) return null;

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
