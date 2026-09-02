// Group chat thread.
//
// Same UI as the 1:1 thread — both render components/trainer/ChatThreadView, so
// the inverted list, day dividers, jump-to-latest and keyboard-frame input bar
// are literally the same code. What differs is here:
//   - received bubbles carry their author (a group has many senders),
//   - the header shows the group name + member count and links to Manage,
//   - the menu offers Report / Leave (or Delete for the owner) instead of the
//     1:1 Block / Remove-connection pair,
//   - blocked members' messages are filtered client-side. Blocking severs a
//     CONNECTION (0006) and group membership is independent of that, so the
//     server still delivers their rows; hiding them here keeps a block
//     meaningful inside a group (Apple Guideline 1.2).

import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../../components/FadeScreen";
import ChatBubble from "../../../components/trainer/ChatBubble";
import ChatThreadView from "../../../components/trainer/ChatThreadView";
import SimpleSheet from "../../../components/trainer/SimpleSheet";
import ReportReasonSheet from "../../../components/trainer/ReportReasonSheet";
import PeopleIcon from "../../../components/icons/PeopleIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER } from "../../../constants/theme";
import { useTheme } from "../../../contexts/ThemeContext";
import {
  deleteGroup,
  deleteGroupMessage,
  fetchGroup,
  fetchGroupMembers,
  fetchGroupThread,
  leaveGroup,
  markGroupRead,
  sendGroupMessage,
  subscribeToGroup,
} from "../../../lib/groups";
import { getMyUid } from "../../../lib/chat";
import { loadHiddenMessageIds, loadBlockedIds, reportPerson, reportMessage } from "../../../utils/moderation";
import type { Group, GroupMember, GroupMessage } from "../../../constants/groups";
import type { ReportReason } from "../../../constants/chat";

export default function GroupThreadScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const groupId = id ?? "";

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]); // newest-first
  const [menuOpen, setMenuOpen] = useState(false);
  const [report, setReport] = useState<{ kind: "message"; msg: GroupMessage } | null>(null);

  const displayName = group?.name || name || "Group";

  const refresh = useCallback(async () => {
    if (!groupId) return;
    const uid = await getMyUid();
    if (!uid) return;
    const [g, roster] = await Promise.all([fetchGroup(uid, groupId), fetchGroupMembers(groupId)]);
    if (!g) {
      // Deleted, or we were removed from it.
      Alert.alert("Group unavailable", "This group no longer exists, or you're no longer a member.");
      router.back();
      return;
    }
    const [thread, hidden, blocked] = await Promise.all([
      fetchGroupThread(uid, groupId, roster),
      loadHiddenMessageIds(),
      loadBlockedIds(),
    ]);
    setGroup(g);
    setMembers(roster);
    setMessages(
      [...thread]
        .reverse() // newest-first for the inverted list
        .filter(m => !hidden.has(m.id) && !blocked.has(m.senderId)),
    );
    markGroupRead(uid, groupId).catch(err => {
      if (__DEV__) console.warn("[avenas] mark group read", groupId, err);
    });
  }, [groupId, router]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      (async () => {
        try {
          await refresh();
        } catch (err) {
          if (__DEV__) console.warn("[avenas] load group thread", groupId, err);
        }
        if (cancelled || !groupId) return;
        // Live delivery while the thread is open. My own inserts echo back here
        // too — skip them, since send() already put the message in state.
        const uid = await getMyUid();
        if (cancelled) return;
        const unsub = subscribeToGroup(groupId, senderId => {
          if (senderId !== uid) void refresh();
        });
        if (cancelled) unsub();
        else unsubscribe = unsub;
      })();
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    }, [groupId, refresh]),
  );

  // Throws on failure — ChatThreadView restores the draft and alerts.
  const send = useCallback(async (text: string) => {
    if (!groupId) return;
    const uid = await getMyUid();
    if (!uid) throw new Error("not signed in");
    const msg = await sendGroupMessage(uid, groupId, text, members);
    setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [msg, ...prev]));
  }, [groupId, members]);

  const onLongPressMessage = useCallback((msg: GroupMessage) => {
    if (msg.mine) return; // you only report other people's messages
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReport({ kind: "message", msg });
  }, []);

  const submitReport = async (reason: ReportReason) => {
    const target = report;
    setReport(null);
    if (!target) return;
    const author = { id: target.msg.senderId, name: target.msg.senderName, photoUri: target.msg.senderPhotoUri };
    await reportMessage(author, { id: target.msg.id, text: target.msg.text }, reason);
    await reportPerson(author, reason);
    setMessages(prev => prev.filter(m => m.id !== target.msg.id));
    // The group owner can actually remove the content for everyone; anyone else
    // has hidden it for themselves via the local hidden-messages list.
    if (group?.isOwner) {
      try {
        await deleteGroupMessage(target.msg.id);
      } catch (err) {
        if (__DEV__) console.warn("[avenas] delete reported group message", err);
      }
    }
    Alert.alert(
      "Report received",
      group?.isOwner
        ? "Thanks, we review reports within 24 hours. The message has been removed from the group."
        : "Thanks, we review reports within 24 hours. The message is hidden for you.",
    );
  };

  const onLeave = () => {
    setMenuOpen(false);
    Alert.alert(
      `Leave ${displayName}?`,
      "You'll stop receiving messages from this group. The trainer can add you back later.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: async () => {
          try {
            const uid = await getMyUid();
            if (!uid) throw new Error("not signed in");
            await leaveGroup(uid, groupId);
            router.back();
          } catch (e) {
            Alert.alert("Couldn't leave", e instanceof Error ? e.message : "Check your connection and try again.");
          }
        } },
      ],
    );
  };

  const onDelete = () => {
    setMenuOpen(false);
    Alert.alert(
      `Delete ${displayName}?`,
      "The group and its messages are removed for everyone. Programs you've already sent stay in your clients' libraries.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteGroup(groupId);
            router.back();
          } catch (e) {
            Alert.alert("Couldn't delete group", e instanceof Error ? e.message : "Check your connection and try again.");
          }
        } },
      ],
    );
  };

  const openManage = () => {
    setMenuOpen(false);
    router.navigate({ pathname: "/trainer/group-edit", params: { id: groupId } });
  };

  const memberLabel = useMemo(() => {
    const n = group?.memberCount ?? members.length;
    return `${n} member${n === 1 ? "" : "s"}`;
  }, [group, members]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: t.div }]}>
      <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} accessibilityLabel="Go back" accessibilityRole="button">
        <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
          <Ionicons name="chevron-back" size={22} color={t.tp} />
        </View>
      </TouchableOpacity>
      <View style={[styles.groupAvatar, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
        <PeopleIcon size={20} color={ACCT} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.headerName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        <Text style={[styles.headerSub, { color: t.ts }]} numberOfLines={1}>{memberLabel}</Text>
      </View>
      <TouchableOpacity onPress={() => setMenuOpen(true)} activeOpacity={0.8} accessibilityLabel="Group options" accessibilityRole="button">
        <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
          <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
        </View>
      </TouchableOpacity>
    </View>
  );

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <ChatThreadView
        messages={messages}
        renderBubble={msg => (
          <ChatBubble
            msg={msg}
            senderName={msg.mine ? undefined : msg.senderName}
            senderPhotoUri={msg.senderPhotoUri}
          />
        )}
        onSend={send}
        onLongPressMessage={onLongPressMessage}
        placeholder={`Message ${displayName}…`}
        emptyText="No messages yet. Start the conversation 👋"
        header={header}
      />

      <SimpleSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        <View style={styles.menu}>
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={openManage} accessibilityRole="button" accessibilityLabel="View members">
            <Ionicons name="people-outline" size={20} color={t.tp} />
            <Text style={[styles.menuText, { color: t.tp }]}>
              {group?.isOwner ? "Manage members" : "View members"}
            </Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          {group?.isOwner ? (
            <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete group">
              <Ionicons name="trash-outline" size={20} color={DANGER} />
              <Text style={[styles.menuText, { color: DANGER }]}>Delete group</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onLeave} accessibilityRole="button" accessibilityLabel="Leave group">
              <Ionicons name="exit-outline" size={20} color={DANGER} />
              <Text style={[styles.menuText, { color: DANGER }]}>Leave group</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={[styles.menuHint, { color: t.ts }]}>
          Press and hold any message to report it.
        </Text>
      </SimpleSheet>

      <ReportReasonSheet
        visible={report !== null}
        title="Report message"
        onSubmit={submitReport}
        onClose={() => setReport(null)}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  groupAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  headerName:  { fontFamily: FontFamily.bold, fontSize: 18 },
  headerSub:   { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },

  menuName:    { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu:        { paddingHorizontal: 16, paddingTop: 4 },
  menuRow:     { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 8 },
  menuDivider: { height: 1, marginHorizontal: 8 },
  menuText:    { fontFamily: FontFamily.semibold, fontSize: 16 },
  menuHint:    { fontFamily: FontFamily.regular, fontSize: 12, textAlign: "center", paddingHorizontal: 24, paddingTop: 10 },
});
