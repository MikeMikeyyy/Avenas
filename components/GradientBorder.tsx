import { LinearGradient } from "expo-linear-gradient";
import { StyleProp, View, ViewStyle } from "react-native";

const CARD = "#1e1e1e";

export interface GradientBorderProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  radius?: number;
  colors?: readonly [string, string, ...string[]];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}

export default function GradientBorder({
  children,
  style,
  innerStyle,
  radius = 20,
  colors = ["rgba(255,255,255,0.9)", "rgba(255,255,255,0.2)"] as const,
  start = { x: 0, y: 0 },
  end = { x: 1, y: 1 },
}: GradientBorderProps) {
  return (
    <LinearGradient
      colors={colors}
      start={start}
      end={end}
      style={[{ borderRadius: radius + 0.5, padding: 0.5 }, style]}
    >
      <View style={[{ borderRadius: radius, backgroundColor: CARD, overflow: "hidden" }, innerStyle]}>
        {children}
      </View>
    </LinearGradient>
  );
}
