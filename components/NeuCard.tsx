import { Platform, StyleSheet, View } from "react-native";
import { StyleProp, ViewStyle } from "react-native";
import { CARD_EDGE_DARK, CARD_GLOW, CARD_SHADE, CARD_SHADE_DARK, NEU_BG, NEU_BG_DARK } from "../constants/theme";

// Re-exported for files that import NEU_BG from NeuCard directly
export { NEU_BG, NEU_BG_DARK };

type IosShadow = {
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
};

/** "#abc" / "#aabbcc" at `alpha` as rgba(), for a box-shadow colour. */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The same shadow as a CSS box-shadow. Android draws none of the iOS shadow
 * props (offset, opacity, radius), and its `elevation` can't cast a coloured
 * highlight up and to the left, so light-mode cards came out flat, with only
 * their border. It draws `boxShadow` (Android 9+) instead. The blur is twice
 * iOS's shadowRadius, the usual conversion between the two.
 */
function toBoxShadow(s: IosShadow): string | null {
  if (!s.shadowColor || !s.shadowOpacity) return null;
  const { width = 0, height = 0 } = s.shadowOffset ?? {};
  return `${width}px ${height}px ${2 * (s.shadowRadius ?? 0)}px ${rgba(s.shadowColor, s.shadowOpacity)}`;
}

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

  // A borderRadius in `style` wins over `radius`. `style` only reaches the
  // outer layer, so it used to round the card's outside while the two layers
  // inside kept `radius`: the white edge traced a 20px curve inside a 16px card.
  // Reading it here gives all three layers the shape the caller asked for.
  const styleRadius = StyleSheet.flatten(style)?.borderRadius;
  const r = typeof styleRadius === "number" ? styleRadius : radius;

  // Both modes MUST render the same 3-level view tree. A live theme toggle
  // reconciles the existing native views in place; if the tree depth differed
  // per mode (as it originally did), Fabric would repurpose views across roles
  // and leave children misplaced until the next full reload.
  const shadowA = isInset ? CARD_GLOW : CARD_SHADE;
  const shadowB = isInset ? CARD_SHADE : CARD_GLOW;

  // Outer: dark mode = one deep drop shadow; light mode = a soft, wide shade
  // down and to the right (inset: the pair swapped, and tighter)
  const iosOuterShadow: IosShadow & { elevation?: number } = dark
    ? {
        shadowColor: CARD_SHADE_DARK,
        shadowOffset: { width: 0, height: sm ? 5 : 8 },
        shadowOpacity: 0.45,
        shadowRadius: sm ? 8 : 12,
        elevation: 4,
      }
    : isInset
      ? {
          shadowColor: shadowA,
          shadowOffset: { width: sm ? 3 : 4, height: sm ? 3 : 4 },
          shadowOpacity: 1,
          shadowRadius: 5,
        }
      : {
          shadowColor: shadowA,
          shadowOffset: { width: sm ? 4 : 6, height: sm ? 5 : 8 },
          shadowOpacity: 0.2,
          shadowRadius: sm ? 8 : 12,
        };

  // Middle: light mode = top-left highlight; dark mode = no highlight (opacity 0)
  const iosMidShadow: IosShadow = dark
    ? { shadowOpacity: 0 }
    : isInset
      ? {
          shadowColor: shadowB,
          shadowOffset: { width: sm ? -2 : -3, height: sm ? -2 : -3 },
          shadowOpacity: 1,
          shadowRadius: 5,
        }
      : {
          shadowColor: shadowB,
          shadowOffset: { width: sm ? -3 : -4, height: sm ? -3 : -4 },
          shadowOpacity: 0.9,
          shadowRadius: sm ? 4 : 6,
        };

  // Android: both shadows as one box-shadow on the outer layer (see toBoxShadow),
  // built from the iOS values above so the two can't drift apart. The middle
  // layer casts nothing there; it stays in the tree for its shape (see above).
  const outerShadow = Platform.OS === "android"
    ? { boxShadow: [toBoxShadow(iosOuterShadow), toBoxShadow(iosMidShadow)].filter(Boolean).join(", ") }
    : iosOuterShadow;
  const midShadow = Platform.OS === "android" ? undefined : iosMidShadow;

  const borderColor = dark ? CARD_EDGE_DARK : "rgba(255,255,255,0.85)";

  return (
    // Outer shadow wrapper
    <View
      style={[
        { borderRadius: r, backgroundColor: resolvedBg },
        outerShadow,
        fillStyle,
        style,
      ]}
    >
      {/* Highlight shadow wrapper (inert in dark mode, but kept for tree-shape stability) */}
      <View
        style={[
          { borderRadius: r, backgroundColor: resolvedBg },
          midShadow,
          fillStyle,
        ]}
      >
        {/* Clip layer — prevents any shadow bleed at corners */}
        <View
          style={[
            {
              borderRadius: r,
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
