// A clock with an arrow turning it back: Lucide's "rotate-ccw-clock", for an
// exercise's history (the Workout tab's exercise sheet; user request,
// 2026-10-30, in place of Ionicons' time-outline).

import Svg, { Path } from "react-native-svg";

type Props = {
  size: number;
  color: string;
};

export default function HistoryIcon({ size, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <Path d="M3 3v5h5" />
      <Path d="M12 7v5l4 2" />
    </Svg>
  );
}
