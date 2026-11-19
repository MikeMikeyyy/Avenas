import Svg, { Path, Rect } from "react-native-svg";

/** The Program Builder's mark, the "barbell spark": a spark over a barbell
 *  (user pick, 2026-11-13, option B of the Insights Mark Studies). Avenas' own
 *  drawing, on the app's 24-point icon grid. My Programs' Build with AI card
 *  and the Program Builder. */
export default function BuilderMark({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6.5 16H17.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <Rect x="3" y="11.5" width="3.2" height="9" rx="1.4" fill={color} />
      <Rect x="17.8" y="11.5" width="3.2" height="9" rx="1.4" fill={color} />
      <Path
        d="M12 2.4C12.28 4.88 14.12 6.72 16.6 7C14.12 7.28 12.28 9.12 12 11.6C11.72 9.12 9.88 7.28 7.4 7C9.88 6.72 11.72 4.88 12 2.4Z"
        fill={color}
      />
    </Svg>
  );
}
