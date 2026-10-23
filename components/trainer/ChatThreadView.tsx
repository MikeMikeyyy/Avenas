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
//
// The refreshed thread (user decisions, 2026-10-22, the Chat Redesign canvas):
// messages from one person in a row sit close as a run (`runOf`: the same
// sender, the same day, a few minutes apart), so a bubble can say who once at
// the top and the time once at the bottom; the day is plain words, not a
// pill; the composer is the app's faded field (SearchField's look), with no
// line above it; the send button takes the thread's tone, green for a chat
// with one person and orchid for a group's.

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Platform, Alert,
  NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import Animated, { useAnimatedStyle, interpolate, Extrapolation, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { pillGlow, PILL_RADIUS } from "../../constants/buttons";
import { sentGradient, type ChatTone } from "../../constants/chat";
import { useTheme } from "../../contexts/ThemeContext";
import GlassButton from "../GlassButton";
import SendIcon from "../icons/SendIcon";
import { toYMD, relativeDayLabel } from "../../utils/dates";

/** How far apart two messages from one person can be and still sit together
 *  as a run. */
const RUN_GAP_MS = 5 * 60 * 1000;

/** Where a message sits in its run: the first (oldest) shows who wrote it,
 *  the last (newest) its face and time. A message on its own is both. */
export type RunPlace = { first: boolean; last: boolean };

/** The composer's height, and the send button's. Matches the app's search
 *  fields (42), which is what makes the two read as the same control. */
const FIELD_H = 42;

/** The jump-to-latest button over the thread. */
const JUMP_SIZE = 44;

/** The minimum a message needs to render in the thread. Both ChatMessage and
 *  GroupMessage satisfy it; the screen's renderBubble sees the full type. */
export type ThreadMessage = {
  id: string;
  mine: boolean;
  text: string;
  sentAtISO: string;
  /** Who sent it, in a group. A 1:1 thread's received messages are all the
   *  contact's, so they need none. */
  senderId?: string;
};

/** Whether two neighbouring messages belong to one run. */
function sameRun(a: ThreadMessage, b: ThreadMessage): boolean {
  const who = (m: ThreadMessage) => (m.mine ? "me" : m.senderId ?? "them");
  if (who(a) !== who(b)) return false;
  const ta = new Date(a.sentAtISO);
  const tb = new Date(b.sentAtISO);
  if (toYMD(ta) !== toYMD(tb)) return false;
  return Math.abs(ta.getTime() - tb.getTime()) <= RUN_GAP_MS;
}

// Render rows for the inverted thread: a message, or a day divider. The divider
// is emitted right after a day's OLDEST message in this newest-first array, which
// (once inverted) places it visually ABOVE that day's first message.
type Row<T> =
  | { type: "msg"; msg: T; run: RunPlace }
  | { type: "day"; key: string; label: string };

interface Props<T extends ThreadMessage> {
  /** NEWEST-FIRST, to match the inverted list. */
  messages: T[];
  renderBubble: (msg: T, run: RunPlace) => ReactNode;
  /** The send button's colour: green for a person's chat, orchid for a
   *  group's (the thread's own bubbles take the same). */
  tone?: ChatTone;
  /** Send handler. Throws to signal failure: the draft is restored and the
   *  standard "not sent" alert is shown, so neither screen has to reimplement it. */
  onSend: (text: string) => Promise<void>;
  placeholder: string;
  emptyText?: string;
  /** Pinned above the thread, never lifted by the keyboard. */
  header: ReactNode;
}

export default function ChatThreadView<T extends ThreadMessage>({
  messages,
  renderBubble,
  tone = "green",
  onSend,
  placeholder,
  emptyText = "No messages yet. Say hi 👋",
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
  const grad = sentGradient(tone);

  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const show = e.nativeEvent.contentOffset.y > 300;
    if (show !== showJumpRef.current) {
      showJumpRef.current = show;
      setShowJump(show);
    }
  }, []);

  // The light haptic is the button's (GlassButton).
  const jumpToLatest = useCallback(() => {
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
      // Newest-first: the older neighbour is i + 1, the newer i - 1.
      const older = messages[i + 1];
      const newer = messages[i - 1];
      out.push({
        type: "msg",
        msg: m,
        run: { first: !older || !sameRun(older, m), last: !newer || !sameRun(m, newer) },
      });
      const curYMD = toYMD(new Date(m.sentAtISO));
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
                // Plain words, quieter than the messages they sit over.
                <View style={styles.dayWrap}>
                  <Text style={[styles.dayText, { color: t.ts }]}>{item.label}</Text>
                </View>
              ) : (
                // Taps belong to the bubble (ChatBubble's onPress), not the row:
                // the row spans the thread, so a row-wide target opened a
                // message from a tap on the empty space beside it.
                <>{renderBubble(item.msg, item.run)}</>
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
          {/* Jump back to the latest message once scrolled into history. */}
          {showJump && (
            <Animated.View entering={ZoomIn.duration(180)} exiting={ZoomOut.duration(140)} style={styles.jumpWrap}>
              <GlassButton
                onPress={jumpToLatest}
                size={JUMP_SIZE}
                solidStyle={styles.jumpLift}
                accessibilityLabel="Scroll to latest message"
              >
                <Ionicons name="chevron-down" size={22} color={t.tp} />
              </GlassButton>
            </Animated.View>
          )}
        </View>

        {/* Input bar — barStyle collapses the bottom inset as the keyboard rises */}
        <Animated.View style={[styles.inputBar, barStyle]}>
          <View style={[styles.inputBox, { backgroundColor: t.field, borderColor: t.div }]}>
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
            <View style={[styles.sendGlow, pillGlow(grad[1], 0.4), { opacity: canSend ? 1 : 0.4 }]}>
              <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendBtn}>
                <SendIcon size={18} color="#fff" />
              </LinearGradient>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty:      { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  emptyText:  { fontFamily: FontFamily.regular, fontSize: 14 },

  dayWrap:    { alignItems: "center", marginTop: 14, marginBottom: 8 },
  dayText:    { fontFamily: FontFamily.semibold, fontSize: 12 },

  jumpWrap:        { position: "absolute", right: 16, bottom: 12 },
  // The solid button's lift; the glass one is lit by the glass.
  jumpLift:        { shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 4 },

  // No line above it: the field itself says where typing goes.
  inputBar:   { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  // The app's faded field (components/SearchField.tsx's look): t.field with a
  // t.div hairline, no shadow, fully rounded so it pairs with the round send.
  //
  // minHeight rather than height, because this one grows: a wrapped line takes
  // the padding past 42 while a single line still sits at the search bar's
  // height. maxHeight stops it eating the thread.
  inputBox:   { flex: 1, flexDirection: "row", alignItems: "center", minHeight: FIELD_H, maxHeight: 120, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 10 : 4, borderRadius: PILL_RADIUS, borderWidth: 1 },
  input:      { flex: 1, fontFamily: FontFamily.regular, fontSize: 15, padding: 0, maxHeight: 100 },
  // Square to the field's height, so the two read as one control pair rather
  // than a button that outgrew its input. The glow sits on an outer view: a
  // gradient that clips its corners can't cast a shadow of its own.
  sendGlow:   { width: FIELD_H, height: FIELD_H, borderRadius: FIELD_H / 2 },
  sendBtn:    { width: FIELD_H, height: FIELD_H, borderRadius: FIELD_H / 2, alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
