// Conversations list — the chat hub for the trainer section.
//
// Lists everyone you've added (clients/coaches for a trainer; trainers for a
// gym user) with a last-message preview, newest first. The "+" opens the
// broadcast composer (message several people at once). Tapping a row opens that
// 1:1 thread. Real connections message through the backend; mock-roster people
// stay local (utils/chatStore routes per contact).

import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../components/FadeScreen";
import NeuCard from "../../components/NeuCard";
import BounceButton from "../../components/BounceButton";
import PlusIcon from "../../components/icons/PlusIcon";
import ChatIcon from "../../components/icons/ChatIcon";
import MessageComposeSheet from "../../components/trainer/MessageComposeSheet";
import Avatar from "../../components/Avatar";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { useAccountType } from "../../contexts/AccountTypeContext";
import { loadChatContacts, loadAllThreads, broadcastMessage, loadReads, countUnreadInThread } from "../../utils/chatStore";
import { makeInitials } from "../../utils/trainerStore";
import { getMyConnections } from "../../lib/connections";
import UnreadBadge from "../../components/UnreadBadge";
import { loadBlockedIds, loadHiddenMessageIds } from "../../utils/moderation";
import type { ChatContact, ChatThreads, ChatReads } from "../../constants/chat";

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

type Row = ChatContact & { lastText: string; lastAtISO: string; unreadCount: number; unread: boolean; sortKey: number };

export default function MessagesScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { accountType } = useAccountType();

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [search, setSearch] = useState("");

  const buildRows = useCallback((people: ChatContact[], threads: ChatThreads, reads: ChatReads, hidden: Set<string>): Row[] => {
    return people
      .map(c => {
        const msgs = (threads[c.id] ?? []).filter(m => !hidden.has(m.id)); // drop reported messages
        const last = msgs[msgs.length - 1];
        const unreadCount = countUnreadInThread(msgs, reads[c.id]);
        return {
          ...c,
          lastText: last ? (last.mine ? `You: ${last.text}` : last.text) : "Tap to start the conversation",
          lastAtISO: last?.sentAtISO ?? "",
          unreadCount,
          unread: unreadCount > 0,
          sortKey: last ? new Date(last.sentAtISO).getTime() : 0,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
  }, []);

  // Contacts to list = the local roster (mock clients/coaches/trainers) merged
  // with every real accepted connection, so people you're connected to but have
  // no local entry for (e.g. a gym user's connected trainers) still get a thread.
  // Real connections win on an id clash; offline / signed out → local only.
  const gatherContacts = useCallback(async (): Promise<ChatContact[]> => {
    const local = await loadChatContacts(accountType);
    try {
      const conns = await getMyConnections();
      const real: ChatContact[] = conns
        .filter(c => c.status === "accepted")
        .map(c => ({
          id: c.otherId,
          name: c.name || "User",
          initials: makeInitials(c.name || "User"),
          subtitle: accountType === "pt" ? (c.accountType === "pt" ? "Coach" : "Client") : "Trainer",
          photoUri: c.photoUri,
        }));
      const realIds = new Set(real.map(c => c.id));
      return [...real, ...local.filter(l => !realIds.has(l.id))];
    } catch {
      return local;
    }
  }, [accountType]);

  const load = useCallback(async () => {
    const all = await gatherContacts();
    const [threads, reads, blocked, hidden] = await Promise.all([loadAllThreads(), loadReads(), loadBlockedIds(), loadHiddenMessageIds()]);
    const people = all.filter(p => !blocked.has(p.id)); // blocked users disappear from chat
    setContacts(people);
    setRows(buildRows(people, threads, reads, hidden));
  }, [gatherContacts, buildRows]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const all = await gatherContacts();
        const [threads, reads, blocked, hidden] = await Promise.all([loadAllThreads(), loadReads(), loadBlockedIds(), loadHiddenMessageIds()]);
        if (cancelled) return;
        const people = all.filter(p => !blocked.has(p.id));
        setContacts(people);
        setRows(buildRows(people, threads, reads, hidden));
      })();
      return () => { cancelled = true; };
    }, [gatherContacts, buildRows]),
  );

  const openThread = (c: ChatContact) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/trainer/chat/[id]", params: { id: c.id, name: c.name, initials: c.initials, photo: c.photoUri ?? "" } });
  };

  const handleSend = async (ids: string[], text: string) => {
    setComposeOpen(false);
    try {
      await broadcastMessage(ids, text);
    } catch (err) {
      // Backend send failed (offline / connection severed) — say so instead of
      // showing a message the recipients will never receive.
      if (__DEV__) console.warn("[avenas] broadcast message", err);
      Alert.alert("Message not sent", "Check your connection and try again.");
      return;
    }
    await load();
    if (ids.length === 1) {
      const c = contacts.find(x => x.id === ids[0]);
      if (c) router.navigate({ pathname: "/trainer/chat/[id]", params: { id: c.id, name: c.name, initials: c.initials, photo: c.photoUri ?? "" } });
    }
  };

  const q = search.trim().toLowerCase();
  const visibleRows = q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Top gradient blur */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 14, left: 20, zIndex: 10 }}
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

      {/* New message (broadcast to many) is a trainer feature — gym users only
          message their trainers 1:1, so they don't get the plus button. */}
      {accountType === "pt" && (
        <BounceButton
          onPress={() => setComposeOpen(true)}
          accessibilityLabel="New message"
          style={{ position: "absolute", top: insets.top + 16, right: 20, zIndex: 10 }}
        >
          <View style={[styles.newBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
            <PlusIcon size={16} color="#fff" />
          </View>
        </BounceButton>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        // Lets a tap on a result row fire on the first touch while the search
        // field is focused, instead of being swallowed to dismiss the keyboard.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 }}
      >
        <View style={styles.titleRow}>
          <View style={{ width: 44 }} />
          <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>Messages</Text>
          <View style={{ width: 44 }} />
        </View>

        {rows.length > 0 && (
          <View style={[styles.searchBox, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]}>
            <Ionicons name="search" size={16} color={t.ts} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name"
              placeholderTextColor={t.ts}
              style={[styles.searchInput, { color: t.tp }]}
              returnKeyType="search"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")} hitSlop={8} accessibilityLabel="Clear search" accessibilityRole="button">
                <Ionicons name="close-circle" size={18} color={t.ts} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {rows.length === 0 ? (
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 16 }}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
                <ChatIcon size={26} color={ACCT} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No one to message yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                {accountType === "pt"
                  ? "Add clients or coaches to start a conversation."
                  : "Connect a trainer to start a conversation."}
              </Text>
            </View>
          </NeuCard>
        ) : visibleRows.length === 0 ? (
          <Text style={[styles.noMatch, { color: t.ts }]}>No people match “{search.trim()}”.</Text>
        ) : (
          visibleRows.map(r => (
            <BounceButton key={r.id} style={{ marginBottom: 10 }} onPress={() => openThread(r)} accessibilityLabel={`Open chat with ${r.name}`}>
              <NeuCard dark={isDark} radius={16}>
                <View style={styles.row}>
                  <Avatar
                    uri={r.photoUri}
                    initials={r.initials}
                    size={48}
                    backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                    textStyle={[styles.avatarText, { color: ACCT }]}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{r.name}</Text>
                      {r.lastAtISO ? <Text style={[styles.time, { color: t.ts }]}>{fmtAgo(r.lastAtISO)}</Text> : null}
                    </View>
                    <View style={styles.rowBottom}>
                      <Text style={[styles.preview, { color: r.unread ? t.tp : t.ts, fontFamily: r.unread ? FontFamily.semibold : FontFamily.regular }]} numberOfLines={1}>
                        {r.lastText}
                      </Text>
                      <UnreadBadge count={r.unreadCount} />
                    </View>
                  </View>
                </View>
              </NeuCard>
            </BounceButton>
          ))
        )}
      </ScrollView>

      <MessageComposeSheet
        visible={composeOpen}
        contacts={contacts}
        onSend={handleSend}
        onClose={() => setComposeOpen(false)}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },

  // height 40 + paddingTop insets.top+14 puts the title on the back/plus buttons'
  // centerline (both centre at insets.top+34); marginBottom is the gap to the list.
  titleRow:    { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 30 },
  title:       { flex: 1, fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center" },
  newBtn:      { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },

  searchBox:   { flexDirection: "row", alignItems: "center", gap: 8, height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 16 },
  searchInput: { flex: 1, fontFamily: FontFamily.regular, fontSize: 15, paddingVertical: 0 },
  noMatch:     { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },

  row:         { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatarText:  { fontFamily: FontFamily.bold, fontSize: 16 },
  rowTop:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name:        { flex: 1, fontFamily: FontFamily.bold, fontSize: 16 },
  time:        { fontFamily: FontFamily.regular, fontSize: 12 },
  rowBottom:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  preview:     { flex: 1, fontSize: 13 },

  emptyInner:  { padding: 24, alignItems: "center", gap: 8 },
  emptyIcon:   { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle:  { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody:   { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
