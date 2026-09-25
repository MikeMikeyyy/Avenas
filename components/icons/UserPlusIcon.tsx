import Svg, { Circle, Line, Path } from "react-native-svg";

/** Add people to something you run (Lucide's "user-plus"): a group page's Add
 *  members button. Connecting with someone new is UserRoundPlusIcon. */
export default function UserPlusIcon({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...stroke} />
      <Circle cx={9} cy={7} r={4} {...stroke} />
      <Line x1={19} x2={19} y1={8} y2={14} {...stroke} />
      <Line x1={22} x2={16} y1={11} y2={11} {...stroke} />
    </Svg>
  );
}
