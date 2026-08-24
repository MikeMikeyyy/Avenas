// 1:1 chat thread.
//
// The thread itself (inverted list, day dividers, jump-to-latest, keyboard-frame
// input bar) lives in components/trainer/ChatThreadView so this screen and the
// group thread render the same UI. What stays here is what's specific to a
// conversation with ONE person: the header, the realtime subscription filtered
// to that peer, and the Report / Block / Remove-connection menu.

import { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../../components/FadeScreen";
import Avatar from "../../../components/Avatar";
import ChatBubble from "../../../components/trainer/ChatBubble";
import ChatThreadView from "../../../components/trainer/ChatThreadView";
import SimpleSheet from "../../../components/trainer/SimpleSheet";
import ReportReasonSheet from "../../../components/trainer/ReportReasonSheet";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER } from "../../../constants/theme";
import { useTheme } from "../../../contexts/ThemeContext";
import { useAccountType } from "../../../contexts/AccountTypeContext";
import { loadThread, appendMessage, markThreadRead } from "../../../utils/chatStore";
import { getMyUid, isCloudContactId, subscribeToInbound } from "../../../lib/chat";
import { loadHiddenMessageIds, loadBlockedIds, blockContact, unaddContact, reportPerson, reportMessage } from "../../../utils/moderation";
import type { ChatMessage, ReportReason } from "../../../constants/chat";

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

  const onLongPressMessage = useCallback((msg: ChatMessage) => {
    if (msg.mine) return; // you only report messages from the other person
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReport({ kind: "message", msg });
  }, []);

  const submitReport = async (reason: ReportReason) => {
    const target = report;
    setReport(null);
    if (!target) return;
    if (target.kind === "message") {
      await reportMessage(contact, { id: target.msg.id, text: target.msg.text }, reason);
      setMessages(prev => prev.filter(m => m.id !== target.msg.id));
      Alert.alert("Report received", "Thanks, we review reports within 24 hours and remove content (and the people who post it) that breaks our guidelines.");
    } else {
      // reportPerson routes an "inappropriate name or photo" report to the
      // profile kind, which snapshots both before they can be changed.
      await reportPerson({ ...contact, photoUri: photo || undefined }, reason);
      Alert.alert(
        "Report received",
        `Thanks, we review reports within 24 hours. Would you also like to block ${displayName}?`,
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

  // Throws on failure — ChatThreadView restores the draft and alerts.
  const send = useCallback(async (text: string) => {
    if (!contactId) return;
    const msg = await appendMessage(contactId, text);
    setMessages(prev => [msg, ...prev]); // prepend → bottom of inverted list
  }, [contactId]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: t.div }]}>
      <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} accessibilityLabel="Go back" accessibilityRole="button">
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
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
          <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
            <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <ChatThreadView
        messages={messages}
        renderBubble={msg => <ChatBubble msg={msg} />}
        onSend={send}
        onLongPressMessage={onLongPressMessage}
        placeholder={`Message ${displayName}…`}
        header={header}
      />

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

  menuName:   { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu:       { paddingHorizontal: 16, paddingTop: 4 },
  menuRow:    { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 8 },
  menuDivider:{ height: 1, marginHorizontal: 8 },
  menuText:   { fontFamily: FontFamily.semibold, fontSize: 16 },
});
