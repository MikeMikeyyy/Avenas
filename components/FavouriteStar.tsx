// components/FavouriteStar.tsx
//
// The gold star on a favourited group. One component so the colour and the glow
// stay identical across the three places it appears (the trainer hub's group
// row, the group header, and the group options menu) — they drifted apart the
// moment each site inlined `color={GOLD}`.
//
// The glow is a TEXT shadow, not a View shadow. Ionicons renders a glyph inside
// a <Text>, so a text shadow traces the star's actual points; a View shadow
// would bloom from the icon's square bounding box instead.
//
// It is deliberately quieter in dark mode. The same shadow values read far
// stronger against a dark navy card than against a near-white one, so dark gets
// a smaller radius and a lower opacity on an already-softened gold.

import { Ionicons } from "@expo/vector-icons";
import type { TextStyle } from "react-native";

import { GOLD, GOLD_DARK } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

/** Hex + 0-1 alpha as an 8-digit hex. RN text shadows take the alpha in the
 *  colour, not as a separate opacity. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${hex}${a.toString(16).padStart(2, "0").toUpperCase()}`;
}

type Props = {
  /** Glyph size. 16 in rows and headers, 20 in the options menu. */
  size?: number;
  /** False renders the hollow `star-outline` in `inactiveColor` with no glow —
   *  the "not favourited yet" state of a toggle. */
  filled?: boolean;
  /** Colour for the hollow state. Required whenever `filled` can be false. */
  inactiveColor?: string;
  style?: TextStyle;
};

/** The gold colour for the current theme — for text sitting beside the star
 *  (the options-menu label), which must match it exactly. */
export function useFavouriteGold(): string {
  const { isDark } = useTheme();
  return isDark ? GOLD_DARK : GOLD;
}

export default function FavouriteStar({ size = 16, filled = true, inactiveColor, style }: Props) {
  const { isDark } = useTheme();
  const gold = isDark ? GOLD_DARK : GOLD;

  if (!filled) {
    return <Ionicons name="star-outline" size={size} color={inactiveColor ?? gold} style={style} />;
  }

  return (
    <Ionicons
      name="star"
      size={size}
      color={gold}
      style={[
        {
          textShadowColor: withAlpha(gold, isDark ? 0.3 : 0.5),
          textShadowOffset: { width: 0, height: 0 },
          // Scales with the glyph so a 20pt star doesn't get a 16pt star's halo.
          textShadowRadius: (isDark ? 0.16 : 0.27) * size,
        },
        style,
      ]}
    />
  );
}
