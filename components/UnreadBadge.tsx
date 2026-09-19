// Small red pill showing a count of unread items (messages). Renders nothing at
// 0 so callers can drop it in unconditionally. Caps the display at "9+" so a big
// backlog never blows out the layout. Pass `style` to position it (e.g. absolute
// over a button corner).

import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { DANGER_BRIGHT, FontFamily } from "../constants/theme";
import { haloGlow } from "../constants/buttons";

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
  // The app's red, glowing: the same DANGER_BRIGHT fill and centred halo the
  // red buttons wear (Remove, Delete), so an unread count reads as part of that
  // family instead of a flat dot pasted on. A halo rather than pillGlow's
  // downward drop — on something this small a drop shadow looks like it's
  // floating off the button it belongs to; an even glow keeps it pinned there.
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: DANGER_BRIGHT,
    ...haloGlow(DANGER_BRIGHT),
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#fff", fontFamily: FontFamily.bold, fontSize: 11, lineHeight: 14 },
});
