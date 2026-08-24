// The chat thread shell, shared by the 1:1 thread (app/trainer/chat/[id].tsx)
// and the group thread (app/trainer/group/[id].tsx) so the two are literally the
// same UI rather than two copies that drift.
//
// Scroll-to-latest is solved structurally with an INVERTED FlatList: `messages`
// is held newest-first and `inverted` renders index 0 at the visual bottom, so
// the list opens pinned to the newest message every time — no scrollToEnd, no
// race (the bug that killed the previous attempt). New sends prepend → appear at
// the bottom automatically. The list + input bar ride the live keyboard frame via
// react-native-keyboard-controller, so they track the interactive drag-to-dismiss
// frame-by-frame instead of snapping the way KeyboardAvoidingView did.
//
// The header is a slot: each screen owns its own (a person vs a group differ in
// avatar, subtitle and menu), but everything below it is common.

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Pressable, Platform, Alert,
  NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import Animated, { useAnimatedStyle, interpolate, Extrapolation, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import SendIcon from "../icons/SendIcon";
import { toYMD, relativeDayLabel } from "../../utils/dates";

/** The minimum a message needs to render in the thread. Both ChatMessage and
 *  GroupMessage satisfy it; the screen's renderBubble sees the full type. */
export type ThreadMessage = {
  id: string;
  mine: boolean;
  text: string;
  sentAtISO: string;
};

// Render rows for the inverted thread: a message, or a day divider. The divider
// is emitted right after a day's OLDEST message in this newest-first array, which
// (once inverted) places it visually ABOVE that day's first message.
type Row<T> =
  | { type: "msg"; msg: T }
  | { type: "day"; key: string; label: string };

interface Props<T extends ThreadMessage> {
  /** NEWEST-FIRST, to match the inverted list. */
  messages: T[];
  renderBubble: (msg: T) => ReactNode;
  /** Send handler. Throws to signal failure: the draft is restored and the
   *  standard "not sent" alert is shown, so neither screen has to reimplement it. */
  onSend: (text: string) => Promise<void>;
  onLongPressMessage?: (msg: T) => void;
  placeholder: string;
  emptyText?: string;
  /** Pinned above the thread, never lifted by the keyboard. */
  header: ReactNode;
}

export default function ChatThreadView<T extends ThreadMessage>({
  messages,
  renderBubble,
  onSend,
  onLongPressMessage,
  placeholder,
  emptyText = "No messages yet — say hi 👋",
  header,
}: Props<T>) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const [input, setInput] = useState("");
  // Jump-to-latest: on the INVERTED list, offset 0 is the newest message, so
  // "scrolled up into history" is simply a large contentOffset.y. The ref
  // mirrors the state so the scroll handler only re-renders on show/hide flips.
  const listRef = useRef<FlatList<Row<T>>>(null);
  const [showJump, setShowJump] = useState(false);
  const showJumpRef = useRef(false);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput("");
    try {
      await onSend(text);
      // If the user had scrolled into history, bring their new message into view.
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (err) {
      // Backend send failed (offline / connection severed / removed from the
      // group) — hand the draft back rather than pretending it went through.
      if (__DEV__) console.warn("[avenas] send message", err);
      setInput(text);
      Alert.alert("Message not sent", "Check your connection and try again.");
    }
  }, [input, onSend]);

  const canSend = input.trim().length > 0;

  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const show = e.nativeEvent.contentOffset.y > 300;
    if (show !== showJumpRef.current) {
      showJumpRef.current = show;
      setShowJump(show);
    }
  }, []);

  const jumpToLatest = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // Interleave day dividers. messages is newest-first; we append a divider after
  // a message whenever the next (older) message falls on a different calendar day
  // (or there is none), so each day's group gets one "Today / Yesterday / date"
  // header above its first message once the list is inverted.
  const items = useMemo<Row<T>[]>(() => {
    const out: Row<T>[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      out.push({ type: "msg", msg: m });
      const curYMD = toYMD(new Date(m.sentAtISO));
      const older = messages[i + 1];
      const olderYMD = older ? toYMD(new Date(older.sentAtISO)) : null;
      if (olderYMD !== curYMD) {
        out.push({ type: "day", key: `day_${curYMD}_${m.id}`, label: relativeDayLabel(new Date(m.sentAtISO)) });
      }
    }
    return out;
  }, [messages]);

  // height.value is 0 closed, -keyboardHeight open — updated frame-by-frame
  // through the interactive drag. -height.value is the live keyboard height we
  // reserve at the bottom, lifting the list + input bar in lock-step with the keys.
  const { height, progress } = useReanimatedKeyboardAnimation();
  const liftStyle = useAnimatedStyle(() => ({ paddingBottom: -height.value }));
  // The home-indicator inset is meaningless behind the keyboard; collapse it as
  // the keyboard rises so the send button sits snug above the keys.
  const barStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(progress.value, [0, 1], [insets.bottom + 8, 6], Extrapolation.CLAMP),
  }));

  return (
    <View style={{ flex: 1 }}>
      {header}

      {/* List + input bar ride the live keyboard frame together (interactive drag included) */}
      <Animated.View style={[{ flex: 1 }, liftStyle]}>
        {/* Messages */}
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={items}
            inverted
            onScroll={onListScroll}
            scrollEventThrottle={32}
            // flex:1 makes the scroll surface fill the whole page; without it the
            // list collapses to its content height, so with one message only the
            // bubble area was draggable. alwaysBounceVertical lets the drag (and
            // interactive keyboard dismiss) register even when content doesn't fill.
            style={{ flex: 1 }}
            alwaysBounceVertical
            keyExtractor={it => (it.type === "msg" ? it.msg.id : it.key)}
            renderItem={({ item }) =>
              item.type === "day" ? (
                <View style={styles.dayWrap}>
                  <View style={[styles.dayPill, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }]}>
                    <Text style={[styles.dayText, { color: t.ts }]}>{item.label}</Text>
                  </View>
                </View>
              ) : onLongPressMessage ? (
                <Pressable onLongPress={() => onLongPressMessage(item.msg)} delayLongPress={250}>
                  {renderBubble(item.msg)}
                </Pressable>
              ) : (
                <>{renderBubble(item.msg)}</>
              )
            }
            keyboardShouldPersistTaps="handled"
            // Instagram/iMessage-style: drag the list down and the keyboard
            // follows your finger (iOS). Android falls back to dismiss-on-drag.
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
          />
          {messages.length === 0 && (
            <View style={styles.empty} pointerEvents="none">
              <Text style={[styles.emptyText, { color: t.ts }]}>{emptyText}</Text>
            </View>
          )}
          {/* Jump back to the latest message once scrolled into history.
              Scale-only entrance — opacity on a GlassView ancestor is not allowed. */}
          {showJump && (
            <Animated.View entering={ZoomIn.duration(180)} exiting={ZoomOut.duration(140)} style={styles.jumpWrap}>
              <TouchableOpacity onPress={jumpToLatest} activeOpacity={0.8} accessibilityLabel="Scroll to latest message" accessibilityRole="button">
                {isGlassEffectAPIAvailable() ? (
                  <GlassView glassEffectStyle="regular" style={styles.jumpBtn}>
                    <Ionicons name="chevron-down" size={22} color={t.tp} />
                  </GlassView>
                ) : (
                  <View style={[styles.jumpBtn, styles.jumpBtnFallback, { backgroundColor: t.ctrl }]}>
                    <Ionicons name="chevron-down" size={22} color={t.tp} />
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>

        {/* Input bar — barStyle collapses the bottom inset as the keyboard rises */}
        <Animated.View style={[styles.inputBar, { borderTopColor: t.div }, barStyle]}>
          <View style={[styles.inputBox, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#ffffff", borderColor: t.div }]}>
            <TextInput
              style={[styles.input, { color: t.tp }]}
              value={input}
              onChangeText={setInput}
              placeholder={placeholder}
              placeholderTextColor={t.ts}
              multiline
            />
          </View>
          <TouchableOpacity onPress={send} disabled={!canSend} activeOpacity={0.8} accessibilityLabel="Send message" accessibilityRole="button">
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
  empty:      { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  emptyText:  { fontFamily: FontFamily.regular, fontSize: 14 },

  dayWrap:    { alignItems: "center", marginVertical: 10 },
  dayPill:    { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  dayText:    { fontFamily: FontFamily.semibold, fontSize: 12 },

  jumpWrap:        { position: "absolute", right: 16, bottom: 12 },
  jumpBtn:         { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  jumpBtnFallback: { shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 4 },

  inputBar:   { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  inputBox:   { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: Platform.OS === "ios" ? 10 : 4, maxHeight: 120, justifyContent: "center" },
  input:      { fontFamily: FontFamily.regular, fontSize: 15, maxHeight: 100 },
  sendBtn:    { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
});
