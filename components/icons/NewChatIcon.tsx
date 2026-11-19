import Svg, { Path } from "react-native-svg";

/** A chat bubble with a plus: start a new AI conversation (user pick,
 *  2026-11-13, option 1 of the Insights Mark Studies). The bubble is
 *  ChatIcon's (Lucide's "message-circle"), so the two read as one family. */
export default function NewChatIcon({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M12 8.8v6.4M8.8 12h6.4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}
