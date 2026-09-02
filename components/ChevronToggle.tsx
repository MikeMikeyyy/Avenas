// A chevron that rotates to reflect an expanded/collapsed section.
//
// Two rotations, because the callers use it for two different jobs:
//   default   — chevron-down swings from pointing right (collapsed) to down
//               (expanded), for a section heading you tap to fold.
//   upDown    — flips a full 180°, for a card footer where the chevron already
//               points down and should point up once open.
//
// Shared because PTHome, MyPTHome and the programs list all need it; it lived
// as three byte-identical copies before.

import { useEffect } from "react";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

export default function ChevronToggle({ expanded, color, upDown }: { expanded: boolean; color: string; upDown?: boolean }) {
  const sv = useSharedValue(expanded ? 1 : 0);
  useEffect(() => { sv.value = withTiming(expanded ? 1 : 0, { duration: 220 }); }, [expanded, sv]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: upDown ? `${sv.value * 180}deg` : `${sv.value * 90 - 90}deg` }],
  }));
  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={20} color={color} />
    </Animated.View>
  );
}
