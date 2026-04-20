import { useRef, useCallback } from "react";
import { Animated, StyleProp, ViewStyle } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

interface FadeScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
}

export default function FadeScreen({ children, style, duration = 180 }: FadeScreenProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }).start();
    }, [])
  );

  return (
    <Animated.View style={[{ flex: 1, opacity }, style]}>
      {children}
    </Animated.View>
  );
}
