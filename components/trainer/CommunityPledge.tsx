// The zero-tolerance pledge (COMMUNITY_PLEDGE) as a callout rather than a line
// of green text, so it reads as the rule it is. Shared by the agreement gate and
// the standalone Community Guidelines page so the two can't drift apart.
//
// Built on the same tinted-notice treatment as the Workout tab's "completed"
// banner (mint wash, thin accent border, dark text), pushed a step stronger: a
// solid accent badge with a soft halo carries the colour, and the sentence stays
// in the primary text colour, because accent green on a mint wash is too faint
// to read comfortably in light mode.

import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { APP_DARK, APP_LIGHT, ACCT, FontFamily } from "../../constants/theme";
import { haloGlow } from "../../constants/buttons";
import { COMMUNITY_PLEDGE } from "../../constants/community";
import { useTheme } from "../../contexts/ThemeContext";

export default function CommunityPledge({ style }: { style?: StyleProp<ViewStyle> }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.14)",
          borderColor: `${ACCT}59`,
        },
        style,
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={COMMUNITY_PLEDGE}
    >
      <View style={[styles.badge, { backgroundColor: ACCT }, haloGlow(ACCT, isDark ? 0.45 : 0.55, 6)]}>
        <Ionicons name="shield-checkmark" size={16} color="#fff" />
      </View>
      <Text style={[styles.text, { color: t.tp }]}>{COMMUNITY_PLEDGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box:   { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1 },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  text:  { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14, lineHeight: 20 },
});
