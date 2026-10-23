// A tile on a Trainer page: what it holds, and a line that says whether
// anything there is new. Two sit side by side under a gym user's trainer card
// (components/trainer/MyPTHome.tsx: Programs and Sent for Review) and under a
// group's name on its page (Group Chat and Programs). Each tile has its own
// colour (`mark`, its icon and its circle), so the two read apart from each
// other and from the page's green button: all in the one green, they read as
// one thing (user feedback, 2026-10-21).

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import BounceButton from "../BounceButton";
import NeuCard from "../NeuCard";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

export default function HubTile({ icon, mark, title, meta, metaColor, onPress, accessibilityLabel }: {
  icon: ReactNode;
  /** The tile's colour: its icon's circle is this, faint. */
  mark: string;
  title: string;
  meta: string;
  metaColor: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <BounceButton style={{ flex: 1 }} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {/* The card takes its height from the sized view inside it. */}
      <NeuCard dark={isDark} radius={20}>
        <View style={styles.tile}>
          <View style={styles.top}>
            <View style={[styles.icon, { backgroundColor: `${mark}${isDark ? "29" : "2E"}` }]}>{icon}</View>
            <Ionicons name="chevron-forward" size={16} color={t.ts} />
          </View>
          <View>
            <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>{title}</Text>
            <Text style={[styles.meta, { color: metaColor }]} numberOfLines={1}>{meta}</Text>
          </View>
        </View>
      </NeuCard>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  tile: { height: 108, padding: 14, justifyContent: "space-between" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: FontFamily.bold, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: FontFamily.bold, fontSize: 13, lineHeight: 17 },
});
