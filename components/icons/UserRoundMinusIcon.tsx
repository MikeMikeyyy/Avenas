import Svg, { Circle, Path } from "react-native-svg";

/** Take someone off (Lucide's "user-round-minus"): Remove connection, Remove
 *  from my clients, and removing a member from a group. The same family as
 *  UserRoundPlusIcon, which is its "add" counterpart. */
export default function UserRoundMinusIcon({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M2 21a8 8 0 0 1 13.292-6" {...stroke} />
      <Circle cx={10} cy={8} r={5} {...stroke} />
      <Path d="M22 19h-6" {...stroke} />
    </Svg>
  );
}
