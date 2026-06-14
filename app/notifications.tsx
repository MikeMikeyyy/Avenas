// Notifications — per-category preferences reached from Settings > Account >
// Notifications. The master switch silences everything; each category can also
// be toggled on its own. Values persist via NotificationPrefsContext and gate
// any future delivery site through utils/notifications.isCategoryEnabled.
//
// These toggles record intent only. Actually firing OS notifications needs a
// dev/EAS build + expo-notifications (Expo Go can't deliver them), so the footer
// points users at iOS Settings for system-level control.

import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "../components/NeuCard";
import { useTheme } from "../contexts/ThemeContext";
import { useNotificationPrefs } from "../contexts/NotificationPrefsContext";
import { NOTIFICATION_SECTIONS } from "../constants/notifications";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";

const TP = APP_LIGHT.tp;

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { prefs, setMaster, setCategory } = useNotificationPrefs();

  const toggleMaster = (val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMaster(val);
  };

  const toggleCategory = (key: Parameters<typeof setCategory>[0], val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCategory(key, val);
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFillObject} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Notifications</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Master switch */}
        <NeuCard dark={isDark} style={styles.masterCard}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="notifications-outline" size={20} color={t.icon} />
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: t.tp }]}>Allow Notifications</Text>
                <Text style={[styles.rowDesc, { color: t.ts }]}>
                  Turn everything off without losing your choices below.
                </Text>
              </View>
            </View>
            <Switch
              value={prefs.master}
              onValueChange={toggleMaster}
              trackColor={{ false: t.div, true: ACCT }}
              thumbColor="#fff"
            />
          </View>
        </NeuCard>

        {/* Category sections — dimmed + disabled while the master switch is off */}
        {NOTIFICATION_SECTIONS.map((section) => (
          <View key={section.title} style={[styles.section, !prefs.master && styles.sectionOff]}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>{section.title}</Text>
            <NeuCard dark={isDark} style={styles.sectionCard}>
              {section.items.map((item, i) => (
                <View key={item.key}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Ionicons name={item.icon} size={20} color={t.icon} />
                      <View style={styles.rowText}>
                        <Text style={[styles.rowLabel, { color: t.tp }]}>{item.label}</Text>
                        <Text style={[styles.rowDesc, { color: t.ts }]}>{item.description}</Text>
                      </View>
                    </View>
                    <Switch
                      value={prefs.master && prefs.categories[item.key]}
                      onValueChange={(val) => toggleCategory(item.key, val)}
                      disabled={!prefs.master}
                      trackColor={{ false: t.div, true: ACCT }}
                      thumbColor="#fff"
                    />
                  </View>
                </View>
              ))}
            </NeuCard>
          </View>
        ))}

        <Text style={[styles.footer, { color: t.ts }]}>
          You can also manage Avenas notifications in your device Settings.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1 },
  topGradient:  { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:       { paddingHorizontal: 20 },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, height: 40 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  title:        { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center", flex: 1 },
  masterCard:   { borderRadius: 18, marginBottom: 24 },
  section:      { marginBottom: 24 },
  sectionOff:   { opacity: 0.45 },
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginLeft: 4 },
  sectionCard:  { borderRadius: 18 },
  divider:      { height: 1, marginHorizontal: 16 },
  row:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowLeft:      { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  rowText:      { flex: 1, gap: 2 },
  rowLabel:     { fontFamily: FontFamily.regular, fontSize: 16 },
  rowDesc:      { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 16 },
  footer:       { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 4, paddingHorizontal: 12 },
});
