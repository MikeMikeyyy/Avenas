import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import { useTheme } from "../contexts/ThemeContext";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";

const TP = APP_LIGHT.tp;

export default function ReportBugScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [sent, setSent] = useState(false);

  const canSend = description.trim().length > 0;

  const onSend = () => {
    if (!canSend) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Keyboard.dismiss();
    setSent(true);
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

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
          >
            <View style={styles.header}>
              <View style={{ width: 40 }} />
              <Text style={[styles.title, { color: t.tp }]}>Report a Bug</Text>
              <View style={{ width: 40 }} />
            </View>

            {sent ? (
              <View style={styles.successWrap}>
                <NeuCard dark={isDark} radius={40} style={styles.successIconCard}>
                  <View style={styles.successIconInner}>
                    <Ionicons name="checkmark" size={40} color={ACCT} />
                  </View>
                </NeuCard>
                <Text style={[styles.successTitle, { color: t.tp }]}>Thanks!</Text>
                <Text style={[styles.successBody, { color: t.ts }]}>
                  We've got your report. We'll take a look and follow up if we need more info.
                </Text>
                <BounceButton
                  onPress={() => router.back()}
                  style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}
                  accessibilityLabel="Back to settings"
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryBtnText}>Back to Settings</Text>
                </BounceButton>
              </View>
            ) : (
              <>
                <Text style={[styles.intro, { color: t.ts }]}>
                  Tell us what went wrong and we'll look into it.
                </Text>

                <Text style={[styles.fieldLabel, { color: t.ts }]}>WHAT HAPPENED</Text>
                <NeuCard dark={isDark} style={styles.fieldCard}>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Describe the bug…"
                    placeholderTextColor={t.ts}
                    multiline
                    style={[styles.multilineInput, { color: t.tp }]}
                    textAlignVertical="top"
                  />
                </NeuCard>

                <Text style={[styles.fieldLabel, { color: t.ts }]}>STEPS TO REPRODUCE (OPTIONAL)</Text>
                <NeuCard dark={isDark} style={styles.fieldCard}>
                  <TextInput
                    value={steps}
                    onChangeText={setSteps}
                    placeholder="e.g. Go to Programs, tap New Program…"
                    placeholderTextColor={t.ts}
                    multiline
                    style={[styles.multilineInputShort, { color: t.tp }]}
                    textAlignVertical="top"
                  />
                </NeuCard>

                <BounceButton
                  onPress={onSend}
                  style={[
                    styles.primaryBtn,
                    {
                      backgroundColor: canSend ? ACCT : (isDark ? t.div : "#cfd4dc"),
                      shadowColor: canSend ? ACCT : "transparent",
                    },
                  ]}
                  accessibilityLabel="Send report"
                  accessibilityRole="button"
                >
                  <Text style={[styles.primaryBtnText, !canSend && { color: t.ts }]}>Send Report</Text>
                </BounceButton>
              </>
            )}
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:                 { flex: 1 },
  topGradient:          { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:               { paddingHorizontal: 20 },
  header:               { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, height: 40 },
  backBtn:              { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  title:                { fontFamily: FontFamily.bold, fontSize: 18, color: TP },
  intro:                { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", marginBottom: 24, paddingHorizontal: 24, lineHeight: 20 },
  fieldLabel:           { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4 },
  fieldCard:            { borderRadius: 18, marginBottom: 20 },
  multilineInput:       { fontFamily: FontFamily.regular, fontSize: 15, paddingHorizontal: 16, paddingVertical: 14, minHeight: 140, lineHeight: 21 },
  multilineInputShort:  { fontFamily: FontFamily.regular, fontSize: 15, paddingHorizontal: 16, paddingVertical: 14, minHeight: 80, lineHeight: 21 },
  primaryBtn:           { borderRadius: 18, paddingVertical: 16, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, marginTop: 8 },
  primaryBtnText:       { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff" },
  successWrap:          { alignItems: "center", paddingTop: 24, paddingHorizontal: 8 },
  successIconCard:      { width: 80, height: 80, borderRadius: 40, marginBottom: 16 },
  successIconInner:     { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  successTitle:         { fontFamily: FontFamily.bold, fontSize: 22, marginBottom: 8 },
  successBody:          { fontFamily: FontFamily.regular, fontSize: 15, textAlign: "center", marginBottom: 28, lineHeight: 22, paddingHorizontal: 16 },
});
