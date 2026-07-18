// Insights — AI training-assistant (WHOOP-style slide-up sheet, placeholder).
//
// Presented as a modal (see app/_layout.tsx: presentation "modal"), so it slides
// up over Home and can be swiped down to dismiss. Layout, top → bottom:
//   - grabber handle (top middle) + "Insights" brand mark (top left)
//   - the assistant's text, flowing from the TOP of the sheet (plain text, no
//     box). Only the user's own messages sit in a bubble.
//   - a single horizontal-scroll row of suggested questions
//   - the text input the user writes in
//
// AI IS NOT WIRED YET. `respond()` returns a fixed placeholder so the page is
// usable and the integration point is obvious. To make it real:
//   1. Replace respond() with a call to the latest Claude model (server-side).
//   2. Feed it the user's training context — workout_history, active program,
//      workout_dates — plus a muscle-group breakdown. NOTE: CompletedExercise
//      stores only the exercise NAME, so totalling per muscle group means
//      mapping names back to constants/exercises.ts (primaryMuscle) + custom
//      exercises (muscles) first. See memory: home-insights-card.
//   3. Persist the thread (currently ephemeral component state) if we want it
//      to survive dismiss/reopen. Real replies are markdown (headers/bullets),
//      so swap the plain <Text> for a lightweight markdown renderer then.

import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, ScrollView,
} from "react-native";
import Animated, { useAnimatedStyle, interpolate, Extrapolation } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import ChatBubble from "../components/trainer/ChatBubble";
import SendIcon from "../components/icons/SendIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import type { ChatMessage } from "../constants/chat";

const INTRO_TEXT =
  "Hey, I'm your training assistant. Soon I'll break down how you're tracking: your weekly and monthly trends and how your sessions split across muscle groups, so you can keep things balanced and know what to focus on next.";

// Placeholder reply until the AI layer is wired in (see header note).
const PLACEHOLDER_REPLY =
  "I'm not connected yet, but I'm coming soon. I'll read your real workouts and give you insights right here.";

const SUGGESTIONS = [
  "How balanced is my split?",
  "Summarise my week",
  "What should I focus on?",
];

function makeMessage(mine: boolean, text: string): ChatMessage {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, mine, text, sentAtISO: new Date().toISOString() };
}

export default function InsightsScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  // oldest-first: the assistant's text reads from the top of the sheet down.
  const [messages, setMessages] = useState<ChatMessage[]>(() => [makeMessage(false, INTRO_TEXT)]);
  const [input, setInput] = useState("");

  // Stand-in for the AI call. Swap this for a real model request (see header).
  const respond = useCallback((_userText: string): string => PLACEHOLDER_REPLY, []);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput("");
    const userMsg = makeMessage(true, trimmed);
    const reply = makeMessage(false, respond(trimmed));
    setMessages((prev) => [...prev, userMsg, reply]);
  }, [respond]);

  const canSend = input.trim().length > 0;

  // Input bar tracks the live keyboard frame (interactive drag included).
  const { height, progress } = useReanimatedKeyboardAnimation();
  const liftStyle = useAnimatedStyle(() => ({ paddingBottom: -height.value }));
  const barStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(progress.value, [0, 1], [insets.bottom + 8, 6], Extrapolation.CLAMP),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Top bar — grabber centered, brand mark on the left */}
      <View style={styles.topBar}>
        <View style={styles.grabberWrap} pointerEvents="none">
          <View style={[styles.grabber, { backgroundColor: t.div }]} />
        </View>
        <View style={[styles.brand, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#ffffff" }]}>
          <View style={styles.brandBadge}>
            <Ionicons name="sparkles" size={13} color="#FFFFFF" />
          </View>
          <Text style={[styles.brandText, { color: ACCT }]}>Insights</Text>
        </View>
      </View>

      <Animated.View style={[{ flex: 1 }, liftStyle]}>
        {/* Conversation — flows from the top. Assistant = plain text, user = bubble. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m) =>
            m.mine ? (
              <ChatBubble key={m.id} msg={m} />
            ) : (
              <View key={m.id} style={styles.aiBlock}>
                <Text style={[styles.aiText, { color: t.tp }]}>{m.text}</Text>
              </View>
            )
          )}
        </ScrollView>

        {/* Suggested questions — one horizontal scroll line. alignItems:center on
            the content + flexGrow:0 on the ScrollView keep the chips at their
            natural size (a horizontal ScrollView otherwise stretches them). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.suggestScroll}
          contentContainerStyle={styles.suggestRow}
        >
          {SUGGESTIONS.map((s) => (
            <TouchableOpacity
              key={s}
              activeOpacity={0.8}
              onPress={() => send(s)}
              style={[styles.suggestChip, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#ffffff" }]}
              accessibilityRole="button"
            >
              <Text style={[styles.suggestText, { color: t.tp }]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Input bar — barStyle collapses the bottom inset as the keyboard rises */}
        <Animated.View style={[styles.inputBar, { borderTopColor: t.div }, barStyle]}>
          <View style={[styles.inputBox, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#ffffff", borderColor: t.div }]}>
            <TextInput
              style={[styles.input, { color: t.tp }]}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your training…"
              placeholderTextColor={t.ts}
              multiline
              onSubmitEditing={() => send(input)}
            />
          </View>
          <TouchableOpacity onPress={() => send(input)} disabled={!canSend} activeOpacity={0.8} accessibilityLabel="Send message" accessibilityRole="button">
            <View style={[styles.sendBtn, { backgroundColor: ACCT, opacity: canSend ? 1 : 0.4 }]}>
              <SendIcon size={18} color="#fff" />
            </View>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar:      { flexDirection: "row", justifyContent: "flex-start", alignItems: "center", paddingHorizontal: 16, paddingTop: 26, paddingBottom: 12 },
  grabberWrap: { position: "absolute", top: 8, left: 0, right: 0, alignItems: "center" },
  grabber:     { width: 40, height: 5, borderRadius: 3 },
  brand:       { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 5, paddingRight: 12, paddingVertical: 5, borderRadius: 999 },
  brandBadge:  { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: ACCT,
                 shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 5 },
  brandText:   { fontFamily: FontFamily.semibold, fontSize: 14 },

  scrollContent: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16 },
  aiBlock:       { width: "100%", marginVertical: 8 },
  aiText:        { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },

  suggestScroll: { flexGrow: 0 },
  suggestRow:    { alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  suggestChip:   { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  suggestText:   { fontFamily: FontFamily.semibold, fontSize: 13 },

  inputBar:   { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  inputBox:   { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: Platform.OS === "ios" ? 10 : 4, maxHeight: 120, justifyContent: "center" },
  input:      { fontFamily: FontFamily.regular, fontSize: 15, maxHeight: 100 },
  sendBtn:    { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
});
