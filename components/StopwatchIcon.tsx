// The stopwatch on the Workout tab's top-right button, which opens the interval
// timer / stopwatch (components/IntervalTimerModal.tsx). Replaces Ionicons'
// timer-outline there: a round-capped stopwatch with a crown on top, a side
// button at two o'clock, and hands at four.
//
// Stroked on a 24-unit grid like components/DumbbellIcon.tsx, so it takes the
// theme's text colour in both modes and stays crisp at any size.

import Svg, { Circle, Path } from "react-native-svg";

type Props = {
  size?: number;
  color: string;
};

export default function StopwatchIcon({ size = 22, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={13.5} r={8.1} stroke={color} strokeWidth={1.6} />
      <Path
        // Crown bar, its stem down to the dial, the side button, then the
        // hands: up from the centre, and out towards four o'clock.
        d="M9.8 2.2H14.2M12 2.2V5.4M17.7 7.8L19.4 6.1M12 9V13.5L14.2 15.7"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
