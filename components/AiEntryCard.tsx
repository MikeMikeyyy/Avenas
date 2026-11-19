import React, { type ComponentType } from "react";
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, ON_FILL } from "../constants/theme";
import { darkGlow } from "../constants/buttons";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";

// ─── An AI assistant's card ──────────────────────────────────────────────────
// The way in to one of the AI's chats (components/ai/AiChatScreen.tsx): its
// mark in a green badge, a title and a line, opening its screen. Home's
// Insights (InsightsCard, logo A) and My Programs' Build with AI (logo B).

interface Props {
  isDark: boolean;
  Mark: ComponentType<{ size?: number; color?: string }>;
  title: string;
  subtitle: string;
  route: Href;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

export default function AiEntryCard({ isDark, Mark, title, subtitle, route, accessibilityLabel, style }: Props) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();

  return (
    <BounceButton
      style={style}
      onPress={() => router.navigate(route)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <NeuCard dark={isDark} radius={22} style={styles.card}>
        <View style={styles.inner}>
          <View style={[styles.iconBadge, darkGlow(styles.iconBadge, isDark)]}>
            <Mark size={20} color={ON_FILL} />
          </View>
          <View style={styles.textCol}>
            <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
            <Text style={[styles.subtitle, { color: t.ts }]}>{subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.ts} />
        </View>
      </NeuCard>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
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
