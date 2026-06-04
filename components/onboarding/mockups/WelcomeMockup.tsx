import { View, StyleSheet } from "react-native";
import { useEffect } from "react";
import { Image } from "expo-image";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, withRepeat, Easing,
} from "react-native-reanimated";
import NeuCard from "../../NeuCard";

const logo = require("../../../assets/images/logo.png");

// Welcome hero visual — the logo sits on a neumorphic disc that floats gently.
// Animation runs while the slide is active.
interface MockupProps {
  dark: boolean;
  active: boolean;
}

export default function WelcomeMockup({ dark, active }: MockupProps) {
  const float = useSharedValue(0);
  const enter = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      enter.value = 0;
      return;
    }
    enter.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    float.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [active]);

  const discStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { scale: 0.86 + enter.value * 0.14 },
      { translateY: -6 + float.value * 12 },
    ],
  }));

  return (
    <View style={styles.wrap}>
      <Reanimated.View style={discStyle}>
        <NeuCard dark={dark} radius={70} style={styles.disc}>
          <View style={styles.discInner}>
            <Image source={logo} style={styles.logo} contentFit="contain" />
          </View>
        </NeuCard>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:      { width: 280, height: 220, alignItems: "center", justifyContent: "center" },
  disc:      { width: 140, height: 140, borderRadius: 70 },
  discInner: { width: 140, height: 140, alignItems: "center", justifyContent: "center" },
  logo:      { width: 92, height: 92 },
});
