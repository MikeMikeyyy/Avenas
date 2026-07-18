import Svg, { Path, Circle } from "react-native-svg";

// Flat gold-medal award icon (gold disc, orange star, red ribbon tails),
// recreated from the reference artwork used on the workout summary. The
// palette is intrinsic to the artwork and intentionally NOT themed — do not
// swap these for theme tokens.
const RIBBON = "#F8635E";
const GOLD = "#F5C84C";
const GOLD_LIGHT = "#FBE26A";
const STAR = "#F6A62B";

export default function MedalIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      {/* Ribbon tails sit behind the disc; their tops are covered by it. */}
      <Path d="M150 310 L255 348 L200 492 L163 425 L98 458 Z" fill={RIBBON} />
      <Path d="M362 310 L257 348 L312 492 L349 425 L414 458 Z" fill={RIBBON} />
      <Circle cx={256} cy={216} r={152} fill={GOLD} />
      <Circle cx={256} cy={216} r={118} fill={GOLD_LIGHT} />
      <Path
        d="M256 132 L276.6 187.7 L335.9 190 L289.3 226.8 L305.4 284 L256 251 L206.6 284 L222.7 226.8 L176.1 190 L235.4 187.7 Z"
        fill={STAR}
      />
    </Svg>
  );
}
