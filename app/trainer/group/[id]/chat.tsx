// Group chat thread.
//
// Same UI as the 1:1 thread — both render components/trainer/ChatThreadView, so
// the inverted list, day dividers, jump-to-latest and keyboard-frame input bar
// are literally the same code. What differs is here:
//   - received bubbles carry their author (a group has many senders),
//   - the header shows the group name + member count and opens the group page,
//   - the menu is about the PEOPLE in the thread: report someone, or block
//     them. A group has many senders, so each is a two-step sheet (what, then
//     who) rather than the 1:1 menu's single named target. Everything about the
//     group itself lives on the group's page, which the header links to,
//   - tapping a message offers what the 1:1 thread does (delete your own,
//     report someone else's), as another step of the SAME sheet — one RN Modal
//     per screen, including the report reasons, which used to be a second one,
//   - blocked members' messages are filtered client-side. Blocking severs a
//     CONNECTION (0006) and group membership is independent of that, so the
//     server still delivers their rows; hiding them here keeps a block
//     meaningful inside a group (Apple Guideline 1.2).

import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../../../components/FadeScreen";
import Avatar from "../../../../components/Avatar";
import ChatBubble from "../../../../components/trainer/ChatBubble";
import ChatThreadView from "../../../../components/trainer/ChatThreadView";
import SimpleSheet from "../../../../components/trainer/SimpleSheet";
import { ReportReasonList } from "../../../../components/trainer/ReportReasonSheet";
import MessageActions from "../../../../components/trainer/MessageActions";
import GroupAvatar from "../../../../components/trainer/GroupAvatar";
import SheetPill from "../../../../components/SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER } from "../../../../constants/theme";
import { useTheme } from "../../../../contexts/ThemeContext";
import { useAccountType } from "../../../../contexts/AccountTypeContext";
import {
  deleteGroupMessage,
  deleteMyGroupMessage,
  fetchGroup,
  fetchGroupMembers,
  fetchGroupThread,
  markGroupRead,
  sendGroupMessage,
  subscribeToGroup,
} from "../../../../lib/groups";
import { getMyUid } from "../../../../lib/chat";
import { loadHiddenMessageIds, loadBlockedIds, blockContact, reportPerson, reportMessage } from "../../../../utils/moderation";
import type { Group, GroupMember, GroupMessage } from "../../../../constants/groups";
import type { ReportReason } from "../../../../constants/chat";
import BackButton, { BACK_TOP, BACK_LEFT } from "../../../../components/BackButton";

export default function GroupThreadScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // Blocking cleans up the local roster, which differs by account type.
  const { accountType } = useAccountType();

  const groupId = id ?? "";

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]); // newest-first
  /** Mine, so the people list can leave me out of it. */
  const [myUid, setMyUid] = useState<string | null>(null);
  /**
   * The one sheet, and which step it's on (null = closed):
   *   menu → report | block   the header menu, then "who?"
   *   message                 a tapped bubble: delete it, or report it
   *   reasons                 why you're reporting a person or a message
   * All steps of ONE sheet, never a second modal — two RN Modals mounted at
   * once is the bug where the second never presents again.
   */
  const [sheet, setSheet] = useState<
    | { step: "menu" | "report" | "block" }
    | { step: "message"; msg: GroupMessage }
    | { step: "reasons"; target: { kind: "message"; msg: GroupMessage } | { kind: "person"; member: GroupMember } }
    | null
  >(null);

  const displayName = group?.name || name || "Group";

  const refresh = useCallback(async () => {
    if (!groupId) return;
    const uid = await getMyUid();
    if (!uid) return;
    setMyUid(uid);
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
    // Read up to the newest message loaded, in server time (see markGroupRead):
    // the unfiltered thread, so a hidden message can't hold the stamp back.
    markGroupRead(uid, groupId, thread[thread.length - 1]?.sentAtISO).catch(err => {
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

  const closeSheet = useCallback(() => setSheet(null), []);

  /** Tap (or press and hold) a message: what you can do with it. */
  const openMessage = useCallback((msg: GroupMessage) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // The sheet would otherwise open above a raised keyboard, half the screen up.
    Keyboard.dismiss();
    setSheet({ step: "message", msg });
  }, []);

  /**
   * Delete a message I sent. Everyone in the group sees "Message deleted by …"
   * where it was, with the words gone from the server. Shown at once and put
   * back if the server refuses, so a deletion that didn't happen never looks
   * like it did. (The owner's reported-message removal below is separate: that
   * takes someone else's message out entirely.)
   */
  const onDeleteMessage = useCallback((msg: GroupMessage) => {
    closeSheet();
    Alert.alert(
      "Delete message?",
      "It will show as deleted for everyone in the group.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, text: "", deleted: true } : m)));
            try {
              await deleteMyGroupMessage(msg.id);
            } catch (err) {
              if (__DEV__) console.warn("[avenas] delete group message", err);
              setMessages(prev => prev.map(m => (m.id === msg.id ? msg : m)));
              Alert.alert("Couldn't delete message", "Check your connection and try again.");
            }
          },
        },
      ],
    );
  }, [closeSheet]);

  const submitReport = async (reason: ReportReason) => {
    const target = sheet?.step === "reasons" ? sheet.target : null;
    closeSheet();
    if (!target) return;

    // A person reported from the menu: no message to take down, so this is
    // purely "look at this account".
    if (target.kind === "person") {
      const { id, name: personName, photoUri } = target.member;
      await reportPerson({ id, name: personName, photoUri }, reason);
      Alert.alert(
        "Report received",
        `Thanks, we review reports within 24 hours and remove content, and the people who post it, that breaks our guidelines. You can also block ${personName} from the menu.`,
      );
      return;
    }

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

  /** Everyone but me — the only people there is anything to do about. */
  const others = useMemo(() => members.filter(m => m.id !== myUid), [members, myUid]);

  const onPickReport = useCallback((member: GroupMember) => {
    setSheet({ step: "reasons", target: { kind: "person", member } });
  }, []);

  /**
   * Block someone in the group.
   *
   * Blocking severs a CONNECTION, and group membership is independent of that,
   * so the server keeps delivering their messages — `blockContact` records the
   * block locally and this screen filters them out on load, which is what makes
   * it mean anything in here. They're dropped from the thread on the spot too,
   * rather than at the next open.
   */
  const onPickBlock = useCallback((member: GroupMember) => {
    closeSheet();
    Alert.alert(
      `Block ${member.name}?`,
      "You won't see their messages in this group or anywhere else in the app. They aren't told.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            await blockContact({ id: member.id, name: member.name, initials: member.initials }, accountType);
            setMessages(prev => prev.filter(m => m.senderId !== member.id));
            Alert.alert("Blocked", `You won't see ${member.name}'s messages any more.`);
          },
        },
      ],
    );
  }, [accountType, closeSheet]);

  const memberLabel = useMemo(() => {
    const n = group?.memberCount ?? members.length;
    return `${n} member${n === 1 ? "" : "s"}`;
  }, [group, members]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + BACK_TOP, borderBottomColor: t.div }]}>
      <BackButton inline />
      {/* The photo and name open the group, the way tapping a thread's title
          does everywhere else. The menu used to be the only route there, and
          it's moderation-only now — without this, arriving from Messages (where
          Back returns to the conversation list) would leave no way through. */}
      <TouchableOpacity
        style={styles.headerTitle}
        activeOpacity={0.7}
        onPress={() => router.navigate({ pathname: "/trainer/group/[id]", params: { id: groupId, name: displayName } })}
        accessibilityRole="button"
        accessibilityLabel={`Open ${displayName} group page`}
      >
        <GroupAvatar uri={group?.photoUri} size={38} isDark={isDark} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
          <Text style={[styles.headerSub, { color: t.ts }]} numberOfLines={1}>{memberLabel}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setSheet({ step: "menu" })} activeOpacity={0.8} accessibilityLabel="Group options" accessibilityRole="button">
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
            onPress={() => openMessage(msg)}
          />
        )}
        onSend={send}
        placeholder={`Message ${displayName}…`}
        emptyText="No messages yet. Start the conversation 👋"
        header={header}
      />

      <SimpleSheet visible={sheet !== null} onClose={closeSheet}>
        {/* The header menu is step 1: what to do, then step 2: who to do it
            to. Everything about the group itself (members, leaving, deleting)
            lives on the group's page, so this menu is only about the people in
            the thread. A tapped message and the report reasons are steps of
            this same sheet. */}
        {sheet?.step === "message" ? (
          <MessageActions
            message={sheet.msg}
            authorName={sheet.msg.senderName}
            onDelete={() => onDeleteMessage(sheet.msg)}
            onReport={() => setSheet({ step: "reasons", target: { kind: "message", msg: sheet.msg } })}
          />
        ) : sheet?.step === "reasons" ? (
          <ReportReasonList
            title={sheet.target.kind === "person" ? `Report ${sheet.target.member.name}` : "Report message"}
            onSubmit={submitReport}
            onCancel={closeSheet}
          />
        ) : !sheet || sheet.step === "menu" ? (
          <>
            <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
            <View style={styles.menu}>
              <SheetPill label="Report someone" icon={c => <Ionicons name="flag-outline" size={18} color={c} />} onPress={() => setSheet({ step: "report" })} />
              <SheetPill label="Block someone" variant="danger" icon={c => <Ionicons name="ban-outline" size={18} color={c} />} onPress={() => setSheet({ step: "block" })} />
            </View>
            <Text style={[styles.menuHint, { color: t.ts }]}>
              Tap any message to delete it or report it.
            </Text>
          </>
        ) : (
          <>
            <View style={styles.pickHeader}>
              <TouchableOpacity
                onPress={() => setSheet({ step: "menu" })}
                style={styles.pickBack}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={20} color={t.tp} />
              </TouchableOpacity>
              <Text style={[styles.menuName, { color: t.tp, flex: 1, paddingBottom: 0 }]} numberOfLines={1}>
                {sheet.step === "report" ? "Report someone" : "Block someone"}
              </Text>
              <View style={styles.pickBack} />
            </View>
            {others.length === 0 ? (
              <Text style={[styles.menuHint, { color: t.ts, paddingBottom: 12 }]}>
                {"There's no one else in this group yet."}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
                <View style={styles.menu}>
                  {/* One pill per person. Block names stay red, the colour the
                      step's own button was, without a wall of red fills. */}
                  {others.map(m => (
                    <SheetPill
                      key={m.id}
                      label={m.name}
                      tint={sheet.step === "block" ? DANGER : undefined}
                      icon={() => (
                        <Avatar
                          uri={m.photoUri}
                          initials={m.initials}
                          size={30}
                          backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                          textColor={ACCT}
                          textStyle={[styles.pickInitials, { color: ACCT }]}
                        />
                      )}
                      onPress={() => (sheet.step === "report" ? onPickReport(m) : onPickBlock(m))}
                    />
                  ))}
                </View>
              </ScrollView>
            )}
          </>
        )}
      </SimpleSheet>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: BACK_LEFT, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  headerTitle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  // The group's circle is GroupAvatar's own, at the 38pt this header used.
  headerName:  { fontFamily: FontFamily.bold, fontSize: 18 },
  headerSub:   { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },

  menuName:    { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  // Room for the pills' shadows inside the person list's ScrollView too.
  menu:        { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6, gap: 12 },
  menuHint:    { fontFamily: FontFamily.regular, fontSize: 12, textAlign: "center", paddingHorizontal: 24, paddingTop: 10 },

  // Step 2 — pick a person. The back chevron and the spacer opposite it are the
  // same width so the title stays centred.
  pickHeader:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 6 },
  pickBack:    { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  pickInitials:{ fontFamily: FontFamily.bold, fontSize: 13 },
});
