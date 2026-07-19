import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";

// ─── Insights card ────────────────────────────────────────────────────────────
// Compact entry point on Home (between the activity calendar and the weekly
// schedule). Tapping opens the Insights chat page (`app/insights.tsx`), which is
// the surface an AI layer will fill in: daily/weekly/monthly trends and a
// muscle-group breakdown of the user's training.

interface Props {
  isDark: boolean;
}

export default function InsightsCard({ isDark }: Props) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();

  return (
    <BounceButton
      style={styles.wrap}
      onPress={() => router.navigate("/insights")}
      accessibilityRole="button"
      accessibilityLabel="Open training insights"
    >
      <NeuCard dark={isDark} radius={22} style={styles.card}>
        <View style={styles.inner}>
          <View style={styles.iconBadge}>
            <Ionicons name="sparkles" size={20} color="#FFFFFF" />
          </View>
          <View style={styles.textCol}>
            <Text style={[styles.title, { color: t.tp }]}>Insights</Text>
            <Text style={[styles.subtitle, { color: t.ts }]}>Ask about your training</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.ts} />
        </View>
      </NeuCard>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 28 },
  card: { borderRadius: 22 },
  inner: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  iconBadge: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: ACCT,
    shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 6,
  },
  textCol: { flex: 1, gap: 2 },
  title: { fontFamily: FontFamily.bold, fontSize: 17 },
  subtitle: { fontFamily: FontFamily.regular, fontSize: 13 },
});
