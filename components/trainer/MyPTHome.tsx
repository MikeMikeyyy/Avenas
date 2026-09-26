import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { scheduleCloudPush } from "../../lib/syncManager";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import ChevronToggle from "../ChevronToggle";
import ExpandReveal, { useReveal } from "../ExpandReveal";
import ChatIcon from "../icons/ChatIcon";
import UserRoundPlusIcon from "../icons/UserRoundPlusIcon";
import UserRoundIcon from "../icons/UserRoundIcon";
import PeopleIcon from "../icons/PeopleIcon";
import SendIcon from "../icons/SendIcon";
import TrashIcon from "../TrashIcon";
import OfflineBanner from "../OfflineBanner";
import UnreadBadge from "../UnreadBadge";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import ProgramPickerSheet from "./ProgramPickerSheet";
import GroupInviteCard from "./GroupInviteCard";
import GroupAvatar from "./GroupAvatar";
import { acceptGroupInvite, declineGroupInvite, fetchMyGroupInvites, isGroupLimitError } from "../../lib/groups";
import { loadGroupRows } from "../../utils/groupStore";
import { groupAlertCounts } from "../../utils/groupAlerts";
import { GROUP_LIMIT_TITLE, MAX_GROUPS, groupLimitMessage, type GroupInvite } from "../../constants/groups";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, AWAITING_ORANGE, DANGER_BRIGHT } from "../../constants/theme";
import { haloGlow, pill, pillGlow, PILL_RADIUS, PILL_SHADOW } from "../../constants/buttons";
import { CARD_INNER, CARD_META, CARD_PAD, CARD_PILL, CARD_PILL_TEXT, CARD_TITLE, CARD_TOP, REVEAL_BLEED, SUMMARY_ROW } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import {
  acceptSharedProgramBatch,
  appendSentProgram,
  applyReturnedProgram,
  batchKeyOf,
  dismissKeyOf,
  dismissSharedBatch,
  isReturnedDismissed,
  returnedKeyOf,
  sentKeyOf,
  loadSentPrograms,
  removeSentProgram,
  ShareUnavailableError,
  type AssignedPT,
  type SentProgram,
  type SharedProgram,
} from "../../utils/trainerStore";
import { EMPTY_GYM_HUB, fetchGymHub, peekGymHub, saveGymHub, type GymHubData } from "../../utils/trainerHub";
import { hydrateGroupPages } from "../../utils/groupPage";
import Avatar from "../Avatar";
import { getJSON } from "../../utils/storage";
import { isActiveNow, presenceLabel } from "../../utils/presence";
import { PROGRAMS_KEY, type SavedProgram } from "../../constants/programs";
import { alertMessage } from "../../utils/errors";

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** A program's cycle as a wrap of day chips: training days tinted, rest days
 *  quiet. Nothing when the program has no cycle. */
function CycleGrid({ cycle, isDark }: { cycle: string[]; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  if (cycle.length === 0) return null;
  return (
    <View style={styles.cycleGrid}>
      {cycle.map((day, i) => {
        const isTraining = day !== "Rest" && day !== "";
        return (
          <View
            key={i}
            style={[styles.cycleChip, isTraining
              ? { backgroundColor: ACCT + "22", borderColor: ACCT, borderWidth: 1 }
              : { backgroundColor: t.div }]}
          >
            <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>{day || "Rest"}</Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A program card whose actions open on tap.
 *
 * The body is the tap target, the buttons reveal beneath it with the shared
 * ExpandReveal motion (the same open and close as the trainer page's program
 * cards), and a chevron at the foot shows which way it'll go. Every program
 * card on this page uses it, so a received program, a returned review and one
 * you've sent all open the same way. They used to show their buttons all the
 * time, which made a list of three programs a list of nine buttons.
 *
 * Laid out exactly like the trainer hub's cards (PTHome's SentCard): the
 * content is its own gapped column, and the reveal and chevron follow it with
 * explicit spacing, because a closed reveal is a zero-height box and a `gap`
 * around it would reserve space for it anyway. No Reanimated layout animation
 * on any ancestor either — that freezes the UI-thread height tween, which is
 * the whole animation.
 */
function TapToOpenCard({ open, onToggle, isDark, label, actions, children }: {
  open: boolean;
  onToggle: () => void;
  isDark: boolean;
  /** For VoiceOver: what the card is, before "expand"/"collapse". */
  label: string;
  /** The row of buttons, revealed on tap. */
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reveal = useReveal();
  useEffect(() => { reveal.setOpen(open); }, [open, reveal]);

  return (
    <View style={{ marginBottom: 10 }}>
      <NeuCard dark={isDark} radius={16}>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggle(); }}
          style={styles.cardInner}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${label}, ${open ? "collapse" : "expand"}`}
        >
          <View style={styles.cardBody}>{children}</View>
          {/* The glow needs room inside the reveal's clip, which is `overflow:
              hidden` and would slice it off in a straight line. `bleed` gives
              the sides and bottom (constants/cards.ts REVEAL_BLEED); the top
              padding gives the top, and is also the distance from the content.
              It's padding INSIDE the reveal rather than the reveal reaching up
              into the space above (`pullTop`), because that moved the whole
              reveal up as it opened: the buttons rose 12pt into place while
              every other card's unfold downward and stay still. */}
          <ExpandReveal
            progress={reveal.progress}
            fade={reveal.fade}
            open={open}
            bleed={REVEAL_BLEED}
            contentStyle={styles.revealBody}
          >
            {actions}
          </ExpandReveal>
          <View style={styles.chevronRow}>
            <ChevronToggle expanded={open} color={t.ts} upDown />
          </View>
        </Pressable>
      </NeuCard>
    </View>
  );
}

/**
 * A program I sent for review that my trainer has sent BACK, shown among the
 * programs I've received — because that's what it is now: something a trainer
 * has handed me to take on. The line under it says so in plain words, so it
 * can't be mistaken for a new program they wrote.
 *
 * Same card and the same button order as a received program — View, Accept
 * (while the changes haven't been applied), Remove — so the two read as one
 * list. Accept here is "apply the trainer's changes over my program";
 * Remove takes it off this list only, and never undoes applied changes.
 */
function ReturnedReviewCard({ review, fromLabel, isDark, open, onToggle, onView, onAccept, onRemove }: {
  review: SentProgram;
  /** "Your trainer", or the group it went to. */
  fromLabel: string;
  isDark: boolean;
  open: boolean;
  onToggle: () => void;
  onView: () => void;
  onAccept: () => void;
  onRemove: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const applied = !!review.appliedAtISO;
  const cycle = review.programSnapshot?.cyclePattern ?? [];

  return (
    <TapToOpenCard
      open={open}
      onToggle={onToggle}
      isDark={isDark}
      label={`${review.programName}, reviewed by your trainer`}
      actions={
        <View style={styles.actionRow}>
          <BounceButton style={{ flex: 1 }} onPress={onView} accessibilityLabel={`View ${review.programName}`}>
            <View style={[styles.viewBtnInner, { backgroundColor: t.ctrl }]}>
              <Text style={[styles.viewBtnText, { color: t.tp }]}>View</Text>
            </View>
          </BounceButton>
          {!applied && (
            <BounceButton style={{ flex: 1 }} onPress={onAccept} needsConnection accessibilityLabel={`Accept your trainer's changes to ${review.programName}`}>
              <View style={[styles.viewBtnInner, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }]}>
                <Text style={[styles.viewBtnText, { color: "#fff" }]}>Accept</Text>
              </View>
            </BounceButton>
          )}
          <BounceButton onPress={onRemove} accessibilityLabel={`Remove ${review.programName} from this list`}>
            <View style={[styles.viewBtnInner, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
              <TrashIcon size={16} color="#fff" />
              <Text style={[styles.viewBtnText, { color: "#fff" }]}>Remove</Text>
            </View>
          </BounceButton>
        </View>
      }
    >
      <View style={styles.receivedTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{review.programName}</Text>
          <Text style={[styles.itemMeta, { color: t.ts }]} numberOfLines={1}>
            {`Sent back ${fmtAgo(review.returnedAtISO ?? review.sentAtISO).toLowerCase()} · ${fromLabel}`}
          </Text>
        </View>
        {applied ? (
          <View
            style={[styles.acceptBox, { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }]}
            accessibilityLabel="Changes applied"
          >
            <Ionicons name="checkmark" size={14} color="#fff" />
          </View>
        ) : (
          <View style={[styles.statusPill, { backgroundColor: `${ACCT}22` }]}>
            <Text style={[styles.statusText, { color: ACCT }]}>Reviewed</Text>
          </View>
        )}
      </View>
      <CycleGrid cycle={cycle} isDark={isDark} />
      {/* What this is, in the user's terms: their own program, back. */}
      <Text style={[styles.acceptedLine, { color: applied ? ACCT : t.ts }]}>
        {applied ? "You sent this for review · Changes added to your programs" : "You sent this for review · It's back with your trainer's changes"}
      </Text>
      {review.trainerComments ? (
        <View style={[styles.commentBox, { borderTopColor: t.div }]}>
          <Text style={[styles.commentLabel, { color: t.ts }]}>TRAINER COMMENTS</Text>
          <Text style={[styles.commentBody, { color: t.tp }]}>{review.trainerComments}</Text>
        </View>
      ) : null}
    </TapToOpenCard>
  );
}

export default function MyPTHome() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // Loading placeholders sit a shade below a divider in both themes.
  const skeletonFill = isDark ? "rgba(255,255,255,0.08)" : t.div;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unread: unreadMessages, refresh: refreshUnread } = useUnreadMessages();
  // The account this page's data belongs to. Constant for the page's life: the
  // tab remounts it when the account changes (app/(tabs)/trainer-hub.tsx).
  const { userId } = useAuth();
  const owner = userId ?? "";

  /**
   * Everything on this page, as ONE value (utils/trainerHub.ts). It starts on
   * the copy saved last time, so the first frame is the whole page, and a load
   * replaces it in a single render, so a refresh changes the page in place
   * rather than filling it in section by section.
   *
   * Null only before the first load ever finishes (no saved copy yet), and the
   * page keeps that apart from "loaded and empty": `pt` is `undefined` while
   * resolving and `null` once we know there's no trainer. With only null, the
   * page drew "No trainer linked yet" for the half-second before the
   * connections came back, to people who have a trainer, and the program
   * lists' empty states ("No programs received yet") flashed the same way.
   */
  const [hub, setHub] = useState<GymHubData | null>(() => peekGymHub(owner));
  const programsLoaded = hub !== null;
  const pt: AssignedPT | null | undefined = hub ? hub.pt : undefined;
  const {
    received,
    sent,
    dismissedKeys: dismissedKeyList,
    groups,
    groupOwners,
    shares,
    groupReviewsToDo,
    groupInvites,
    myUid,
  } = hub ?? EMPTY_GYM_HUB;
  const dismissedKeys = useMemo(() => new Set(dismissedKeyList), [dismissedKeyList]);
  // Local, and only the program picker reads it, so it's not part of the hub.
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);

  // Whatever the page shows is what it opens on next time, including a change
  // made here (an accepted program, a removed card) that no load has seen yet.
  useEffect(() => {
    if (hub) saveGymHub(owner, hub);
  }, [hub, owner]);

  // Each group's saved page, read off the device now so tapping a group opens
  // on it rather than on a spinner (utils/groupPage.ts). Device reads only.
  const groupIdsKey = groups.map(g => g.group.id).join(",");
  useEffect(() => {
    if (groupIdsKey) void hydrateGroupPages(owner, groupIdsKey.split(","));
  }, [owner, groupIdsKey]);

  // Live "last active" for the connected trainer + the manage-button badge
  // count. Disconnecting a real connection lives on the Connect screen
  // (app/connect.tsx). A local/mock trainer isn't in the map → no presence row.
  const { presenceById, pendingIncoming } = useConnectionPresence();
  /** Which program cards are open, by row id. One set for all three lists: the
   *  ids are share rows, so a card I sent and one I received never collide. */
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [collapsedFromTrainer, setCollapsedFromTrainer] = useState(false);
  const [collapsedSentToTrainer, setCollapsedSentToTrainer] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const toggleFromTrainer = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedFromTrainer(v => !v);
  }, []);
  const toggleSentToTrainer = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedSentToTrainer(v => !v);
  }, []);
  const toggleGroups = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedGroups(v => !v);
  }, []);


  // The card plays its own haptic, so this is only the state.
  const toggleCard = useCallback((id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /**
   * Arriving at the page brings it up to date: behind the saved copy it opened
   * on, and in one render when the load lands. If the startup prefetch is still
   * running, this joins it rather than asking the server twice. The cancel flag
   * stops a load that outlives the visit from writing to the page; its result
   * is saved regardless, so the next open starts from it.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void fetchGymHub(owner).then(next => { if (!cancelled) setHub(next); });
    void getJSON<SavedProgram[]>(PROGRAMS_KEY, []).then(progs => {
      if (!cancelled) setMyPrograms(Array.isArray(progs) ? progs : []);
    });
    return () => { cancelled = true; };
  }, [owner]));

  /** Pull down to re-read: new messages, a program your trainer sent back, a
   *  group invite. Always its OWN read (`fresh`), never the arrival load or the
   *  startup prefetch, so what you pulled for is what the server says now. Runs
   *  to completion, and always clears the spinner because `fetchGymHub` never
   *  rejects. */
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // The Messages badge too: it normally recounts on focus, which a pull
    // isn't, so without this the one number you pulled for wouldn't move.
    const [next, progs] = await Promise.all([
      fetchGymHub(owner, { fresh: true }),
      getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
      refreshUnread(),
    ]);
    setHub(next);
    setMyPrograms(Array.isArray(progs) ? progs : []);
    setRefreshing(false);
  }, [owner, refreshUnread]);

  const openChat = () => {
    if (!pt) return;
    router.navigate({ pathname: "/trainer/chat/[id]", params: { id: pt.id, name: pt.name, initials: pt.initials } });
  };



  /** Join a group I was invited to. The group only becomes readable once the
   *  RPC returns, so the list is re-read rather than moved across optimistically
   *  — a failed accept must not leave a group card that opens to nothing. */
  /** groupId → what's waiting on me in it. Same helper the trainer hub uses, so
   *  a badge means the same thing on both sides. */
  const groupAlerts = useMemo(
    () => groupAlertCounts({
      unreadByGroup: Object.fromEntries(groups.map(g => [g.group.id, g.unreadCount])),
      shares,
      // Review requests waiting on me, in groups where the owner has made me a
      // trainer. A gym user can hold that role, and then picks reviews up like
      // any trainer; it was hard-coded empty, so their group's badge never
      // counted a review waiting on them. Empty for a plain member: the query
      // behind it only returns reviews I coach, never ones I sent.
      reviews: groupReviewsToDo,
      myUid,
    }),
    [groups, shares, groupReviewsToDo, myUid],
  );

  // The group limit is checked against this list before anything is sent; the
  // database refuses a 6th too (0035), which covers a list that's out of date.
  // At the limit the invite stays where it is, to accept after leaving a group.
  const atGroupLimit = groups.length >= MAX_GROUPS;
  const ownsAGroup = groups.some(r => r.group.isOwner);
  const handleAcceptInvite = useCallback(async (invite: GroupInvite) => {
    if (atGroupLimit) {
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
    const [groupRows, invites] = await Promise.all([loadGroupRows(), fetchMyGroupInvites()]);
    setHub(h => h && { ...h, groups: groupRows, groupInvites: invites });
  }, [atGroupLimit, ownsAGroup]);

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

  // Accepts in flight, by card: a second tap while the first is still on its
  // way would otherwise say "added" twice (the store adds it once either way).
  const accepting = useRef(new Set<string>());

  const handleApplyReturned = useCallback(async (entry: SentProgram) => {
    if (entry.appliedAtISO || accepting.current.has(entry.id)) return;
    accepting.current.add(entry.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await applyReturnedProgram(entry.id);
    } catch (e) {
      Alert.alert("Couldn't update your program", alertMessage(e, "Check your connection and try again."));
      return;
    } finally {
      accepting.current.delete(entry.id);
    }
    scheduleCloudPush(); // applyReturnedProgram wrote @avenas/programs (a synced key)
    const appliedAt = new Date().toISOString();
    setHub(h => h && { ...h, sent: h.sent.map(s => s.id === entry.id ? { ...s, appliedAtISO: appliedAt } : s) });
    Alert.alert("Program Updated", `"${entry.programName}" in your programs was updated with your trainer's edits.`);
  }, []);

  /**
   * Take a program someone sent me off this list.
   *
   * It's a hide on my side only (see DISMISSED_SHARES_KEY): an accepted copy
   * stays in My Programs, and the trainer still sees it as sent. The prompt
   * says which of those applies, because the two cases lose different things —
   * nothing at all once it's accepted, the chance to accept it if it isn't.
   */
  const handleRemoveReceived = useCallback((entry: SharedProgram) => {
    const accepted = !!entry.acceptedAtISO;
    Alert.alert(
      "Remove Program",
      accepted
        ? `Remove "${entry.programName}" from this list? It stays in your programs.`
        : `Remove "${entry.programName}" without accepting it? It comes back if your trainer sends it again or updates it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const key = batchKeyOf(entry);
            // Hides this version: a Send Update brings it back (dismissKeyOf).
            await dismissSharedBatch(dismissKeyOf(entry));
            // The badge counts from `shares` too, so a removed program stops
            // counting as waiting on me straight away.
            setHub(h => h && {
              ...h,
              received: h.received.filter(r => batchKeyOf(r) !== key),
              shares: h.shares.filter(r => batchKeyOf(r) !== key),
            });
          },
        },
      ],
    );
  }, []);

  // A review I sent splits across the two sections by whether it's come back:
  // still waiting → "Sent to Trainer"; returned → "From Your Trainer", among
  // the programs I've received, because it's now something a trainer has
  // handed me. One place each, never both.
  const pendingSent = useMemo(() => sent.filter(s => s.status !== "returned"), [sent]);
  const returnedToMe = useMemo(
    () => sent.filter(s => s.status === "returned" && !isReturnedDismissed(s, dismissedKeys)),
    [sent, dismissedKeys],
  );

  /** Take a returned review off "From Your Trainer". A hide on this device, like
   *  removing a received program. It never undoes applied changes, and if they
   *  weren't applied your program just stays as it was. It hides THIS version
   *  (returnedKeyOf): if the trainer sends an update, it's back with Accept. */
  const handleRemoveReturned = useCallback((entry: SentProgram) => {
    const applied = !!entry.appliedAtISO;
    Alert.alert(
      "Remove Program",
      applied
        ? `Remove "${entry.programName}" from this list? The changes stay in your programs.`
        : `Remove "${entry.programName}" without accepting the changes? Your program stays as it was.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const key = returnedKeyOf(entry);
            await dismissSharedBatch(key);
            setHub(h => h && (h.dismissedKeys.includes(key) ? h : { ...h, dismissedKeys: [...h.dismissedKeys, key] }));
          },
        },
      ],
    );
  }, []);

  /** Where a returned review came from, for the line under its name. */
  const returnedFrom = useCallback((s: SentProgram) => (
    s.groupId ? (groups.find(g => g.group.id === s.groupId)?.group.name ?? "A group") : (pt?.name ?? "Your trainer")
  ), [groups, pt]);

  // Worded to match the button that opens it ("Remove"), and saying plainly
  // that your own copy is safe, since that's the worry a red button raises.
  const handleUnsendProgram = useCallback((entry: SentProgram) => {
    Alert.alert(
      "Remove Program",
      `Remove "${entry.programName}" from your trainer? They won't see it any more. Your own copy stays in your programs.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeSentProgram(entry.id);
            } catch (e) {
              // It used to leave the list whatever happened, while the trainer
              // still had it.
              Alert.alert("Couldn't remove it", alertMessage(e, "Check your connection and try again."));
              return;
            }
            setHub(h => h && { ...h, sent: h.sent.filter(s => s.id !== entry.id) });
          },
        },
      ]
    );
  }, []);

  const handleSendProgram = useCallback(async (program: SavedProgram) => {
    if (!pt) {
      Alert.alert("No trainer", "Connect a trainer before sending a program.");
      return;
    }
    const entry: SentProgram = {
      id: `sent_${Date.now()}`,
      programId: program.id,
      programName: program.name,
      sentAtISO: new Date().toISOString(),
      status: "sent",
      programSnapshot: program,
    };
    try {
      // Real trainers (uuid id) receive through the cloud; mock stays local.
      await appendSentProgram(entry, pt.id);
    } catch (e) {
      Alert.alert("Couldn't send program", alertMessage(e, "Check your connection and try again."));
      return;
    }
    // Re-read rather than prepend `entry`: its `sent_…` id is only a local
    // placeholder, and the cloud row it became has a uuid of its own. A card
    // holding the placeholder can't be removed, because removeSentProgram
    // treats a non-uuid id as a local entry, clears nothing in the cloud, and
    // the program came back on the next load. The prepend is kept only as a
    // fallback for a reload that fails, so a send that worked never looks lost.
    const fresh = await loadSentPrograms();
    const landed = fresh.some(s => sentKeyOf(s) === sentKeyOf(entry));
    setHub(h => h && { ...h, sent: landed ? fresh : [entry, ...fresh] });
    Alert.alert("Sent", `"${program.name}" was sent to ${pt.name}.`);
  }, [pt]);

  const handleAccept = useCallback(async (share: SharedProgram) => {
    const key = batchKeyOf(share);
    if (share.acceptedAtISO || accepting.current.has(key)) return;
    accepting.current.add(key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let importedId: string | null;
    try {
      importedId = await acceptSharedProgramBatch(key);
    } catch (e) {
      Alert.alert("Couldn't add program", alertMessage(e, "Check your connection and try again."));
      // Deleted or archived since this card was drawn: it's gone, so is its card.
      if (e instanceof ShareUnavailableError) {
        setHub(h => h && {
          ...h,
          received: h.received.filter(r => batchKeyOf(r) !== key),
          shares: h.shares.filter(r => batchKeyOf(r) !== key),
        });
      }
      return;
    } finally {
      accepting.current.delete(key);
    }
    scheduleCloudPush(); // the accept materialised/updated @avenas/programs (a synced key)
    const acceptedAt = new Date().toISOString();
    setHub(h => h && {
      ...h,
      received: h.received.map(r => batchKeyOf(r) === key
        ? { ...r, acceptedAtISO: acceptedAt, acceptedProgramId: importedId ?? undefined }
        : r),
    });
    Alert.alert("Program Added", `"${share.programName}" was added to your programs.`);
  }, []);

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
        // +14 top: same first-row line as PTHome (the my-trainers back/plus
        // chrome line) — keep the two hub views in sync.
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
        <OfflineBanner />
        <View style={styles.topPills}>
          <BounceButton
            style={styles.trainersBtnWrap}
            onPress={() => router.navigate("/my-trainers")}
            accessibilityLabel="Open my trainers"
          >
            <View style={[styles.trainersBtn, { backgroundColor: t.ctrl }]}>
              <UserRoundIcon size={16} color={ACCT} />
              <Text style={[styles.trainersBtnText, { color: t.tp }]}>My Trainers</Text>
            </View>
          </BounceButton>
          <View style={{ flex: 1 }} />
          <BounceButton onPress={() => router.navigate("/trainer/messages")} accessibilityLabel="Open messages">
            <View>
              <View style={[styles.circleBtn, { backgroundColor: t.ctrl }]}>
                <ChatIcon size={18} color={t.tp} />
              </View>
              <UnreadBadge count={unreadMessages} style={styles.msgBadge} />
            </View>
          </BounceButton>
          <BounceButton onPress={() => router.navigate("/connect")} accessibilityLabel="Connect with someone">
            <View>
              <View style={[styles.circleBtn, { backgroundColor: t.ctrl }]}>
                <UserRoundPlusIcon size={20} color={t.tp} />
              </View>
              <UnreadBadge count={pendingIncoming} style={styles.msgBadge} />
            </View>
          </BounceButton>
        </View>

        <Text style={[styles.title, { color: t.tp }]}>My Trainer</Text>

        {/* The trainer hub's "Send a Program" button, in the same place: under
            the page title, above the people you'd send to. It was a small "+"
            beside the Sent to Trainer heading, halfway down the page. Hidden
            only once we know there's no trainer, where the empty card's
            "Connect a Trainer" is the one green action; while the trainer is
            still resolving it holds its place so the card below doesn't jump,
            and a tap in that moment does nothing. */}
        {pt !== null && (
          <BounceButton
            style={{ marginTop: 16 }}
            onPress={() => { if (pt) setSendOpen(true); }}
            needsConnection
            accessibilityLabel={pt ? `Send a program to ${pt.name} for review` : "Send a program to your trainer for review"}
          >
            <View style={styles.sendProgramBtn}>
              <SendIcon size={18} color="#fff" />
              <Text style={styles.sendProgramText}>Send a Program for Review</Text>
            </View>
          </BounceButton>
        )}

        {pt === undefined ? (
          // Still resolving. Same card, same row, same height as the real one,
          // so the trainer fills in place rather than the page jumping — and so
          // nobody who HAS a trainer is told they don't.
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 16 }}>
            <View style={styles.ptCard} accessibilityLabel="Loading your trainer">
              <View style={[styles.skeletonAvatar, { backgroundColor: skeletonFill }]} />
              <View style={styles.skeletonText}>
                <View style={[styles.skeletonLine, { width: 76, backgroundColor: skeletonFill }]} />
                <View style={[styles.skeletonLine, styles.skeletonLineLarge, { backgroundColor: skeletonFill }]} />
              </View>
            </View>
          </NeuCard>
        ) : pt === null ? (
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 16 }}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
                <PeopleIcon size={28} color={ACCT} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No trainer linked yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                Connect with a personal trainer to share programs and get feedback on your progress.
              </Text>
              <BounceButton style={{ marginTop: 8 }} onPress={() => router.navigate("/connect")}>
                <View style={[styles.cta, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                  <Text style={styles.ctaText}>Connect a Trainer</Text>
                </View>
              </BounceButton>
            </View>
          </NeuCard>
        ) : (
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 16 }}>
            <View style={styles.ptCard}>
              <Avatar
                uri={pt.photoUri}
                initials={pt.initials}
                size={56}
                backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                textColor={ACCT}
                textStyle={[styles.avatarText, { color: ACCT }]}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.ptLabel, { color: t.ts }]}>YOUR TRAINER</Text>
                <Text style={[styles.ptName, { color: t.tp }]}>{pt.name}</Text>
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
              </View>
              <BounceButton onPress={openChat} accessibilityLabel="Chat with trainer">
                <View style={[styles.chatBtn, { backgroundColor: t.ctrl }]}>
                  <ChatIcon size={18} color={t.tp} />
                </View>
              </BounceButton>
            </View>
          </NeuCard>
        )}

        {/* Groups a trainer has put me in, directly under the trainer card:
            people and places first, then the programs moving between them. It
            sat at the foot of the page, below both program lists. The section
            only exists once there's something in it: a gym user who has never
            been added to one has no use for an empty Groups heading.

            Invites sit above the joined groups and are the only thing here that
            isn't a link — until you accept, there is no group page to open. */}
        {(groups.length > 0 || groupInvites.length > 0) && (
          <>
            <Pressable onPress={toggleGroups} style={styles.sectionHeaderRow} accessibilityRole="button">
              <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Groups</Text>
              <ChevronToggle expanded={!collapsedGroups} color={t.ts} />
              {groupInvites.length > 0 && <UnreadBadge count={groupInvites.length} />}
            </Pressable>
            {!collapsedGroups && (
              <>
                {groupInvites.map(inv => (
                  <GroupInviteCard
                    key={inv.groupId}
                    invite={inv}
                    onAccept={handleAcceptInvite}
                    onDecline={handleDeclineInvite}
                  />
                ))}
                {/* One card per group, matching the invite cards directly
                    above them and the trainer side's list. */}
                {groups.map(g => {
                  // Whose group it is, ahead of its size: with groups from
                  // several trainers, that's what tells two apart.
                  const owner = groupOwners[g.group.id];
                  const members = `${g.group.memberCount} member${g.group.memberCount === 1 ? "" : "s"}`;
                  const meta = g.group.isOwner ? `Your group · ${members}` : owner ? `Run by ${owner.name} · ${members}` : members;
                  return (
                  <BounceButton
                    key={g.group.id}
                    style={{ marginBottom: 10 }}
                    onPress={() => router.navigate({ pathname: "/trainer/group/[id]", params: { id: g.group.id, name: g.group.name } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Open group ${g.group.name}${owner ? `, run by ${owner.name}` : ""}`}
                  >
                    <NeuCard dark={isDark} radius={16}>
                      <View style={styles.summaryRow}>
                        <GroupAvatar uri={g.group.photoUri} size={38} isDark={isDark} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{g.group.name}</Text>
                          <Text style={[styles.groupMeta, { color: t.ts }]} numberOfLines={1}>{meta}</Text>
                        </View>
                        {/* Unread messages plus any program sent into this
                            group that I haven't accepted. A gym user picks up
                            no reviews, so that third source is always 0 here. */}
                        <UnreadBadge count={groupAlerts[g.group.id] ?? 0} />
                        <Ionicons name="chevron-forward" size={16} color={t.ts} />
                      </View>
                    </NeuCard>
                  </BounceButton>
                  );
                })}
              </>
            )}
          </>
        )}

        <Pressable
          onPress={toggleFromTrainer}
          style={styles.sectionHeaderRow}
          accessibilityRole="button"
          accessibilityLabel={`From Your Trainer, ${received.length + returnedToMe.length}. Toggle list`}
        >
          <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>From Your Trainer</Text>
          {/* The group page's section count: heading, count, chevron. Only when
              there's something to count — an empty section already says so. */}
          {received.length + returnedToMe.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{received.length + returnedToMe.length}</Text>
            </View>
          )}
          <ChevronToggle expanded={!collapsedFromTrainer} color={t.ts} />
        </Pressable>
        {!collapsedFromTrainer ? (received.length === 0 && returnedToMe.length === 0 ? (
          // Only say "none" once we've actually looked; before that it's a lie.
          !programsLoaded ? null : <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.smallEmpty, { color: t.ts }]}>No programs received yet.</Text>
          </NeuCard>
        ) : (
          <View>
            {/* Reviews that have come back lead: they're the newest thing a
                trainer has done for you, and usually the one to act on. */}
            {returnedToMe.map(s => (
              <ReturnedReviewCard
                key={s.id}
                review={s}
                fromLabel={returnedFrom(s)}
                isDark={isDark}
                open={expandedCards.has(s.id)}
                onToggle={() => toggleCard(s.id)}
                onView={() => router.navigate(
                  s.appliedAtISO
                    ? { pathname: "/programs", params: { focus: s.programId } }
                    : { pathname: "/program-view", params: { sentId: s.id } },
                )}
                onAccept={() => handleApplyReturned(s)}
                onRemove={() => handleRemoveReturned(s)}
              />
            ))}
            {received.map(r => {
              const accepted = !!r.acceptedAtISO;
              // Was accepted at some point but the gym user deleted it from
              // /programs. acceptedAtISO is cleared on delete and
              // deletedByRecipientAtISO is stamped — see removeSharedProgramByLocalId.
              const wasDeleted = !accepted && !!r.deletedByRecipientAtISO;

              // One row of actions, in the same order in every state: View,
              // Accept (only while there's something to accept), Remove.
              //
              // View opens the program itself — or, once accepted, your copy in
              // My Programs, since that's the one you'll be training from.
              // Remove only takes it off THIS list: an accepted copy stays in
              // My Programs, and the trainer's view doesn't change.
              const actions = (
                <View style={styles.actionRow}>
                  <BounceButton
                    style={{ flex: 1 }}
                    onPress={() => router.navigate(
                      accepted
                        ? (r.acceptedProgramId ? { pathname: "/programs", params: { focus: r.acceptedProgramId } } : "/programs")
                        : { pathname: "/program-view", params: { sharedId: r.id } }
                    )}
                    accessibilityLabel={accepted ? `Open ${r.programName} in your programs` : `View ${r.programName}`}
                  >
                    <View style={[styles.viewBtnInner, { backgroundColor: t.ctrl }]}>
                      <Text style={[styles.viewBtnText, { color: t.tp }]}>View</Text>
                    </View>
                  </BounceButton>
                  {!accepted && (
                    <BounceButton
                      style={{ flex: 1 }}
                      onPress={() => handleAccept(r)}
                      needsConnection
                      accessibilityLabel={`Accept ${r.programName}`}
                    >
                      <View style={[styles.viewBtnInner, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }]}>
                        <Text style={[styles.viewBtnText, { color: "#fff" }]}>Accept</Text>
                      </View>
                    </BounceButton>
                  )}
                  <BounceButton
                    onPress={() => handleRemoveReceived(r)}
                    accessibilityLabel={`Remove ${r.programName} from this list`}
                  >
                    <View style={[styles.viewBtnInner, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
                      <TrashIcon size={16} color="#fff" />
                      <Text style={[styles.viewBtnText, { color: "#fff" }]}>Remove</Text>
                    </View>
                  </BounceButton>
                </View>
              );

              // One card for every state; only the line under the cycle differs,
              // and every state opens to the same row. (The "was deleted" state
              // used to be the only one behind a tap and the accepted one had no
              // buttons, so the same program offered different things depending
              // on its history.)
              return (
                <TapToOpenCard
                  key={r.id}
                  open={expandedCards.has(r.id)}
                  onToggle={() => toggleCard(r.id)}
                  isDark={isDark}
                  label={`${r.programName}, ${accepted ? "accepted" : "received"}`}
                  actions={actions}
                >
                  <View style={styles.receivedTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{r.programName}</Text>
                      <Text style={[styles.itemMeta, { color: t.ts }]}>Received {fmtAgo(r.sentAtISO)}</Text>
                    </View>
                    {accepted && (
                      <View
                        style={[
                          styles.acceptBox,
                          { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },
                        ]}
                        accessibilityLabel="Program accepted"
                      >
                        <Ionicons name="checkmark" size={14} color="#fff" />
                      </View>
                    )}
                  </View>
                  <CycleGrid cycle={r.programSnapshot?.cyclePattern ?? []} isDark={isDark} />
                  {accepted ? (
                    <Text style={[styles.acceptedLine, { color: ACCT }]}>Added to your programs</Text>
                  ) : wasDeleted ? (
                    // Accepted once, then deleted from My Programs. Accept
                    // here adds it back.
                    <Text style={[styles.acceptedLine, { color: t.ts }]}>Removed from your programs</Text>
                  ) : null}
                </TapToOpenCard>
              );
            })}
          </View>
        )) : received.length > 0 || returnedToMe.length > 0 ? (
          <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
            {/* Same order as the cards: returned reviews, then programs sent to
                me. The divider logic counts across both, so the last row of
                the combined list is the one without a line under it. */}
            {returnedToMe.map((s, i) => {
              const applied = !!s.appliedAtISO;
              const isLast = i === returnedToMe.length - 1 && received.length === 0;
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => router.navigate(
                    applied
                      ? { pathname: "/programs", params: { focus: s.programId } }
                      : { pathname: "/program-view", params: { sentId: s.id } },
                  )}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${s.programName}, your program reviewed`}
                  style={[styles.summaryRow, { borderBottomColor: t.div, borderBottomWidth: isLast ? 0 : 1 }]}
                >
                  <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{s.programName}</Text>
                  <View style={[styles.statusPill, { backgroundColor: `${ACCT}22` }]}>
                    <Text style={[styles.statusText, { color: ACCT }]}>{applied ? "Applied" : "Reviewed"}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            {received.map((r, i) => {
              const accepted = !!r.acceptedAtISO;
              const wasDeleted = !accepted && !!r.deletedByRecipientAtISO;
              const label = accepted ? "Accepted" : wasDeleted ? "Removed" : "Pending";
              const accent = accepted;
              return (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => router.navigate({ pathname: "/program-view", params: { sharedId: r.id } })}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${r.programName}`}
                  style={[
                    styles.summaryRow,
                    { borderBottomColor: t.div, borderBottomWidth: i === received.length - 1 ? 0 : 1 },
                  ]}
                >
                  <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{r.programName}</Text>
                  <View style={[styles.statusPill, accent
                    ? { backgroundColor: `${ACCT}22` }
                    : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
                  ]}>
                    <Text style={[styles.statusText, { color: accent ? ACCT : t.ts }]}>{label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </NeuCard>
        ) : null}

        {/* A plain heading now, like From Your Trainer: sending moved to the
            green button at the top of the page. */}
        <Pressable
          onPress={toggleSentToTrainer}
          style={styles.sectionHeaderRow}
          accessibilityRole="button"
          accessibilityLabel={`Sent to Trainer, ${pendingSent.length}. Toggle list`}
        >
          <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Sent to Trainer</Text>
          {pendingSent.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{pendingSent.length}</Text>
            </View>
          )}
          <ChevronToggle expanded={!collapsedSentToTrainer} color={t.ts} />
        </Pressable>
        {!collapsedSentToTrainer ? (pendingSent.length === 0 ? (
          !programsLoaded ? null : <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.smallEmpty, { color: t.ts }]}>{`You haven't sent any programs to your trainer yet.`}</Text>
          </NeuCard>
        ) : (
          // Everything here is still waiting on a trainer: a review that's come
          // back has moved up to "From Your Trainer", so these cards only ever
          // offer View and Remove.
          pendingSent.map(s => (
            <TapToOpenCard
              key={s.id}
              open={expandedCards.has(s.id)}
              onToggle={() => toggleCard(s.id)}
              isDark={isDark}
              label={`${s.programName}, awaiting review`}
              actions={
                <View style={styles.actionRow}>
                  <BounceButton
                    style={{ flex: 1 }}
                    onPress={() => router.navigate({ pathname: "/program-view", params: { sentId: s.id } })}
                    accessibilityLabel={`View ${s.programName}`}
                  >
                    <View style={[styles.viewBtnInner, { backgroundColor: t.ctrl }]}>
                      <Text style={[styles.viewBtnText, { color: t.tp }]}>View</Text>
                    </View>
                  </BounceButton>
                  {/* Labelled, like the trainer side's Remove. A bare bin was
                      the one unlabelled action on the card, and a red square
                      with no word on it reads as "delete", which this isn't:
                      your own copy of the program stays. */}
                  <BounceButton
                    onPress={() => handleUnsendProgram(s)}
                    needsConnection
                    accessibilityLabel={`Remove ${s.programName}`}
                  >
                    <View style={[styles.viewBtnInner, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
                      <TrashIcon size={16} color="#fff" />
                      <Text style={[styles.viewBtnText, { color: "#fff" }]}>Remove</Text>
                    </View>
                  </BounceButton>
                </View>
              }
            >
              <View style={styles.receivedTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{s.programName}</Text>
                  {/* Where it went matters here: a program posted to a group
                      could come back from any trainer in it, and the name is
                      looked up live so a renamed group reads correctly on old
                      sends. */}
                  <Text style={[styles.itemMeta, { color: t.ts }]} numberOfLines={1}>
                    Sent {fmtAgo(s.sentAtISO)}
                    {s.groupId ? ` · ${groups.find(g => g.group.id === s.groupId)?.group.name ?? "a group"}` : ""}
                  </Text>
                </View>
                {/* The same words and orange as the trainer's side of this
                    request, and as this list's one-line rows (it said
                    "Pending" here and "Awaiting review" there). */}
                <View style={[styles.statusPill, { backgroundColor: `${AWAITING_ORANGE}22` }]}>
                  <Text style={[styles.statusText, { color: AWAITING_ORANGE }]}>Awaiting review</Text>
                </View>
              </View>
              <CycleGrid cycle={s.programSnapshot?.cyclePattern ?? []} isDark={isDark} />
            </TapToOpenCard>
          ))
        )) : pendingSent.length > 0 ? (
          <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
            {pendingSent.map((s, i) => {
              const applied = !!s.appliedAtISO;
              const returned = s.status === "returned";
              const label = applied ? "Applied" : returned ? "Returned" : "Awaiting review";
              const accent = applied || returned;
              const onPress = () => {
                if (applied) router.navigate({ pathname: "/programs", params: { focus: s.programId } });
                else router.navigate({ pathname: "/program-view", params: { sentId: s.id } });
              };
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={onPress}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${s.programName}`}
                  style={[
                    styles.summaryRow,
                    { borderBottomColor: t.div, borderBottomWidth: i === pendingSent.length - 1 ? 0 : 1 },
                  ]}
                >
                  <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{s.programName}</Text>
                  <View style={[styles.statusPill, { backgroundColor: `${accent ? ACCT : AWAITING_ORANGE}22` }]}>
                    <Text style={[styles.statusText, { color: accent ? ACCT : AWAITING_ORANGE }]}>{label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </NeuCard>
        ) : null}
      </ScrollView>

      <ProgramPickerSheet
        visible={sendOpen}
        title="Send to Trainer"
        subtitle={pt ? `Pick a program to send to ${pt.name} for review.` : "Connect a trainer first."}
        programs={myPrograms}
        onPick={handleSendProgram}
        onClose={() => setSendOpen(false)}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient:  { position: "absolute", left: 0, right: 0, zIndex: 5 },
  topPills: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  trainersBtnWrap: { alignSelf: "center" },
  msgBadge:     { position: "absolute", top: -5, right: -5 },
  trainersBtn:  { flexDirection: "row", alignItems: "center", gap: 8, height: 40, borderRadius: 20, paddingHorizontal: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  trainersBtnText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  circleBtn:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  title:        { fontFamily: FontFamily.bold, fontSize: 28 },
  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18, marginTop: 24, marginBottom: 12 },
  emptyInner:   { padding: 28, alignItems: "center", gap: 12 },
  emptyIcon:    { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 17, textAlign: "center" },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
  cta:          { borderRadius: PILL_RADIUS, paddingVertical: 13, paddingHorizontal: 24, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  ctaText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },
  ptCard:       { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  // Placeholder while the trainer resolves. Sized to the real row — 56pt avatar,
  // a label line and a name line — so the card doesn't change height when the
  // trainer fills in.
  skeletonAvatar:    { width: 56, height: 56, borderRadius: 28 },
  skeletonText:      { flex: 1, gap: 9 },
  skeletonLine:      { height: 10, borderRadius: 5 },
  skeletonLineLarge: { width: 140, height: 16, borderRadius: 8 },
  avatar:       { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 18 },
  ptLabel:      { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 1 },
  ptName:       { fontFamily: FontFamily.bold, fontSize: 18, marginTop: 2 },
  presenceRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  presenceDot:  { width: 6, height: 6, borderRadius: 3 },
  presenceText: { fontFamily: FontFamily.regular, fontSize: 12 },
  chatBtn:      { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  itemRow:      { flexDirection: "row", alignItems: "center", gap: 12, padding: CARD_PAD },
  // Shared with summaryName below: this section renders the same title as a
  // card and as a list row, and the two must land in the same place.
  itemName:     { ...CARD_TITLE },
  itemMeta:     { ...CARD_META },
  receivedTop:  { ...CARD_TOP },
  acceptBox:    { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cycleGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:    { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:{ fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  acceptedLine: { fontFamily: FontFamily.semibold, fontSize: 12 },
  actionRow:    { flexDirection: "row", gap: 10 },
  // Pills rather than NeuCards: these sit INSIDE an expanded card, and a raised
  // neumorphic button on a raised card reads as two stacked surfaces. White
  // control surface for View, DANGER for Delete, same shape either way.
  viewBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, minHeight: 38, borderRadius: PILL_RADIUS, ...PILL_SHADOW },
  viewBtnText:  { fontFamily: FontFamily.bold, fontSize: 14 },
  // TapToOpenCard, with the same numbers as the trainer hub's program cards
  // (PTHome reviewInner / sharedActionRow / chevronRow). No `gap` on the inner:
  // the content column carries its own, and the reveal and chevron are spaced
  // explicitly, since a gap would reserve room around the closed reveal.
  cardInner:    { ...CARD_INNER },
  cardBody:     { gap: 10 },
  revealBody:   { paddingTop: 12 },
  chevronRow:   { alignItems: "center", marginTop: 10 },
  sectionHeaderRow:{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12 },
  // A section's count, the group page's badge value for value
  // (app/trainer/group/[id] countBadge), beside the same 18pt heading.
  countBadge:     { minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: "center", justifyContent: "center", backgroundColor: ACCT },
  countBadgeText: { fontFamily: FontFamily.bold, fontSize: 12, color: "#fff" },
  // The trainer hub's "Send a Program" pill (PTHome broadcast / broadcastText),
  // value for value, so the two sides' send buttons are the same button.
  sendProgramBtn:  { ...pill(), gap: 10, backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) },
  sendProgramText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff", letterSpacing: 0.2 },
  commentBox:   { paddingTop: 10, borderTopWidth: 1, gap: 6 },
  commentLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.8 },
  commentBody:  { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  statusPill:   { ...CARD_PILL },
  statusText:   { ...CARD_PILL_TEXT },
  summaryRow:   { ...SUMMARY_ROW },
  summaryName:  { flex: 1, ...CARD_TITLE },
  groupIcon:    { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  groupMeta:    { fontFamily: FontFamily.regular, fontSize: 11, marginTop: 1 },
  smallEmpty:   { fontFamily: FontFamily.regular, fontSize: 13, padding: 18, textAlign: "center" },
});
