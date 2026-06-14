// Small red pill showing a count of unread items (messages). Renders nothing at
// 0 so callers can drop it in unconditionally. Caps the display at "9+" so a big
// backlog never blows out the layout. Pass `style` to position it (e.g. absolute
// over a button corner).

import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { DANGER, FontFamily } from "../constants/theme";

export default function UnreadBadge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  if (count <= 0) return null;
  const label = count > 9 ? "9+" : String(count);
  return (
    <View
      style={[styles.badge, style]}
      accessibilityRole="text"
      accessibilityLabel={`${count} unread`}
    >
      <Text style={styles.text} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: DANGER,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#fff", fontFamily: FontFamily.bold, fontSize: 11, lineHeight: 14 },
});
