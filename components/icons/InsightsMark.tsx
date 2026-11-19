import Svg, { Path } from "react-native-svg";

/** Insights' mark, the "progress spark": a training line climbing to a spark,
 *  insight drawn out of your progress (user pick, 2026-11-13, option A of the
 *  Insights Mark Studies). Avenas' own drawing, on the app's 24-point icon
 *  grid with rounded ends. Home's Insights card, Insights' top bar and its
 *  agreement. */
export default function InsightsMark({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 19.5 8.5 14 12 16.5 16 12" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M18.6 1.8C18.88 4.28 20.72 6.12 23.2 6.4C20.72 6.68 18.88 8.52 18.6 11C18.32 8.52 16.48 6.68 14 6.4C16.48 6.12 18.32 4.28 18.6 1.8Z"
        fill={color}
      />
    </Svg>
  );
}
