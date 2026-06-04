import { View, Text, StyleSheet } from "react-native";
import Reanimated, {
  useAnimatedStyle, interpolate, Extrapolation, type SharedValue,
} from "react-native-reanimated";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";

// One page of the onboarding deck: an animated visual (the mockup) above a
// headline + subtext. The visual parallaxes and the whole slide fades as it
// scrolls past, driven on the UI thread by the deck's shared scrollX.
interface FeatureSlideProps {
  width: number;
  index: number;
  scrollX: SharedValue<number>;
  title: string;
  subtitle: string;
  dark: boolean;
  children: React.ReactNode;
}

export default function FeatureSlide({
  width, index, scrollX, title, subtitle, dark, children,
}: FeatureSlideProps) {
  const t = dark ? APP_DARK : APP_LIGHT;

  const visualStyle = useAnimatedStyle(() => {
    const page = scrollX.value / width;
    const dist = index - page;
    return {
      opacity: interpolate(Math.abs(dist), [0, 1], [1, 0.2], Extrapolation.CLAMP),
      transform: [
        { translateX: dist * width * 0.16 },
        { scale: interpolate(Math.abs(dist), [0, 1], [1, 0.86], Extrapolation.CLAMP) },
      ],
    };
  });

  const textStyle = useAnimatedStyle(() => {
    const page = scrollX.value / width;
    const dist = index - page;
    return {
      opacity: interpolate(Math.abs(dist), [0, 0.7], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateY: Math.abs(dist) * 16 }],
    };
  });

  return (
    <View style={[styles.slide, { width }]}>
      <View style={styles.visual}>
        <Reanimated.View style={visualStyle}>{children}</Reanimated.View>
      </View>
      <Reanimated.View style={[styles.textBlock, textStyle]}>
        <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>{subtitle}</Text>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide:     { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 24 },
  visual:    { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 24 },
  textBlock: { paddingHorizontal: 32, alignItems: "center", minHeight: 150, marginBottom: 24 },
  title:     { fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  subtitle:  { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 12 },
});
