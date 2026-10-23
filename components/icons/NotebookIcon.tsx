import Svg, { Path, Rect } from "react-native-svg";

/** A notebook: the Trainer tab's mark for programs (Lucide's "notebook"). */
export default function NotebookIcon({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M2 6h4M2 10h4M2 14h4M2 18h4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="4" y="2" width="16" height="20" rx="2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 2v20" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
