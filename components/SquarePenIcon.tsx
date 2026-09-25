// A pen over a square: Lucide's "square-pen", for writing something of your own:
// a Custom Workout, and editing a program (Edit Program, Open in Builder, the
// program view's edit button). The bare pen that marks an editable name is
// PenIcon.

import Svg, { Path } from "react-native-svg";

type Props = {
  size: number;
  color: string;
};

export default function SquarePenIcon({ size, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <Path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </Svg>
  );
}
