// components/DrawnIcon.tsx
//
// Draws an icon kept as drawing data (constants/tabIcons.ts) in one colour.

import Svg, { Circle, Path } from "react-native-svg";

import type { IconDrawing } from "../constants/tabIcons";

type Props = {
  drawing: IconDrawing;
  size: number;
  color: string;
};

export default function DrawnIcon({ drawing, size, color }: Props) {
  const { stroke } = drawing;
  const ends = stroke?.round ? "round" : undefined;
  const paint = {
    fill: stroke ? "none" : color,
    stroke: stroke ? color : undefined,
    strokeWidth: stroke?.width,
    strokeLinecap: ends,
    strokeLinejoin: ends,
  } as const;
  return (
    <Svg width={size} height={size} viewBox={drawing.viewBox} fill="none">
      {drawing.paths.map((d, i) => (
        <Path key={`p${i}`} d={d} {...paint} />
      ))}
      {drawing.circles?.map((c, i) => (
        <Circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.r} {...paint} />
      ))}
    </Svg>
  );
}
