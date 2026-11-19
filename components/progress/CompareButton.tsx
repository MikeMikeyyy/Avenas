// components/progress/CompareButton.tsx
//
// The Progress page's way into comparing two programs: a round button with
// two overlapping circles, green and periwinkle (the Program Compare canvas).
// It's always there; with nothing to compare yet it opens the sheet locked,
// saying what comparing needs (user request, 2026-10-15). Glass on iOS 26
// (components/GlassButton.tsx; user request, 2026-10-23).
//
// The circles sit on a diagonal, green low and periwinkle high, like Lucide's
// "blend" (user request, 2026-10-22): its spacing (6 apart each way at r 7)
// scaled to these r 6 circles, centred on the box.
//
// On the Progress page the filter dock draws it (components/progress/
// FilterDock.tsx), and the page holds its place with a `ghost`.

import { StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import GlassButton from "../GlassButton";
import { ACCT, compareBlue } from "../../constants/theme";
import { PILL_SHADOW } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";

/** The circle, across. */
export const COMPARE_SIZE = 40;
/** Its touch area round the circle, wider by 2 each side: a layout lining
 *  the circle itself up takes the spare off. */
export const COMPARE_HIT = 44;

/** The two circles, the button's face (the filter dock draws it too). */
export function CompareMark() {
  const { isDark } = useTheme();
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Circle cx={9.4} cy={14.6} r={6} fill={ACCT} />
      <Circle cx={14.6} cy={9.4} r={6} fill="none" stroke={compareBlue(isDark)} strokeWidth={2.2} />
    </Svg>
  );
}

export default function CompareButton({ onPress, size = COMPARE_SIZE, ghost = false }: {
  onPress: () => void;
  size?: number;
  /** Unseen, holding its place for the filter dock to draw over. */
  ghost?: boolean;
}) {
  return (
    <GlassButton
      onPress={onPress}
      size={size}
      ghost={ghost}
      style={styles.hit}
      solidStyle={PILL_SHADOW}
      accessibilityLabel="Compare programs"
    >
      <CompareMark />
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  hit: { minWidth: COMPARE_HIT, minHeight: COMPARE_HIT, alignItems: "center", justifyContent: "center" },
});
