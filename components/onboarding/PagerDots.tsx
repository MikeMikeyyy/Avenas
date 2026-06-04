import { View, StyleSheet } from "react-native";
import Reanimated, {
  useAnimatedStyle, interpolate, interpolateColor, Extrapolation, type SharedValue,
} from "react-native-reanimated";
import { APP_DARK, APP_LIGHT, BTN_SLATE, BTN_SLATE_DARK } from "../../constants/theme";

// Pagination dots for the onboarding deck. The active dot stretches into a pill
// and tints to the slate button color, interpolated from the deck's shared
// scrollX (UI thread).
interface PagerDotsProps {
  count: number;
  width: number;
  scrollX: SharedValue<number>;
  dark: boolean;
}

function Dot({
  index, width, scrollX, dark,
}: { index: number; width: number; scrollX: SharedValue<number>; dark: boolean }) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const active = dark ? BTN_SLATE_DARK : BTN_SLATE;
  const style = useAnimatedStyle(() => {
    const page = scrollX.value / width;
    const dist = Math.abs(index - page);
    return {
      width: interpolate(dist, [0, 1], [22, 8], Extrapolation.CLAMP),
      backgroundColor: interpolateColor(Math.min(dist, 1), [0, 1], [active, t.div]),
    };
  });
  return <Reanimated.View style={[styles.dot, style]} />;
}

export default function PagerDots({ count, width, scrollX, dark }: PagerDotsProps) {
  return (
    <View style={styles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <Dot key={i} index={i} width={width} scrollX={scrollX} dark={dark} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, height: 8 },
  dot: { height: 8, borderRadius: 4 },
});
