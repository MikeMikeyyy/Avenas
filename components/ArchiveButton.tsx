// The one way into an archive (app/program-archive.tsx): a round button, the
// back button's size, on each page that has one. One component so the pages
// show the same button.
//
// `floating` pins it over the page at the top right, mirroring the back button
// across the screen (same BACK_TOP, BACK_LEFT in from the right edge, same
// circle), so it stays put while the page scrolls under it: My Programs. The
// Trainer tab and a group's page place it inline, in their own top rows.

import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import BounceButton from "./BounceButton";
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
    <BounceButton
      onPress={onPress}
      style={floating ? [styles.floating, { top: insets.top + BACK_TOP }] : undefined}
      accessibilityLabel="Open archive"
      accessibilityRole="button"
    >
      {/* Floating, it matches the back button it faces, which has no shadow;
          inline, the other round buttons in its row, which do. */}
      <View style={[styles.btn, !floating && PILL_SHADOW, { backgroundColor: t.ctrl }]}>
        <ArchiveIcon size={20} color={t.tp} />
      </View>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", right: BACK_LEFT, zIndex: 10 },
  btn: { width: BACK_SIZE, height: BACK_SIZE, borderRadius: BACK_SIZE / 2, alignItems: "center", justifyContent: "center" },
});
