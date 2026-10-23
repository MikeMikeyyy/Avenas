// The one way into an archive (app/program-archive.tsx): a round button, the
// back button's size, on each page that has one. One component so the pages
// show the same button.
//
// `floating` pins it over the page at the top right, mirroring the back button
// across the screen (same BACK_TOP, BACK_LEFT in from the right edge, same
// circle), so it stays put while the page scrolls under it: My Programs, the
// trainer's Programs and a group's Programs. Without it, it's a plain item
// for a row of its own. Glass on iOS 26 (components/GlassButton.tsx).

import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GlassButton from "./GlassButton";
import { BACK_LEFT, BACK_SIZE, BACK_TOP } from "./BackButton";
import ArchiveIcon from "./icons/ArchiveIcon";
import { APP_DARK, APP_LIGHT } from "../constants/theme";
import { PILL_SHADOW } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";

export default function ArchiveButton({ onPress, floating = false }: { onPress: () => void; floating?: boolean }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  return (
    <GlassButton
      onPress={onPress}
      size={BACK_SIZE}
      style={floating ? [styles.floating, { top: insets.top + BACK_TOP }] : undefined}
      // Floating, it matches the back button it faces, which has no shadow;
      // in a row, the other round buttons there, which do.
      solidStyle={floating ? undefined : PILL_SHADOW}
      accessibilityLabel="Open archive"
    >
      <ArchiveIcon size={20} color={t.tp} />
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", right: BACK_LEFT, zIndex: 10 },
});
