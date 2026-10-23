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

import { StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import GlassButton from "../GlassButton";
import { ACCT, compareBlue } from "../../constants/theme";
import { PILL_SHADOW } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";

export default function CompareButton({ onPress, size = 40 }: { onPress: () => void; size?: number }) {
  const { isDark } = useTheme();
  return (
    <GlassButton
      onPress={onPress}
      size={size}
      style={styles.hit}
      solidStyle={PILL_SHADOW}
      accessibilityLabel="Compare programs"
    >
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Circle cx={9.4} cy={14.6} r={6} fill={ACCT} />
        <Circle cx={14.6} cy={9.4} r={6} fill="none" stroke={compareBlue(isDark)} strokeWidth={2.2} />
      </Svg>
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  hit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
