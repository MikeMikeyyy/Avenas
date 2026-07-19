// 1:1 chat thread.
//
// Scroll-to-latest is solved structurally with an INVERTED FlatList: state is
// held newest-first and `inverted` renders index 0 at the visual bottom, so the
// list opens pinned to the newest message every time — no scrollToEnd, no race
// (the bug that killed the previous attempt). New sends prepend → appear at the
// bottom automatically. The list + input bar ride the live keyboard frame via
// react-native-keyboard-controller, so they track the interactive drag-to-dismiss
// frame-by-frame instead of snapping the way KeyboardAvoidingView did.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Pressable, Platform, Alert,
  NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import Animated, { useAnimatedStyle, interpolate, Extrapolation, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../../components/FadeScreen";
import Avatar from "../../../components/Avatar";
import ChatBubble from "../../../components/trainer/ChatBubble";
import SimpleSheet from "../../../components/trainer/SimpleSheet";
import ReportReasonSheet from "../../../components/trainer/ReportReasonSheet";
import SendIcon from "../../../components/icons/SendIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER } from "../../../constants/theme";
import { useTheme } from "../../../contexts/ThemeContext";
import { useAccountType } from "../../../contexts/AccountTypeContext";
import { loadThread, appendMessage, markThreadRead } from "../../../utils/chatStore";
import { getMyUid, isCloudContactId, subscribeToInbound } from "../../../lib/chat";
import { loadHiddenMessageIds, loadBlockedIds, blockContact, unaddContact, reportUser, reportMessage } from "../../../utils/moderation";
import { toYMD, relativeDayLabel } from "../../../utils/dates";
import type { ChatMessage, ReportReason } from "../../../constants/chat";

// Render rows for the inverted thread: a message, or a day divider. The divider
// is emitted right after a day's OLDEST message in this newest-first array, which
// (once inverted) places it visually ABOVE that day's first message.
type ChatItem =
  | { type: "msg"; msg: ChatMessage }
  | { type: "day"; key: string; label: string };

export default function ChatThreadScreen() {
  const router = useRouter();
  const { id, name, initials, photo } = useLocalSearchParams<{ id: string; name?: string; initials?: string; photo?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { accountType } = useAccountType();

  const contactId = id ?? "";
  const displayName = name || "Chat";
  const displayInitials = initials || (displayName.slice(0, 2).toUpperCase());
  const contact = { id: contactId, name: displayName, initials: displayInitials };

  const [messages, setMessages] = useState<ChatMessage[]>([]); // newest-first
  const [input, setInput] = useState("");
  // Jump-to-latest: on the INVERTED list, offset 0 is the newest message, so
  // "scrolled up into history" is simply a large contentOffset.y. The ref
  // mirrors the state so the scroll handler only re-renders on show/hide flips.
  const listRef = useRef<FlatList<ChatItem>>(null);
  const [showJump, setShowJump] = useState(false);
  const showJumpRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // null = no report sheet open; the variant drives the reason picker's title.
  const [report, setReport] = useState<{ kind: "user" } | { kind: "message"; msg: ChatMessage } | null>(null);

  // Re-fetch the thread (merged local + cloud) and mark it read. Used by the
  // focus effect and by the realtime subscription when a message arrives live.
  const refresh = useCallback(async () => {
    const thread = contactId ? await loadThread(contactId) : [];
    const hidden = await loadHiddenMessageIds();
    // newest-first for the inverted list; reported messages filtered out
    setMessages([...thread].reverse().filter(m => !hidden.has(m.id)));
    if (contactId) markThreadRead(contactId); // viewing clears the unread badge
  }, [contactId]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      (async () => {
        // Defence-in-depth: every UI path filters blocked users out of the lists
        // that link here, but a stale router history or a deep-link could still
        // land on a blocked contact's thread. Bail out before we read their
        // messages so a block can't be bypassed by navigation.
        if (contactId) {
          const blocked = await loadBlockedIds();
          if (cancelled) return;
          if (blocked.has(contactId)) {
            router.back();
            return;
          }
        }
        await refresh();
        // Real connections get live delivery while the thread is open; without
        // realtime (offline, Expo Go hiccup) the focus-effect reload still
        // catches up on the next visit.
        const uid = await getMyUid();
        if (cancelled || !uid || !isCloudContactId(contactId)) return;
        const unsub = subscribeToInbound(uid, senderId => {
          if (senderId === contactId) refresh();
        });
        if (cancelled) unsub();
        else unsubscribe = unsub;
      })();
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    }, [contactId, refresh]),
  );

  const onReportUser = () => { setMenuOpen(false); setReport({ kind: "user" }); };

  const onBlock = () => {
    setMenuOpen(false);
    Alert.alert(
      `Block ${displayName}?`,
      "They'll be removed from your connections and can no longer message you. You can unblock them later in Settings.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Block", style: "destructive", onPress: async () => {
          const { severed } = await blockContact(contact, accountType);
          router.back();
          if (!severed) Alert.alert(`${displayName} is blocked`, "We couldn't reach the server to sever the connection. It will finish when you're back online.");
        } },
      ],
    );
  };

  const onUnadd = () => {
    setMenuOpen(false);
    Alert.alert(
      `Remove ${displayName}?`,
      "This removes your connection. Any programs already shared stay in your library.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: async () => {
          const { severed } = await unaddContact(contactId, accountType);
          if (severed) {
            router.back();
          } else {
            // Unlike block, nothing filters an un-added person out while
            // offline — the connection is genuinely still up, so say so.
            Alert.alert("Couldn't remove connection", "We couldn't reach the server, so the connection wasn't removed. Check your internet and try again.");
          }
        } },
      ],
    );
  };

  const onLongPressMessage = (msg: ChatMessage) => {
    if (msg.mine) return; // you only report messages from the other person
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReport({ kind: "message", msg });
  };

  const submitReport = async (reason: ReportReason) => {
    const target = report;
    setReport(null);
    if (!target) return;
    if (target.kind === "message") {
      await reportMessage(contact, { id: target.msg.id, text: target.msg.text }, reason);
      setMessages(prev => prev.filter(m => m.id !== target.msg.id));
      Alert.alert("Report received", "Thanks — we review reports within 24 hours and remove content (and the people who post it) that breaks our guidelines.");
    } else {
      await reportUser(contact, reason);
      Alert.alert(
        "Report received",
        `Thanks — we review reports within 24 hours. Would you also like to block ${displayName}?`,
        [
          { text: "Not now", style: "cancel" },
          { text: "Block", style: "destructive", onPress: async () => {
            const { severed } = await blockContact(contact, accountType);
            router.back();
            if (!severed) Alert.alert(`${displayName} is blocked`, "We couldn't reach the server to sever the connection. It will finish when you're back online.");
          } },
        ],
      );
    }
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !contactId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput("");
    try {
      const msg = await appendMessage(contactId, text);
      setMessages(prev => [msg, ...prev]); // prepend → bottom of inverted list
      // If the user had scrolled into history, bring their new message into view.
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (err) {
      // Backend send failed (offline / connection severed) — hand the draft
      // back rather than pretending it went through.
      if (__DEV__) console.warn("[avenas] send message", contactId, err);
      setInput(text);
      Alert.alert("Message not sent", "Check your connection and try again.");
    }
  }, [input, contactId]);

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
  const items = useMemo<ChatItem[]>(() => {
    const out: ChatItem[] = [];
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
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View style={{ flex: 1 }}>
        {/* Header — stays pinned at the top, never lifted by the keyboard */}
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: t.div }]}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} accessibilityLabel="Go back" accessibilityRole="button">
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
          <Avatar
            uri={photo || undefined}
            initials={displayInitials}
            size={38}
            backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
            textStyle={[styles.avatarText, { color: ACCT }]}
          />
          <Text style={[styles.headerName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
          <TouchableOpacity onPress={() => setMenuOpen(true)} activeOpacity={0.8} accessibilityLabel="Conversation options" accessibilityRole="button">
            {isGlassEffectAPIAvailable() ? (
              <GlassView glassEffectStyle="regular" style={styles.backBtn}>
                <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
              </GlassView>
            ) : (
              <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
                <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
              </View>
            )}
          </TouchableOpacity>
        </View>

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
                ) : (
                  <Pressable onLongPress={() => onLongPressMessage(item.msg)} delayLongPress={250}>
                    <ChatBubble msg={item.msg} />
                  </Pressable>
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
                <Text style={[styles.emptyText, { color: t.ts }]}>No messages yet — say hi 👋</Text>
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
                    <View style={[styles.jumpBtn, styles.jumpBtnFallback, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
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
                placeholder={`Message ${displayName}…`}
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

      {/* Conversation options — Report / Block / Remove (Apple Guideline 1.2) */}
      <SimpleSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        <View style={styles.menu}>
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onReportUser} accessibilityRole="button" accessibilityLabel={`Report ${displayName}`}>
            <Ionicons name="flag-outline" size={20} color={t.tp} />
            <Text style={[styles.menuText, { color: t.tp }]}>Report</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onBlock} accessibilityRole="button" accessibilityLabel={`Block ${displayName}`}>
            <Ionicons name="ban-outline" size={20} color={DANGER} />
            <Text style={[styles.menuText, { color: DANGER }]}>Block</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onUnadd} accessibilityRole="button" accessibilityLabel={`Remove ${displayName}`}>
            <Ionicons name="person-remove-outline" size={20} color={t.tp} />
            <Text style={[styles.menuText, { color: t.tp }]}>Remove connection</Text>
          </TouchableOpacity>
        </View>
      </SimpleSheet>

      <ReportReasonSheet
        visible={report !== null}
        title={report?.kind === "message" ? "Report message" : `Report ${displayName}`}
        onSubmit={submitReport}
        onClose={() => setReport(null)}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 13 },
  headerName: { flex: 1, fontFamily: FontFamily.bold, fontSize: 18 },

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

  menuName:   { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu:       { paddingHorizontal: 16, paddingTop: 4 },
  menuRow:    { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 8 },
  menuDivider:{ height: 1, marginHorizontal: 8 },
  menuText:   { fontFamily: FontFamily.semibold, fontSize: 16 },
});
