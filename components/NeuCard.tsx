import { View } from "react-native";
import { StyleProp, ViewStyle } from "react-native";

// Must match the page background exactly — neumorphism breaks if they differ
export const NEU_BG = "#e8ecf3ff";

// Shadows are tinted to the background hue for a natural raised-material look
const SHADOW_LIGHT = "#FFFFFF";
const SHADOW_DARK  = "#a3afc0"; // darker blue-tint of #e0e5ec

interface NeuCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  radius?: number;
  variant?: "raised" | "inset";
}

export default function NeuCard({
  children,
  style,
  innerStyle,
  radius = 20,
  variant = "raised",
}: NeuCardProps) {
  const isInset = variant === "inset";

  return (
    // Dark shadow wrapper (bottom-right depth)
    <View
      style={[
        {
          borderRadius: radius,
          backgroundColor: NEU_BG,
          shadowColor: isInset ? SHADOW_LIGHT : SHADOW_DARK,
          shadowOffset: { width: 6, height: 6 },
          shadowOpacity: isInset ? 1 : 0.7,
          shadowRadius: isInset ? 5 : 12,
        },
        style,
      ]}
    >
      {/* White shadow wrapper (top-left highlight) */}
      <View
        style={{
          borderRadius: radius,
          backgroundColor: NEU_BG,
          shadowColor: isInset ? SHADOW_DARK : SHADOW_LIGHT,
          shadowOffset: { width: -3, height: -3 },
          shadowOpacity: 1,
          shadowRadius: isInset ? 5 : 4,
        }}
      >
        {/* Clip layer — prevents any shadow bleed at corners */}
        <View
          style={[
            {
              borderRadius: radius,
              backgroundColor: NEU_BG,
              overflow: "hidden",
            },
            innerStyle,
          ]}
        >
          {children}
        </View>
      </View>
    </View>
  );
}
