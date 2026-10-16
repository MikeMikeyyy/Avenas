// Canonical dumbbell SVG, shared by the tab bar, workout, new-program, and
// programs screens. Its drawing lives in constants/tabIcons.ts, because the
// Workout tab's icon on iOS 26 is an image rendered from the same drawing.
// The journal screen currently uses a near-identical local `WorkoutIcon`
// whose `d` path differs by a few control points — leaving it untouched
// preserves pixel-level parity. Unify after a pixel-diff confirms
// equivalence.

import DrawnIcon from "./DrawnIcon";
import { DUMBBELL_ICON } from "../constants/tabIcons";

type Props = {
  size: number;
  color: string;
};

export default function DumbbellIcon({ size, color }: Props) {
  return <DrawnIcon drawing={DUMBBELL_ICON} size={size} color={color} />;
}
