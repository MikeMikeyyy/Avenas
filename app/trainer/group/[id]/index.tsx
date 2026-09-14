// A group's own page: the members in it, and the things you do with them.
//
// Reached by tapping a group on the trainer hub. The CHAT lives one level down
// at /trainer/group/<id>/chat — a group is a roster first and a conversation
// second, which is the point of grouping clients up in the first place.
//
// Members render with the same ClientCard as My Clients, so a group reads as a
// filtered view of the roster rather than a separate concept, and tapping one
// opens that client exactly as it would from the hub.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../../../components/FadeScreen";
import NeuCard from "../../../../components/NeuCard";
import BounceButton from "../../../../components/BounceButton";
import Avatar from "../../../../components/Avatar";
import ClientCard from "../../../../components/trainer/ClientCard";
import SimpleSheet from "../../../../components/trainer/SimpleSheet";
import ProgramPickerSheet from "../../../../components/trainer/ProgramPickerSheet";
import UnreadBadge from "../../../../components/UnreadBadge";
import ChatIcon from "../../../../components/icons/ChatIcon";
import SendIcon from "../../../../components/icons/SendIcon";
import PeopleIcon from "../../../../components/icons/PeopleIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER, ROLE_OWNER, ROLE_TRAINER, ROLE_MEMBER, GOLD } from "../../../../constants/theme";
import { pill, PILL_H_SM } from "../../../../constants/buttons";
import { useTheme } from "../../../../contexts/ThemeContext";
import { deleteGroup, fetchGroup, fetchGroupMembers, leaveGroup, setGroupMemberRole } from "../../../../lib/groups";
import { getMyUid } from "../../../../lib/chat";
import { loadFavouriteGroupIds, loadGroupRows, toggleFavouriteGroup } from "../../../../utils/groupStore";
import { resolveTrainerRoster } from "../../../../utils/roster";
import { appendSharedPrograms, loadClientData, type Client, type SharedProgram } from "../../../../utils/trainerStore";
import { getJSON } from "../../../../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../../../../constants/programs";
import { canCoachGroup, type Group, type GroupMember, type GroupRole } from "../../../../constants/groups";

/** How many member avatars the banner stacks before collapsing to "+N". */
const AVATAR_STACK = 4;

const ROLE_LABEL: Record<GroupRole, string> = {
  owner:   "OWNER",
  trainer: "TRAINER",
  member:  "MEMBER",
};

const ROLE_COLOR: Record<GroupRole, string> = {
  owner:   ROLE_OWNER,
  trainer: ROLE_TRAINER,
  member:  ROLE_MEMBER,
};

export default function GroupPageScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const groupId = id ?? "";

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  /** Members matched against the client roster, so cards can show programs. */
  const [clients, setClients] = useState<Client[]>([]);
  const [activeProgramByClient, setActiveProgramByClient] = useState<Record<string, string>>({});
  const [unread, setUnread] = useState(0);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The member whose role sheet is open (owner only; null = closed). */
  const [memberMenu, setMemberMenu] = useState<GroupMember | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isFavourite, setIsFavourite] = useState(false);
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);

  const displayName = group?.name || name || "Group";

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = await getMyUid();
        if (!uid || !groupId) return;
        const [g, roster, { clients: allClients }, rows, progs, favIds] = await Promise.all([
          fetchGroup(uid, groupId),
          fetchGroupMembers(groupId),
          resolveTrainerRoster(),
          loadGroupRows(),
          getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
          loadFavouriteGroupIds(),
        ]);
        if (cancelled) return;
        setIsFavourite(favIds.has(groupId));
        if (!g) {
          Alert.alert("Group unavailable", "This group no longer exists, or you're no longer a member.");
          router.back();
          return;
        }
        setMyUid(uid);
        setGroup(g);
        setMembers(roster);
        setClients(allClients);
        setUnread(rows.find(r => r.group.id === groupId)?.unreadCount ?? 0);
        setMyPrograms(Array.isArray(progs) ? progs : []);

        // Active program per member, same as the hub's client list.
        const byClient: Record<string, string> = {};
        await Promise.all(roster.map(async m => {
          const data = await loadClientData(m.id);
          const active = data.programs.find(p => p.status === "active");
          if (active) byClient[m.id] = active.name;
        }));
        if (!cancelled) setActiveProgramByClient(byClient);
      } catch (err) {
        if (__DEV__) console.warn("[avenas] load group page", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, router]));

  const openChat = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/trainer/group/[id]/chat", params: { id: groupId, name: displayName } });
  }, [router, groupId, displayName]);

  const openManage = useCallback(() => {
    setMenuOpen(false);
    router.navigate({ pathname: "/trainer/group-edit", params: { id: groupId } });
  }, [router, groupId]);

  const onToggleFavourite = useCallback(async () => {
    setMenuOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await toggleFavouriteGroup(groupId);
    setIsFavourite(next.has(groupId));
  }, [groupId]);

  const toggleSearch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Closing clears the query AND drops the keyboard in the same tap, so the X
    // removes the search row and dismisses the keyboard together rather than
    // leaving one behind. Reopening then never shows a stale filter.
    setSearchOpen(open => {
      if (open) {
        setQuery("");
        Keyboard.dismiss();
      }
      return !open;
    });
  }, []);

  const openMemberMenu = useCallback((m: GroupMember) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMemberMenu(m);
  }, []);

  // Promote to trainer, or demote back. Owner-only, and the RPC enforces that
  // server-side too rather than trusting this screen.
  const toggleRole = useCallback(async (m: GroupMember) => {
    setMemberMenu(null);
    const next = m.role === "trainer" ? "member" : "trainer";
    try {
      await setGroupMemberRole(groupId, m.id, next);
      setMembers(prev => prev.map(x => (x.id === m.id ? { ...x, role: next } : x)));
      Alert.alert(
        next === "trainer" ? "Now a trainer" : "Now a member",
        next === "trainer"
          ? `${m.name} can send programs to this group and to people in it.`
          : `${m.name} can no longer send programs to this group.`,
      );
    } catch (e) {
      Alert.alert("Couldn't change role", e instanceof Error ? e.message : "Check your connection and try again.");
    }
  }, [groupId]);

  // Everyone in the group except me. A trainer never sends a program to
  // themselves, and only real connections can receive one.
  const recipientIds = members.filter(m => m.id !== myUid).map(m => m.id);

  /** My own standing in this group, which decides whether I can send programs. */
  const myRole: GroupRole = members.find(m => m.id === myUid)?.role ?? "member";
  const canCoach = canCoachGroup(myRole);

  // Filters the list only. The banner, the count badge and a program send all
  // stay whole-group — searching is for finding someone, not for narrowing who
  // a program reaches.
  const visibleMembers = (() => {
    const q = query.trim().toLowerCase();
    return q ? members.filter(m => m.name.toLowerCase().includes(q)) : members;
  })();

  const handleSendProgram = useCallback(async (program: SavedProgram) => {
    setSendOpen(false);
    if (recipientIds.length === 0) {
      Alert.alert("No one to send to", "This group has no other members yet.");
      return;
    }
    // One row per member, exactly like the hub's send flow — the shared batch
    // key collapses them into a single card in "Programs You've Sent".
    const now = new Date().toISOString();
    const base = `share_${Date.now()}`;
    const entries: SharedProgram[] = recipientIds.map((cid, i) => ({
      id: `${base}_${i}`,
      clientId: cid,
      programId: program.id,
      programName: program.name,
      sentAtISO: now,
      programSnapshot: program,
    }));
    try {
      await appendSharedPrograms(entries);
    } catch (e) {
      Alert.alert("Couldn't send program", e instanceof Error ? e.message : "Check your internet and try again.");
      return;
    }
    Alert.alert("Program Sent", `"${program.name}" was sent to ${recipientIds.length} member${recipientIds.length === 1 ? "" : "s"} of ${displayName}.`);
  }, [recipientIds, displayName]);

  const onLeave = () => {
    setMenuOpen(false);
    Alert.alert(
      `Leave ${displayName}?`,
      "You'll stop receiving messages from this group. The trainer can add you back later.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: async () => {
          try {
            if (!myUid) throw new Error("not signed in");
            await leaveGroup(myUid, groupId);
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

  /** The roster entry for a member, so the card can show their active program.
   *  Falls back to the group's own record for anyone not in the client list —
   *  a fellow trainer you haven't taken on as a client, for instance. */
  const clientFor = (m: GroupMember): Client =>
    clients.find(c => c.id === m.id) ?? { id: m.id, name: m.name, initials: m.initials, photoUri: m.photoUri };

  const shown = members.slice(0, AVATAR_STACK);
  const overflow = Math.max(0, members.length - AVATAR_STACK);

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: t.div }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} accessibilityLabel="Go back" accessibilityRole="button">
          <View style={[styles.iconBtn, { backgroundColor: t.ctrl }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          {isFavourite && <Ionicons name="star" size={16} color={GOLD} />}
          <Text style={[styles.headerName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        </View>
        <TouchableOpacity onPress={() => setMenuOpen(true)} activeOpacity={0.8} accessibilityLabel="Group options" accessibilityRole="button">
          <View style={[styles.iconBtn, { backgroundColor: t.ctrl }]}>
            <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
          </View>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={ACCT} /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          // Without this the keyboard eats the first tap on any button while
          // the search field is focused, so closing search took two taps.
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 40 }}
        >
          {/* Banner: who's in it, and the two things you do with a group. */}
          <NeuCard dark={isDark} radius={20}>
            <View style={styles.bannerInner}>
              <View style={styles.avatarStack}>
                {shown.map((m, i) => (
                  <View key={m.id} style={[styles.stackItem, { marginLeft: i === 0 ? 0 : -12, borderColor: t.bg }]}>
                    <Avatar
                      uri={m.photoUri}
                      initials={m.initials}
                      size={38}
                      backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                      textColor={ACCT}
                      textStyle={[styles.stackText, { color: ACCT }]}
                    />
                  </View>
                ))}
                {overflow > 0 && (
                  <View style={[styles.stackItem, styles.overflowChip, { marginLeft: -12, borderColor: t.bg, backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)" }]}>
                    <Text style={[styles.overflowText, { color: t.ts }]}>+{overflow}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.memberCount, { color: t.ts }]}>
                {members.length} member{members.length === 1 ? "" : "s"}
              </Text>

              {/* Sending belongs to the owner and anyone they've promoted to
                  trainer; a plain member being coached here gets the chat full
                  width instead. Mirrors can_coach_in_group(), which is what the
                  RLS on shared_programs actually enforces. */}
              <View style={styles.actionRow}>
                <BounceButton style={{ flex: 1 }} onPress={openChat} accessibilityLabel={`Open ${displayName} chat`}>
                  <View style={[styles.actionBtn, styles.actionChrome, { backgroundColor: t.ctrl }]}>
                    <ChatIcon size={17} color={t.tp} />
                    <Text style={[styles.actionText, { color: t.tp }]}>Group Chat</Text>
                    <UnreadBadge count={unread} style={styles.actionBadge} />
                  </View>
                </BounceButton>
                {canCoach && (
                  <BounceButton style={{ flex: 1 }} onPress={() => setSendOpen(true)} accessibilityLabel="Send a program to this group">
                    <View style={[styles.actionBtn, styles.actionPrimary]}>
                      <SendIcon size={17} color="#fff" />
                      <Text style={[styles.actionText, { color: "#fff" }]}>Send Program</Text>
                    </View>
                  </BounceButton>
                )}
              </View>
            </View>
          </NeuCard>

          <View style={styles.sectionRow}>
            <Text style={[styles.sectionHeading, { color: t.tp }]}>Members</Text>
            {/* The total, not the filtered count — group size is a stable fact,
                and the list below already shows what a search matched. */}
            <View style={[styles.countBadge, { backgroundColor: ACCT }]}>
              <Text style={styles.countBadgeText}>{members.length}</Text>
            </View>
            <View style={{ flex: 1 }} />
            {members.length > 0 && (
              <TouchableOpacity
                onPress={toggleSearch}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={searchOpen ? "Close search" : "Search members"}
              >
                <View style={[styles.searchBtn, { backgroundColor: t.ctrl }]}>
                  <Ionicons name={searchOpen ? "close" : "search"} size={17} color={t.tp} />
                </View>
              </TouchableOpacity>
            )}
          </View>

          {searchOpen && (
            <View style={[styles.searchBox, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]}>
              <Ionicons name="search" size={16} color={t.ts} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search members"
                placeholderTextColor={t.ts}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                style={[styles.searchInput, { color: t.tp }]}
              />
              {query.trim().length > 0 && (
                <TouchableOpacity onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search" accessibilityRole="button">
                  <Ionicons name="close-circle" size={18} color={t.ts} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {members.length === 0 ? (
            <NeuCard dark={isDark} radius={20}>
              <View style={styles.emptyInner}>
                <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
                  <PeopleIcon size={26} color={ACCT} />
                </View>
                <Text style={[styles.emptyTitle, { color: t.tp }]}>No members yet</Text>
                <Text style={[styles.emptyBody, { color: t.ts }]}>
                  Add clients to this group to message them together and send one program to all of them.
                </Text>
              </View>
            </NeuCard>
          ) : visibleMembers.length === 0 ? (
            <NeuCard dark={isDark} radius={16}>
              <View style={styles.noMatchRow}>
                <Ionicons name="search-outline" size={15} color={t.ts} />
                <Text style={[styles.noMatchText, { color: t.ts }]}>{`No members match "${query.trim()}"`}</Text>
              </View>
            </NeuCard>
          ) : (
            visibleMembers.map(m => (
              <ClientCard
                key={m.id}
                client={clientFor(m)}
                activeProgramName={activeProgramByClient[m.id]}
                // get_group_members orders owner, then trainers, then members,
                // so the badges read top to bottom in rank order.
                badge={ROLE_LABEL[m.role]}
                badgeColor={ROLE_COLOR[m.role]}
                // The owner gets a sheet to promote or demote; everyone else
                // goes straight through to the client page.
                onPress={() => (group?.isOwner && m.id !== myUid
                  ? openMemberMenu(m)
                  : router.navigate({ pathname: "/trainer/client/[id]", params: { id: m.id } }))}
              />
            ))
          )}
        </ScrollView>
      )}

      <SimpleSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        <View style={styles.menu}>
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onToggleFavourite} accessibilityRole="button" accessibilityLabel={isFavourite ? "Remove from favourites" : "Add to favourites"}>
            <Ionicons name={isFavourite ? "star" : "star-outline"} size={20} color={isFavourite ? GOLD : t.tp} />
            <Text style={[styles.menuText, { color: isFavourite ? GOLD : t.tp }]}>
              {isFavourite ? "Remove from favourites" : "Add to favourites"}
            </Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={openManage} accessibilityRole="button" accessibilityLabel="Manage members">
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
      </SimpleSheet>

      {/* Owner's per-member sheet. Opening the client page is first, because
          it's what tapping a card does everywhere else in the app. */}
      <SimpleSheet visible={memberMenu !== null} onClose={() => setMemberMenu(null)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{memberMenu?.name || "Member"}</Text>
        <View style={styles.menu}>
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.8}
            onPress={() => {
              const m = memberMenu;
              setMemberMenu(null);
              if (m) router.navigate({ pathname: "/trainer/client/[id]", params: { id: m.id } });
            }}
            accessibilityRole="button"
            accessibilityLabel={`Open ${memberMenu?.name ?? "member"}`}
          >
            <Ionicons name="person-outline" size={20} color={t.tp} />
            <Text style={[styles.menuText, { color: t.tp }]}>Open client page</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.8}
            onPress={() => memberMenu && toggleRole(memberMenu)}
            accessibilityRole="button"
            accessibilityLabel={memberMenu?.role === "trainer" ? "Make a member" : "Make a trainer"}
          >
            <Ionicons
              name={memberMenu?.role === "trainer" ? "arrow-down-circle-outline" : "shield-checkmark-outline"}
              size={20}
              color={memberMenu?.role === "trainer" ? t.tp : ROLE_TRAINER}
            />
            <Text style={[styles.menuText, { color: memberMenu?.role === "trainer" ? t.tp : ROLE_TRAINER }]}>
              {memberMenu?.role === "trainer" ? "Make a member" : "Make a trainer"}
            </Text>
          </TouchableOpacity>
        </View>
      </SimpleSheet>

      <ProgramPickerSheet
        visible={sendOpen}
        title={`Send to ${displayName}`}
        subtitle={`Everyone in this group receives it (${recipientIds.length} member${recipientIds.length === 1 ? "" : "s"}).`}
        programs={myPrograms}
        onPick={handleSendProgram}
        onClose={() => setSendOpen(false)}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  iconBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitleRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  headerName:   { flex: 1, fontFamily: FontFamily.bold, fontSize: 18 },
  loading:      { flex: 1, alignItems: "center", justifyContent: "center" },

  bannerInner:  { padding: 18, gap: 12 },
  avatarStack:  { flexDirection: "row", alignItems: "center" },
  // The ring is the page background, so overlapping avatars stay separated.
  stackItem:    { borderRadius: 21, borderWidth: 2 },
  stackText:    { fontFamily: FontFamily.bold, fontSize: 13 },
  overflowChip: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  overflowText: { fontFamily: FontFamily.bold, fontSize: 12 },
  memberCount:  { fontFamily: FontFamily.regular, fontSize: 13 },

  actionRow:    { flexDirection: "row", gap: 10, marginTop: 2 },
  // Layout only. The shadow lives on the variants below, because sharing one
  // shadow meant the white button rendered it with the default BLACK colour at
  // 0.35 opacity — a heavy dark halo that only looked right under the green.
  actionBtn:    { ...pill(PILL_H_SM), gap: 7, paddingHorizontal: 12 },
  actionPrimary:{ backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8 },
  // The app's standard white chrome: soft neutral shadow, never a coloured glow.
  actionChrome: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  actionText:   { fontFamily: FontFamily.bold, fontSize: 14 },
  actionBadge:  { position: "absolute", top: -6, right: -6 },

  sectionRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12 },
  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18 },
  countBadge:   { minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: "center", justifyContent: "center" },
  countBadgeText: { fontFamily: FontFamily.bold, fontSize: 12, color: "#fff" },
  searchBtn:    { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  searchBox:    { flexDirection: "row", alignItems: "center", gap: 8, height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 },
  searchInput:  { flex: 1, fontFamily: FontFamily.regular, fontSize: 15, paddingVertical: 0 },
  noMatchRow:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  noMatchText:  { fontFamily: FontFamily.regular, fontSize: 13 },

  emptyInner:   { padding: 24, alignItems: "center", gap: 10 },
  emptyIcon:    { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },

  menuName:     { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu:         { paddingHorizontal: 16, paddingTop: 4 },
  menuRow:      { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 8 },
  menuDivider:  { height: 1, marginHorizontal: 8 },
  menuText:     { fontFamily: FontFamily.semibold, fontSize: 16 },
});
