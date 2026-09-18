import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SystemUI from "expo-system-ui";

import { APP_DARK, APP_LIGHT } from "../constants/theme";

const THEME_KEY = "@avenas/theme";

interface ThemeContextValue {
  isDark: boolean;
  toggleDark: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  toggleDark: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to LIGHT. The app follows the in-app Dark Mode toggle only, NOT the
  // device's system theme — a fresh install starts light and only goes dark once
  // the user has explicitly turned dark mode on (persisted at THEME_KEY).
  const [isDark, setIsDark] = useState(false);

  // Apply the saved preference on mount; stay light when none is saved.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_KEY);
        if (saved !== null) setIsDark(saved === "dark");
      } catch {
        // keep light on read failure
      }
    })();
  }, []);

  // Paint the NATIVE root view behind every screen. Left alone it stays the
  // platform default (white), and any frame where a screen isn't painted yet
  // shows it: a stack push before the incoming screen's first paint, a tab
  // scene the OS reclaimed and is rebuilding, a screen fading in from
  // transparent. In dark mode that reads as a white flash between screens, and
  // it only starts once the app has been used long enough for screens to be
  // torn down and re-created. The JS-side backgrounds (the Stack's
  // contentStyle, each screen's own bg) can't cover those frames, because
  // there's nothing rendered yet to carry them.
  //
  // Fire and forget: a failure here is cosmetic and must never block the theme.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(isDark ? APP_DARK.bg : APP_LIGHT.bg).catch(() => {});
  }, [isDark]);

  const toggleDark = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      AsyncStorage.setItem(THEME_KEY, next ? "dark" : "light").catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({ isDark, toggleDark }), [isDark, toggleDark]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
