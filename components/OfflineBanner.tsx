// "You're offline" at the top of a page whose data comes from the server (the
// Trainer tab, a group, a program someone sent, an archive, a review): the page
// is showing the copy it last loaded, and its buttons that need the server are
// dimmed (BounceButton `needsConnection`). Nothing while online, so a page can
// always render it.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { PILL_RADIUS } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import { useOffline } from "../contexts/ConnectivityContext";

export default function OfflineBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const { isDark } = useTheme();
  const offline = useOffline();
  const t = isDark ? APP_DARK : APP_LIGHT;
  if (!offline) return null;
  return (
    <View
      style={[styles.banner, { backgroundColor: t.ctrl, borderColor: t.div }, style]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={t.ts} />
      <Text style={[styles.text, { color: t.tp }]}>
        {"You're offline. Showing what was here last time."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: PILL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  text: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
});
