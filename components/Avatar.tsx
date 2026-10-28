// A circular avatar that shows a profile photo when one is set, falling back to
// initials (or a person glyph) on a pale circle in the person's own colour:
// picked from their id (`colorKey`, constants/theme.ts avatarColors), so they
// look the same on every page and a list of people isn't all green (user
// request, 2026-10-28). Used across the trainer hub roster. The neumorphic/blur
// avatars on profile/settings/home keep their bespoke shadow wrappers and
// render photos inline — this is for the simpler tinted-circle case.

import { View, Text, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { avatarColors } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

export default function Avatar({
  uri,
  initials,
  size,
  colorKey,
  textStyle,
  style,
}: {
  uri?: string | null;
  initials?: string;
  size: number;
  /** Whose circle it is, their user id: it picks their colour. */
  colorKey?: string;
  /** The initials' font and size. Their colour is the person's own. */
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const { isDark } = useTheme();
  const { bg, ink } = avatarColors(colorKey, isDark);
  const radius = size / 2;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: radius, backgroundColor: bg },
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
        <Text style={[textStyle, { color: ink }]}>{initials}</Text>
      ) : (
        <Ionicons name="person" size={size * 0.5} color={ink} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
