// The pen that marks an editable name: Lucide's "pen-line" (a pen over a
// writing line), drawn in the caller's colour like the other SVG icons.

import Svg, { Path } from "react-native-svg";

type Props = {
  size: number;
  color: string;
};

export default function PenIcon({ size, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M13 21h8" />
      <Path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </Svg>
  );
}
