import { View } from "react-native";
import { StyleProp, ViewStyle } from "react-native";
import { NEU_BG, NEU_BG_DARK } from "../constants/theme";

// Re-exported for files that import NEU_BG from NeuCard directly
export { NEU_BG, NEU_BG_DARK };

interface NeuCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  radius?: number;
  bg?: string;
  dark?: boolean;
}

export default function NeuCard({
  children,
  style,
  innerStyle,
  radius = 20,
  bg,
  dark = false,
}: NeuCardProps) {
  const resolvedBg = bg ?? (dark ? NEU_BG_DARK : NEU_BG);
  return (
    <View
      style={[
        {
          borderRadius: radius,
          backgroundColor: resolvedBg,
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: dark ? 0.35 : 0.1,
          shadowRadius: 8,
          elevation: 4,
        },
        style,
      ]}
    >
      {/* Clip layer */}
      <View
        style={[
          {
            borderRadius: radius,
            backgroundColor: resolvedBg,
            overflow: "hidden",
          },
          innerStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
