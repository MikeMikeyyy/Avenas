import { View, useWindowDimensions } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Ellipse } from "react-native-svg";
import { AURORA } from "../constants/theme";

export type AuroraTint = "home" | "green" | "aqua" | "blush";

type Blob = { color: string; o: number; cx: number; cy: number; rx: number; ry: number };

// Blob layouts per tint. `o` is the light-mode peak opacity; cx/cy/rx/ry are
// fractions of the backdrop's width/height. "home" is the three-hue mix; the
// single-tint layouts (used by the quick-action destination pages) lead with
// that page's orb color plus a soft counter-glow so the page doesn't read flat.
const TINT_BLOBS: Record<AuroraTint, Blob[]> = {
  home: [
    { color: AURORA.mint,  o: 0.20, cx: 0.12, cy: 0.22, rx: 0.78, ry: 0.50 },
    { color: AURORA.aqua,  o: 0.16, cx: 0.95, cy: 0.16, rx: 0.72, ry: 0.46 },
    { color: AURORA.blush, o: 0.13, cx: 0.55, cy: 0.62, rx: 0.85, ry: 0.42 },
  ],
  // Mint's base (ACCT) is far more electric than aqua/blush, so its lead blob
  // runs at a lower opacity to land at the same perceived weight as the other
  // two pages' glows.
  green: [
    { color: AURORA.mint,  o: 0.14, cx: 0.18, cy: 0.12, rx: 0.85, ry: 0.50 },
    { color: AURORA.aqua,  o: 0.10, cx: 0.92, cy: 0.32, rx: 0.65, ry: 0.42 },
  ],
  aqua: [
    { color: AURORA.aqua,  o: 0.19, cx: 0.18, cy: 0.12, rx: 0.85, ry: 0.50 },
    { color: AURORA.mint,  o: 0.10, cx: 0.92, cy: 0.32, rx: 0.65, ry: 0.42 },
  ],
  blush: [
    { color: AURORA.blush, o: 0.18, cx: 0.18, cy: 0.12, rx: 0.85, ry: 0.50 },
    { color: AURORA.aqua,  o: 0.10, cx: 0.92, cy: 0.32, rx: 0.65, ry: 0.42 },
  ],
};

// Decorative pastel glow rendered behind a screen's header area. Pure SVG
// radial fades (no blur filters) so it stays cheap and renders identically in
// Expo Go. Position it absolutely as the first child of the screen container
// and let content scroll over it; pointerEvents is disabled. Gradient ids are
// prefixed with the tint so two mounted screens (e.g. Home under a pushed
// page) can never collide.
export default function AuroraBackdrop({
  dark,
  tint = "home",
  height = 520,
}: {
  dark: boolean;
  tint?: AuroraTint;
  height?: number;
}) {
  const { width } = useWindowDimensions();
  // Glows read brighter against the dark navy bg, so dim them slightly there.
  const boost = dark ? 0.8 : 1;
  const blobs = TINT_BLOBS[tint];
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height }}>
      <Svg width={width} height={height}>
        <Defs>
          {blobs.map((b, i) => (
            <RadialGradient key={i} id={`aurora-${tint}-${i}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={b.color} stopOpacity={b.o * boost} />
              <Stop offset="55%" stopColor={b.color} stopOpacity={b.o * boost * 0.45} />
              <Stop offset="100%" stopColor={b.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {blobs.map((b, i) => (
          <Ellipse
            key={i}
            cx={width * b.cx}
            cy={height * b.cy}
            rx={width * b.rx}
            ry={height * b.ry}
            fill={`url(#aurora-${tint}-${i})`}
          />
        ))}
      </Svg>
    </View>
  );
}
