// A group's own page: the members in it, and the things you do with them.
//
// Reached by tapping a group on the trainer hub. The CHAT lives one level down
// at /trainer/group/<id>/chat — a group is a roster first and a conversation
// second, which is the point of grouping clients up in the first place.
//
// Members render with the same ClientCard as My Clients, so a group reads as a
// filtered view of the roster rather than a separate concept, and tapping one
// opens that client exactly as it would from the hub.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import FadeScreen from "../../../../components/FadeScreen";
import NeuCard from "../../../../components/NeuCard";
import BounceButton from "../../../../components/BounceButton";
import Avatar from "../../../../components/Avatar";
import ClientCard from "../../../../components/trainer/ClientCard";
import GroupAvatar from "../../../../components/trainer/GroupAvatar";
import SimpleSheet from "../../../../components/trainer/SimpleSheet";
import ProgramPickerSheet from "../../../../components/trainer/ProgramPickerSheet";
import UnreadBadge from "../../../../components/UnreadBadge";
import ChevronToggle from "../../../../components/ChevronToggle";
import ExpandReveal, { useReveal } from "../../../../components/ExpandReveal";
import TrashIcon from "../../../../components/TrashIcon";
import KeyboardDismissButton from "../../../../components/KeyboardDismissButton";
import ChatIcon from "../../../../components/icons/ChatIcon";
import SendIcon from "../../../../components/icons/SendIcon";
import PeopleIcon from "../../../../components/icons/PeopleIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER, DANGER_BRIGHT, ROLE_OWNER, ROLE_TRAINER, ROLE_MEMBER } from "../../../../constants/theme";
import { pill, pillGlow, haloGlow, PILL_H_SM, PILL_RADIUS, PILL_SHADOW } from "../../../../constants/buttons";
import { CARD_INNER, CARD_META, CARD_PAD, CARD_PILL, CARD_PILL_TEXT, CARD_TITLE, CARD_TOP } from "../../../../constants/cards";
import FavouriteStar, { useFavouriteGold } from "../../../../components/FavouriteStar";
import { useTheme } from "../../../../contexts/ThemeContext";
import { deleteGroup, fetchGroup, fetchGroupMembers, leaveGroup, setGroupMemberRole } from "../../../../lib/groups";
import { getMyUid } from "../../../../lib/chat";
import { scheduleCloudPush } from "../../../../lib/syncManager";
import { loadFavouriteGroupIds, loadGroupRows, toggleFavouriteGroup } from "../../../../utils/groupStore";
import { resolveTrainerRoster } from "../../../../utils/roster";
import { acceptSharedProgramBatch, appendSentProgram, appendSharedPrograms, batchKeyOf, loadClientData, loadGroupReviewPrograms, loadGroupSharedPrograms, removeGroupSharedProgramBatch, setGroupReviewDone, type Client, type SentProgram, type SharedProgram } from "../../../../utils/trainerStore";
import { getJSON } from "../../../../utils/storage";
import { fmtAgo } from "../../../../utils/dates";
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

/** One send to this group: one `shared_programs` row per invited member,
 *  collapsed onto the batch key they share. */
type SentBatch = {
  key: string;
  programName: string;
  sentAtISO: string;
  entries: SharedProgram[];
  acceptedCount: number;
};

/**
 * One send's card: the program, who has accepted it, and the actions behind a
 * tap. Its own component so it can own the open/close animation
 * (components/ExpandReveal.tsx, shared with Home's achievement cards and the
 * Help & FAQ accordion). The actions used to fade in and out while the card's
 * height jumped to fit them.
 */
function SentBatchCard({ batch, open, myUid, iCoachGroup, isDark, onToggle, onView, onAccept, onDelete }: {
  batch: SentBatch;
  open: boolean;
  myUid: string | null;
  iCoachGroup: boolean;
  isDark: boolean;
  onToggle: () => void;
  onView: (sharedId: string) => void;
  onAccept: () => void;
  onDelete: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reveal = useReveal();
  useEffect(() => { reveal.setOpen(open); }, [open, reveal]);

  // My own entry in this batch — what Accept acts on. A coach who sent it has
  // no entry of their own, which is one more reason they never see Accept.
  const mine = batch.entries.find(e => e.clientId === myUid);
  // The count is only the truth when I can see the whole batch, which the
  // database grants to this group's coaches and no one else. A member sees one
  // row and would read "0 of 1".
  const meta = mine?.acceptedAtISO
    ? "Accepted"
    : iCoachGroup
      ? (batch.acceptedCount === batch.entries.length
          ? "Accepted by everyone"
          : `${batch.acceptedCount} of ${batch.entries.length} accepted`)
      : "Shared with this group";

  return (
    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
      <View>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${batch.programName}, ${meta}, ${open ? "collapse" : "expand"}`}
        >
          <View style={styles.sentRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sentName, { color: t.tp }]} numberOfLines={1}>{batch.programName}</Text>
              <Text style={[styles.sentMeta, { color: t.ts }]} numberOfLines={1}>{meta}</Text>
            </View>
            <ChevronToggle expanded={open} color={t.ts} upDown />
          </View>
        </Pressable>
        <ExpandReveal progress={reveal.progress} fade={reveal.fade} open={open} contentStyle={styles.sentActions}>
          <BounceButton
            style={styles.sentActionSlot}
            onPress={() => onView((mine ?? batch.entries[0]).id)}
            accessibilityLabel={`View ${batch.programName}`}
          >
            <View style={[styles.sentActionBtn, { backgroundColor: t.ctrl }]}>
              <Text style={[styles.sentActionText, { color: t.tp }]}>View Program</Text>
            </View>
          </BounceButton>
          {/* Not mutually exclusive: a trainer who is a member of the group both
              received a copy and may remove the send, so they get all three.
              The sender has no entry of their own, so no Accept. */}
          {mine && !mine.acceptedAtISO && (
            <BounceButton style={styles.sentActionSlot} onPress={onAccept} accessibilityLabel={`Accept ${batch.programName}`}>
              <View style={[styles.sentActionBtn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }]}>
                <Text style={[styles.sentActionText, { color: "#fff" }]}>Accept</Text>
              </View>
            </BounceButton>
          )}
          {iCoachGroup && (
            <BounceButton style={styles.sentActionSlot} onPress={onDelete} accessibilityLabel={`Delete ${batch.programName}`}>
              <View style={[styles.sentActionBtn, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
                <TrashIcon size={15} color="#fff" />
                <Text style={[styles.sentActionText, { color: "#fff" }]}>Delete</Text>
              </View>
            </BounceButton>
          )}
        </ExpandReveal>
      </View>
    </NeuCard>
  );
}

/**
 * One program a member posted here for a coach to look at — the receiving half
 * of the group's program traffic, and deliberately the same card as the trainer
 * hub's "Programs Received": name, who it came from and when, a status pill,
 * and the review behind a tap.
 *
 * Shown to the SENDER too, without the actions. A gym user tracks their request
 * on their own trainer page, but a TRAINER who is a plain member of someone
 * else's group has no such page — their own hub only lists reviews addressed to
 * them — so without this their request vanished the moment they sent it.
 */
function GroupReviewCard({ review, from, open, canReview, isDark, onToggle, onOpen, onDone }: {
  review: SentProgram;
  /** Who asked, resolved against the roster. */
  from: string;
  open: boolean;
  canReview: boolean;
  isDark: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDone: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reveal = useReveal();
  useEffect(() => { reveal.setOpen(open); }, [open, reveal]);

  const returned = review.status === "returned";

  const row = (
    <View style={styles.sentRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sentName, { color: t.tp }]} numberOfLines={1}>{review.programName}</Text>
        <Text style={[styles.sentMeta, { color: t.ts }]} numberOfLines={1}>
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
      {canReview && <ChevronToggle expanded={open} color={t.ts} upDown />}
    </View>
  );

  // Nothing behind the tap for a member, so it isn't a tap: the card states
  // where their request stands and stops there.
  if (!canReview) return <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>{row}</NeuCard>;

  return (
    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
      <View>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${review.programName} from ${from}, ${returned ? "returned" : "awaiting review"}, ${open ? "collapse" : "expand"}`}
        >
          {row}
        </Pressable>
        <ExpandReveal progress={reveal.progress} fade={reveal.fade} open={open} contentStyle={styles.sentActions}>
          <BounceButton style={styles.sentActionSlot} onPress={onOpen} accessibilityLabel={`Review ${review.programName}`}>
            <View style={[styles.sentActionBtn, { backgroundColor: t.ctrl }]}>
              <Text style={[styles.sentActionText, { color: t.tp }]}>
                {returned ? "View Review" : "Edit & Send Back"}
              </Text>
            </View>
          </BounceButton>
          {/* Closing the item is what keeps this a queue rather than an
              ever-growing log. It only clears the GROUP's copy — the member
              keeps the feedback on their own page. */}
          <BounceButton style={styles.sentActionSlot} onPress={onDone} accessibilityLabel={`Mark ${review.programName} as done`}>
            <View style={[styles.sentActionBtn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }]}>
              <Ionicons name="checkmark" size={15} color="#fff" />
              <Text style={[styles.sentActionText, { color: "#fff" }]}>Mark Done</Text>
            </View>
          </BounceButton>
        </ExpandReveal>
      </View>
    </NeuCard>
  );
}

export default function GroupPageScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The options-menu label sits beside the star and must match it exactly.
  const favouriteGold = useFavouriteGold();
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
  // One picker sheet serving both directions rather than two mounted sheets:
  // "send" is a coach pushing a program out to the group, "review" a member
  // posting one in. Never both, which is also what keeps this screen clear of
  // the two-RN-Modals-at-once trap.
  const [picker, setPicker] = useState<"send" | "review" | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isFavourite, setIsFavourite] = useState(false);
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  const [groupShares, setGroupShares] = useState<SharedProgram[]>([]);
  const [expandedSent, setExpandedSent] = useState<Set<string>>(new Set());
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());
  // The group's review queue: programs members posted here, still open. Empty
  // for a member — RLS returns a group's reviews to its coaches only.
  const [groupReviews, setGroupReviews] = useState<SentProgram[]>([]);

  // Declared up here because the handlers below name it: a const referenced in
  // a useCallback dependency array is read during render, not when the callback
  // runs, so a later declaration is a temporal-dead-zone error.
  const displayName = group?.name || name || "Group";

  /** Owner or trainer here — the same test the database enforces for sending to
   *  this group, and what separates "can remove this" from "can take a copy". */
  const iCoachGroup = useMemo(() => {
    const role = members.find(m => m.id === myUid)?.role;
    return !!role && canCoachGroup(role);
  }, [members, myUid]);

  const toggleSent = useCallback((key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedSent(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
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

  /** Re-read this group's sends. Shared by the initial load, the send flow and
   *  both actions below, so the list never shows a stale state. */
  const refreshGroupShares = useCallback(async () => {
    try {
      const [shares, reviews] = await Promise.all([
        loadGroupSharedPrograms(groupId),
        loadGroupReviewPrograms(groupId),
      ]);
      setGroupShares(shares);
      setGroupReviews(reviews);
    } catch (err) {
      if (__DEV__) console.warn("[avenas] refresh group shares", err);
    }
  }, [groupId]);

  /** Clear a review out of the group's queue. Coach-only at the database, so
   *  this button never renders for anyone else. */
  const handleCompleteReview = useCallback((entry: SentProgram) => {
    Alert.alert(
      "Mark as done",
      `Clear "${entry.programName}" from this group's review list? ${entry.returnedAtISO ? "The member keeps the feedback on their own page." : "It hasn't been sent back yet."}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark done",
          onPress: async () => {
            try {
              await setGroupReviewDone(entry.id, true);
            } catch (e) {
              Alert.alert("Couldn't update", e instanceof Error ? e.message : "Check your connection and try again.");
              return;
            }
            setGroupReviews(prev => prev.filter(r => r.id !== entry.id));
          },
        },
      ],
    );
  }, []);

  /** Post one of my programs to this group for whichever coach picks it up. */
  const handleAskForReview = useCallback(async (program: SavedProgram) => {
    setPicker(null);
    const ownerId = group?.ownerId;
    if (!ownerId) {
      Alert.alert("Group unavailable", "Reopen the group and try again.");
      return;
    }
    const entry: SentProgram = {
      id: `sent_${Date.now()}`,
      programId: program.id,
      programName: program.name,
      sentAtISO: new Date().toISOString(),
      status: "sent",
      programSnapshot: program,
      // What makes this the GROUP's to review rather than the owner's, even
      // though the owner is the addressed recipient.
      groupId,
    };
    try {
      await appendSentProgram(entry, ownerId);
    } catch (e) {
      Alert.alert("Couldn't send program", e instanceof Error ? e.message : "Check your internet and try again.");
      return;
    }
    // Put it in the section on this tick: the request now has a card of its own
    // here, and waiting for the next focus would look like the send was lost.
    await refreshGroupShares();
    Alert.alert("Sent for Review", `"${program.name}" was sent to the trainers in ${displayName}. It stays on this page until a trainer marks it done.`);
  }, [group?.ownerId, groupId, displayName, refreshGroupShares]);

  const handleDeleteBatch = useCallback((batchKey: string, programName: string) => {
    Alert.alert(
      "Delete Program",
      `Remove "${programName}" from this group? Members who already accepted it keep their copy.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await removeGroupSharedProgramBatch(groupId, batchKey);
            await refreshGroupShares();
          },
        },
      ],
    );
  }, [refreshGroupShares, groupId]);

  const handleAcceptBatch = useCallback(async (batchKey: string, programName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await acceptSharedProgramBatch(batchKey);
    scheduleCloudPush(); // the accept materialised a local program
    await refreshGroupShares();
    Alert.alert("Program Added", `"${programName}" is now in your programs.`);
  }, [refreshGroupShares]);

  /**
   * This group's sends, one card per send rather than per member.
   *
   * A send writes an entry per recipient — that's what the hub's pending list
   * is built from — so they're collapsed on `batchKeyOf`, the same key the hub
   * uses. Both surfaces therefore agree on what counts as one send.
   */
  const sentBatches = useMemo<SentBatch[]>(() => {
    const byKey = new Map<string, SharedProgram[]>();
    for (const s of groupShares) {
      const k = batchKeyOf(s);
      const list = byKey.get(k);
      if (list) list.push(s); else byKey.set(k, [s]);
    }
    return Array.from(byKey.entries())
      .map(([key, entries]) => ({
        key,
        programName: entries[0].programName,
        sentAtISO: entries[0].sentAtISO,
        entries,
        acceptedCount: entries.filter(e => e.acceptedAtISO).length,
      }))
      .sort((a, b) => (a.sentAtISO < b.sentAtISO ? 1 : -1));
  }, [groupShares]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = await getMyUid();
        if (!uid || !groupId) return;
        const [g, roster, { clients: allClients }, rows, progs, favIds, shares, reviews] = await Promise.all([
          fetchGroup(uid, groupId),
          fetchGroupMembers(groupId),
          resolveTrainerRoster(),
          loadGroupRows(),
          getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
          loadFavouriteGroupIds(),
          loadGroupSharedPrograms(groupId),
          loadGroupReviewPrograms(groupId),
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
        // Already scoped to this group, in both directions — what arrived here
        // is a group's noticeboard, not my own inbox.
        setGroupShares(shares);
        setGroupReviews(reviews);

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
    setPicker(null);
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
      // The only thing tying these per-member rows back to the group. Without
      // it the send is indistinguishable from individual sends, which is why
      // it used to vanish from this page entirely.
      groupId,
    }));
    try {
      await appendSharedPrograms(entries);
    } catch (e) {
      Alert.alert("Couldn't send program", e instanceof Error ? e.message : "Check your internet and try again.");
      return;
    }
    // Re-read so the Programs Sent section updates on this tick. The page loads
    // on focus, and sending never leaves it — so without this the send only
    // appeared after navigating away and back.
    await refreshGroupShares();
    Alert.alert("Program Sent", `"${program.name}" was sent to ${recipientIds.length} member${recipientIds.length === 1 ? "" : "s"} of ${displayName}.`);
  }, [recipientIds, displayName, groupId, refreshGroupShares]);

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

  /** Who a review came from, for the line under its name. My own request reads
   *  "You" — it's on this page so I can see where it got to, not to tell me who
   *  I am. Someone who has since left the group falls back to a neutral label
   *  rather than blanking the line: the request is still in the queue. */
  const reviewFrom = (r: SentProgram): string => {
    if (r.senderId && r.senderId === myUid) return "You";
    return members.find(m => m.id === r.senderId)?.name ?? "A member";
  };

  /** My own row reads its program from MY programs, not from the per-client
   *  store the other rows use: that store is keyed by client id and I'm not one
   *  of my own clients, so my card claimed "No active program" however many I
   *  was running. */
  const myActiveProgramName = myPrograms.find(p => p.status === "active")?.name;

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
          {isFavourite && <FavouriteStar size={16} />}
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
          {/* Banner: the group's own face, who's in it, and the two things you
              do with a group. The photo leads because it's what the group is
              recognised by everywhere else; the member stack stays underneath,
              since who's in it is the other half of the answer. */}
          <NeuCard dark={isDark} radius={20}>
            <View style={styles.bannerInner}>
              <TouchableOpacity
                activeOpacity={group?.isOwner ? 0.8 : 1}
                onPress={group?.isOwner ? openManage : undefined}
                accessibilityRole={group?.isOwner ? "button" : "image"}
                accessibilityLabel={group?.isOwner ? "Change group photo" : `${displayName} photo`}
              >
                <GroupAvatar uri={group?.photoUri} size={64} isDark={isDark} />
              </TouchableOpacity>
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
                {canCoach ? (
                  <BounceButton style={{ flex: 1 }} onPress={() => setPicker("send")} accessibilityLabel="Send a program to this group">
                    <View style={[styles.actionBtn, styles.actionPrimary]}>
                      <SendIcon size={17} color="#fff" />
                      <Text style={[styles.actionText, { color: "#fff" }]}>Send Program</Text>
                    </View>
                  </BounceButton>
                ) : (
                  /* The other direction: a member posts a program here and
                     whichever coach is free picks it up. One request to the
                     group rather than one per trainer, so a gym with three
                     trainers doesn't produce three reviews of one program. */
                  <BounceButton style={{ flex: 1 }} onPress={() => setPicker("review")} accessibilityLabel="Send a program to this group for review">
                    <View style={[styles.actionBtn, styles.actionPrimary]}>
                      <SendIcon size={17} color="#fff" />
                      <Text style={[styles.actionText, { color: "#fff" }]}>Ask for Review</Text>
                    </View>
                  </BounceButton>
                )}
              </View>
            </View>
          </NeuCard>

          {/* Programs members posted here for a coach to look at — the other
              direction from "Programs Sent" below, and the same section a coach
              sees on their hub. A coach gets the review actions; the person who
              posted it gets the card as a status line, because for a trainer
              who's a plain member here this is the only page it appears on.

              Anything marked done has left the list entirely; that's the point
              of it being a queue rather than a log. */}
          {groupReviews.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <Text style={[styles.sectionHeading, { color: t.tp }]}>
                  {iCoachGroup ? "Programs Received" : "Sent for Review"}
                </Text>
                <View style={[styles.countBadge, { backgroundColor: ACCT }]}>
                  <Text style={styles.countBadgeText}>{groupReviews.length}</Text>
                </View>
              </View>
              {groupReviews.map(r => (
                <GroupReviewCard
                  key={r.id}
                  review={r}
                  from={reviewFrom(r)}
                  open={expandedReviews.has(r.id)}
                  canReview={iCoachGroup}
                  isDark={isDark}
                  onToggle={() => toggleReview(r.id)}
                  onOpen={() => router.navigate({ pathname: "/trainer/review/[id]", params: { id: r.id, groupId } })}
                  onDone={() => handleCompleteReview(r)}
                />
              ))}
            </>
          )}

          {/* Programs sent to this group. A send writes one row per member, so
              they're collapsed by batch key into one card each — the same key
              the trainer hub groups by, so both surfaces agree on what "one
              send" is. */}
          {sentBatches.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <Text style={[styles.sectionHeading, { color: t.tp }]}>Programs Sent</Text>
                <View style={[styles.countBadge, { backgroundColor: ACCT }]}>
                  <Text style={styles.countBadgeText}>{sentBatches.length}</Text>
                </View>
              </View>
              {sentBatches.map(b => (
                <SentBatchCard
                  key={b.key}
                  batch={b}
                  open={expandedSent.has(b.key)}
                  myUid={myUid}
                  iCoachGroup={iCoachGroup}
                  isDark={isDark}
                  onToggle={() => toggleSent(b.key)}
                  onView={(sharedId) => router.navigate({ pathname: "/program-view", params: { sharedId } })}
                  onAccept={() => handleAcceptBatch(b.key, b.programName)}
                  onDelete={() => handleDeleteBatch(b.key, b.programName)}
                />
              ))}
            </>
          )}

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
            {/* Adding people was only ever behind the ⋯ menu's "Manage members",
                which reads as reviewing a roster rather than growing one. The +
                sits where the Groups list's own + sits, next to the heading. */}
            {group?.isOwner && (
              <TouchableOpacity
                onPress={openManage}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Add members"
              >
                <View style={[styles.searchBtn, { backgroundColor: t.ctrl }]}>
                  <Ionicons name="person-add-outline" size={16} color={t.tp} />
                </View>
              </TouchableOpacity>
            )}
          </View>

          {searchOpen && (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.searchRow}>
              {/* Same field as PTHome's client search, Messages and the exercise
                  picker: a filled, fully rounded pill on t.ctrl (white on light)
                  rather than a faint tinted box, so it reads as something you
                  type into and matches every other search in the app. */}
              <View style={[styles.searchBox, { backgroundColor: t.ctrl, borderColor: t.div }]}>
                <Ionicons name="search" size={17} color={t.ts} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search members"
                  placeholderTextColor={t.ts}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="search"
                  clearButtonMode="never"
                  style={[styles.searchInput, { color: t.tp }]}
                />
                {query.trim().length > 0 && (
                  <TouchableOpacity onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search" accessibilityRole="button">
                    <Ionicons name="close-circle" size={19} color={t.ts} />
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
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
            visibleMembers.map(m => {
              // YOUR OWN row never opens anything. The client page is a page
              // ABOUT someone you coach, built from the client roster, and you
              // are not on your own roster — so it loaded, found nothing and
              // said "client not found". A coach's own card used to reach it
              // because the self-check only guarded the owner's sheet and then
              // fell through to the navigate below.
              const isMe = m.id === myUid;
              // The owner gets a sheet to promote or demote. A coach of the
              // group opens the client page. Everyone else — a gym user
              // looking at who else is in their group — gets a roster entry
              // and nothing more: the client page is a coaching surface
              // (progress, journal, send a program) and opening it on a
              // fellow member would claim a relationship that isn't there.
              // No action → no onPress at all, so the card doesn't bounce and
              // buzz on a tap that goes nowhere.
              const onPress = isMe
                ? undefined
                : group?.isOwner
                  ? () => openMemberMenu(m)
                  : iCoachGroup
                    ? () => router.navigate({ pathname: "/trainer/client/[id]", params: { id: m.id } })
                    : undefined;
              return (
                <ClientCard
                  key={m.id}
                  client={clientFor(m)}
                  activeProgramName={isMe ? myActiveProgramName : activeProgramByClient[m.id]}
                  // get_group_members orders owner, then trainers, then members,
                  // so the badges read top to bottom in rank order. An outstanding
                  // invite outranks the role: what they'd be once they join is
                  // less useful than knowing they haven't joined. "YOU" outranks
                  // both — it's why that one card doesn't respond to a tap.
                  badge={isMe ? "YOU" : m.accepted ? ROLE_LABEL[m.role] : "INVITED"}
                  badgeColor={isMe ? t.ts : m.accepted ? ROLE_COLOR[m.role] : t.ts}
                  onPress={onPress}
                />
              );
            })
          )}
        </ScrollView>
      )}

      <SimpleSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        <View style={styles.menu}>
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onToggleFavourite} accessibilityRole="button" accessibilityLabel={isFavourite ? "Remove from favourites" : "Add to favourites"}>
            <FavouriteStar size={20} filled={isFavourite} inactiveColor={t.tp} />
            <Text style={[styles.menuText, { color: isFavourite ? favouriteGold : t.tp }]}>
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
        visible={picker !== null}
        title={picker === "review" ? "Ask for a Review" : `Send to ${displayName}`}
        subtitle={picker === "review"
          ? `A trainer in ${displayName} will look at it and send it back with their notes.`
          : `Everyone in this group receives it (${recipientIds.length} member${recipientIds.length === 1 ? "" : "s"}).`}
        programs={myPrograms}
        onPick={picker === "review" ? handleAskForReview : handleSendProgram}
        onClose={() => setPicker(null)}
      />

      {/* The floating keyboard-down button for the member search, the same one
          PTHome's client search and the group edit screen show. Last child so
          it sits above the scroll content; renders nothing without a keyboard. */}
      <KeyboardDismissButton />
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
  // Shares the card geometry the hub uses, so that when this section gains the
  // same list/cards toggle the title is already in the place a summary row
  // would put it.
  sentRow:  { ...CARD_INNER, ...CARD_TOP },
  sentName: { ...CARD_TITLE },
  sentMeta: { ...CARD_META },
  statusPill: { ...CARD_PILL },
  statusText: { ...CARD_PILL_TEXT },
  // Wraps because a trainer who is also a member gets three buttons. Two share
  // a row; the third takes a full row of its own rather than being squeezed to
  // a third of a phone's width.
  sentActions:   { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: CARD_PAD, paddingBottom: CARD_PAD },
  sentActionSlot: { flexGrow: 1, flexBasis: "45%" },
  sentActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, minHeight: 38, borderRadius: PILL_RADIUS, ...PILL_SHADOW },
  sentActionText: { fontFamily: FontFamily.bold, fontSize: 14 },
  countBadge:   { minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: "center", justifyContent: "center" },
  countBadgeText: { fontFamily: FontFamily.bold, fontSize: 12, color: "#fff" },
  searchBtn:    { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  searchRow:    { marginBottom: 12 },
  searchBox:    { flexDirection: "row", alignItems: "center", gap: 9, height: 42, paddingHorizontal: 14, borderRadius: PILL_RADIUS, borderWidth: 1, ...PILL_SHADOW },
  searchInput:  { flex: 1, fontFamily: FontFamily.regular, fontSize: 15, padding: 0 },
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
