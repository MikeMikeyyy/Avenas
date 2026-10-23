// The favourite star on an exercise's two pages, its screen and its history
// (user request, 2026-10-22: the history page didn't say whether it was one),
// across from the back button so it reads as a control rather than decoration.
// The same gold and the same storage key as the picker's star, so all three
// always agree; read again on every focus, since the picker writes the key too.

import { useCallback, useState } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import FavouriteStar from "./FavouriteStar";
import GlassButton from "./GlassButton";
import { BACK_LEFT, BACK_SIZE, BACK_TOP } from "./BackButton";
import { APP_DARK, APP_LIGHT } from "../constants/theme";
import { FAVOURITE_EXERCISES_KEY } from "../constants/exercises";
import { useTheme } from "../contexts/ThemeContext";
import { getJSON, setJSON } from "../utils/storage";
import { isFavourite, toggleFavourite } from "../utils/exerciseFavourites";

export default function FavouriteExerciseButton({ name }: { name: string }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [favourites, setFavourites] = useState<string[]>([]);
  const starred = isFavourite(favourites, name);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getJSON<string[]>(FAVOURITE_EXERCISES_KEY, []).then(v => {
        if (!cancelled && Array.isArray(v)) {
          setFavourites(v.filter((n): n is string => typeof n === "string"));
        }
      }).catch(() => {});
      return () => { cancelled = true; };
    }, []),
  );

  // The light haptic is GlassButton's.
  const toggle = useCallback(() => {
    setFavourites(prev => {
      const next = toggleFavourite(prev, name);
      setJSON(FAVOURITE_EXERCISES_KEY, next).catch(() => {});
      return next;
    });
  }, [name]);

  return (
    <GlassButton
      onPress={toggle}
      size={BACK_SIZE}
      style={[styles.floating, { top: insets.top + BACK_TOP }]}
      accessibilityLabel={starred ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
      accessibilityState={{ selected: starred }}
    >
      <FavouriteStar size={20} filled={starred} inactiveColor={t.ts} />
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", right: BACK_LEFT, zIndex: 10 },
});
