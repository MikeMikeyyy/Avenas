import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Keyboard, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
// FadeIn/FadeOut are for the search row only. The program cards deliberately
// carry NO layout animation: LinearTransition on a card froze the UI-thread
// height tween inside ExpandReveal, which is the open/close animation itself.
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import ChevronToggle from "../ChevronToggle";
import ExpandReveal, { useReveal } from "../ExpandReveal";
import ClientCard from "./ClientCard";
import Avatar from "../Avatar";
import AddClientSheet from "./AddClientSheet";
import ProgramPickerSheet from "./ProgramPickerSheet";
import RecipientPickerSheet from "./RecipientPickerSheet";
import PeopleIcon from "../icons/PeopleIcon";
import ChatIcon from "../icons/ChatIcon";
import SendIcon from "../icons/SendIcon";
import TrashIcon from "../TrashIcon";
import UnreadBadge from "../UnreadBadge";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import { Ionicons } from "@expo/vector-icons";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER_BRIGHT } from "../../constants/theme";
import { pill, pillGlow, haloGlow, PILL_RADIUS, PILL_SHADOW } from "../../constants/buttons";
import { CARD_INNER, CARD_META, CARD_PILL, CARD_PILL_TEXT, CARD_TITLE, CARD_TOP, REVEAL_BLEED, SUMMARY_ROW } from "../../constants/cards";
import FavouriteStar from "../FavouriteStar";
import { useTheme } from "../../contexts/ThemeContext";
import {
  appendSharedPrograms,
  batchKeyOf,
  loadClientData,
  loadClients,
  loadMyGroupReviews,
  loadSentPrograms,
  loadSharedPrograms,
  makeInitials,
  migrateBroadcastShares,
  migrateCoachReceivedShares,
  removeSharedProgramBatch,
  saveClients,
  setGroupReviewDone,
  dismissReceivedReview,
  type Client,
  type SentProgram,
  type SharedProgram,
} from "../../utils/trainerStore";
import { seedMockClientsIfNeeded } from "../../utils/mockClientSeed";
import { resolveTrainerRoster } from "../../utils/roster";
import { getJSON } from "../../utils/storage";
import { removeShareConfirm } from "../../utils/removeShare";
import { loadFavouriteGroupIds, loadFavouriteMemberIds, loadGroupRows, sortByFavourite } from "../../utils/groupStore";
import { groupAlertCounts } from "../../utils/groupAlerts";
import { acceptGroupInvite, declineGroupInvite, fetchAllGroupMemberships, fetchMyGroupInvites } from "../../lib/groups";
import GroupInviteCard from "./GroupInviteCard";
import GroupAvatar from "./GroupAvatar";
import { getMyUid } from "../../lib/chat";
import { PROGRAMS_KEY, type SavedProgram } from "../../constants/programs";
import type { Group, GroupInvite } from "../../constants/groups";

// Same SVG used by workout.tsx / new-program.tsx / review screen.
function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4"/>
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** The cycle strip a program card shows before you open it. */
function CycleStrip({ cycle, isDark }: { cycle: string[]; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  if (cycle.length === 0) return null;
  return (
    <View style={styles.cycleGrid}>
      {cycle.map((day, i) => {
        const isTraining = day !== "Rest" && day !== "";
        return (
          <View
            key={i}
            style={[
              styles.cycleChip,
              isTraining
                ? { backgroundColor: `${ACCT}22`, borderColor: ACCT, borderWidth: 1 }
                : { backgroundColor: t.div },
            ]}
          >
            <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]} numberOfLines={1}>
              {day || "Rest"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * One send, in "Programs Sent".
 *
 * Its own component so it can hold a `useReveal` — a hook can't live inside the
 * map — and so the card owns its open/close animation instead of swapping
 * content in and out. It used to render the expanded half only while open, with
 * a fade over a height that jumped, so the card snapped to its new size and the
 * contents faded into it afterwards.
 *
 * There is deliberately NO Reanimated layout wrapper (LinearTransition) around
 * this card: a layout animation on an ancestor freezes the UI-thread height
 * tween inside ExpandReveal, which is the whole animation.
 */
function SentCard({ batch, open, isDark, sentTo, nameFor, onToggle, onView, onRemove }: {
  batch: { key: string; programName: string; sentAtISO: string; entries: SharedProgram[]; acceptedCount: number; total: number; allAccepted: boolean; programSnapshot?: SavedProgram };
  open: boolean;
  isDark: boolean;
  /** "Gym Crew · 5 members" or "3 clients" — worked out by the caller, which is
   *  the one holding the group list. */
  sentTo: string;
  nameFor: (clientId: string) => string;
  onToggle: () => void;
  onView: () => void;
  onRemove: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reveal = useReveal();
  useEffect(() => { reveal.setOpen(open); }, [open, reveal]);

  const pillLabel = batch.allAccepted ? "Accepted" : `${batch.acceptedCount}/${batch.total} accepted`;

  return (
    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
      <Pressable
        onPress={onToggle}
        style={styles.reviewInner}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${batch.programName}, ${pillLabel}, ${open ? "collapse" : "expand"}`}
      >
        <View style={styles.reviewTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.reviewName, { color: t.tp }]} numberOfLines={1}>{batch.programName}</Text>
            {/* The group belongs on the COLLAPSED card: where a program went is
                the first thing you want to know, and putting it behind a tap
                meant opening every card to find out. */}
            <Text style={[styles.reviewMeta, { color: t.ts }]} numberOfLines={1}>
              Sent {fmtAgo(batch.sentAtISO)} · {sentTo}
            </Text>
          </View>
          <View style={[styles.statusPill, batch.allAccepted
            ? { backgroundColor: `${ACCT}22` }
            : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
          ]}>
            <Text style={[styles.statusText, { color: batch.allAccepted ? ACCT : t.ts }]}>{pillLabel}</Text>
          </View>
        </View>
        <CycleStrip cycle={batch.programSnapshot?.cyclePattern ?? []} isDark={isDark} />
        {/* bleed: room for the buttons' glow inside the reveal's clip, which
            otherwise cut it off in a straight line (constants/cards.ts). */}
        <ExpandReveal progress={reveal.progress} fade={reveal.fade} open={open} bleed={REVEAL_BLEED} contentStyle={styles.revealBody}>
          <View style={[styles.recipientList, { borderColor: t.div }]}>
            {batch.entries.map((e, i) => {
              const eAccepted = !!e.acceptedAtISO;
              return (
                <View
                  key={e.id}
                  style={[
                    styles.recipientRow,
                    { borderBottomColor: t.div, borderBottomWidth: i === batch.entries.length - 1 ? 0 : StyleSheet.hairlineWidth },
                  ]}
                >
                  <View style={[styles.recipientDot, eAccepted
                    ? { backgroundColor: ACCT, borderColor: ACCT }
                    : { backgroundColor: "transparent", borderColor: t.ts },
                  ]} />
                  <Text style={[styles.recipientName, { color: t.tp }]} numberOfLines={1}>{nameFor(e.clientId)}</Text>
                  <Text style={[styles.recipientStatus, { color: eAccepted ? ACCT : t.ts }]}>
                    {eAccepted ? `Accepted · ${fmtAgo(e.acceptedAtISO!)}` : "Pending"}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={styles.sharedActionRow}>
            <BounceButton style={{ flex: 2 }} onPress={onView} accessibilityLabel={`View ${batch.programName}`}>
              <View style={[styles.sharedActionBtnInner, { backgroundColor: t.ctrl }]}>
                <Text style={[styles.reviewBtnText, { color: t.tp }]}>View Program</Text>
              </View>
            </BounceButton>
            <BounceButton style={{ flex: 1 }} onPress={onRemove} accessibilityLabel={`Remove ${batch.programName}`}>
              <View style={[styles.sharedActionBtnInner, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
                <TrashIcon size={16} color="#fff" />
                <Text style={[styles.deleteBtnText, { color: "#fff" }]}>Remove</Text>
              </View>
            </BounceButton>
          </View>
        </ExpandReveal>
        <View style={styles.chevronRow}>
          <ChevronToggle expanded={open} color={t.ts} upDown />
        </View>
      </Pressable>
    </NeuCard>
  );
}

/** One program someone sent for review, in "Programs Received". Same structure
 *  and the same reveal as SentCard — the two sit in one column and open the
 *  same way. */
function ReceivedCard({ review, open, isDark, from, onToggle, onOpen, onRemove }: {
  review: SentProgram;
  open: boolean;
  isDark: boolean;
  /** The group it came from, or that it's a direct request. */
  from: string;
  onToggle: () => void;
  onOpen: () => void;
  /** Take it off this list. For a group review that clears the group's queue
   *  for every coach; for a 1:1 one it hides it from mine. The caller decides. */
  onRemove: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reveal = useReveal();
  useEffect(() => { reveal.setOpen(open); }, [open, reveal]);

  const returned = review.status === "returned";

  return (
    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
      <Pressable
        onPress={onToggle}
        style={styles.reviewInner}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${review.programName}, ${returned ? "returned" : "awaiting review"}, ${open ? "collapse" : "expand"}`}
      >
        <View style={styles.reviewTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.reviewName, { color: t.tp }]} numberOfLines={1}>{review.programName}</Text>
            <Text style={[styles.reviewMeta, { color: t.ts }]} numberOfLines={1}>
              {from} · Sent {fmtAgo(review.sentAtISO)}
            </Text>
          </View>
          <View style={[styles.statusPill, returned
            ? { backgroundColor: `${ACCT}22` }
            : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
          ]}>
            <Text style={[styles.statusText, { color: returned ? ACCT : t.ts }]}>
              {returned ? "Returned" : "Awaiting review"}
            </Text>
          </View>
        </View>
        <CycleStrip cycle={review.programSnapshot?.cyclePattern ?? []} isDark={isDark} />
        {/* The same pair as the sent cards: the white action and the red
            Remove. It was a raised neumorphic card sitting inside a raised
            card, the one button in the column in the old style. */}
        <ExpandReveal progress={reveal.progress} fade={reveal.fade} open={open} bleed={REVEAL_BLEED} contentStyle={styles.sharedActionRow}>
          <BounceButton style={{ flex: 2 }} onPress={onOpen} accessibilityLabel={returned ? `View your review of ${review.programName}` : `Edit and send back ${review.programName}`}>
            <View style={[styles.sharedActionBtnInner, { backgroundColor: t.ctrl }]}>
              <Text style={[styles.reviewBtnText, { color: t.tp }]}>
                {returned ? "View Review" : "Edit & Send Back"}
              </Text>
            </View>
          </BounceButton>
          <BounceButton style={{ flex: 1 }} onPress={onRemove} accessibilityLabel={`Remove ${review.programName}`}>
            <View style={[styles.sharedActionBtnInner, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
              <TrashIcon size={16} color="#fff" />
              <Text style={[styles.reviewBtnText, { color: "#fff" }]}>Remove</Text>
            </View>
          </BounceButton>
        </ExpandReveal>
        <View style={styles.chevronRow}>
          <ChevronToggle expanded={open} color={t.ts} upDown />
        </View>
      </Pressable>
    </NeuCard>
  );
}

export default function PTHome() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unread: unreadMessages, refresh: refreshUnread } = useUnreadMessages();

  const [clients, setClients] = useState<Client[]>([]);
  // "None" is only true once we've looked. Both empty states ("No clients yet",
  // the groups explainer) drew during the load, to trainers who have clients.
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  const [reviews, setReviews] = useState<SentProgram[]>([]);
  // Open reviews posted to a group I coach. Same shape, different route in:
  // they're addressed to the group's owner, so they reach me through the group
  // policy rather than through my own inbox.
  const [groupReviews, setGroupReviews] = useState<SentProgram[]>([]);
  const [activeProgramByClient, setActiveProgramByClient] = useState<Record<string, string>>({});
  const [sharedOut, setSharedOut] = useState<SharedProgram[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  // Groups another trainer has added me to and I haven't answered yet.
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const [groupMemberships, setGroupMemberships] = useState<Record<string, string[]>>({});
  /** groupId → unread messages in its thread, one half of a group's badge. */
  const [unreadByGroup, setUnreadByGroup] = useState<Record<string, number>>({});
  /** Mine, for "is this share addressed to me". Null until the load resolves. */
  const [myUid, setMyUid] = useState<string | null>(null);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  /** Starred PEOPLE, oldest star first. Set from a client's own page (its ⋯
   *  menu) or a group roster; this list only reads it. */
  const [favouriteMembers, setFavouriteMembers] = useState<Set<string>>(new Set());
  const [kbHeight, setKbHeight] = useState(0);
  // Live-ish presence for connected clients + the Connect button badge count.
  // Disconnecting a real connection lives on the Connect screen (app/connect.tsx).
  const { presenceById, pendingIncoming } = useConnectionPresence();

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [pendingProgram, setPendingProgram] = useState<SavedProgram | null>(null);
  const [expandedShared, setExpandedShared] = useState<Set<string>>(new Set());
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());
  const [collapsedSharedSection, setCollapsedSharedSection] = useState(false);
  const [collapsedReviewsSection, setCollapsedReviewsSection] = useState(false);
  const [collapsedClientsSection, setCollapsedClientsSection] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleSharedSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedSharedSection(v => !v);
  }, []);
  const toggleReviewsSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedReviewsSection(v => !v);
  }, []);
  const toggleClientsSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedClientsSection(v => !v);
  }, []);
  const toggleSearch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Closing: clear the query and drop the keyboard in the same tap, so the X
    // removes the search row and dismisses the keyboard together.
    if (searchOpen) {
      setSearch("");
      Keyboard.dismiss();
    }
    setSearchOpen(v => !v);
  }, [searchOpen]);

  const toggleShared = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedShared(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleReview = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedReviews(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /**
   * Everything this page shows, in one pass.
   *
   * Driven by two things: arriving at the page, and pulling it down. The caller
   * owns the `cancelled` flag, because a focus load has to stop writing state
   * when you navigate away mid-flight, while a pull-to-refresh runs to
   * completion — you're looking right at it.
   */
  const loadAll = useCallback(async (isCancelled: () => boolean) => {
      try {
        const seeded = await seedMockClientsIfNeeded();
        const fresh = seeded.length > 0 ? seeded : await loadClients();

        // Live connections joined with the local roster, bucketed by the
        // counterpart's account type — a connected TRAINER belongs on the My
        // Trainers page, not in here. Blocked ids and stale local snapshots of
        // severed connections are filtered inside the resolver; offline it
        // degrades to the local roster.
        //
        // Resolved FIRST and shown as soon as it lands. The client list used to
        // wait for every load below — sent programs, three group queries, shares,
        // each client's data — run one after another, and drew "No clients yet"
        // for the whole of that.
        const merged = (await resolveTrainerRoster()).clients;
        if (!isCancelled()) { setClients(merged); setClientsLoaded(true); }

        const progs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
        const sent = await loadSentPrograms();
        const fromGroups = await loadMyGroupReviews();

        // Groups + their rosters (two queries total, not one per group), so the
        // send flow can offer "everyone in this group" without a second load.
        let groupList: Group[] = [];
        let memberships: Record<string, string[]> = {};
        let favIds = new Set<string>();
        let invites: GroupInvite[] = [];
        let unreadByGroup: Record<string, number> = {};
        try {
          favIds = await loadFavouriteGroupIds();
          const favPeople = await loadFavouriteMemberIds();
          if (!isCancelled()) setFavouriteMembers(favPeople);
          const uid = await getMyUid();
          if (!isCancelled()) setMyUid(uid);
          if (uid) {
            // A trainer gets invited to other trainers' groups the same way a gym
            // user does, so the invite list belongs on both hubs.
            //
            // loadGroupRows rather than fetchMyGroups: it's the same groups with
            // each thread's unread count worked out, which is half of what the
            // badge on a group card counts.
            const [rows, ms, inv] = await Promise.all([
              loadGroupRows(),
              fetchAllGroupMemberships(uid),
              fetchMyGroupInvites(),
            ]);
            // Starred groups pinned above the rest, newest-first within each half.
            groupList = sortByFavourite(rows.map(r => r.group), favIds);
            unreadByGroup = Object.fromEntries(rows.map(r => [r.group.id, r.unreadCount]));
            memberships = ms;
            invites = inv;
          }
        } catch (e) {
          if (__DEV__) console.warn("[avenas] load groups", e);
        }
        // Groups show as soon as they're known too, rather than after shares.
        if (!isCancelled()) {
          setGroups(groupList);
          setGroupMemberships(memberships);
          setFavourites(favIds);
          setGroupInvites(invites);
          setUnreadByGroup(unreadByGroup);
          setGroupsLoaded(true);
        }

        await migrateBroadcastShares(fresh);
        await migrateCoachReceivedShares();
        const shared = await loadSharedPrograms();
        const activeMap: Record<string, string> = {};
        await Promise.all(merged.map(async c => {
          const data = await loadClientData(c.id);
          const active = data.programs.find(p => p.status === "active");
          if (active) activeMap[c.id] = active.name;
        }));
        if (!isCancelled()) {
          setMyPrograms(Array.isArray(progs) ? progs : []);
          setReviews(sent);
          setGroupReviews(fromGroups);
          setSharedOut(shared);
          setActiveProgramByClient(activeMap);
        }
      } catch (err) {
        if (__DEV__) console.warn("[avenas] load trainer hub", err);
      } finally {
        // Settle both even on failure, so a thrown load leaves an honest empty
        // state rather than a blank page. Harmless when already true.
        if (!isCancelled()) { setClientsLoaded(true); setGroupsLoaded(true); }
      }
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void loadAll(() => cancelled);
    return () => { cancelled = true; };
  }, [loadAll]));

  /**
   * Pull down to re-read everything: new messages, programs a client sent back,
   * a review someone posted to a group. The page already refreshes when you
   * arrive, but a trainer sitting on it waiting for a reply had no way to ask
   * again short of leaving and coming back.
   *
   * It runs to completion rather than taking a cancel flag — you're holding the
   * page open, so there's nothing to cancel — and always clears the spinner,
   * since `loadAll` swallows its own failures.
   */
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // The Messages badge too: it normally recounts on focus, which a pull
    // isn't, so without this the one number you pulled for wouldn't move.
    await Promise.all([loadAll(() => false), refreshUnread()]);
    setRefreshing(false);
  }, [loadAll, refreshUnread]);

  // Starred clients pinned on top, oldest star first, then the roster's own
  // order — the same rule the group roster and the groups list follow, off the
  // same account-wide list, so someone starred on their client page is pinned
  // in every group you share with them too. Sorted after the search filter, so
  // a search result list is pinned the same way the full one is.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q ? clients.filter(c => c.name.toLowerCase().includes(q)) : clients;
    return sortByFavourite(matched, favouriteMembers);
  }, [clients, search, favouriteMembers]);

  const handleAddClient = useCallback(async (name: string, note: string) => {
    const newClient: Client = {
      id: `client_${Date.now()}`,
      name,
      initials: makeInitials(name),
      note: note || undefined,
      lastActiveISO: new Date().toISOString(),
      streak: 0,
    };
    // Persist against the LOCAL roster only. `clients` in state is the resolved
    // view (local + live connections), and writing that back would bake
    // connection snapshots into CLIENTS_KEY, where they'd outlive the
    // connection itself.
    const local = await loadClients();
    await saveClients([newClient, ...local]);
    setClients(prev => [newClient, ...prev]);
  }, []);

  const openNewGroup = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate("/trainer/group-edit");
  }, [router]);

  const openGroup = useCallback((g: Group) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/trainer/group/[id]", params: { id: g.id, name: g.name } });
  }, [router]);

  /** Re-read rather than move the invite across: the group only becomes
   *  readable once the RPC returns, so an optimistic card could open to
   *  nothing. Same reasoning as the gym-user hub. */
  const handleAcceptInvite = useCallback(async (invite: GroupInvite) => {
    try {
      await acceptGroupInvite(invite.groupId);
    } catch (e) {
      Alert.alert("Couldn't join group", e instanceof Error ? e.message : "Check your connection and try again.");
      return;
    }
    // Same read as the initial load, so a group joined from an invite arrives
    // with its badge rather than an empty one until the next focus.
    const [rows, inv] = await Promise.all([loadGroupRows(), fetchMyGroupInvites()]);
    setGroups(sortByFavourite(rows.map(r => r.group), favourites));
    setUnreadByGroup(Object.fromEntries(rows.map(r => [r.group.id, r.unreadCount])));
    setGroupInvites(inv);
  }, [favourites]);

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
              Alert.alert("Couldn't decline", e instanceof Error ? e.message : "Check your connection and try again.");
              return;
            }
            setGroupInvites(prev => prev.filter(i => i.groupId !== invite.groupId));
          },
        },
      ],
    );
  }, []);

  // Group shortcuts for the recipient picker: ticking one ticks its members, and
  // the send still goes out per-person through the existing share path.
  const recipientGroups = useMemo(
    () => groups.map(g => ({ id: g.id, name: g.name, memberIds: groupMemberships[g.id] ?? [], photoUri: g.photoUri })),
    [groups, groupMemberships],
  );

  /** "Programs Received": the 1:1 reviews addressed to me and the open ones
   *  from groups I coach, as one newest-first list. Which route a review
   *  arrived by is a fact about the database, not about the job it represents —
   *  either way someone is waiting on me to look at their program. */
  const received = useMemo(
    () => [...reviews, ...groupReviews].sort(
      (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
    ),
    [reviews, groupReviews],
  );

  /** The line under a received program's name: which group it came from, or
   *  that it's a direct request. The group name is looked up live, so a rename
   *  carries; a group I've since left falls back rather than dropping the card,
   *  because the work is still mine until it's marked done. */
  const receivedFrom = useCallback(
    (r: SentProgram) => (r.groupId ? groups.find(g => g.id === r.groupId)?.name ?? "A group" : "From a client"),
    [groups],
  );

  /**
   * Take a program off Programs Received. What that means depends on where it
   * came from, and the prompt says which, because the two reach different
   * people:
   *
   *   a GROUP review — cleared from the group's queue, for every coach of the
   *     group (`set_group_review_completed`, coach-only at the database). This
   *     is what Mark Done used to be.
   *   a 1:1 review — hidden from MY list only (dismissReceivedReview).
   *
   * Either way the person who sent it keeps their copy and any feedback, and
   * the prompt warns when it hasn't been sent back yet, since removing it then
   * leaves them waiting on a review nobody will do.
   */
  const handleRemoveReview = useCallback((entry: SentProgram) => {
    const notBack = !entry.returnedAtISO;
    const where = entry.groupId ? "the group's review list" : "your list";
    Alert.alert(
      "Remove Program",
      `Remove "${entry.programName}" from ${where}?${notBack ? " You haven't sent it back yet, so they'll still be waiting on a review." : " They keep the feedback you sent back."}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              if (entry.groupId) await setGroupReviewDone(entry.id, true);
              else await dismissReceivedReview(entry.id);
            } catch (e) {
              Alert.alert("Couldn't remove it", e instanceof Error ? e.message : "Check your internet and try again.");
              return;
            }
            if (entry.groupId) setGroupReviews(prev => prev.filter(r => r.id !== entry.id));
            else setReviews(prev => prev.filter(r => r.id !== entry.id));
          },
        },
      ],
    );
  }, []);

  /** Open a review. A group one has to carry its groupId: the review screen
   *  looks a direct review up in my own inbox, where a group's row — addressed
   *  to the group's owner — isn't. */
  const openReview = useCallback((r: SentProgram) => {
    router.navigate({
      pathname: "/trainer/review/[id]",
      params: r.groupId ? { id: r.id, groupId: r.groupId } : { id: r.id },
    });
  }, [router]);

  /** groupId → everything in that group waiting on me: unread messages, a
   *  program shared with me I haven't accepted, a review I could pick up. */
  const groupAlerts = useMemo(
    () => groupAlertCounts({ unreadByGroup, shares: sharedOut, reviews: groupReviews, myUid }),
    [unreadByGroup, sharedOut, groupReviews, myUid],
  );

  const batches = useMemo(() => {
    const byKey = new Map<string, SharedProgram[]>();
    for (const s of sharedOut) {
      // Skip programs a coach sent ME — those belong on the My Coaches page,
      // not in this trainer's "Programs Sent" list.
      if (s.receivedFromCoachId) continue;
      const k = batchKeyOf(s);
      const arr = byKey.get(k);
      if (arr) arr.push(s);
      else byKey.set(k, [s]);
    }
    return Array.from(byKey.entries()).map(([key, entries]) => {
      const head = entries[0];
      const acceptedCount = entries.filter(e => !!e.acceptedAtISO).length;
      return {
        key,
        programId: head.programId,
        programName: head.programName,
        sentAtISO: head.sentAtISO,
        programSnapshot: head.programSnapshot,
        // Every entry in a batch came from the same send, so the head's group
        // is the batch's group. Undefined for a direct send.
        groupId: head.groupId,
        entries,
        acceptedCount,
        total: entries.length,
        allAccepted: entries.length > 0 && acceptedCount === entries.length,
      };
    });
  }, [sharedOut]);

  const handleUnshareBatch = useCallback((batch: typeof batches[number]) => {
    const prompt = removeShareConfirm({
      programName: batch.programName,
      recipients: batch.groupId
        ? `${groups.find(g => g.id === batch.groupId)?.name ?? "this group"}`
        : `${batch.total} client${batch.total === 1 ? "" : "s"}`,
      total: batch.total,
      accepted: batch.acceptedCount,
    });
    Alert.alert(
      prompt.title,
      prompt.body,
      [
        { text: prompt.cancel, style: "cancel" },
        {
          text: prompt.confirm,
          style: "destructive",
          onPress: async () => {
            await removeSharedProgramBatch(batch.key);
            setSharedOut(prev => prev.filter(s => batchKeyOf(s) !== batch.key));
          },
        },
      ]
    );
  }, [groups]);

  const handleProgramPicked = useCallback((program: SavedProgram) => {
    if (clients.length === 0) {
      Alert.alert("No clients", "Add a client before sending a program.");
      return;
    }
    setPendingProgram(program);
  }, [clients]);

  const handleConfirmRecipients = useCallback(async (recipients: string[] | "all") => {
    if (!pendingProgram) return;
    const now = new Date().toISOString();
    const base = `share_${Date.now()}`;
    const targets = recipients === "all" ? clients.map(c => c.id) : recipients;
    if (targets.length === 0) {
      Alert.alert("No recipients", "Add a client before sending a program.");
      return;
    }
    const entries: SharedProgram[] = targets.map((cid, i) => ({
      id: `${base}_${i}`,
      clientId: cid,
      programId: pendingProgram.id,
      programName: pendingProgram.name,
      sentAtISO: now,
      programSnapshot: pendingProgram,
    }));
    try {
      await appendSharedPrograms(entries);
    } catch (e) {
      // Real-account sends go through the server and genuinely fail offline —
      // don't pretend it worked.
      Alert.alert("Couldn't send program", e instanceof Error ? e.message : "Check your internet and try again.");
      return;
    }
    setSharedOut(prev => [...entries, ...prev]);
    Alert.alert("Program Sent", `"${pendingProgram.name}" was sent to ${targets.length} client${targets.length === 1 ? "" : "s"}.`);
    setPendingProgram(null);
  }, [pendingProgram, clients]);

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
        // Without this the keyboard eats the first tap on any button (incl. the
        // search-close X) while the search field is focused, forcing a double tap.
        keyboardShouldPersistTaps="handled"
        // +14 top: exactly the floating-chrome line pushed screens use
        // (my-trainers back/plus sit at insets.top+14). Keep in sync with
        // MyPTHome so both hub views share the same first-row line.
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 140 }}
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
        <View style={styles.coachesRow}>
          <BounceButton
            style={styles.coachesBtnWrap}
            onPress={() => router.navigate("/trainer/coaches")}
            accessibilityLabel="Open my trainers"
          >
            <View style={[styles.coachesBtn, { backgroundColor: t.ctrl }]}>
              <Ionicons name="person-outline" size={16} color={ACCT} />
              <Text style={[styles.coachesBtnText, { color: t.tp }]}>My Trainers</Text>
            </View>
          </BounceButton>
          <View style={{ flex: 1 }} />
          <BounceButton onPress={() => router.navigate("/trainer/messages")} accessibilityLabel="Open messages">
            <View>
              <View style={[styles.searchBtn, { backgroundColor: t.ctrl }]}>
                <ChatIcon size={18} color={t.tp} />
              </View>
              <UnreadBadge count={unreadMessages} style={styles.msgBadge} />
            </View>
          </BounceButton>
          <BounceButton onPress={() => router.navigate("/connect")} accessibilityLabel="Connect with someone">
            <View>
              <View style={[styles.searchBtn, { backgroundColor: t.ctrl }]}>
                <Ionicons name="add" size={24} color={t.tp} />
              </View>
              <UnreadBadge count={pendingIncoming} style={styles.msgBadge} />
            </View>
          </BounceButton>
        </View>

        <View style={styles.titleRow}>
          <Pressable
            onPress={toggleClientsSection}
            style={styles.clientsHeaderLeft}
            accessibilityRole="button"
            accessibilityLabel={`My Clients, ${clients.length} ${clients.length === 1 ? "client" : "clients"}. Toggle list`}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[styles.title, { color: t.tp }]}>My Clients</Text>
              <View style={[styles.countBadge, { backgroundColor: ACCT }]}>
                <Text style={[styles.countBadgeText, { color: "#fff" }]}>{clients.length}</Text>
              </View>
              <ChevronToggle expanded={!collapsedClientsSection} color={t.ts} />
            </View>
          </Pressable>
          <BounceButton onPress={toggleSearch} accessibilityLabel={searchOpen ? "Close search" : "Search clients"}>
            <View style={[styles.searchBtn, { backgroundColor: t.ctrl }]}>
              <Ionicons name={searchOpen ? "close" : "search"} size={18} color={t.tp} />
            </View>
          </BounceButton>
        </View>

        {searchOpen && (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.searchRow}>
            {/* Same field as the exercise picker's: a filled, fully rounded
                pill on t.ctrl rather than a faint tinted box, so it reads as
                something you type into. */}
            <View style={[styles.search, { backgroundColor: t.ctrl, borderColor: t.div }]}>
              <Ionicons name="search" size={17} color={t.ts} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search clients"
                placeholderTextColor={t.ts}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="never"
                style={[styles.searchInput, { color: t.tp }]}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")} hitSlop={8} accessibilityLabel="Clear search" accessibilityRole="button">
                  <Ionicons name="close-circle" size={19} color={t.ts} />
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        )}

        <BounceButton style={{ marginBottom: 18 }} onPress={() => setSendOpen(true)}>
          <View style={[styles.broadcast, { backgroundColor: ACCT, shadowColor: ACCT }]}>
            <SendIcon size={18} color="#fff" />
            <Text style={styles.broadcastText}>Send a Program</Text>
          </View>
        </BounceButton>

        {!clientsLoaded ? null : filtered.length === 0 ? (
          search ? (
            <NeuCard dark={isDark} radius={12}>
              <View style={styles.noMatchRow}>
                <Ionicons name="search-outline" size={15} color={t.ts} />
                <Text style={[styles.noMatchText, { color: t.ts }]}>{`No matches for "${search}"`}</Text>
              </View>
            </NeuCard>
          ) : (
            <NeuCard dark={isDark} radius={20}>
              <View style={styles.emptyInner}>
                <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
                  <PeopleIcon size={28} color={ACCT} />
                </View>
                <Text style={[styles.emptyTitle, { color: t.tp }]}>No clients yet</Text>
                <Text style={[styles.emptyBody, { color: t.ts }]}>Tap the + button to connect with someone by code or QR.</Text>
              </View>
            </NeuCard>
          )
        ) : collapsedClientsSection ? (
          <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
            {filtered.map((c, i) => (
              <TouchableOpacity
                key={c.id}
                onPress={() => router.navigate({ pathname: "/trainer/client/[id]", params: { id: c.id } })}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Open ${c.name}`}
                style={[styles.summaryRow, { borderBottomColor: t.div, borderBottomWidth: i === filtered.length - 1 ? 0 : 1 }]}
              >
                <Avatar
                  uri={c.photoUri}
                  initials={c.initials}
                  size={28}
                  backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                  textColor={ACCT}
                  textStyle={[styles.summaryAvatarText, { color: ACCT }]}
                />
                <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{c.name}</Text>
                {favouriteMembers.has(c.id) && <FavouriteStar size={15} />}
                <Ionicons name="chevron-forward" size={16} color={t.ts} />
              </TouchableOpacity>
            ))}
          </NeuCard>
        ) : (
          filtered.map(c => (
            <ClientCard
              key={c.id}
              // Live presence overrides the load-time snapshot; local/mock
              // entries aren't in the map and keep their stored value.
              client={presenceById.has(c.id) ? { ...c, lastActiveISO: presenceById.get(c.id) ?? undefined } : c}
              activeProgramName={activeProgramByClient[c.id]}
              // Marks the pinned ones. Not a control: starring is done on the
              // client's own page, from its ⋯ menu.
              isFavourite={favouriteMembers.has(c.id)}
              onPress={() => router.navigate({ pathname: "/trainer/client/[id]", params: { id: c.id } })}
            />
          ))
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0, flex: 1 }]}>Groups</Text>
          <BounceButton onPress={openNewGroup} accessibilityLabel="Create a group">
            <View style={[styles.groupAddBtn, { backgroundColor: t.ctrl }]}>
              <Ionicons name="add" size={20} color={t.tp} />
            </View>
          </BounceButton>
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
          groupsLoaded && groupInvites.length === 0 ? (
            <NeuCard dark={isDark} radius={16}>
              <Text style={[styles.groupEmpty, { color: t.ts }]}>
                Put clients in a group to message them together and send one program to all of them.
              </Text>
            </NeuCard>
          ) : null
        ) : (
          /* One card per group, not one card of rows: a group is a place you
             go, the same as a client, and the client list above it is already
             a stack of separate cards. The row content is unchanged —
             SUMMARY_ROW's padding is CARD_PAD on every side, so a row that
             becomes a whole card's body still sits where a card title does. */
          groups.map(g => (
            <BounceButton
              key={g.id}
              style={{ marginBottom: 10 }}
              onPress={() => openGroup(g)}
              accessibilityRole="button"
              accessibilityLabel={`Open group ${g.name}`}
            >
              <NeuCard dark={isDark} radius={16}>
                <View style={styles.summaryRow}>
                  <GroupAvatar uri={g.photoUri} size={30} isDark={isDark} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.groupNameRow}>
                      <Text style={[styles.groupName, { color: t.tp }]} numberOfLines={1}>{g.name}</Text>
                      {/* Beside the NAME, not out at the right edge: it's a fact
                          about this group, so it reads as part of the title
                          rather than as another control in the row of them. It
                          counts unread messages, a program shared with me and a
                          review to pick up — the same red pill the Messages
                          button wears, for the same reason. */}
                      <UnreadBadge count={groupAlerts[g.id] ?? 0} />
                    </View>
                    <Text style={[styles.groupMeta, { color: t.ts }]}>
                      {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                    </Text>
                  </View>
                  {/* Display only, and only once starred. Favouriting is done
                      INSIDE the group, from its options menu: a star on every
                      card put an empty control on a row whose whole job is to
                      be tapped once, to open the group. */}
                  {favourites.has(g.id) && <FavouriteStar size={16} />}
                  <Ionicons name="chevron-forward" size={16} color={t.ts} />
                </View>
              </NeuCard>
            </BounceButton>
          ))
        )}

        {batches.length > 0 && (
          <>
            <Pressable onPress={toggleSharedSection} style={styles.sectionHeaderRow} accessibilityRole="button">
              <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Programs Sent</Text>
              <ChevronToggle expanded={!collapsedSharedSection} color={t.ts} />
            </Pressable>
            {collapsedSharedSection ? (
              <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                {batches.map((b, i) => {
                  const pillLabel = b.allAccepted ? "Accepted" : `${b.acceptedCount}/${b.total} accepted`;
                  return (
                    <TouchableOpacity
                      key={b.key}
                      onPress={() => router.navigate({ pathname: "/program-view", params: { sharedId: b.entries[0].id } })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${b.programName}`}
                      style={[
                        styles.summaryRow,
                        { borderBottomColor: t.div, borderBottomWidth: i === batches.length - 1 ? 0 : 1 },
                      ]}
                    >
                      <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{b.programName}</Text>
                      <View style={[styles.statusPill, b.allAccepted
                        ? { backgroundColor: `${ACCT}22` }
                        : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
                      ]}>
                        <Text style={[styles.statusText, { color: b.allAccepted ? ACCT : t.ts }]}>
                          {pillLabel}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </NeuCard>
            ) : batches.map(b => (
              <SentCard
                key={b.key}
                batch={b}
                open={expandedShared.has(b.key)}
                isDark={isDark}
                sentTo={b.groupId
                  ? `${groups.find(g => g.id === b.groupId)?.name ?? "a group"} · ${b.total} member${b.total === 1 ? "" : "s"}`
                  : `${b.total} client${b.total === 1 ? "" : "s"}`}
                nameFor={(clientId) => clients.find(c => c.id === clientId)?.name ?? "Removed client"}
                onToggle={() => toggleShared(b.key)}
                onView={() => router.navigate({ pathname: "/program-view", params: { sharedId: b.entries[0].id } })}
                onRemove={() => handleUnshareBatch(b)}
              />
            ))}
          </>
        )}

        {received.length > 0 && (
          <>
            <Pressable onPress={toggleReviewsSection} style={styles.sectionHeaderRow} accessibilityRole="button">
              <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Programs Received</Text>
              <ChevronToggle expanded={!collapsedReviewsSection} color={t.ts} />
            </Pressable>
            {collapsedReviewsSection ? (
              <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                {received.map((r, i) => {
                  const returned = r.status === "returned";
                  return (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => openReview(r)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Open review for ${r.programName}`}
                      style={[
                        styles.summaryRow,
                        { borderBottomColor: t.div, borderBottomWidth: i === received.length - 1 ? 0 : 1 },
                      ]}
                    >
                      <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{r.programName}</Text>
                      <View style={[styles.statusPill, returned
                        ? { backgroundColor: `${ACCT}22` }
                        : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
                      ]}>
                        <Text style={[styles.statusText, { color: returned ? ACCT : t.ts }]}>
                          {returned ? "Returned" : "Awaiting review"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </NeuCard>
            ) : received.map(r => (
              <ReceivedCard
                key={r.id}
                review={r}
                open={expandedReviews.has(r.id)}
                isDark={isDark}
                from={receivedFrom(r)}
                onToggle={() => toggleReview(r.id)}
                onOpen={() => openReview(r)}
                onRemove={() => handleRemoveReview(r)}
              />
            ))}
          </>
        )}
      </ScrollView>

      <AddClientSheet visible={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleAddClient} />
      <ProgramPickerSheet
        visible={sendOpen}
        title="Send a Program"
        subtitle="Pick a program, then choose who receives it."
        programs={myPrograms}
        onPick={handleProgramPicked}
        onClose={() => setSendOpen(false)}
      />
      <RecipientPickerSheet
        visible={pendingProgram !== null}
        programName={pendingProgram?.name ?? ""}
        clients={clients}
        groups={recipientGroups}
        onConfirm={handleConfirmRecipients}
        onClose={() => setPendingProgram(null)}
      />

      {kbHeight > 0 && Platform.OS === "ios" && (
        <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, zIndex: 999 }}>
          <TouchableOpacity
            onPress={() => Keyboard.dismiss()}
            activeOpacity={0.75}
            style={[styles.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}
            accessibilityLabel="Dismiss keyboard"
            accessibilityRole="button"
          >
            <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        </View>
      )}
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient:  { position: "absolute", left: 0, right: 0, zIndex: 5 },
  coachesRow:    { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  coachesBtnWrap: { alignSelf: "center" },
  coachesBtn:   { flexDirection: "row", alignItems: "center", gap: 8, height: 40, borderRadius: 20, paddingHorizontal: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  coachesBtnText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  titleRow:     { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  clientsHeaderLeft: { flex: 1, flexDirection: "column" },
  title:        { fontFamily: FontFamily.bold, fontSize: 28 },
  countBadge:   { minWidth: 26, height: 24, borderRadius: 12, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  countBadgeText:{ fontFamily: FontFamily.bold, fontSize: 13, letterSpacing: 0.2 },
  addBtn:       { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  manageBtn:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  searchBtn:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  msgBadge:     { position: "absolute", top: -5, right: -5 },
  searchRow:    { marginBottom: 14 },
  search:       { flexDirection: "row", alignItems: "center", gap: 9, height: 42, paddingHorizontal: 14, borderRadius: PILL_RADIUS, borderWidth: 1, ...PILL_SHADOW },
  searchInput:  { flex: 1, fontFamily: FontFamily.regular, fontSize: 15, padding: 0 },
  summaryAvatar:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  summaryAvatarText:{ fontFamily: FontFamily.bold, fontSize: 11 },
  broadcast:    { ...pill(), gap: 10, ...pillGlow(ACCT, 0.4) },
  broadcastText:{ fontFamily: FontFamily.bold, fontSize: 15, color: "#fff", letterSpacing: 0.2 },
  emptyInner:   { padding: 28, alignItems: "center", gap: 10 },
  noMatchRow:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  noMatchText:  { fontFamily: FontFamily.regular, fontSize: 13 },
  emptyIcon:    { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 18 },
  sectionHeading:{ fontFamily: FontFamily.bold, fontSize: 18, marginTop: 24, marginBottom: 12 },
  sectionHeaderRow:{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12 },
  summaryRow:    { ...SUMMARY_ROW },
  // Shared with reviewName below: a collapsed section renders the same title as
  // a list row that a card renders as a heading, and the two must land in the
  // same place or the title jumps when the section is toggled.
  summaryName:   { flex: 1, ...CARD_TITLE },
  groupAddBtn:   { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  groupIcon:     { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  // The name and its badge share a line. `flexShrink` on the name (not `flex`)
  // so a long group name truncates and the badge stays put, rather than the
  // name taking the width and pushing the count off the card.
  groupNameRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  groupName:     { flexShrink: 1, ...CARD_TITLE },
  groupMeta:     { fontFamily: FontFamily.regular, fontSize: 11, marginTop: 1 },
  groupEmpty:    { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, padding: 16, textAlign: "center" },
  // No `gap` here: a closed ExpandReveal is a zero-height child, and a gap
  // would reserve space on both sides of it, loosening every collapsed card.
  // The children carry their own top margins instead, and the reveal's lives on
  // its content, which only exists while it's open.
  reviewInner:  { ...CARD_INNER },
  /** The sent card's revealed half: recipient list above the action row. */
  revealBody:   { gap: 10, paddingTop: 12 },
  reviewTop:    { ...CARD_TOP },
  reviewName:   { ...CARD_TITLE },
  reviewMeta:   { ...CARD_META },
  statusPill:   { ...CARD_PILL },
  statusText:   { ...CARD_PILL_TEXT },
  reviewBtnText:{ fontFamily: FontFamily.bold, fontSize: 14 },
  cycleGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 12 },
  cycleChip:    { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:{ fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  kbFloatBtn:   { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
  chevronRow:    { alignItems: "center", paddingTop: 2, marginTop: 10 },
  sharedActionRow:{ flexDirection: "row", gap: 10, paddingTop: 12 },
  // Pills rather than NeuCards: these sit INSIDE an expanded card, and a raised
  // neumorphic button on a raised card reads as two stacked surfaces. The white
  // control surface + soft shadow is the same treatment the rest of the app's
  // secondary actions use, and the delete variant just swaps the fill for DANGER.
  sharedActionBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, minHeight: 38, borderRadius: PILL_RADIUS, ...PILL_SHADOW },
  deleteBtnText:  { fontFamily: FontFamily.bold, fontSize: 14, color: "#E53935", letterSpacing: 0.2 },
  recipientList:  { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, marginTop: 2 },
  recipientRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  recipientDot:   { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  recipientName:  { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
  recipientStatus:{ fontFamily: FontFamily.regular, fontSize: 11 },
});
