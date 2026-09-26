import Svg, { Circle, Path } from "react-native-svg";

/** A person (Lucide's "user-round"): the Trainer tab's My Trainers button, on
 *  both hubs. The same family as UserRoundPlusIcon beside it. */
export default function UserRoundIcon({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={5} {...stroke} />
      <Path d="M20 21a8 8 0 0 0-16 0" {...stroke} />
    </Svg>
  );
}
