// Blocked Accounts — review and unblock people you've blocked in the Trainer
// hub (Apple Guideline 1.2). Reached from Settings → Safety. Unblocking lets the
// person reappear in your conversation list.

import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "../components/NeuCard";
import { useTheme } from "../contexts/ThemeContext";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import { pill, PILL_H_XS } from "../constants/buttons";
import { loadBlocked, unblockUser } from "../utils/moderation";
import { alertMessage } from "../utils/errors";
import { alertOffline, useOffline } from "../contexts/ConnectivityContext";
import type { BlockedUser } from "../constants/chat";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";

const TP = APP_LIGHT.tp;

export default function BlockedAccountsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [blocked, setBlocked] = useState<BlockedUser[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const list = await loadBlocked();
        if (!cancelled) setBlocked(list);
      })();
      return () => { cancelled = true; };
    }, []),
  );

  // Unblocking lifts the block on the server too (migration 0040), so it needs
  // a connection: offline it dims and says so, and a failure puts the row back
  // rather than showing someone unblocked who isn't.
  const offline = useOffline();
  const unblock = async (b: BlockedUser) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBlocked(prev => prev.filter(x => x.id !== b.id)); // optimistic
    try {
      await unblockUser(b.id);
    } catch (e) {
      setBlocked(await loadBlocked());
      Alert.alert("Couldn't unblock", alertMessage(e, "Check your connection and try again."));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <BackButton />

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + BACK_TOP, paddingBottom: insets.bottom + 40 }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Blocked Accounts</Text>
          <View style={{ width: 40 }} />
        </View>

        {blocked.length === 0 ? (
          <NeuCard dark={isDark} radius={18} style={{ marginTop: 8 }}>
            <View style={styles.emptyInner}>
              <Ionicons name="ban-outline" size={26} color={t.ts} />
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No blocked accounts</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                People you block from a conversation appear here. You can unblock them at any time.
              </Text>
            </View>
          </NeuCard>
        ) : (
          <NeuCard dark={isDark} style={styles.card}>
            {blocked.map((b, i) => (
              <View key={b.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
                <View style={styles.row}>
                  <View style={[styles.avatar, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }]}>
                    <Text style={[styles.avatarText, { color: t.ts }]}>{b.initials}</Text>
                  </View>
                  <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{b.name}</Text>
                  <TouchableOpacity
                    onPress={offline ? alertOffline : () => unblock(b)}
                    activeOpacity={0.8}
                    style={[styles.unblockBtn, { borderColor: ACCT, opacity: offline ? 0.4 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Unblock ${b.name}`}
                  >
                    <Text style={[styles.unblockText, { color: ACCT }]}>Unblock</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </NeuCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:      { paddingHorizontal: 20 },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, height: BACK_SIZE },
  title:       { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center", flex: 1 },
  card:        { borderRadius: 18, marginBottom: 24 },
  divider:     { height: 1, marginHorizontal: 16 },
  row:         { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  avatar:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText:  { fontFamily: FontFamily.bold, fontSize: 14 },
  name:        { flex: 1, fontFamily: FontFamily.semibold, fontSize: 15 },
  unblockBtn:  { ...pill(PILL_H_XS), borderWidth: 1.5, paddingHorizontal: 14 },
  unblockText: { fontFamily: FontFamily.bold, fontSize: 13 },
  emptyInner:  { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle:  { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody:   { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
