import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
