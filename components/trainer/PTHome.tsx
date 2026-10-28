// components/trainer/PTHome.tsx
//
// The Trainer tab for a trainer account (user decisions, 2026-10-21, the
// Trainer Page canvas, "Final · Trainer account"): the tab's title with My
// Trainers and Messages beside it, then the Programs card (what's waiting on
// you to review, what you've sent: the Programs page holds them, so a long
// client list never pushes them away), then Groups, then Clients, the list
// that grows, last. Groups and clients are one-line rows, starred ones first,
// with the gold star; connecting someone is the connect button on Clients.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scrollEndPadding } from "../../constants/floatingBars";
import { useFloatingBarsReach } from "../../hooks/useFloatingBars";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "../MaskedView";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import GlassButton from "../GlassButton";
import Avatar from "../Avatar";
import FavouriteStar from "../FavouriteStar";
import UnreadBadge from "../UnreadBadge";
import OfflineBanner from "../OfflineBanner";
import PeopleIcon from "../icons/PeopleIcon";
import ChatIcon from "../icons/ChatIcon";
import UserRoundPlusIcon from "../icons/UserRoundPlusIcon";
import HubTitle from "./HubTitle";
import MyTrainersPill from "./MyTrainersPill";
import ProgramsCard from "./ProgramsCard";
import ConnectionNotices from "./ConnectionNotices";
import GroupInviteCard from "./GroupInviteCard";
import GroupAvatar from "./GroupAvatar";
import MemberStack from "./MemberStack";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, NEU_BG, NEU_BG_DARK } from "../../constants/theme";
import { PILL_SHADOW } from "../../constants/buttons";
import { CARD_META, CARD_TITLE, SUMMARY_ROW } from "../../constants/cards";
import { GROUP_LIMIT_TITLE, MAX_JOINED_GROUPS, MAX_OWNED_GROUPS, groupLimitMessage, memberFaces, type Group, type GroupInvite } from "../../constants/groups";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { EMPTY_PT_HUB, fetchPTHub, peekPTHub, savePTHub, type PTHubData } from "../../utils/trainerHub";
import { hydrateGroupPages } from "../../utils/groupPage";
import { loadGroupRows } from "../../utils/groupStore";
import { programsSummary, rosterOrder, sortByFavourite } from "../../utils/trainerLists";
import { groupAlertCounts } from "../../utils/groupAlerts";
import { isActiveNow, presenceLabel } from "../../utils/presence";
import { acceptGroupInvite, declineGroupInvite, fetchGroupMembers, fetchMyGroupInvites, isGroupLimitError } from "../../lib/groups";
import { alertMessage } from "../../utils/errors";

/** The round buttons on a section's heading row (Groups' +, Clients' connect). */
const SECTION_BTN = 36;

export default function PTHome() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const router = useRouter();
  const { unread: unreadMessages, refresh: refreshUnread } = useUnreadMessages();
  // The account this page's data belongs to. Constant for the page's life: the
  // tab remounts it when the account changes (app/(tabs)/trainer-hub.tsx).
  const { userId } = useAuth();
  const owner = userId ?? "";

  /**
   * Everything on this page, as ONE value (utils/trainerHub.ts).
   *
   * It starts on the copy saved last time, so the first frame is the whole
   * page, and a load replaces it in a single render, so a refresh changes the
   * page in place. It used to be a dozen separate pieces of state filled in by
   * a chain of reads, each section appearing as its read landed, which built
   * the page top to bottom over several seconds on every launch.
   *
   * Null only before the first load ever finishes (no saved copy yet), and
   * that's what "not loaded" means below: "None" is only true once we've
   * looked, so the empty states wait for it rather than drawing to trainers
   * who have clients. The Programs page reads and saves the same copy.
   */
  const [hub, setHub] = useState<PTHubData | null>(() => peekPTHub(owner));
  const loaded = hub !== null;
  const {
    clients,
    reviews,
    groupReviews,
    sharedOut,
    activeProgramByClient,
    groups,
    groupInvites,
    unreadByGroup,
    groupFaces,
    favouriteGroupIds,
    favouriteMemberIds,
    myUid,
  } = hub ?? EMPTY_PT_HUB;
  const favourites = useMemo(() => new Set(favouriteGroupIds), [favouriteGroupIds]);
  const favouriteMembers = useMemo(() => new Set(favouriteMemberIds), [favouriteMemberIds]);

  // Whatever the page shows is what it opens on next time, including a change
  // made here (a declined invite) that no load has seen yet.
  useEffect(() => {
    if (hub) savePTHub(owner, hub);
  }, [hub, owner]);

  // Each group's saved page, read off the device now so tapping a group opens
  // on it rather than on a spinner (utils/groupPage.ts). Device reads only.
  const groupIdsKey = groups.map(g => g.id).join(",");
  useEffect(() => {
    if (groupIdsKey) void hydrateGroupPages(owner, groupIdsKey.split(","));
  }, [owner, groupIdsKey]);

  // Live-ish presence for connected clients + the connect button's count.
  // Disconnecting a real connection lives on the Connect screen (app/connect.tsx).
  const { presenceById, pendingIncoming } = useConnectionPresence();

  /**
   * Arriving at the page brings it up to date. First from the saved copy,
   * which the Programs page writes to (a removed send, a new one), so coming
   * back shows it at once; then behind it, in one render when the load lands.
   * If the startup prefetch is still running, this joins it rather than asking
   * the server twice. The cancel flag stops a load that outlives the visit from
   * writing to the page; its result is saved regardless, so the next open
   * starts from it.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const held = peekPTHub(owner);
    if (held) setHub(held);
    void fetchPTHub(owner).then(next => { if (!cancelled) setHub(next); });
    return () => { cancelled = true; };
  }, [owner]));

  /**
   * Pull down to re-read everything: new messages, programs a client sent,
   * a review someone posted to a group. The page already refreshes when you
   * arrive, but a trainer sitting on it waiting for a reply had no way to ask
   * again short of leaving and coming back.
   *
   * Always its OWN read (`fresh`), never the arrival load or the startup
   * prefetch: what you pulled for is what the server says now. It runs to
   * completion rather than taking a cancel flag (you're holding the page open,
   * so there's nothing to cancel) and always clears the spinner, since
   * `fetchPTHub` never rejects.
   */
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // The Messages count too: it normally recounts on focus, which a pull
    // isn't, so without this the one number you pulled for wouldn't move.
    const [next] = await Promise.all([fetchPTHub(owner, { fresh: true }), refreshUnread()]);
    setHub(next);
    setRefreshing(false);
  }, [owner, refreshUnread]);

  // Starred clients pinned on top, oldest star first (the same account-wide
  // list a group roster pins by), then whoever was active most recently.
  const sortedClients = useMemo(
    () => rosterOrder(clients, favouriteMemberIds),
    [clients, favouriteMemberIds],
  );

  const programs = useMemo(
    () => programsSummary(reviews, groupReviews, sharedOut),
    [reviews, groupReviews, sharedOut],
  );

  // The group limits are checked against this list before anything is sent, so
  // the prompt comes before the form is filled in: the groups I made, and
  // separately the ones I joined. The database refuses past either too (0042),
  // which covers a list that's out of date.
  const ownedCount = groups.filter(g => g.isOwner).length;
  const atCreateLimit = ownedCount >= MAX_OWNED_GROUPS;
  const atJoinLimit = groups.length - ownedCount >= MAX_JOINED_GROUPS;
  const ownsAGroup = ownedCount > 0;

  const openNewGroup = useCallback(() => {
    if (atCreateLimit) {
      Alert.alert(GROUP_LIMIT_TITLE, groupLimitMessage("create", ownsAGroup));
      return;
    }
    router.navigate("/trainer/group-edit");
  }, [router, atCreateLimit, ownsAGroup]);

  const openGroup = useCallback((g: Group) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/trainer/group/[id]", params: { id: g.id, name: g.name } });
  }, [router]);

  const openClient = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/trainer/client/[id]", params: { id } });
  }, [router]);

  /** Re-read rather than move the invite across: the group only becomes
   *  readable once the RPC returns, so an optimistic card could open to
   *  nothing. Same reasoning as the gym-user hub. */
  const handleAcceptInvite = useCallback(async (invite: GroupInvite) => {
    // At the limit the invite stays where it is, to accept after leaving a group.
    if (atJoinLimit) {
      Alert.alert(GROUP_LIMIT_TITLE, groupLimitMessage("join", ownsAGroup));
      return;
    }
    try {
      await acceptGroupInvite(invite.groupId);
    } catch (e) {
      if (isGroupLimitError(e)) Alert.alert(GROUP_LIMIT_TITLE, groupLimitMessage("join", ownsAGroup));
      else Alert.alert("Couldn't join group", alertMessage(e, "Check your connection and try again."));
      return;
    }
    // Same read as the initial load, so a group joined from an invite arrives
    // with its badge (and its faces) rather than an empty one until the next
    // focus. Without its faces, its row says how many members instead.
    const [rows, inv, joined] = await Promise.all([
      loadGroupRows(),
      fetchMyGroupInvites(),
      fetchGroupMembers(invite.groupId).catch(() => null),
    ]);
    setHub(h => h && {
      ...h,
      groups: sortByFavourite(rows.map(r => r.group), new Set(h.favouriteGroupIds)),
      unreadByGroup: Object.fromEntries(rows.map(r => [r.group.id, r.unreadCount])),
      groupFaces: joined
        ? { ...h.groupFaces, [invite.groupId]: memberFaces(joined) }
        : h.groupFaces,
      groupInvites: inv,
    });
  }, [atJoinLimit, ownsAGroup]);

  const handleDeclineInvite = useCallback((invite: GroupInvite) => {
    Alert.alert(
      `Decline ${invite.name}?`,
      `${invite.ownerName} can invite you again later.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            try {
              await declineGroupInvite(invite.groupId);
            } catch (e) {
              Alert.alert("Couldn't decline", alertMessage(e, "Check your connection and try again."));
              return;
            }
            setHub(h => h && { ...h, groupInvites: h.groupInvites.filter(i => i.groupId !== invite.groupId) });
          },
        },
      ],
    );
  }, []);

  /** groupId → everything in that group waiting on me: unread messages, a
   *  program shared with me I haven't accepted, a review I could pick up. */
  const groupAlerts = useMemo(
    () => groupAlertCounts({ unreadByGroup, shares: sharedOut, reviews: groupReviews, myUid }),
    [unreadByGroup, sharedOut, groupReviews, myUid],
  );

  // The faces' rings are the card they sit on, so overlapping faces stay apart.
  const cardSurface = isDark ? NEU_BG_DARK : NEU_BG;
  const avatarTint = isDark ? `${ACCT}1F` : `${ACCT}2E`;

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.5)", "transparent"]}
            locations={[0, 0.6, 0.85, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        // +50 top: where every tab's title sits (Home's greeting). Keep in
        // sync with MyPTHome so both hub views open on the same title line.
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 50, paddingBottom: scrollEndPadding(insets.bottom + 140, barsReach) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={ACCT}
            colors={[ACCT]}
            progressViewOffset={insets.top}
          />
        }
      >
        <HubTitle>
          {/* The trainers coaching you, and what they've sent you
              (app/trainer/coaches.tsx). */}
          <MyTrainersPill onPress={() => router.navigate("/trainer/coaches")} />
          <GlassButton
            onPress={() => router.navigate("/trainer/messages")}
            solidStyle={PILL_SHADOW}
            badge={<UnreadBadge count={unreadMessages} style={styles.badge} />}
            accessibilityLabel="Open messages"
          >
            <ChatIcon size={18} color={t.tp} />
          </GlassButton>
        </HubTitle>
        <OfflineBanner />

        {/* Someone I'm connected with switched account type: what it changed,
            and the choice it leaves me (components/trainer/ConnectionNotices.tsx). */}
        <ConnectionNotices
          notices={hub?.notices ?? []}
          accountType="pt"
          onResolved={noticeId => setHub(h => h && { ...h, notices: (h.notices ?? []).filter(n => n.id !== noticeId) })}
          onChanged={() => { void fetchPTHub(owner, { fresh: true }).then(setHub); }}
        />

        <ProgramsCard
          toReview={programs.toReview}
          sent={programs.sent}
          onPress={() => router.navigate("/trainer/programs")}
        />

        {/* Groups above clients: there are only ever a few of them (you can
            make 3 and join 3), and clients are the list that grows. */}
        <View style={styles.sectionRow}>
          <View style={styles.sectionTitle}>
            <Text style={[styles.sectionHeading, { color: t.tp }]}>Groups</Text>
            {groups.length > 0 ? <Text style={[styles.sectionCount, { color: t.ts }]}>{groups.length}</Text> : null}
          </View>
          <GlassButton onPress={openNewGroup} size={SECTION_BTN} solidStyle={PILL_SHADOW} accessibilityLabel="Create a group">
            <Ionicons name="add" size={20} color={t.tp} />
          </GlassButton>
        </View>
        {/* Invites another trainer sent me, above my own groups: an unanswered
            invite is the only thing in this section that needs a decision. */}
        {groupInvites.map(inv => (
          <GroupInviteCard
            key={inv.groupId}
            invite={inv}
            onAccept={handleAcceptInvite}
            onDecline={handleDeclineInvite}
          />
        ))}
        {groups.length === 0 ? (
          loaded && groupInvites.length === 0 ? (
            <NeuCard dark={isDark} radius={16}>
              <Text style={[styles.groupEmpty, { color: t.ts }]}>
                Put clients in a group to message them together and send one program to all of them.
              </Text>
            </NeuCard>
          ) : null
        ) : (
          <NeuCard dark={isDark} radius={16}>
            {groups.map((g, i) => {
              // Who's in it, as faces under the name: the group page's banner
              // stack, smaller. A group whose faces haven't loaded yet (just
              // joined, or an older saved copy) says how many instead.
              const faces = groupFaces?.[g.id];
              const count = faces?.length ?? g.memberCount;
              return (
                <TouchableOpacity
                  key={g.id}
                  onPress={() => openGroup(g)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Open group ${g.name}, ${count} member${count === 1 ? "" : "s"}`}
                  style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.div }]}
                >
                  <GroupAvatar uri={g.photoUri} size={36} isDark={isDark} colorKey={g.id} />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, { color: t.tp }]} numberOfLines={1}>{g.name}</Text>
                    {faces && faces.length > 0 ? (
                      <View style={styles.faces}>
                        <MemberStack members={faces} size={20} overlap={8} isDark={isDark} ringColor={cardSurface} countColor={t.ts} />
                      </View>
                    ) : (
                      <Text style={[styles.rowMeta, { color: t.ts }]}>{count} member{count === 1 ? "" : "s"}</Text>
                    )}
                  </View>
                  {/* Everything in it waiting on me: unread messages, a program
                      shared with me, a review to pick up. The same red count
                      the Messages button wears. */}
                  <UnreadBadge count={groupAlerts[g.id] ?? 0} />
                  {/* Display only, and only once starred: favouriting is done
                      inside the group, from its options menu. */}
                  {favourites.has(g.id) ? <FavouriteStar size={15} /> : null}
                  <Ionicons name="chevron-forward" size={16} color={t.ts} />
                </TouchableOpacity>
              );
            })}
          </NeuCard>
        )}

        <View style={styles.sectionRow}>
          <View style={styles.sectionTitle}>
            <Text style={[styles.sectionHeading, { color: t.tp }]}>Clients</Text>
            {clients.length > 0 ? <Text style={[styles.sectionCount, { color: t.ts }]}>{clients.length}</Text> : null}
          </View>
          {/* Connecting someone (by code or QR), with a count of the
              requests waiting there to accept. */}
          <GlassButton
            onPress={() => router.navigate("/connect")}
            size={SECTION_BTN}
            solidStyle={PILL_SHADOW}
            badge={<UnreadBadge count={pendingIncoming} style={styles.badge} />}
            accessibilityLabel={pendingIncoming > 0 ? `Connect with someone, ${pendingIncoming} waiting` : "Connect with someone"}
          >
            <UserRoundPlusIcon size={18} color={t.tp} />
          </GlassButton>
        </View>
        {/* No client search: the roster is small enough to scan (a 10-client
            limit is planned). A search is meant to come back with the Pro
            tier's larger roster, not before. */}
        {!loaded ? null : sortedClients.length === 0 ? (
          <NeuCard dark={isDark} radius={20}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIcon, { backgroundColor: avatarTint }]}>
                <PeopleIcon size={28} color={ACCT} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No clients yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>Tap the connect button above to add someone by their code or QR.</Text>
            </View>
          </NeuCard>
        ) : (
          <NeuCard dark={isDark} radius={16}>
            {sortedClients.map((c, i) => {
              // Live presence over the load-time snapshot; local entries aren't
              // in the map and keep their stored value.
              const lastActive = presenceById.has(c.id) ? presenceById.get(c.id) ?? undefined : c.lastActiveISO;
              const program = activeProgramByClient[c.id] ?? "No active program";
              const meta = lastActive ? `${program} · ${presenceLabel(lastActive)}` : program;
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => openClient(c.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${c.name}, ${meta}`}
                  style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.div }]}
                >
                  <Avatar
                    uri={c.photoUri}
                    initials={c.initials}
                    size={36}
                    colorKey={c.id}
                    textStyle={styles.avatarText}
                  />
                  <View style={styles.rowText}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.rowTitle, styles.rowName, { color: t.tp }]} numberOfLines={1}>{c.name}</Text>
                      {/* A fellow trainer you've taken on as a client. */}
                      {c.isTrainer ? (
                        <View style={[styles.tag, { backgroundColor: `${ACCT}22` }]}>
                          <Text style={[styles.tagText, { color: ACCT }]}>TRAINER</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.metaRow}>
                      {/* Green when they're active now, the grey of everyone else. */}
                      {lastActive ? (
                        <View style={[styles.dot, { backgroundColor: isActiveNow(lastActive) ? ACCT : t.ts }]} />
                      ) : null}
                      <Text style={[styles.rowMeta, styles.metaText, { color: t.ts }]} numberOfLines={1}>{meta}</Text>
                    </View>
                  </View>
                  {/* Display only, and only once starred: starring is done on the
                      client's own page, from its ⋯ menu. */}
                  {favouriteMembers.has(c.id) ? <FavouriteStar size={15} /> : null}
                  <Ionicons name="chevron-forward" size={16} color={t.ts} />
                </TouchableOpacity>
              );
            })}
          </NeuCard>
        )}
      </ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  badge: { position: "absolute", top: -5, right: -5 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, marginTop: 16, marginBottom: 4 },
  // The count on the heading's baseline, with the row's button still centred
  // in the row. Centred by its box, the smaller number rode high beside the
  // word, like a power (user feedback, 2026-10-21).
  sectionTitle: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8 },
  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18 },
  sectionCount: { fontFamily: FontFamily.bold, fontSize: 15 },
  row: { ...SUMMARY_ROW, paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...CARD_TITLE },
  rowMeta: { ...CARD_META },
  // `flexShrink`, not `flex`, so a long name truncates and the TRAINER tag stays.
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName: { flexShrink: 1 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  metaText: { flexShrink: 1, marginTop: 0 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 13 },
  // Under the name, a little apart from it: the faces' rings would otherwise
  // sit against the title's descenders.
  faces: { marginTop: 4 },
  groupEmpty: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, padding: 16, textAlign: "center" },
  emptyInner: { padding: 28, alignItems: "center", gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 18 },
});
