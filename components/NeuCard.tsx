import { View } from "react-native";
import { StyleProp, ViewStyle } from "react-native";
import { NEU_BG, NEU_BG_DARK } from "../constants/theme";

// Re-exported for files that import NEU_BG from NeuCard directly
export { NEU_BG, NEU_BG_DARK };

// Light mode shadows
const SHADOW_LIGHT = "#FFFFFF";
const SHADOW_DARK  = "#a3afc0";

interface NeuCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  radius?: number;
  variant?: "raised" | "inset";
  bg?: string;
  shadowSize?: "sm" | "md";
  dark?: boolean;
  fill?: boolean;
}

export default function NeuCard({
  children,
  style,
  innerStyle,
  radius = 20,
  variant = "raised",
  bg,
  shadowSize = "md",
  dark = false,
  fill = false,
}: NeuCardProps) {
  const resolvedBg = bg ?? (dark ? NEU_BG_DARK : NEU_BG);
  const isInset = variant === "inset";
  const sm = shadowSize === "sm";

  const fillStyle = fill ? { flex: 1 } : undefined;

  // Dark mode: clean single shadow, no light highlight
  if (dark) {
    return (
      <View
        style={[
          {
            borderRadius: radius,
            backgroundColor: resolvedBg,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.35,
            shadowRadius: 8,
            elevation: 4,
          },
          fillStyle,
          style,
        ]}
      >
        <View
          style={[
            {
              borderRadius: radius,
              backgroundColor: resolvedBg,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.2)",
            },
            fillStyle,
            innerStyle,
          ]}
        >
          {children}
        </View>
      </View>
    );
  }

  // Light mode: full neumorphic effect
  const shadowA = isInset ? SHADOW_LIGHT : SHADOW_DARK;
  const shadowB = isInset ? SHADOW_DARK  : SHADOW_LIGHT;

  return (
    // Dark shadow wrapper (bottom-right depth)
    <View
      style={[
        {
          borderRadius: radius,
          backgroundColor: resolvedBg,
          shadowColor: shadowA,
          shadowOffset: { width: sm ? 3 : 4, height: sm ? 3 : 4 },
          shadowOpacity: isInset ? 1 : 0.5,
          shadowRadius: isInset ? 5 : sm ? 5 : 8,
        },
        fillStyle,
        style,
      ]}
    >
      {/* White/light shadow wrapper (top-left highlight) */}
      <View
        style={[
          {
            borderRadius: radius,
            backgroundColor: resolvedBg,
            shadowColor: shadowB,
            shadowOffset: { width: sm ? -2 : -3, height: sm ? -2 : -3 },
            shadowOpacity: 1,
            shadowRadius: isInset ? 5 : sm ? 3 : 4,
          },
          fillStyle,
        ]}
      >
        {/* Clip layer — prevents any shadow bleed at corners */}
        <View
          style={[
            {
              borderRadius: radius,
              backgroundColor: resolvedBg,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.85)",
            },
            fillStyle,
            innerStyle,
          ]}
        >
          {children}
        </View>
      </View>
    </View>
  );
}
