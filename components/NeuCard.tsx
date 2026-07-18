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

  // Both modes MUST render the same 3-level view tree. A live theme toggle
  // reconciles the existing native views in place; if the tree depth differed
  // per mode (as it originally did), Fabric would repurpose views across roles
  // and leave children misplaced until the next full reload.
  const shadowA = isInset ? SHADOW_LIGHT : SHADOW_DARK;
  const shadowB = isInset ? SHADOW_DARK  : SHADOW_LIGHT;

  // Outer: dark mode = clean single drop shadow; light mode = bottom-right depth
  const outerShadow = dark
    ? {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 4,
      }
    : {
        shadowColor: shadowA,
        shadowOffset: { width: sm ? 3 : 4, height: sm ? 3 : 4 },
        shadowOpacity: isInset ? 1 : 0.5,
        shadowRadius: isInset ? 5 : sm ? 5 : 8,
      };

  // Middle: light mode = top-left highlight; dark mode = no highlight (opacity 0)
  const midShadow = dark
    ? { shadowOpacity: 0 }
    : {
        shadowColor: shadowB,
        shadowOffset: { width: sm ? -2 : -3, height: sm ? -2 : -3 },
        shadowOpacity: 1,
        shadowRadius: isInset ? 5 : sm ? 3 : 4,
      };

  const borderColor = dark ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.85)";

  return (
    // Outer shadow wrapper
    <View
      style={[
        { borderRadius: radius, backgroundColor: resolvedBg },
        outerShadow,
        fillStyle,
        style,
      ]}
    >
      {/* Highlight shadow wrapper (inert in dark mode, but kept for tree-shape stability) */}
      <View
        style={[
          { borderRadius: radius, backgroundColor: resolvedBg },
          midShadow,
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
              borderColor,
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
