// The back button on every pushed screen, and the one place it sits.
//
// 16 below the top safe area, 20 in from the left (the edge the page's cards
// line up with), 40 round. It had drifted to four positions across ~35
// screens (14 or 16 down; 16, 20, 22 or 26 in), so it jumped sideways as you
// moved from page to page.
//
// A page's title lines up with it by sharing these numbers, not by eye: the
// title row starts at `insets.top + BACK_TOP` and is `BACK_SIZE` tall with its
// items centred, so the title's centre IS the button's centre. A button on the
// right of the same page sits at the same `BACK_TOP`.
//
// Floating (the default) pins it over the page. `inline` makes it a plain item
// for a header bar, whose row supplies the position instead:
// `paddingTop: insets.top + BACK_TOP`, `paddingHorizontal: BACK_LEFT`.
//
// Drawn as components/GlassButton.tsx: Liquid Glass on iOS 26, the solid
// control circle below that.

import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import GlassButton from "./GlassButton";
import { APP_DARK, APP_LIGHT } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

export const BACK_TOP = 16;
export const BACK_LEFT = 20;
export const BACK_SIZE = 40;

export default function BackButton({
  onPress,
  inline = false,
  accessibilityLabel = "Go back",
}: {
  /** Defaults to router.back(). */
  onPress?: () => void;
  inline?: boolean;
  accessibilityLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  return (
    <GlassButton
      onPress={() => {
        if (onPress) onPress();
        else router.back();
      }}
      size={BACK_SIZE}
      style={inline ? undefined : [styles.floating, { top: insets.top + BACK_TOP }]}
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name="chevron-back" size={22} color={t.tp} />
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", left: BACK_LEFT, zIndex: 10 },
});
