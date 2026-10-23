import Svg, { Path } from "react-native-svg";

/** A group's chat (Lucide's "messages-circle"): two round bubbles, so it reads
 *  apart from ChatIcon's one-person conversation (user choice, 2026-10-22; it
 *  was "messages-square"). The group page's Group Chat button. */
export default function GroupChatIcon({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19.95 10.05a7 7 0 0 1 1.412 7.872 1 1 0 0 0-.058.787l.675 2.089a1 1 0 0 1-1.236 1.168l-2.155-.631a1 1 0 0 0-.745.06 7 7 0 0 1-7.793-1.445"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2.696 12.708a1 1 0 0 0-.058-.785 7 7 0 1 1 3.518 3.473 1 1 0 0 0-.744-.061l-2.155.63a1 1 0 0 1-1.236-1.167z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
