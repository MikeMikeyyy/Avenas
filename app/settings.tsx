import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, interpolateColor } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import NeuCard from "../components/NeuCard";
import { APP_LIGHT, APP_DARK, FontFamily, Colors, ACCT } from "../constants/theme";

// ─── Settings item types ──────────────────────────────────────────────────────
type BaseItem     = { icon: string; label: string; renderIcon?: (c: string) => React.ReactNode };
type NavigateItem = BaseItem;
type ToggleItem   = BaseItem & { toggle: true };
type UnitItem     = BaseItem & { unitToggle: true };
type SettingsItem = NavigateItem | ToggleItem | UnitItem;

// ─── Static values for StyleSheet (dark overrides applied inline) ─────────────
const TP   = APP_LIGHT.tp;
const TS   = APP_LIGHT.ts;
const ICON = APP_LIGHT.icon;
const DIV  = APP_LIGHT.div;

const SECTIONS: { title: string; items: SettingsItem[] }[] = [
  {
    title: "Account",
    items: [
      { icon: "person-outline",        label: "Profile"           },
      { icon: "notifications-outline", label: "Notifications"     },
      { icon: "", label: "Privacy & Security", renderIcon: (c: string) => (
        <View style={{ transform: [{ scaleY: 0.9 }] }}>
          <Ionicons name="lock-closed-outline" size={20} color={c} />
        </View>
      ) },
    ],
  },
  {
    title: "App",
    items: [
      { icon: "moon-outline",           label: "Dark Mode", toggle: true },
      { icon: "", label: "Units", unitToggle: true, renderIcon: (c: string) => (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.535 19.5 8.3025 19.4489 8.1118C19.3102 7.5941 18.9059 7.1898 18.3882 7.0511C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.0511C16.0941 7.1898 15.6898 7.5941 15.5511 8.1118C15.5 8.3025 15.5 8.535 15.5 9Z" stroke={c} strokeWidth="1.5" />
          <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.535 8.5 8.3025 8.44889 8.1118C8.31019 7.5941 7.90587 7.1898 7.38823 7.0511C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.0511C5.09413 7.1898 4.68981 7.5941 4.55111 8.1118C4.5 8.3025 4.5 8.535 4.5 9Z" stroke={c} strokeWidth="1.5" />
          <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={c} strokeWidth="1.5" />
        </Svg>
      ) },
      { icon: "cloud-outline", label: "Data & Sync" },
    ],
  },
  {
    title: "Support",
    items: [
      { icon: "document-text-outline", label: "Terms of Service"  },
      { icon: "shield-outline",        label: "Privacy Policy"    },
      { icon: "help-circle-outline",   label: "Help & FAQ"        },
      { icon: "warning-outline",       label: "Report a Bug"      },
      { icon: "bulb-outline",          label: "Request a Feature" },
      { icon: "star-outline",          label: "Rate Avenas"       },
    ],
  },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark, toggleDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isKg, setIsKg } = useUnit();
  const unitOffset        = useSharedValue(isKg ? 0 : 1); // 0 = kg, 1 = lbs
  const userTriggeredRef  = useRef(false);
  useEffect(() => {
    if (!userTriggeredRef.current) unitOffset.value = isKg ? 0 : 1; // snap on external change (AsyncStorage load)
    userTriggeredRef.current = false;
  }, [isKg]);
  const unitTrackWidth = useSharedValue(0);
  const unitPillStyle  = useAnimatedStyle(() => ({
    width: unitTrackWidth.value / 2,
    transform: [{ translateX: unitOffset.value * (unitTrackWidth.value / 2) }],
  }));
  const kgLabelColor  = useAnimatedStyle(() => ({
    color: interpolateColor(unitOffset.value, [0, 1], ["#ffffff", isDark ? "#8896A7" : "#8896A7"]),
  }));
  const lbsLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(unitOffset.value, [0, 1], [isDark ? "#8896A7" : "#8896A7", "#ffffff"]),
  }));

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
        {/* Header */}
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Settings</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <NeuCard dark={isDark} radius={40} style={styles.avatar}>
            <View style={styles.avatarInner}>
              <Text style={[styles.avatarText, { color: t.icon }]}>MM</Text>
            </View>
          </NeuCard>
          <Text style={[styles.userName, { color: t.tp }]}>Michael</Text>
          <Text style={[styles.userEmail, { color: t.ts }]}>michael@avenas.com</Text>
        </View>

        {/* Sections */}
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>{section.title}</Text>
            <NeuCard dark={isDark} style={styles.sectionCard}>
              {section.items.map((item, i) => (
                <View key={item.label}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
                  {"unitToggle" in item ? (
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        {item.renderIcon?.(t.icon)}
                        <Text style={[styles.rowLabel, { color: t.tp }]}>{item.label}</Text>
                      </View>
                      <View
                        style={[styles.unitToggle, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div }]}
                        onLayout={e => { unitTrackWidth.value = e.nativeEvent.layout.width - 6; }}
                      >
                        <Reanimated.View style={[styles.unitPill, unitPillStyle]} />
                        <TouchableOpacity
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            userTriggeredRef.current = true;
                            setIsKg(true);
                            unitOffset.value = withSpring(0, { damping: 22, stiffness: 300, mass: 0.9 });
                          }}
                          style={styles.unitBtn}
                          accessibilityLabel="Kilograms"
                          accessibilityRole="button"
                        >
                          <Reanimated.Text style={[styles.unitBtnText, kgLabelColor]}>kg</Reanimated.Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            userTriggeredRef.current = true;
                            setIsKg(false);
                            unitOffset.value = withSpring(1, { damping: 22, stiffness: 300, mass: 0.9 });
                          }}
                          style={styles.unitBtn}
                          accessibilityLabel="Pounds"
                          accessibilityRole="button"
                        >
                          <Reanimated.Text style={[styles.unitBtnText, lbsLabelColor]}>lbs</Reanimated.Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : "toggle" in item ? (
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        {item.renderIcon
                          ? item.renderIcon(t.icon)
                          : <Ionicons name={item.icon as any} size={20} color={t.icon} />}
                        <Text style={[styles.rowLabel, { color: t.tp }]}>{item.label}</Text>
                      </View>
                      <Switch
                        value={isDark}
                        onValueChange={toggleDark}
                        trackColor={{ false: t.div, true: ACCT }}
                        thumbColor="#fff"
                      />
                    </View>
                  ) : (
                    <TouchableOpacity activeOpacity={0.7} style={styles.row}>
                      <View style={styles.rowLeft}>
                        {item.renderIcon
                          ? item.renderIcon(t.icon)
                          : <Ionicons name={item.icon as any} size={20} color={t.icon} />}
                        <Text style={[styles.rowLabel, { color: t.tp }]}>{item.label}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={t.ts} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </NeuCard>
          </View>
        ))}

        {/* Sign out */}
        <NeuCard dark={isDark} style={styles.signOutCard}>
          <TouchableOpacity activeOpacity={0.7} style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="log-out-outline" size={20} color={Colors.error} />
              <Text style={[styles.rowLabel, { color: Colors.error }]}>Sign Out</Text>
            </View>
          </TouchableOpacity>
        </NeuCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:              { flex: 1 },
  topGradient:       { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:            { paddingHorizontal: 20 },
  header:            { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 32, height: 40 },
  backBtn:           { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  title:             { fontFamily: FontFamily.bold, fontSize: 18, color: TP },
  avatarSection:     { alignItems: "center", marginBottom: 36, gap: 8 },
  avatar:            { width: 80, height: 80, borderRadius: 40 },
  avatarInner:       { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  avatarText:        { fontFamily: FontFamily.bold, fontSize: 26, color: ICON },
  userName:          { fontFamily: FontFamily.bold, fontSize: 20, color: TP },
  userEmail:         { fontFamily: FontFamily.regular, fontSize: 14, color: TS },
  section:           { marginBottom: 24 },
  sectionLabel:      { fontFamily: FontFamily.semibold, fontSize: 13, color: TS, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginLeft: 4 },
  sectionCard:       { borderRadius: 18 },
  divider:           { height: 1, backgroundColor: DIV, marginHorizontal: 16 },
  row:               { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 16 },
  rowLeft:           { flexDirection: "row", alignItems: "center", gap: 12 },
  rowLabel:          { fontFamily: FontFamily.regular, fontSize: 16, color: TP },
  signOutCard:       { borderRadius: 18, marginBottom: 12 },
  unitToggle: { flexDirection: "row", borderRadius: 20, padding: 3 },
  unitPill:   { position: "absolute", top: 3, left: 3, bottom: 3, borderRadius: 17, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6 },
  unitBtn:    { paddingHorizontal: 12, paddingVertical: 5, alignItems: "center" },
  unitBtnText:{ fontFamily: FontFamily.semibold, fontSize: 13 },
});
