import { useEffect } from "react";
import Svg, { Path } from "react-native-svg";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from "react-native-reanimated";

const BODY      = "M12 2 c1 6,8 8,8 16 a8 8 0 1 1-16 0 c0-4,3-5,3-9 c0 3,2 4,3 4 c-1-4,1-8,2-11 z";
const HIGHLIGHT = "M12 12 c.5 3,3 3,3 8 a3 3 0 1 1-6 0 c0-2,1-2,1-4 c0 1,1 1.5,1.5 1.5 c-.5-2,0-4,.5-5.5 z";

interface Props {
  size?: number;
  color: string;
  animated?: boolean;
}

export default function FlameIcon({ size = 44, color, animated = true }: Props) {
  const scale   = useSharedValue(1);
  const shadowR = useSharedValue(6);

  useEffect(() => {
    if (!animated) return;
    const ease = Easing.inOut(Easing.sin);
    scale.value = withRepeat(withTiming(1.06, { duration: 900, easing: ease }), -1, true);
    shadowR.value = withRepeat(withTiming(14, { duration: 1100, easing: ease }), -1, true);
  }, [animated]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: shadowR.value,
  }));

  // viewBox is 24×32 (3:4). Fit within a square of `size`.
  const svgW = size * 0.75;
  const svgH = size;

  return (
    <Reanimated.View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, animStyle]}>
      <Svg viewBox="0 0 24 32" width={svgW} height={svgH}>
        <Path d={BODY}      fill={color} />
        <Path d={HIGHLIGHT} fill="#ffffff" fillOpacity={0.7} />
      </Svg>
    </Reanimated.View>
  );
}
