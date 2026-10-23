// 1:1 chat thread.
//
// The thread itself (inverted list, day dividers, jump-to-latest, keyboard-frame
// input bar) lives in components/trainer/ChatThreadView so this screen and the
// group thread render the same UI. What stays here is what's specific to a
// conversation with ONE person: the header, the realtime subscription filtered
// to that peer, the Report / Block / Remove-connection menu, and what a tap on
// a message offers (delete your own, report theirs).
//
// All of it is ONE sheet with steps, not a sheet per job: two RN Modals mounted
// on a screen at once is the bug where the second never presents again.

import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../../components/FadeScreen";
import GlassButton from "../../../components/GlassButton";
import Avatar from "../../../components/Avatar";
import ChatBubble from "../../../components/trainer/ChatBubble";
import ChatThreadView from "../../../components/trainer/ChatThreadView";
import SimpleSheet from "../../../components/trainer/SimpleSheet";
import { ReportReasonList } from "../../../components/trainer/ReportReasonSheet";
import MessageActions from "../../../components/trainer/MessageActions";
import SheetPill from "../../../components/SheetPill";
import UserRoundMinusIcon from "../../../components/icons/UserRoundMinusIcon";
import FlagIcon from "../../../components/icons/FlagIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../../constants/theme";
import { useTheme } from "../../../contexts/ThemeContext";
import { useAccountType } from "../../../contexts/AccountTypeContext";
import { loadThread, appendMessage, markThreadRead, deleteMessage } from "../../../utils/chatStore";
import { getMyUid, isCloudContactId, subscribeToInbound } from "../../../lib/chat";
import { getMyConnections } from "../../../lib/connections";
import { makeInitials } from "../../../utils/trainerStore";
import { loadHiddenMessageIds, loadBlockedIds, blockContact, unaddContact, reportPerson, reportMessage } from "../../../utils/moderation";
import type { ChatMessage, ReportReason } from "../../../constants/chat";
import BackButton, { BACK_TOP, BACK_LEFT, BACK_SIZE } from "../../../components/BackButton";
import { useConnectionPresence } from "../../../hooks/useConnectionPresence";
import { isActiveNow, presenceLabel } from "../../../utils/presence";

export default function ChatThreadScreen() {
  const router = useRouter();
  const { id, name, initials, photo } = useLocalSearchParams<{ id: string; name?: string; initials?: string; photo?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { accountType } = useAccountType();

  const contactId = id ?? "";
  // When they were last on the app, for the header (null when hidden or never
  // active; absent for someone not connected), kept fresh while focused.
  const { presenceById } = useConnectionPresence();
  // A notification opens this with the id alone (the url the database puts on
  // a message's push carries no name), and the header read "Chat". Then who
  // they are comes from the connection list.
  const [found, setFound] = useState<{ name: string; initials: string; photo?: string } | null>(null);
  useEffect(() => {
    if (name || !contactId) return;
    let cancelled = false;
    getMyConnections()
      .then(conns => {
        const c = conns.find(x => x.otherId === contactId);
        if (!cancelled && c?.name) setFound({ name: c.name, initials: makeInitials(c.name), photo: c.photoUri });
      })
      .catch(err => { if (__DEV__) console.warn("[avenas] chat contact", err); });
    return () => { cancelled = true; };
  }, [name, contactId]);
  const displayName = name || found?.name || "Chat";
  const displayInitials = initials || found?.initials || (displayName.slice(0, 2).toUpperCase());
  const avatarUri = photo || found?.photo;
  const contact = { id: contactId, name: displayName, initials: displayInitials };

  const [messages, setMessages] = useState<ChatMessage[]>([]); // newest-first
  /** The one sheet, and which step it's on. null = closed. */
  const [sheet, setSheet] = useState<
    | { step: "menu" }
    | { step: "message"; msg: ChatMessage }
    | { step: "reasons"; target: { kind: "user" } | { kind: "message"; msg: ChatMessage } }
    | null
  >(null);
  const closeSheet = useCallback(() => setSheet(null), []);

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

  const onReportUser = () => setSheet({ step: "reasons", target: { kind: "user" } });

  const onBlock = () => {
    closeSheet();
    Alert.alert(
      `Block ${displayName}?`,
      "They'll be removed from your connections and from any group you created, and can no longer message you. You can unblock them later in Settings.",
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
    closeSheet();
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

  /** Tap (or press and hold) a message: what you can do with it. */
  const openMessage = useCallback((msg: ChatMessage) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // The sheet would otherwise open above a raised keyboard, half the screen up.
    Keyboard.dismiss();
    setSheet({ step: "message", msg });
  }, []);

  /**
   * Delete a message I sent. It stays in the thread as "You deleted this
   * message", and as "Message deleted by …" on their side, with the words gone
   * from the server. Shown at once and put back if the server refuses, so a
   * deletion that didn't happen never looks like it did.
   */
  const onDeleteMessage = useCallback((msg: ChatMessage) => {
    closeSheet();
    Alert.alert(
      "Delete message?",
      `It will show as deleted for ${displayName} too.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, text: "", deleted: true } : m)));
            try {
              await deleteMessage(contactId, msg.id);
            } catch (err) {
              if (__DEV__) console.warn("[avenas] delete message", err);
              setMessages(prev => prev.map(m => (m.id === msg.id ? msg : m)));
              Alert.alert("Couldn't delete message", "Check your connection and try again.");
            }
          },
        },
      ],
    );
  }, [closeSheet, contactId, displayName]);

  const submitReport = async (reason: ReportReason) => {
    const target = sheet?.step === "reasons" ? sheet.target : null;
    closeSheet();
    if (!target) return;
    if (target.kind === "message") {
      await reportMessage(contact, { id: target.msg.id, text: target.msg.text }, reason);
      setMessages(prev => prev.filter(m => m.id !== target.msg.id));
      Alert.alert("Report received", "Thanks, we review reports within 24 hours and remove content (and the people who post it) that breaks our guidelines.");
    } else {
      // reportPerson routes an "inappropriate name or photo" report to the
      // profile kind, which snapshots both before they can be changed.
      await reportPerson({ ...contact, photoUri: avatarUri || undefined }, reason);
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

  // Who it is, centred between back and ⋯, with when they were last on the
  // app under the name (hidden, as everywhere, when they've turned Activity
  // Status off; nothing says so). No line under the header (user decision,
  // 2026-10-22, the Chat Redesign canvas).
  const lastActive = presenceById.get(contactId);
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + BACK_TOP }]}>
      <BackButton inline />
      <View style={styles.headerTitle} accessible accessibilityRole="header"
        accessibilityLabel={lastActive ? `${displayName}, ${presenceLabel(lastActive)}` : displayName}>
        <Avatar
          uri={avatarUri || undefined}
          initials={displayInitials}
          size={38}
          backgroundColor={isDark ? `${ACCT}1F` : `${ACCT}2E`}
          textStyle={[styles.avatarText, { color: ACCT }]}
        />
        <View style={styles.headerText}>
          <Text style={[styles.headerName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
          {lastActive ? (
            <View style={styles.presenceRow}>
              <View style={[styles.presenceDot, { backgroundColor: isActiveNow(lastActive) ? ACCT : t.ts }]} />
              <Text style={[styles.headerSub, { color: t.ts }]} numberOfLines={1}>{presenceLabel(lastActive)}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <GlassButton onPress={() => setSheet({ step: "menu" })} size={BACK_SIZE} accessibilityLabel="Conversation options">
        <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
      </GlassButton>
    </View>
  );

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <ChatThreadView
        messages={messages}
        renderBubble={(msg, run) => <ChatBubble msg={msg} run={run} tone="green" authorName={displayName} onPress={() => openMessage(msg)} />}
        tone="green"
        onSend={send}
        placeholder={`Message ${displayName}…`}
        header={header}
      />

      <SimpleSheet visible={sheet !== null} onClose={closeSheet}>
        {sheet?.step === "message" ? (
          // A tapped message: delete it if it's mine, report it if it's theirs.
          <MessageActions
            message={sheet.msg}
            authorName={displayName}
            onDelete={() => onDeleteMessage(sheet.msg)}
            onReport={() => setSheet({ step: "reasons", target: { kind: "message", msg: sheet.msg } })}
          />
        ) : sheet?.step === "reasons" ? (
          <ReportReasonList
            title={sheet.target.kind === "message" ? "Report message" : `Report ${displayName}`}
            onSubmit={submitReport}
            onCancel={closeSheet}
          />
        ) : (
          // Conversation options — Report / Block / Remove (Apple Guideline 1.2)
          <>
            <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
            <View style={styles.menu}>
              <SheetPill label="Report" icon={c => <FlagIcon size={18} color={c} />} onPress={onReportUser} />
              <SheetPill label="Block" variant="danger" icon={c => <Ionicons name="ban-outline" size={18} color={c} />} onPress={onBlock} />
              <SheetPill label="Remove connection" icon={c => <UserRoundMinusIcon size={18} color={c} />} onPress={onUnadd} />
            </View>
            <Text style={[styles.menuHint, { color: t.ts }]}>
              Tap any message to delete it or report it.
            </Text>
          </>
        )}
      </SimpleSheet>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: BACK_LEFT, paddingBottom: 12 },
  // Centred between the two round buttons, which are the same width.
  headerTitle: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  headerText: { flexShrink: 1, minWidth: 0 },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 13 },
  headerName: { fontFamily: FontFamily.bold, fontSize: 17, lineHeight: 22 },
  presenceRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  presenceDot: { width: 7, height: 7, borderRadius: 4 },
  headerSub:  { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 16 },

  menuName:   { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu:       { paddingHorizontal: 20, paddingTop: 10, gap: 12 },
  // The group chat's menu hint, value for value.
  menuHint:   { fontFamily: FontFamily.regular, fontSize: 12, textAlign: "center", paddingHorizontal: 24, paddingTop: 10 },
});
