// components/trainer/MyPTHome.tsx
//
// The Trainer tab for a gym user (user decisions, 2026-10-21, the Trainer Page
// canvas, "Round 2 · Gym user (C)"): your trainer first. The tab's title with
// the My Trainers pill beside it (no Messages button: a message from another of
// your trainers is a red count on the pill, and the My Trainers page says who),
// then your trainer's card, with Message and Send for Review, then two tiles,
// "From [trainer]" and "Sent for Review", each opening its own page
// (app/trainer/received.tsx, app/trainer/sent-reviews.tsx), then your groups.
// The program lists used to be sections down this page, with every program's
// buttons on it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scrollEndPadding } from "../../constants/floatingBars";
import { useFloatingBarsReach } from "../../hooks/useFloatingBars";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "../MaskedView";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import Avatar from "../Avatar";
import UnreadBadge from "../UnreadBadge";
import OfflineBanner from "../OfflineBanner";
import ChatIcon from "../icons/ChatIcon";
import NotebookIcon from "../icons/NotebookIcon";
import PeopleIcon from "../icons/PeopleIcon";
import SendIcon from "../icons/SendIcon";
import HubTitle from "./HubTitle";
import MyTrainersPill from "./MyTrainersPill";
import ConnectionNotices from "./ConnectionNotices";
import GroupInviteCard from "./GroupInviteCard";
import GroupAvatar from "./GroupAvatar";
import MemberStack from "./MemberStack";
import SendForReviewSheet from "./SendForReviewSheet";
import HubTile from "./HubTile";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import { acceptGroupInvite, declineGroupInvite, fetchGroupMembers, fetchMyGroupInvites, isGroupLimitError } from "../../lib/groups";
import { loadGroupRows } from "../../utils/groupStore";
import { groupAlertCounts } from "../../utils/groupAlerts";
import { GROUP_LIMIT_TITLE, MAX_JOINED_GROUPS, groupLimitMessage, memberFaces, type GroupInvite } from "../../constants/groups";
import {
  ACCT,
  APP_DARK,
  APP_LIGHT,
  AWAITING_ORANGE,
  FontFamily,
  NEU_BG,
  NEU_BG_DARK,
  compareBlue,
  compareBlueText,
  replacedTextColor,
  dangerTextColor,
} from "../../constants/theme";
import { darkGlow, pill, pillGlow, PILL_H_SM, PILL_SHADOW } from "../../constants/buttons";
import { CARD_META, CARD_TITLE, SUMMARY_ROW } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { EMPTY_GYM_HUB, fetchGymHub, peekGymHub, saveGymHub, type GymHubData } from "../../utils/trainerHub";
import { hydrateGroupPages } from "../../utils/groupPage";
import { fromLine, gymTileCounts, myTrainersBadge } from "../../utils/trainerLists";
import { isActiveNow, presenceLabel } from "../../utils/presence";
import { alertMessage } from "../../utils/errors";
import type { AssignedPT, SentProgram } from "../../utils/trainerStore";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;


export default function MyPTHome() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // Loading placeholders sit a shade below a divider in both themes.
  const skeletonFill = isDark ? "rgba(255,255,255,0.08)" : t.div;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const router = useRouter();
  const { byPerson: unreadByPerson, refresh: refreshUnread } = useUnreadMessages();
  // The account this page's data belongs to. Constant for the page's life: the
  // tab remounts it when the account changes (app/(tabs)/trainer-hub.tsx).
  const { userId } = useAuth();
  const owner = userId ?? "";

  /**
   * Everything on this page, as ONE value (utils/trainerHub.ts). It starts on
   * the copy saved last time, so the first frame is the whole page, and a load
   * replaces it in a single render, so a refresh changes the page in place
   * rather than filling it in section by section. The two program pages and
   * My Trainers read and save the same copy.
   *
   * Null only before the first load ever finishes (no saved copy yet), and the
   * page keeps that apart from "loaded and empty": `pt` is `undefined` while
   * resolving and `null` once we know there's no trainer. With only null, the
   * page drew "No trainer linked yet" for the half-second before the
   * connections came back, to people who have a trainer.
   */
  const [hub, setHub] = useState<GymHubData | null>(() => peekGymHub(owner));
  const loaded = hub !== null;
  const pt: AssignedPT | null | undefined = hub ? hub.pt : undefined;
  const {
    received,
    sent,
    dismissedKeys,
    groups,
    groupOwners,
    groupFaces,
    shares,
    groupReviewsToDo,
    groupInvites,
    myUid,
  } = hub ?? EMPTY_GYM_HUB;
  // A copy saved before the list was kept knows only the featured trainer.
  const trainers = useMemo(() => hub?.trainers ?? (hub?.pt ? [hub.pt] : []), [hub]);
  const dismissed = useMemo(() => new Set(dismissedKeys), [dismissedKeys]);

  // Whatever the page shows is what it opens on next time, including a change
  // made here (a declined invite) that no load has seen yet.
  useEffect(() => {
    if (hub) saveGymHub(owner, hub);
  }, [hub, owner]);

  // Each group's saved page, read off the device now so tapping a group opens
  // on it rather than on a spinner (utils/groupPage.ts). Device reads only.
  const groupIdsKey = groups.map(g => g.group.id).join(",");
  useEffect(() => {
    if (groupIdsKey) void hydrateGroupPages(owner, groupIdsKey.split(","));
  }, [owner, groupIdsKey]);

  // Live "last active" for the trainer + the connection requests counted on
  // the My Trainers pill. A local/mock trainer isn't in the map → no presence.
  const { presenceById, pendingIncoming } = useConnectionPresence();

  /**
   * Arriving at the page brings it up to date. First from the saved copy,
   * which the pages this one opens write to (an accepted program, a trainer
   * picked on My Trainers), so coming back shows what was done there at once;
   * then behind it, in one render when the load lands. If the startup prefetch
   * is still running, this joins it rather than asking the server twice. The
   * cancel flag stops a load that outlives the visit from writing to the page;
   * its result is saved regardless, so the next open starts from it.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const held = peekGymHub(owner);
    if (held) setHub(held);
    void fetchGymHub(owner).then(next => { if (!cancelled) setHub(next); });
    return () => { cancelled = true; };
  }, [owner]));

  /** Pull down to re-read: a program your trainer sent or sent back, a group
   *  invite, new messages. Always its OWN read (`fresh`), never the arrival
   *  load or the startup prefetch, so what you pulled for is what the server
   *  says now. Runs to completion, and always clears the spinner because
   *  `fetchGymHub` never rejects. */
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // The message counts too: they normally recount on focus, which a pull
    // isn't, so without this the one number you pulled for wouldn't move.
    const [next] = await Promise.all([fetchGymHub(owner, { fresh: true }), refreshUnread()]);
    setHub(next);
    setRefreshing(false);
  }, [owner, refreshUnread]);

  const tiles = useMemo(() => gymTileCounts(received, sent, dismissed), [received, sent, dismissed]);
  // Messages from every other trainer and anyone else you're connected with,
  // and requests to connect: what My Trainers holds that this page doesn't.
  const pillBadge = myTrainersBadge(
    unreadByPerson,
    [...trainers, ...(hub?.others ?? [])].map(p => p.id),
    pt?.id ?? null,
    pendingIncoming,
  );

  const openChat = useCallback(() => {
    if (!pt) return;
    router.navigate({
      pathname: "/trainer/chat/[id]",
      params: { id: pt.id, name: pt.name, initials: pt.initials, photo: pt.photoUri ?? "" },
    });
  }, [pt, router]);

  const [sendOpen, setSendOpen] = useState(false);
  const onSent = useCallback((next: SentProgram[]) => setHub(h => h && { ...h, sent: next }), []);

  /** groupId → what's waiting on me in it. Same helper the trainer hub uses, so
   *  a badge means the same thing on both sides. */
  const groupAlerts = useMemo(
    () => groupAlertCounts({
      unreadByGroup: Object.fromEntries(groups.map(g => [g.group.id, g.unreadCount])),
      shares,
      // Review requests waiting on me, in groups where the owner has made me a
      // trainer. A gym user can hold that role, and then picks reviews up like
      // any trainer. Empty for a plain member: the query behind it only
      // returns reviews I coach, never ones I sent.
      reviews: groupReviewsToDo,
      myUid,
    }),
    [groups, shares, groupReviewsToDo, myUid],
  );

  // The joining limit is checked against this list before anything is sent:
  // groups someone else made (a gym user makes none, but a role can change).
  // The database refuses past it too (0042), which covers a list that's out of
  // date. At the limit the invite stays where it is, to accept after leaving one.
  const ownedCount = groups.filter(r => r.group.isOwner).length;
  const atJoinLimit = groups.length - ownedCount >= MAX_JOINED_GROUPS;
  const ownsAGroup = ownedCount > 0;

  /** Join a group I was invited to. The group only becomes readable once the
   *  RPC returns, so the list is re-read rather than moved across
   *  optimistically: a failed accept must not leave a group row that opens to
   *  nothing. Its faces come with it, as on the trainer's hub. */
  const handleAcceptInvite = useCallback(async (invite: GroupInvite) => {
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
    const [groupRows, invites, joined] = await Promise.all([
      loadGroupRows(),
      fetchMyGroupInvites(),
      fetchGroupMembers(invite.groupId).catch(() => null),
    ]);
    setHub(h => h && {
      ...h,
      groups: groupRows,
      groupInvites: invites,
      groupFaces: joined ? { ...h.groupFaces, [invite.groupId]: memberFaces(joined) } : h.groupFaces,
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

  const openGroup = useCallback((id: string, name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/trainer/group/[id]", params: { id, name } });
  }, [router]);

  // The tiles once we know what's in them, and while there's a trainer or
  // something from one (programs from a trainer you've since disconnected
  // from stay reachable).
  const showTiles = loaded && (!!pt || tiles.fromTotal > 0 || tiles.sentTotal > 0);
  // "Programs", not who they're from: "From Mikeybeastv" alone didn't say what
  // was behind it (user feedback, 2026-10-21). Who they're from is the line
  // under it once nothing's new, and the trainer's card is right above.
  const programsMeta = tiles.newPrograms > 0
    ? plural(tiles.newPrograms, "new program")
    : tiles.fromTotal > 0 ? fromLine(trainers.length, pt ?? null) : "Nothing yet";
  // One a trainer removed without a review comes first, in red: it's the news
  // (user request, 2026-10-29), where one still waiting is the usual state.
  const sentMeta = tiles.notReviewed > 0
    ? `${tiles.notReviewed} not reviewed`
    : tiles.awaiting > 0
      ? `${tiles.awaiting} awaiting review`
      : tiles.accepted > 0 ? `${tiles.accepted} accepted` : "Nothing sent yet";
  const sentInk = tiles.notReviewed > 0 ? dangerTextColor(isDark) : tiles.awaiting > 0 ? replacedTextColor(isDark) : t.ts;
  // Programs in the periwinkle of Compare; Sent for Review in the orange that
  // "Awaiting review" is everywhere. Marks in the colour, words in its ink.
  const programsMark = compareBlue(isDark);
  const sentMark = AWAITING_ORANGE;

  // The faces' rings are the card they sit on, so overlapping faces stay apart.
  const cardSurface = isDark ? NEU_BG_DARK : NEU_BG;
  const avatarTint = isDark ? `${ACCT}1F` : `${ACCT}2E`;
  const unreadFromTrainer = pt ? unreadByPerson[pt.id] ?? 0 : 0;

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
        // +50 top: where every tab's title sits (Home's greeting), as on
        // PTHome — keep the two hub views in sync.
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
          {/* Every trainer you're connected with (app/my-trainers.tsx). */}
          <MyTrainersPill onPress={() => router.navigate("/my-trainers")} badge={pillBadge} />
        </HubTitle>
        <OfflineBanner />

        {/* A trainer I'm connected with switched to a gym account (or someone
            became a trainer): what it changed (components/trainer/ConnectionNotices.tsx). */}
        <ConnectionNotices
          notices={hub?.notices ?? []}
          accountType="gym_user"
          onResolved={noticeId => setHub(h => h && { ...h, notices: (h.notices ?? []).filter(n => n.id !== noticeId) })}
          onChanged={() => { void fetchGymHub(owner, { fresh: true }).then(setHub); }}
        />

        {pt === undefined ? (
          // Still resolving. The same card at the same size, so the trainer
          // fills in place rather than the page jumping, and nobody who HAS a
          // trainer is told they don't.
          <NeuCard dark={isDark} radius={24} style={{ marginTop: 16 }}>
            <View style={styles.hero} accessibilityLabel="Loading your trainer">
              <View style={[styles.skeletonAvatar, { backgroundColor: skeletonFill }]} />
              <View style={[styles.skeletonLine, { width: 76, marginTop: 14, backgroundColor: skeletonFill }]} />
              <View style={[styles.skeletonLine, styles.skeletonLineLarge, { backgroundColor: skeletonFill }]} />
              <View style={styles.heroActions}>
                <View style={[styles.skeletonButton, { backgroundColor: skeletonFill }]} />
                <View style={[styles.skeletonButton, { backgroundColor: skeletonFill }]} />
              </View>
            </View>
          </NeuCard>
        ) : pt === null ? (
          <NeuCard dark={isDark} radius={24} style={{ marginTop: 16 }}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIcon, { backgroundColor: avatarTint }]}>
                <PeopleIcon size={28} color={ACCT} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No trainer linked yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                Connect with a personal trainer to share programs and get feedback on your progress.
              </Text>
              <BounceButton style={{ marginTop: 8 }} onPress={() => router.navigate("/connect")}>
                <View style={[styles.cta, { backgroundColor: ACCT }, darkGlow(styles.cta, isDark)]}>
                  <Text style={styles.ctaText}>Connect a Trainer</Text>
                </View>
              </BounceButton>
            </View>
          </NeuCard>
        ) : (
          <NeuCard dark={isDark} radius={24} style={{ marginTop: 16 }}>
            <View style={styles.hero}>
              <Avatar
                uri={pt.photoUri}
                initials={pt.initials}
                size={64}
                colorKey={pt.id}
                textStyle={styles.heroInitials}
              />
              <Text style={[styles.heroLabel, { color: t.ts }]}>YOUR TRAINER</Text>
              <Text style={[styles.heroName, { color: t.tp }]} numberOfLines={1}>{pt.name}</Text>
              {(() => {
                const lastActive = presenceById.get(pt.id);
                if (!lastActive) return null; // not connected, never active, or sharing off
                return (
                  <View style={styles.presenceRow}>
                    <View style={[styles.presenceDot, { backgroundColor: isActiveNow(lastActive) ? ACCT : t.ts }]} />
                    <Text style={[styles.presenceText, { color: t.ts }]}>{presenceLabel(lastActive)}</Text>
                  </View>
                );
              })()}
              <View style={styles.heroActions}>
                <BounceButton
                  style={{ flex: 1 }}
                  onPress={openChat}
                  accessibilityLabel={unreadFromTrainer > 0 ? `Message ${pt.name}, ${unreadFromTrainer} unread` : `Message ${pt.name}`}
                >
                  <View>
                    <View style={[styles.heroBtn, { backgroundColor: t.ctrl }]}>
                      <ChatIcon size={17} color={t.tp} />
                      <Text style={[styles.heroBtnText, { color: t.tp }]}>Message</Text>
                    </View>
                    <UnreadBadge count={unreadFromTrainer} style={styles.heroBadge} />
                  </View>
                </BounceButton>
                <BounceButton
                  style={{ flex: 1 }}
                  onPress={() => setSendOpen(true)}
                  needsConnection
                  accessibilityLabel={`Send a program to ${pt.name} for review`}
                >
                  <View style={[styles.heroBtn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }]}>
                    <SendIcon size={16} color="#fff" />
                    <Text style={[styles.heroBtnText, { color: "#fff" }]}>Send for Review</Text>
                  </View>
                </BounceButton>
              </View>
            </View>
          </NeuCard>
        )}

        {showTiles ? (
          <View style={styles.tiles}>
            <HubTile
              icon={<NotebookIcon size={18} color={programsMark} />}
              mark={programsMark}
              title="Programs"
              meta={programsMeta}
              metaColor={tiles.newPrograms > 0 ? compareBlueText(isDark) : t.ts}
              onPress={() => router.navigate("/trainer/received")}
              accessibilityLabel={`Programs, ${programsMeta}`}
            />
            <HubTile
              icon={<SendIcon size={17} color={sentMark} />}
              mark={sentMark}
              title="Sent for Review"
              meta={sentMeta}
              metaColor={sentInk}
              onPress={() => router.navigate("/trainer/sent-reviews")}
              accessibilityLabel={`Sent for Review, ${sentMeta}`}
            />
          </View>
        ) : null}

        {/* Groups a trainer has put me in. The section only exists once there's
            something in it: a gym user who's never been added to one has no use
            for an empty Groups heading. Invites sit above the joined groups and
            are the only thing here that isn't a link: until you accept, there
            is no group page to open. */}
        {groups.length > 0 || groupInvites.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <View style={styles.sectionTitle}>
                <Text style={[styles.sectionHeading, { color: t.tp }]}>Groups</Text>
                {groups.length > 0 ? <Text style={[styles.sectionCount, { color: t.ts }]}>{groups.length}</Text> : null}
              </View>
            </View>
            {groupInvites.map(inv => (
              <GroupInviteCard
                key={inv.groupId}
                invite={inv}
                onAccept={handleAcceptInvite}
                onDecline={handleDeclineInvite}
              />
            ))}
            {groups.length > 0 ? (
              <NeuCard dark={isDark} radius={16}>
                {groups.map(({ group: g }, i) => {
                  // Who's in it, as faces under the name, as on the trainer's
                  // hub. Until they've loaded (just joined, or an older saved
                  // copy), whose group it is and how many are in it.
                  const faces = groupFaces?.[g.id];
                  const runBy = groupOwners[g.id];
                  const members = plural(g.memberCount, "member");
                  const words = g.isOwner ? `Your group · ${members}` : runBy ? `Run by ${runBy.name} · ${members}` : members;
                  return (
                    <TouchableOpacity
                      key={g.id}
                      onPress={() => openGroup(g.id, g.name)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Open group ${g.name}, ${words}`}
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
                          <Text style={[styles.rowMeta, { color: t.ts }]} numberOfLines={1}>{words}</Text>
                        )}
                      </View>
                      {/* Unread messages, plus any program sent into this group
                          I haven't accepted, plus reviews I could pick up there. */}
                      <UnreadBadge count={groupAlerts[g.id] ?? 0} />
                      <Ionicons name="chevron-forward" size={16} color={t.ts} />
                    </TouchableOpacity>
                  );
                })}
              </NeuCard>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <SendForReviewSheet
        visible={sendOpen}
        trainer={pt ?? null}
        onClose={() => setSendOpen(false)}
        onSent={onSent}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  // The trainer's card: who they are, centred, and the two things you do with
  // them side by side under it.
  hero: { alignItems: "center", paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16 },
  heroInitials: { fontFamily: FontFamily.bold, fontSize: 21 },
  heroLabel: { fontFamily: FontFamily.bold, fontSize: 11, letterSpacing: 0.8, marginTop: 10 },
  heroName: { fontFamily: FontFamily.bold, fontSize: 20, lineHeight: 26, marginTop: 2 },
  presenceRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  presenceDot: { width: 7, height: 7, borderRadius: 4 },
  presenceText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  heroActions: { alignSelf: "stretch", flexDirection: "row", gap: 10, marginTop: 16 },
  heroBtn: { ...pill(PILL_H_SM), gap: 8, ...PILL_SHADOW },
  heroBtnText: { fontFamily: FontFamily.bold, fontSize: 14 },
  heroBadge: { position: "absolute", top: -5, right: -3 },
  // Placeholder while the trainer resolves, sized to the real card.
  skeletonAvatar: { width: 64, height: 64, borderRadius: 32 },
  skeletonLine: { height: 10, borderRadius: 5 },
  skeletonLineLarge: { width: 140, height: 18, borderRadius: 9, marginTop: 10 },
  skeletonButton: { flex: 1, height: PILL_H_SM, borderRadius: PILL_H_SM / 2 },
  tiles: { flexDirection: "row", gap: 12, marginTop: 16 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, marginTop: 16, marginBottom: 4 },
  // The count on the heading's baseline, as PTHome's. Centred by its box, the
  // smaller number rode high beside the word, like a power (user feedback,
  // 2026-10-21).
  sectionTitle: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8 },
  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18 },
  sectionCount: { fontFamily: FontFamily.bold, fontSize: 15 },
  row: { ...SUMMARY_ROW, paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...CARD_TITLE },
  rowMeta: { ...CARD_META },
  // Under the name, a little apart from it: the faces' rings would otherwise
  // sit against the title's descenders.
  faces: { marginTop: 4 },
  emptyInner: { padding: 28, alignItems: "center", gap: 12 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 17, textAlign: "center" },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
  cta: { ...pill(PILL_H_SM), paddingHorizontal: 24, ...pillGlow(ACCT, 0.4) },
  ctaText: { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },
});
