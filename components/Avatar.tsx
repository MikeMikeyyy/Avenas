// A circular avatar that shows a profile photo when one is set, falling back to
// initials (or a person glyph). Used across the trainer hub roster where people
// are rendered as a tinted circle. The neumorphic/blur avatars on
// profile/settings/home keep their bespoke shadow wrappers and render photos
// inline — this is for the simpler tinted-circle case.

import { View, Text, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

export default function Avatar({
  uri,
  initials,
  size,
  backgroundColor,
  textColor,
  textStyle,
  style,
}: {
  uri?: string | null;
  initials?: string;
  size: number;
  backgroundColor?: string;
  textColor?: string;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const radius = size / 2;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: radius, backgroundColor },
        styles.center,
        style,
      ]}
    >
      {uri ? (
        <ExpoImage
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: radius }}
          contentFit="cover"
          transition={150}
        />
      ) : initials ? (
        <Text style={textStyle}>{initials}</Text>
      ) : (
        <Ionicons name="person" size={size * 0.5} color={textColor ?? "#9aa3b2"} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
