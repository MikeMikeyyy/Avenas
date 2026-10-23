// components/trainer/HubTitle.tsx
//
// The Trainer tab's page title, set as every tab's title is (Home's greeting:
// 28pt bold, 20pt in, at insets.top + 50; docs/ARCHITECTURE.md), with the
// page's buttons on its right, the way Progress has Compare beside its title.
// It scrolls with the page. The trainer's hub passes My Trainers and Messages,
// the gym user's My Trainers alone (user decisions, 2026-10-21, the Trainer
// Page canvas; pinning them over the page was tried and turned down).

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

export default function HubTitle({ children }: { children?: ReactNode }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.row}>
      {/* The tab's own name, as Progress's title is. */}
      <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>Trainer</Text>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  title: { flex: 1, fontFamily: FontFamily.bold, fontSize: 28, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
});
