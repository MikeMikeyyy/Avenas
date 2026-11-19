import Svg, { Path, Circle } from "react-native-svg";

// Flat gold-medal award icon (gold disc, orange star, red ribbon tails),
// recreated from the reference artwork used on the workout summary. The
// palette is intrinsic to the artwork and intentionally NOT themed — do not
// swap these for theme tokens.
const RIBBON = "#F8635E";
const GOLD = "#F5C84C";
const GOLD_LIGHT = "#FBE26A";
const STAR = "#F6A62B";

/** The artwork's own box inside the 512 square: ribbons x 98 to 414, disc top
 *  y 64 to ribbon tips y 492. */
const TIGHT = { x: 98, y: 64, w: 316, h: 428 };

/** `size` is the square it fills, the artwork inside it with room round it
 *  (the summary's Records). `tight`: `size` is the artwork's own height,
 *  cropped to it, for a mark set a fixed gap from something (a rep PR beside
 *  a set's number, components/PrTrophy.tsx). */
export default function MedalIcon({ size = 20, tight = false }: { size?: number; tight?: boolean }) {
  const box = tight
    ? { width: (size * TIGHT.w) / TIGHT.h, height: size, viewBox: `${TIGHT.x} ${TIGHT.y} ${TIGHT.w} ${TIGHT.h}` }
    : { width: size, height: size, viewBox: "0 0 512 512" };
  return (
    <Svg width={box.width} height={box.height} viewBox={box.viewBox}>
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
