// components/progress/CompareButton.tsx
//
// The Progress page's way into comparing two programs: a round button with
// two overlapping circles, green and periwinkle (the Program Compare canvas).
// It shows once there's a finished program to compare with.

import { View, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import * as Haptics from "expo-haptics";
import BounceButton from "../BounceButton";
import { ACCT, APP_DARK, APP_LIGHT, compareBlue } from "../../constants/theme";
import { PILL_SHADOW } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";

export default function CompareButton({ onPress, size = 40 }: { onPress: () => void; size?: number }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <BounceButton
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel="Compare with a finished program"
      style={styles.hit}
    >
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.ctrl }]}>
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Circle cx={9} cy={12} r={6} fill={ACCT} />
          <Circle cx={15} cy={12} r={6} fill="none" stroke={compareBlue(isDark)} strokeWidth={2.2} />
        </Svg>
      </View>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  hit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  circle: { alignItems: "center", justifyContent: "center", ...PILL_SHADOW },
});
