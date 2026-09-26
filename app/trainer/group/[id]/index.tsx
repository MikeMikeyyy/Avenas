// A group's own page: the members in it, and the things you do with them.
//
// Reached by tapping a group on the trainer hub. The CHAT lives one level down
// at /trainer/group/<id>/chat — a group is a roster first and a conversation
// second, which is the point of grouping clients up in the first place.
//
// Members render with the same ClientCard as My Clients, so a group reads as a
// filtered view of the roster rather than a separate concept, and tapping one
// opens that client exactly as it would from the hub.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import FadeScreen from "../../../../components/FadeScreen";
import NeuCard from "../../../../components/NeuCard";
import BounceButton from "../../../../components/BounceButton";
import OfflineBanner from "../../../../components/OfflineBanner";
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
import GroupChatIcon from "../../../../components/icons/GroupChatIcon";
import UserPlusIcon from "../../../../components/icons/UserPlusIcon";
import SendIcon from "../../../../components/icons/SendIcon";
import PeopleIcon from "../../../../components/icons/PeopleIcon";
import UserRoundMinusIcon from "../../../../components/icons/UserRoundMinusIcon";
import ReviewStatusPill, { REVIEW_STAGE_LABEL, removeReviewNote, reviewStage } from "../../../../components/trainer/ReviewStatusPill";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER_BRIGHT, ROLE_OWNER, ROLE_TRAINER, ROLE_MEMBER } from "../../../../constants/theme";
import { pill, pillGlow, haloGlow, PILL_H_SM, PILL_RADIUS, PILL_SHADOW } from "../../../../constants/buttons";
import { CARD_INNER, CARD_META, CARD_PILL, CARD_PILL_TEXT, CARD_TITLE, CARD_TOP, REVEAL_BLEED, SUMMARY_ROW } from "../../../../constants/cards";
import FavouriteStar, { useFavouriteGold } from "../../../../components/FavouriteStar";
import SheetPill from "../../../../components/SheetPill";
import { useTheme } from "../../../../contexts/ThemeContext";
import { useUnit } from "../../../../contexts/UnitContext";
import { fetchPeopleUnits } from "../../../../lib/clientTraining";
import { unitLabel, unitOf } from "../../../../utils/units";
import { useAccountType } from "../../../../contexts/AccountTypeContext";
import { useAuth } from "../../../../contexts/AuthContext";
import { deleteGroup, fetchGroupMembers, leaveGroup, setGroupMemberRole, setGroupMembers, subscribeToGroup } from "../../../../lib/groups";
import { getMyUid } from "../../../../lib/chat";
import { scheduleCloudPush } from "../../../../lib/syncManager";
import { loadGroupUnread, sortByFavourite, toggleFavouriteGroup, toggleFavouriteMember } from "../../../../utils/groupStore";
import { acceptSharedProgramBatch, appendSentProgram, appendSharedPrograms, applyReturnedProgram, batchKeyOf, dismissKeyOf, dismissSharedBatch, loadGroupReviewPrograms, loadGroupSharedPrograms, removeGroupSharedProgramBatch, returnedKeyOf, setGroupReviewDone, setReviewArchived, setSendBatchArchived, type Client, type SentProgram, type SharedProgram } from "../../../../utils/trainerStore";
import {
  dropGroupPage,
  EMPTY_GROUP_PAGE,
  hydrateGroupPage,
  loadGroupPage,
  peekGroupPage,
  saveGroupPage,
  type GroupPageData,
  type GroupPageLoad,
} from "../../../../utils/groupPage";
import { getJSON } from "../../../../utils/storage";
import { fmtAgo } from "../../../../utils/dates";
import { archiveShareChoice, removeShareConfirm } from "../../../../utils/removeShare";
import { askArchiveOrDelete } from "../../../../utils/archiveChoice";
import ArchiveButton from "../../../../components/ArchiveButton";
import { PROGRAMS_KEY, type SavedProgram } from "../../../../constants/programs";
import { canCoachGroup, type GroupMember, type GroupRole } from "../../../../constants/groups";
import { alertMessage } from "../../../../utils/errors";
import BackButton, { BACK_TOP, BACK_LEFT } from "../../../../components/BackButton";

/** How many member avatars the banner stacks before collapsing to "+N". */
const AVATAR_STACK = 4;

/** Space kept between the bottom of the member search pill and the keyboard.
 *  Not just enough to clear it: the matches appear UNDER the pill, and the
 *  keyboard's down button closes the search, so this leaves room for a few of
 *  them (and clears that floating button, which sits ~55pt above the keyboard). */
const SEARCH_KEYBOARD_GAP = 130;

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
function SentBatchCard({ batch, open, myUid, iCoachGroup, isDark, senderName, nameFor, onToggle, onView, onAccept, onRemove, onDismiss }: {
  batch: SentBatch;
  open: boolean;
  myUid: string | null;
  iCoachGroup: boolean;
  isDark: boolean;
  /** Who sent it, resolved against the roster. */
  senderName: string;
  /** A recipient's name, for the per-person list a coach sees. */
  nameFor: (userId: string) => string;
  onToggle: () => void;
  onView: (sharedId: string) => void;
  onAccept: () => void;
  /** Takes the send back out of the group. "Remove", not "Delete": the copies
   *  members already accepted are theirs and stay put. */
  onRemove: () => void;
  /** A member taking it off their OWN list. Never touches My Programs, the
   *  group, or anyone else's view. */
  onDismiss: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reveal = useReveal();
  useEffect(() => { reveal.setOpen(open); }, [open, reveal]);

  // My own entry in this batch — what Accept acts on. A coach who sent it has
  // no entry of their own, which is one more reason they never see Accept.
  const mine = batch.entries.find(e => e.clientId === myUid);
  // Whether I sent it. The sender can always take their own send back out of
  // the group (the database allows it), trainer role or not: after being made
  // a plain member, their Remove fell through to "hide from my list", which
  // never applies to your own send, so it did nothing.
  const iSent = !!myUid && batch.entries.some(e => e.senderId === myUid);
  const canRemoveForAll = iCoachGroup || iSent;
  const allAccepted = batch.acceptedCount === batch.entries.length;
  // The count is only the truth when I can see the whole batch, which the
  // database grants to this group's coaches and no one else. A member sees one
  // row and would read "0 of 1".
  const pill = mine?.acceptedAtISO
    ? "Accepted"
    : iCoachGroup
      ? (allAccepted ? "Accepted" : `${batch.acceptedCount}/${batch.entries.length} accepted`)
      : "Shared";
  const accent = !!mine?.acceptedAtISO || (iCoachGroup && allAccepted);
  const cycle = batch.entries[0]?.programSnapshot?.cyclePattern ?? [];

  return (
    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
      <View>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${batch.programName}, ${pill}, ${open ? "collapse" : "expand"}`}
        >
          <View style={styles.cardInner}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sentName, { color: t.tp }]} numberOfLines={1}>{batch.programName}</Text>
                {/* Who sent it and when, on the CLOSED card: in a gym any coach
                    can send to the group, so "whose programming is this" is the
                    first thing you want and shouldn't be behind a tap. */}
                <Text style={[styles.sentMeta, { color: t.ts }]} numberOfLines={1}>
                  {senderName} · Sent {fmtAgo(batch.sentAtISO)} · {batch.entries.length} member{batch.entries.length === 1 ? "" : "s"}
                </Text>
              </View>
              <View style={[styles.statusPill, accent
                ? { backgroundColor: `${ACCT}22` }
                : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
              ]}>
                <Text style={[styles.statusText, { color: accent ? ACCT : t.ts }]}>{pill}</Text>
              </View>
            </View>
            {cycle.length > 0 && (
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
            )}
            {/* Inside the padded body and ABOVE the chevron, so opening the
                card grows it downward into the actions rather than pushing them
                out beneath the control that revealed them. The reveal is a
                clipped zero-height box when closed, so it costs no space: its
                own top padding lives on the content, which only exists once
                it's open. */}
            <ExpandReveal progress={reveal.progress} fade={reveal.fade} open={open} bleed={REVEAL_BLEED} contentStyle={styles.revealColumn}>
          {/* Who has it and who hasn't. Only a coach is served the whole batch,
              so only a coach gets a list; a member's one row is already the
              status pill above. */}
          {iCoachGroup && (
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
          )}
          {/* One line, in a fixed order: View, Accept (while mine is still
              waiting), Remove. They used to take 45% each and wrapped to a
              second line as soon as there were three.

              Remove means one of two things, and only one ever shows:
                a COACH, or whoever SENT it, takes the send back out of the
                  group, for everyone (members who accepted keep their copy);
                anyone else takes it off THEIR list — see DISMISSED_SHARES_KEY
                  — which never touches My Programs or anyone else's view.
              The sender has no entry of their own, so never sees Accept. */}
          <View style={styles.sentActionRow}>
            <BounceButton
              style={styles.sentActionFlex}
              onPress={() => onView((mine ?? batch.entries[0]).id)}
              accessibilityLabel={`View ${batch.programName}`}
            >
              <View style={[styles.sentActionBtn, { backgroundColor: t.ctrl }]}>
                <Text style={[styles.sentActionText, { color: t.tp }]}>View</Text>
              </View>
            </BounceButton>
            {mine && !mine.acceptedAtISO && (
              <BounceButton style={styles.sentActionFlex} onPress={onAccept} needsConnection accessibilityLabel={`Accept ${batch.programName}`}>
                <View style={[styles.sentActionBtn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }]}>
                  <Text style={[styles.sentActionText, { color: "#fff" }]}>Accept</Text>
                </View>
              </BounceButton>
            )}
            {(canRemoveForAll || mine) && (
              <BounceButton
                onPress={canRemoveForAll ? onRemove : onDismiss}
                // Taking it out of the group needs the server; off my own list doesn't.
                needsConnection={canRemoveForAll}
                accessibilityLabel={canRemoveForAll ? `Remove ${batch.programName} from the group` : `Remove ${batch.programName} from your list`}
              >
                <View style={[styles.sentActionBtn, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
                  <TrashIcon size={15} color="#fff" />
                  <Text style={[styles.sentActionText, { color: "#fff" }]}>Remove</Text>
                </View>
              </BounceButton>
            )}
          </View>
            </ExpandReveal>
            <View style={styles.chevronRow}>
              <ChevronToggle expanded={open} color={t.ts} upDown />
            </View>
          </View>
        </Pressable>
      </View>
    </NeuCard>
  );
}

/**
 * One program a member posted here for a coach to look at — the receiving half
 * of the group's program traffic, and deliberately the same card as the trainer
 * hub's "Programs Received": name, who it came from and when, a status pill,
 * and the actions behind a tap.
 *
 * Shown to the SENDER too. A gym user tracks their request on their own
 * trainer page as well, but a TRAINER who is a plain member of someone else's
 * group has no such page — their own hub only lists reviews addressed to them —
 * so this is where theirs lives. Once it's been sent back it carries the trainer
 * page's View · Accept · Remove. It used to be a status line with no actions, so
 * a trainer who asked could never accept the changes, and a coach's Remove took
 * even the status line away (loadGroupReviewPrograms now keeps it for them).
 */
function GroupReviewCard({ review, from, open, mode, isDark, onToggle, onOpen, onAccept, onRemove }: {
  review: SentProgram;
  /** Who asked, resolved against the roster. */
  from: string;
  open: boolean;
  /** "coach": someone else's request, mine to review. "mine": my own request. */
  mode: "coach" | "mine";
  isDark: boolean;
  onToggle: () => void;
  /** A coach opens the review screen; the person who asked views what came back. */
  onOpen: () => void;
  /** Mine, once it's back and not yet accepted: take the changes. */
  onAccept: () => void;
  /** A coach clears it from the group's queue, for every coach. Mine: takes it
   *  off my own list, and nobody else's. */
  onRemove: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reveal = useReveal();
  useEffect(() => { reveal.setOpen(open); }, [open, reveal]);

  const returned = review.status === "returned";
  const cycle = review.programSnapshot?.cyclePattern ?? [];
  // My own request has nothing on it to act on until it's back.
  const hasActions = mode === "coach" || returned;

  const row = (
    <View style={styles.cardInner}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sentName, { color: t.tp }]} numberOfLines={1}>{review.programName}</Text>
          <Text style={[styles.sentMeta, { color: t.ts }]} numberOfLines={1}>
            {from} · Sent {fmtAgo(review.sentAtISO)}
          </Text>
        </View>
        {/* The trainer hub's pill: orange while it waits on a trainer, green
            once it's gone back, solid green once it's been accepted. */}
        <ReviewStatusPill review={review} />
      </View>
      {/* The shape of the programming, before you open anything: the same strip
          the hub's cards carry, and often enough to answer "is this the block I
          already looked at". */}
      {cycle.length > 0 && (
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
      )}
      {/* Same shape as the sent card: the reveal lives inside the padded body,
          above the chevron that opens it, and takes no space while closed. */}
      {hasActions && (
        <>
          <ExpandReveal progress={reveal.progress} fade={reveal.fade} open={open} bleed={REVEAL_BLEED} contentStyle={styles.revealColumn}>
            {mode === "coach" ? (
              /* The trainer hub's Programs Received card, exactly: a white
                 Review and a red Remove, the same width. Review opens the
                 review screen, where the edit and the Send Back live (it was
                 labelled "Edit & Send Back", then "View Review" once sent).
                 Remove is what Mark Done was: it clears the item from this
                 group's queue for every coach, and the member keeps their copy
                 and can still accept what was sent back. */
              <View style={styles.sentActionRow}>
                <BounceButton
                  style={{ flex: 1 }}
                  onPress={onOpen}
                  accessibilityLabel={returned ? `Review ${review.programName}, already sent back` : `Review ${review.programName}`}
                >
                  <View style={[styles.sentActionBtn, { backgroundColor: t.ctrl }]}>
                    <Text style={[styles.sentActionText, { color: t.tp }]}>Review</Text>
                  </View>
                </BounceButton>
                <BounceButton style={{ flex: 1 }} onPress={onRemove} needsConnection accessibilityLabel={`Remove ${review.programName}`}>
                  <View style={[styles.sentActionBtn, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
                    <TrashIcon size={15} color="#fff" />
                    <Text style={[styles.sentActionText, { color: "#fff" }]}>Remove</Text>
                  </View>
                </BounceButton>
              </View>
            ) : (
              /* My own request, back from a trainer: the gym user trainer
                 page's returned card, in this page's order (as the sent card
                 above): View, Accept while it's still waiting, Remove. */
              <View style={styles.sentActionRow}>
                <BounceButton style={styles.sentActionFlex} onPress={onOpen} accessibilityLabel={`View ${review.programName}`}>
                  <View style={[styles.sentActionBtn, { backgroundColor: t.ctrl }]}>
                    <Text style={[styles.sentActionText, { color: t.tp }]}>View</Text>
                  </View>
                </BounceButton>
                {!review.appliedAtISO && (
                  <BounceButton style={styles.sentActionFlex} onPress={onAccept} needsConnection accessibilityLabel={`Accept the trainer's changes to ${review.programName}`}>
                    <View style={[styles.sentActionBtn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }]}>
                      <Text style={[styles.sentActionText, { color: "#fff" }]}>Accept</Text>
                    </View>
                  </BounceButton>
                )}
                <BounceButton onPress={onRemove} accessibilityLabel={`Remove ${review.programName} from your list`}>
                  <View style={[styles.sentActionBtn, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
                    <TrashIcon size={15} color="#fff" />
                    <Text style={[styles.sentActionText, { color: "#fff" }]}>Remove</Text>
                  </View>
                </BounceButton>
              </View>
            )}
          </ExpandReveal>
          <View style={styles.chevronRow}>
            <ChevronToggle expanded={open} color={t.ts} upDown />
          </View>
        </>
      )}
    </View>
  );

  // Nothing behind the tap while my own request is still waiting, so it isn't
  // a tap: the card states where it stands and stops there.
  if (!hasActions) return <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>{row}</NeuCard>;

  return (
    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
      <View>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${review.programName} from ${from}, ${REVIEW_STAGE_LABEL[reviewStage(review)].toLowerCase()}, ${open ? "collapse" : "expand"}`}
        >
          {row}
        </Pressable>
      </View>
    </NeuCard>
  );
}

export default function GroupPageScreen() {
  const router = useRouter();
  const { accountType } = useAccountType();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The options-menu label sits beside the star and must match it exactly.
  const favouriteGold = useFavouriteGold();
  const insets = useSafeAreaInsets();

  const groupId = id ?? "";
  // The account this page's saved copy belongs to (utils/pageSnapshot.ts).
  const { userId } = useAuth();
  const owner = userId ?? "";

  /**
   * Everything on this page, as ONE value (utils/groupPage.ts).
   *
   * It starts on the copy saved from the last visit, so the page opens whole
   * rather than on a spinner, and a load replaces it in a single render, so
   * arriving or pulling down updates it in place. It used to be separate pieces
   * of state behind a spinner on every visit, with each member's active program
   * added a moment after the rest.
   *
   * Null only when this group has never loaded on this device.
   */
  const [page, setPage] = useState<GroupPageData | null>(() => peekGroupPage(owner, groupId));
  /** A load has answered, even with a failure: the spinner stops either way. */
  const [settled, setSettled] = useState(false);
  const loading = page === null && !settled;
  const {
    group,
    members,
    clients,
    activeProgramByClient,
    unread,
    isFavourite,
    favouriteMemberIds,
    groupShares,
    groupReviews,
    blockedMemberIds,
    myUid,
  } = page ?? EMPTY_GROUP_PAGE;
  const blockedMembers = useMemo(() => new Set(blockedMemberIds ?? []), [blockedMemberIds]);
  /** Starred PEOPLE, oldest star first — the order they're pinned in. */
  const favouriteMembers = useMemo(() => new Set(favouriteMemberIds), [favouriteMemberIds]);

  // Whatever the page shows is what it opens on next time, including a change
  // made here (a role, a star, a removed send) that no load has seen yet.
  useEffect(() => {
    if (page) saveGroupPage(owner, groupId, page);
  }, [page, owner, groupId]);

  // The hub reads its groups' copies off the device ahead of time; opened any
  // other way (a notification, a link), read it now. A load that has already
  // landed is newer, so the copy never replaces it.
  useEffect(() => {
    let live = true;
    void hydrateGroupPage(owner, groupId).then(() => {
      const saved = peekGroupPage(owner, groupId);
      if (live && saved) setPage(p => p ?? saved);
    });
    return () => { live = false; };
  }, [owner, groupId]);

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
  /** Sections shown as one line each instead of full cards. Not persisted:
   *  they're a way to see past a long page on this visit, not preferences. */
  const [collapsedMembers, setCollapsedMembers] = useState(false);
  const [collapsedReviews, setCollapsedReviews] = useState(false);
  /** My own review requests' section ("Sent to Trainer"). Its own toggle: a
   *  trainer here can have both lists at once. */
  const [collapsedMyRequests, setCollapsedMyRequests] = useState(false);
  const [collapsedSent, setCollapsedSent] = useState(false);
  // Local, and only the program picker and my own row read it, so it's not
  // part of the page's saved copy.
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  const [expandedSent, setExpandedSent] = useState<Set<string>>(new Set());
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());

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
      setPage(p => p && { ...p, groupShares: shares, groupReviews: reviews });
    } catch (err) {
      if (__DEV__) console.warn("[avenas] refresh group shares", err);
    }
  }, [groupId]);

  /** Take a review out of the group's queue, for every coach: Archive (back
   *  from the group's archive, in the header) or Delete (completed_at, what
   *  Mark Done was). Coach-only at the database, so this button never renders
   *  for anyone else. */
  // Worded as the trainer hub's Remove on the same item, since a coach can
  // clear it from either place and should be told the same thing in both.
  const handleCompleteReview = useCallback((entry: SentProgram) => {
    const drop = () => setPage(p => p && { ...p, groupReviews: p.groupReviews.filter(r => r.id !== entry.id) });
    askArchiveOrDelete({
      title: "Remove Program",
      body: `Archive "${entry.programName}" to take it off the group's review list until you restore it, or delete it. ${removeReviewNote(entry)}`,
      onArchive: async () => {
        try {
          await setReviewArchived(entry.id, true);
        } catch (e) {
          Alert.alert("Couldn't archive it", alertMessage(e, "Check your connection and try again."));
          return;
        }
        drop();
      },
      onDelete: async () => {
        try {
          await setGroupReviewDone(entry.id, true);
        } catch (e) {
          Alert.alert("Couldn't update", alertMessage(e, "Check your connection and try again."));
          return;
        }
        drop();
      },
    });
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
      Alert.alert("Couldn't send program", alertMessage(e, "Check your connection and try again."));
      return;
    }
    // Put it in the section on this tick: the request now has a card of its own
    // here, and waiting for the next focus would look like the send was lost.
    await refreshGroupShares();
    Alert.alert("Sent for Review", `"${program.name}" was sent to the trainers in ${displayName}. It stays on this page until a trainer marks it done.`);
  }, [group?.ownerId, groupId, displayName, refreshGroupShares]);

  /**
   * A member taking a program off THEIR list of this group's sends. It's a
   * hide on this device (DISMISSED_SHARES_KEY): an accepted copy stays in My
   * Programs, and the coach who sent it still sees it as sent. The prompt says
   * which case you're in, because only the unaccepted one loses anything.
   */
  const handleDismissBatch = useCallback((batch: SentBatch) => {
    const mine = batch.entries.find(e => e.clientId === myUid);
    const accepted = !!mine?.acceptedAtISO;
    Alert.alert(
      "Remove Program",
      accepted
        ? `Remove "${batch.programName}" from this list? It stays in your programs.`
        : `Remove "${batch.programName}" without accepting it? It comes back if it's sent again or updated.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            // Hides this version: a Send Update brings it back (dismissKeyOf).
            await dismissSharedBatch(dismissKeyOf(mine ?? batch.entries[0]));
            await refreshGroupShares();
          },
        },
      ],
    );
  }, [myUid, refreshGroupShares]);

  /**
   * Take a send out of the group, for everyone. A trainer of the group gets
   * Archive beside Delete (back from the group's archive, in the header). A
   * sender who has since lost the trainer role can still take their own send
   * back, but has no archive here to restore from, so they get the plain
   * confirm.
   */
  const handleRemoveBatch = useCallback((batch: SentBatch) => {
    const removeForGood = async () => {
      try {
        await removeGroupSharedProgramBatch(groupId, batch.key);
      } catch (e) {
        // A refused or failed remove used to look like a dead button.
        Alert.alert("Couldn't remove program", alertMessage(e, "Check your connection and try again."));
      }
      await refreshGroupShares();
    };
    if (iCoachGroup) {
      const choice = archiveShareChoice({
        programName: batch.programName,
        recipients: "this group",
        total: batch.entries.length,
        accepted: batch.acceptedCount,
      });
      askArchiveOrDelete({
        title: choice.title,
        body: choice.body,
        onArchive: async () => {
          try {
            await setSendBatchArchived(batch.key, true, groupId);
          } catch (e) {
            Alert.alert("Couldn't archive it", alertMessage(e, "Check your connection and try again."));
          }
          await refreshGroupShares();
        },
        onDelete: removeForGood,
      });
      return;
    }
    const prompt = removeShareConfirm({
      programName: batch.programName,
      recipients: "this group",
      total: batch.entries.length,
      accepted: batch.acceptedCount,
    });
    Alert.alert(
      prompt.title,
      prompt.body,
      [
        { text: prompt.cancel, style: "cancel" },
        { text: prompt.confirm, style: "destructive", onPress: removeForGood },
      ],
    );
  }, [refreshGroupShares, groupId, iCoachGroup]);

  // Accepts in flight, by card: a second tap while the first is on its way
  // would otherwise say "added" twice (the store adds it once either way).
  const accepting = useRef(new Set<string>());

  const handleAcceptBatch = useCallback(async (batchKey: string, programName: string) => {
    if (accepting.current.has(batchKey)) return;
    accepting.current.add(batchKey);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await acceptSharedProgramBatch(batchKey);
    } catch (e) {
      // Deleted or archived since the card was drawn: the refresh takes it away.
      Alert.alert("Couldn't add program", alertMessage(e, "Check your connection and try again."));
      await refreshGroupShares();
      return;
    } finally {
      accepting.current.delete(batchKey);
    }
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
      // A member's Group Programs are what the group's trainers sent them, so
      // their own sends aren't part of it. They only have any from a time they
      // held the trainer role: those stay in the group for everyone else, and
      // in its coaches' Group Programs, but not in the member's own view.
      if (!iCoachGroup && myUid && s.senderId === myUid) continue;
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
  }, [groupShares, iCoachGroup, myUid]);

  /** Put a load's answer on the page. A failed load keeps what's showing (the
   *  saved copy, or the empty page when there's none), and every answer stops
   *  the spinner. */
  const applyLoad = useCallback((result: GroupPageLoad) => {
    setSettled(true);
    if (result.status === "loaded") {
      setPage(result.data);
    } else if (result.status === "gone") {
      Alert.alert("Group unavailable", "This group no longer exists, or you're no longer a member.");
      router.back();
    }
  }, [router]);

  const loadMyPrograms = useCallback(
    () => getJSON<SavedProgram[]>(PROGRAMS_KEY, []).then(progs => (Array.isArray(progs) ? progs : [])),
    [],
  );

  /** Take a trainer's changes to my own request: they go over my original
   *  program, as from my trainer page. Here too because a trainer who asked a
   *  group has no trainer page to do it from. */
  const handleAcceptReturned = useCallback(async (entry: SentProgram) => {
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
    setPage(p => p && { ...p, groupReviews: p.groupReviews.map(r => (r.id === entry.id ? { ...r, appliedAtISO: appliedAt } : r)) });
    setMyPrograms(await loadMyPrograms());
    Alert.alert("Program Updated", `"${entry.programName}" in your programs was updated with your trainer's edits.`);
  }, [loadMyPrograms]);

  /** Take my own returned request off this page. The trainer page's Remove on
   *  the same item, and the same hide (returnedKeyOf): this version only, so an
   *  update from the trainer brings it back. The group's queue is the coaches'
   *  and is untouched. */
  const handleRemoveReturned = useCallback((entry: SentProgram) => {
    Alert.alert(
      "Remove Program",
      entry.appliedAtISO
        ? `Remove "${entry.programName}" from this list? The changes stay in your programs.`
        : `Remove "${entry.programName}" without accepting the changes? Your program stays as it was.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await dismissSharedBatch(returnedKeyOf(entry));
            setPage(p => p && { ...p, groupReviews: p.groupReviews.filter(r => r.id !== entry.id) });
          },
        },
      ],
    );
  }, []);

  /** What came back on my own request: my program, once the changes are in it;
   *  the returned version until then, looked up through this group because a
   *  trainer's own sent list doesn't hold it. */
  const viewReturned = useCallback((r: SentProgram) => {
    router.navigate(r.appliedAtISO
      ? { pathname: "/programs", params: { focus: r.programId } }
      : { pathname: "/program-view", params: { sentId: r.id, groupId } });
  }, [router, groupId]);

  /**
   * Arriving brings the page up to date: behind the saved copy it opened on,
   * in one render when the load lands. The cancel flag stops a load that
   * outlives the visit from writing to the page; a loaded result is saved
   * regardless (loadGroupPage), so the next visit starts from it.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void loadGroupPage(owner, groupId).then(result => { if (!cancelled) applyLoad(result); });
    void loadMyPrograms().then(progs => { if (!cancelled) setMyPrograms(progs); });
    return () => { cancelled = true; };
  }, [owner, groupId, applyLoad, loadMyPrograms]));

  /**
   * The Group Chat badge, kept live while this page is on screen.
   *
   * The count used to be read only when the page loaded, so a message arriving
   * while you were looking at the group never showed until you left and came
   * back. Now each new message from someone else re-reads the count — through
   * loadGroupUnread, the same read the page load uses, so a blocked member's or a
   * hidden message still doesn't count, and my own sends never do. (It used to
   * go through loadGroupRows, every message in every group, which the API's
   * 1000-row cap cut off at the OLDEST end — leaving this badge at 0.)
   *
   * Focus-scoped: it stops when you open the chat (which marks the thread read
   * and has its own listener) and starts again when you come back. Its own
   * channel key, so the two never share a channel.
   */
  useFocusEffect(useCallback(() => {
    if (!groupId) return;
    let active = true;
    const unsubscribe = subscribeToGroup(groupId, async senderId => {
      const uid = await getMyUid();
      if (!active || senderId === uid) return;
      const count = await loadGroupUnread(groupId);
      if (active) setPage(p => p && { ...p, unread: count });
    }, "page");
    return () => { active = false; unsubscribe(); };
  }, [groupId]));

  /** Pull down to re-read the group: new messages waiting in the chat, a
   *  program a coach just sent, a review someone posted, someone who accepted
   *  their invite. Always its own read of the server, separate from the one
   *  made on arrival. Runs to completion, and always clears the spinner because
   *  `loadGroupPage` never rejects. */
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const [result, progs] = await Promise.all([loadGroupPage(owner, groupId), loadMyPrograms()]);
    applyLoad(result);
    setMyPrograms(progs);
    setRefreshing(false);
  }, [owner, groupId, applyLoad, loadMyPrograms]);

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
    setPage(p => p && { ...p, isFavourite: next.has(groupId) });
  }, [groupId]);

  /** Star or unstar a person. The list re-sorts on the next render, so the card
   *  travels to the top (or back into the roster) as you tap it. Starring is
   *  account-wide rather than per-group — the same person in two groups is
   *  pinned in both. */
  const onToggleMemberFavourite = useCallback(async (memberId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await toggleFavouriteMember(memberId);
    setPage(p => p && { ...p, favouriteMemberIds: [...next] });
  }, []);

  const toggleMembersSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedMembers(v => !v);
  }, []);

  const toggleReviewsSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedReviews(v => !v);
  }, []);

  const toggleMyRequestsSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedMyRequests(v => !v);
  }, []);

  const toggleSentSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedSent(v => !v);
  }, []);

  const searchInputRef = useRef<TextInput>(null);
  // Closing clears the query AND drops the keyboard in the same step, so the
  // search row and the keyboard go together rather than leaving one behind,
  // and reopening never shows a stale filter. The X does this, and so does the
  // keyboard's down button while you're typing a search.
  const closeSearch = useCallback(() => {
    setQuery("");
    Keyboard.dismiss();
    setSearchOpen(false);
  }, []);
  const toggleSearch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (searchOpen) closeSearch();
    else setSearchOpen(true);
  }, [searchOpen, closeSearch]);
  // Asked before anything is dismissed: once the keyboard drops, nothing is
  // focused any more.
  const onKeyboardDown = useCallback(() => {
    if (searchInputRef.current?.isFocused()) closeSearch();
    else Keyboard.dismiss();
  }, [closeSearch]);

  // Members is the page's last section, so its search pill opened underneath
  // the keyboard. While searching with the keyboard up, the page grows by the
  // keyboard's height (the ScrollView's paddingBottom) and scrolls just far
  // enough to lift the pill SEARCH_KEYBOARD_GAP above it. When the keyboard
  // drops, the page goes back to where it was.
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const searchBoxRef = useRef<View>(null);
  const [kbHeight, setKbHeight] = useState(0);
  const kbTop = useRef(0);
  const preSearchY = useRef<number | null>(null);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => {
      kbTop.current = e.endCoordinates.screenY;
      setKbHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (searchOpen && kbHeight > 0) {
      // A frame after the taller page has laid out, so the scroll can reach it.
      const frame = requestAnimationFrame(() => {
        searchBoxRef.current?.measureInWindow((_x, y, _w, h) => {
          const overlap = y + h - (kbTop.current - SEARCH_KEYBOARD_GAP);
          if (overlap <= 0) return;
          if (preSearchY.current === null) preSearchY.current = scrollY.current;
          scrollRef.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (kbHeight === 0 && preSearchY.current !== null) {
      scrollRef.current?.scrollTo({ y: preSearchY.current, animated: true });
      preSearchY.current = null;
    }
  }, [searchOpen, kbHeight]);

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
      setPage(p => p && { ...p, members: p.members.map(x => (x.id === m.id ? { ...x, role: next } : x)) });
      Alert.alert(
        next === "trainer" ? "Now a trainer" : "Now a member",
        next === "trainer"
          ? `${m.name} can send programs to this group and to people in it.`
          : `${m.name} can no longer send programs to this group.`,
      );
    } catch (e) {
      Alert.alert("Couldn't change role", alertMessage(e, "Check your connection and try again."));
    }
  }, [groupId]);

  // Take someone out of the group, or withdraw their invite. Owner-only, and
  // set_group_members refuses anyone else. That RPC replaces the roster
  // wholesale (keeping every row it's passed as it was, role and accept alike),
  // so it's handed the roster read NOW minus this one person: the page's copy
  // could still list someone who has since left, and passing them would invite
  // them straight back.
  const removeMember = useCallback((m: GroupMember) => {
    setMemberMenu(null);
    Alert.alert(
      m.accepted ? `Remove ${m.name}?` : `Cancel ${m.name}'s invite?`,
      m.accepted
        ? `They'll leave ${displayName} and stop receiving its messages. You can add them back later.`
        : `They won't be able to join ${displayName}. You can invite them again later.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: m.accepted ? "Remove" : "Cancel Invite", style: "destructive", onPress: async () => {
          try {
            const roster = await fetchGroupMembers(groupId);
            const rest = roster.filter(x => x.id !== m.id);
            await setGroupMembers(groupId, rest.filter(x => !x.isOwner).map(x => x.id));
            setPage(p => p && { ...p, members: rest });
          } catch (e) {
            Alert.alert(m.accepted ? "Couldn't remove them" : "Couldn't cancel the invite", alertMessage(e, "Check your connection and try again."));
          }
        } },
      ],
    );
  }, [groupId, displayName]);

  // Everyone in the group except me. A trainer never sends a program to
  // themselves, and only real connections can receive one.
  const recipientIds = members.filter(m => m.id !== myUid).map(m => m.id);

  // How many of them log in the other unit, for the send sheet: a program's
  // weights read in the unit they were entered in, so say who'll see yours in
  // a unit they don't use. Looked up when the sheet opens (0036; unknown
  // counts as the same unit, so a missing server only drops the note).
  const { isKg: ownIsKg } = useUnit();
  const [otherUnitCount, setOtherUnitCount] = useState(0);
  const recipientKey = recipientIds.join(",");
  useEffect(() => {
    if (picker !== "send") return;
    let cancelled = false;
    fetchPeopleUnits(recipientKey.split(",").filter(Boolean))
      .then(u => { if (!cancelled) setOtherUnitCount(Object.values(u).filter(x => x !== unitOf(ownIsKg)).length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [picker, recipientKey, ownIsKg]);

  /** My own standing in this group, which decides whether I can send programs. */
  const myRole: GroupRole = members.find(m => m.id === myUid)?.role ?? "member";
  const canCoach = canCoachGroup(myRole);
  /**
   * Whether I can send a program OUT to the whole group: the owner and anyone
   * they've made a trainer here. The ROLE decides, not the account type: a gym
   * user the owner makes a trainer sends, reviews and removes exactly like a
   * trainer account does, which is what the database allows too
   * (can_coach_in_group). Gating it on the account type as well left a
   * promoted gym user a trainer in name only, with no Send Program.
   */
  const canSendToGroup = canCoach;

  // Filters the list only. The banner, the count badge and a program send all
  // stay whole-group — searching is for finding someone, not for narrowing who
  // a program reaches.
  // Starred people first, oldest star at the top, then the roster's own order
  // (owner, trainers, then by name) underneath. Sorted AFTER the search filter
  // so a search result list is pinned the same way the full one is.
  const visibleMembers = (() => {
    const q = query.trim().toLowerCase();
    const matched = q ? members.filter(m => m.name.toLowerCase().includes(q)) : members;
    return sortByFavourite(matched, favouriteMembers);
  })();

  /**
   * One row's worth of decisions, shared by the full cards and the compact
   * list — the two views are the same roster drawn twice, so what a row says
   * and what tapping it does can't be allowed to drift between them.
   *
   * YOUR OWN row never opens anything. The client page is a page ABOUT someone
   * you coach, built from the client roster, and you are not on your own
   * roster, so it loaded, found nothing and said "client not found".
   *
   * For everyone else: the owner gets a sheet to promote or demote, a coach of
   * the group opens the client page, and a fellow member gets a roster entry
   * and nothing more. The client page is a coaching surface (progress, journal,
   * send a program) and opening it on a fellow member would claim a
   * relationship that isn't there. No action means no onPress at all, so
   * nothing bounces and buzzes on a tap that goes nowhere.
   *
   * get_group_members orders owner, then trainers, then members, so the badges
   * read top to bottom in rank order. An outstanding invite outranks the role:
   * what they'd be once they join is less useful than knowing they haven't.
   * My own row says "YOU" AND my role, in the role's colour ("YOU · TRAINER"):
   * it said "YOU" alone, so someone made a trainer had no way to see it. It's
   * also why that one row doesn't respond to a tap.
   *
   * Someone I've blocked reads "BLOCKED", in grey, over everything else: they
   * stay in a group I don't own, their messages and programs are hidden from
   * me, and without it they'd simply seem to have gone quiet.
   */
  const memberRows = visibleMembers.map(m => {
    const isMe = m.id === myUid;
    const isBlocked = !isMe && blockedMembers.has(m.id);
    return {
      member: m,
      isMe,
      badge: isBlocked ? "BLOCKED" : isMe ? `YOU · ${ROLE_LABEL[m.role]}` : m.accepted ? ROLE_LABEL[m.role] : "INVITED",
      badgeColor: isBlocked ? t.ts : isMe || m.accepted ? ROLE_COLOR[m.role] : t.ts,
      // Everyone but you opens the same sheet, whatever your standing here.
      // It used to be owner-only, with a coach going straight to the client
      // page and a plain member's row doing nothing at all — which left
      // favouriting, now a row in that sheet, reachable by the owner alone.
      // What the sheet OFFERS is still gated by role; getting to it isn't.
      onPress: isMe ? undefined : () => openMemberMenu(m),
    };
  });

  const handleSendProgram = useCallback(async (program: SavedProgram) => {
    setPicker(null);
    if (recipientIds.length === 0) {
      Alert.alert("No one to send to", "This group has no other members yet.");
      return;
    }
    // One row per member, exactly like the hub's send flow — the shared batch
    // key collapses them into a single card in "Group Programs".
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
      Alert.alert("Couldn't send program", alertMessage(e, "Check your connection and try again."));
      return;
    }
    // Re-read so the Group Programs section updates on this tick. The page loads
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
            dropGroupPage(groupId);
            router.back();
          } catch (e) {
            Alert.alert("Couldn't leave", alertMessage(e, "Check your connection and try again."));
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
            dropGroupPage(groupId);
            router.back();
          } catch (e) {
            Alert.alert("Couldn't delete group", alertMessage(e, "Check your connection and try again."));
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

  /** A person's name for a program card, resolved against the roster. Someone
   *  who has since left the group is no longer in it, but the send they were
   *  part of still is, so the row keeps a neutral label rather than blanking. */
  const memberNameFor = useCallback((userId: string): string => {
    if (userId === myUid) return "You";
    return members.find(m => m.id === userId)?.name ?? "A member";
  }, [members, myUid]);

  /** Who sent a batch. Every row in a send shares a sender, so the head's is
   *  the batch's; a legacy row without one falls back to the group's coach
   *  language rather than naming the wrong person. */
  const senderNameFor = useCallback((batch: SentBatch): string => {
    const senderId = batch.entries[0]?.senderId;
    return senderId ? `From ${memberNameFor(senderId)}` : "From a coach";
  }, [memberNameFor]);

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

  /* The group's review queue: programs posted here for a coach to look at, the
      other direction from sharesSection. Anything marked done has left the
      queue entirely; that's the point of it being a queue rather than a log.

      Split by whose request it is, because anyone the owner makes a trainer
      can ASK for a review as well as review (they're given both buttons):
        receivedReviews   other people's requests. A coach reviews these,
                          under "Programs Received", the hub's name for them.
        myReviewRequests  my own, under "Sent to Trainer" like the gym user's
                          trainer page: a status line while it waits, then
                          View · Accept · Remove once it's back, kept after a
                          coach clears the queue until I remove it myself
                          (loadGroupReviewPrograms). All a plain member ever
                          has (RLS gives a group's other reviews to its
                          coaches only).
      Nobody reviews their own request, so a trainer's own ask is never in
      their Programs Received with Review on it. */
  const receivedReviews = iCoachGroup ? groupReviews.filter(r => r.senderId !== myUid) : [];
  const myReviewRequests = groupReviews.filter(r => !iCoachGroup || r.senderId === myUid);

  const renderReviews = (list: SentProgram[], asCoach: boolean, collapsed: boolean, onToggleSection: () => void) => list.length === 0 ? null : (
    <>
      <Pressable
        onPress={onToggleSection}
        style={styles.sectionRow}
        accessibilityRole="button"
        accessibilityLabel={`${asCoach ? "Programs Received" : "Sent to Trainer"}, ${list.length}. Toggle list`}
      >
        {/* Named from where the reader stands, as on the trainer pages:
            to a coach it's what members sent them (the hub's Programs
            Received); to the person who asked, it's the gym user
            trainer page's "Sent to Trainer". */}
        <Text style={[styles.sectionHeading, { color: t.tp }]}>
          {asCoach ? "Programs Received" : "Sent to Trainer"}
        </Text>
        <View style={[styles.countBadge, { backgroundColor: ACCT }]}>
          <Text style={styles.countBadgeText}>{list.length}</Text>
        </View>
        <ChevronToggle expanded={!collapsed} color={t.ts} />
      </Pressable>
      {collapsed ? (
        <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
          {list.map((r, i) => {
            // A coach opens the review; I open what came back on mine, once
            // there's something to open.
            const onPress = asCoach
              ? () => router.navigate({ pathname: "/trainer/review/[id]", params: { id: r.id, groupId } })
              : r.status === "returned" ? () => viewReturned(r) : undefined;
            return (
              <TouchableOpacity
                key={r.id}
                onPress={onPress}
                disabled={!onPress}
                activeOpacity={0.7}
                accessibilityRole={onPress ? "button" : "text"}
                accessibilityLabel={asCoach ? `Open review for ${r.programName}` : onPress ? `View ${r.programName}` : r.programName}
                style={[
                  styles.summaryRow,
                  { borderBottomColor: t.div, borderBottomWidth: i === list.length - 1 ? 0 : 1 },
                ]}
              >
                <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{r.programName}</Text>
                <ReviewStatusPill review={r} />
              </TouchableOpacity>
            );
          })}
        </NeuCard>
      ) : (
        list.map(r => (
          <GroupReviewCard
            key={r.id}
            review={r}
            from={reviewFrom(r)}
            open={expandedReviews.has(r.id)}
            mode={asCoach ? "coach" : "mine"}
            isDark={isDark}
            onToggle={() => toggleReview(r.id)}
            onOpen={asCoach
              ? () => router.navigate({ pathname: "/trainer/review/[id]", params: { id: r.id, groupId } })
              : () => viewReturned(r)}
            onAccept={() => handleAcceptReturned(r)}
            onRemove={asCoach ? () => handleCompleteReview(r) : () => handleRemoveReturned(r)}
          />
        ))
      )}
    </>
  );
  const reviewsSection = renderReviews(receivedReviews, true, collapsedReviews, toggleReviewsSection);
  const myRequestsSection = renderReviews(myReviewRequests, false, collapsedMyRequests, toggleMyRequestsSection);

  /* Programs sent to this group. A send writes one row per member, so
      they're collapsed by batch key into one card each — the same key
      the trainer hub groups by, so both surfaces agree on what "one
      send" is. */
  const sharesSection = sentBatches.length > 0 ? (
    <>
      <Pressable
        onPress={toggleSentSection}
        style={styles.sectionRow}
        accessibilityRole="button"
        accessibilityLabel={`Group Programs, ${sentBatches.length}. Toggle list`}
      >
        {/* One name for everyone: the programs the group's trainers and owner
            have sent out to it. It used to be named from where the reader
            stood ("Programs Sent" to a coach, "From Your Trainer" to a
            member), which put the same programs under "Programs Sent" for a
            gym user holding the trainer role, who hadn't sent any of them. */}
        <Text style={[styles.sectionHeading, { color: t.tp }]}>Group Programs</Text>
        <View style={[styles.countBadge, { backgroundColor: ACCT }]}>
          <Text style={styles.countBadgeText}>{sentBatches.length}</Text>
        </View>
        <ChevronToggle expanded={!collapsedSent} color={t.ts} />
      </Pressable>
      {collapsedSent ? (
        <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
          {sentBatches.map((b, i) => {
            const mine = b.entries.find(e => e.clientId === myUid);
            const all = b.acceptedCount === b.entries.length;
            const accent = !!mine?.acceptedAtISO || (iCoachGroup && all);
            const label = mine?.acceptedAtISO
              ? "Accepted"
              : iCoachGroup ? (all ? "Accepted" : `${b.acceptedCount}/${b.entries.length} accepted`) : "Shared";
            return (
              <TouchableOpacity
                key={b.key}
                onPress={() => router.navigate({
                  pathname: "/program-view",
                  params: { sharedId: (mine ?? b.entries[0]).id },
                })}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`View ${b.programName}`}
                style={[
                  styles.summaryRow,
                  { borderBottomColor: t.div, borderBottomWidth: i === sentBatches.length - 1 ? 0 : 1 },
                ]}
              >
                <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{b.programName}</Text>
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
      ) : (
        sentBatches.map(b => (
          <SentBatchCard
            key={b.key}
            batch={b}
            open={expandedSent.has(b.key)}
            myUid={myUid}
            iCoachGroup={iCoachGroup}
            isDark={isDark}
            senderName={senderNameFor(b)}
            nameFor={memberNameFor}
            onToggle={() => toggleSent(b.key)}
            onView={(sharedId) => router.navigate({ pathname: "/program-view", params: { sharedId } })}
            onAccept={() => handleAcceptBatch(b.key, b.programName)}
            onRemove={() => handleRemoveBatch(b)}
            onDismiss={() => handleDismissBatch(b)}
          />
        ))
      )}
    </>
  ) : null;

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + BACK_TOP, borderBottomColor: t.div }]}>
        <BackButton inline />
        {/* The group's photo, on the left beside its name, the way a chat
            header or a contact card shows who it is. The owner can tap it to
            change the photo (it opens Manage, where the picker lives); for
            anyone else it's a picture, not a control. */}
        <View style={styles.headerTitleRow}>
          <TouchableOpacity
            activeOpacity={group?.isOwner ? 0.8 : 1}
            onPress={group?.isOwner ? openManage : undefined}
            disabled={!group?.isOwner}
            accessibilityRole={group?.isOwner ? "button" : "image"}
            accessibilityLabel={group?.isOwner ? "Change group photo" : `${displayName} photo`}
          >
            <GroupAvatar uri={group?.photoUri} size={40} isDark={isDark} />
          </TouchableOpacity>
          {isFavourite && <FavouriteStar size={16} />}
          <Text style={[styles.headerName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        </View>
        {/* The group's archive, for the people who can archive here: its
            trainers. A member's Remove is a hide on their own device, with
            nothing to restore. */}
        {iCoachGroup && (
          <ArchiveButton onPress={() => router.navigate({ pathname: "/program-archive", params: { scope: "group", groupId, groupName: displayName } })} />
        )}
        <TouchableOpacity onPress={() => setMenuOpen(true)} activeOpacity={0.8} accessibilityLabel="Group options" accessibilityRole="button">
          <View style={[styles.iconBtn, { backgroundColor: t.ctrl }]}>
            <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
          </View>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={ACCT} /></View>
      ) : (
        // A plain ScrollView, not react-native-keyboard-controller's
        // KeyboardAwareScrollView: that is a Reanimated.ScrollView, which on
        // Fabric doesn't resize for the ExpandReveal cards growing inside it.
        // The keyboard handling for the member search is the effect above.
        <ScrollView
          ref={scrollRef}
          onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          // Without this the keyboard eats the first tap on any button while
          // the search field is focused, so closing search took two taps.
          keyboardShouldPersistTaps="handled"
          // Searching with the keyboard up adds its height below the page, so
          // a search pill at the very bottom has room to scroll above it.
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 40 + (searchOpen ? kbHeight : 0) }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={ACCT}
              colors={[ACCT]}
            />
          }
        >
          <OfflineBanner />
          {/* Banner: who's in it, and the two things you do with a group. The
              group's own photo lives in the header beside its name instead —
              stacked above the member faces it read as one more of them, a
              large circle heading a row of small ones. */}
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

              {/* Sending OUT to the group belongs to the owner and anyone
                  they've made a trainer here, gym user or trainer account
                  (canSendToGroup). Every member gets Ask for Review in the same
                  green slot. */}
              <View style={styles.actionRow}>
                <BounceButton style={{ flex: 1 }} onPress={openChat} accessibilityLabel={`Open ${displayName} chat`}>
                  <View style={[styles.actionBtn, styles.actionChrome, { backgroundColor: t.ctrl }]}>
                    <GroupChatIcon size={17} color={t.tp} />
                    <Text style={[styles.actionText, { color: t.tp }]}>Group Chat</Text>
                    <UnreadBadge count={unread} style={styles.actionBadge} />
                  </View>
                </BounceButton>
                {canSendToGroup ? (
                  <BounceButton style={{ flex: 1 }} onPress={() => setPicker("send")} needsConnection accessibilityLabel="Send a program to this group">
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
                  <BounceButton style={{ flex: 1 }} onPress={() => setPicker("review")} needsConnection accessibilityLabel="Send a program to this group for review">
                    <View style={[styles.actionBtn, styles.actionPrimary]}>
                      <SendIcon size={17} color="#fff" />
                      <Text style={[styles.actionText, { color: "#fff" }]}>Ask for Review</Text>
                    </View>
                  </BounceButton>
                )}
              </View>
              {/* Anyone the owner has made a trainer here can do both: send
                  programs out, and still ask for a review of their own. The
                  owner has no one above them in the group, so they get Send
                  Program alone. A white button on its own row: Send Program
                  stays the one green action, and three buttons wouldn't fit on
                  one line. */}
              {canSendToGroup && myRole !== "owner" && (
                <BounceButton onPress={() => setPicker("review")} needsConnection accessibilityLabel="Send a program to this group for review">
                  <View style={[styles.actionBtn, styles.actionChrome, { backgroundColor: t.ctrl }]}>
                    <SendIcon size={17} color={t.tp} />
                    <Text style={[styles.actionText, { color: t.tp }]}>Ask for Review</Text>
                  </View>
                </BounceButton>
              )}
            </View>
          </NeuCard>

          {/* The program sections, ordered from where the reader stands.
              A member: Group Programs above Sent to Trainer, the order of
              their own trainer page. A coach keeps the order this page has
              always had, the review queue (work waiting on them) above Group
              Programs, then any review they've asked for themselves. */}
          {iCoachGroup ? (
            <>
              {reviewsSection}
              {sharesSection}
              {myRequestsSection}
            </>
          ) : (
            <>
              {sharesSection}
              {myRequestsSection}
            </>
          )}

          <View style={styles.sectionRow}>
            {/* Tapping the heading collapses the roster to one line per person,
                the same toggle My Clients has on the hub. A gym's group runs to
                dozens of cards, and everything under this section is then a
                scroll away. */}
            <Pressable
              onPress={toggleMembersSection}
              style={styles.membersHeaderTap}
              accessibilityRole="button"
              accessibilityLabel={`Members, ${members.length}. Toggle list`}
            >
              <Text style={[styles.sectionHeading, { color: t.tp }]}>Members</Text>
              {/* The total, not the filtered count — group size is a stable fact,
                  and the list below already shows what a search matched. */}
              <View style={[styles.countBadge, { backgroundColor: ACCT }]}>
                <Text style={styles.countBadgeText}>{members.length}</Text>
              </View>
              {members.length > 0 && <ChevronToggle expanded={!collapsedMembers} color={t.ts} />}
            </Pressable>
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
                  <UserPlusIcon size={17} color={t.tp} />
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
              <View ref={searchBoxRef} style={[styles.searchBox, { backgroundColor: t.ctrl, borderColor: t.div }]}>
                <Ionicons name="search" size={17} color={t.ts} />
                <TextInput
                  ref={searchInputRef}
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
          ) : collapsedMembers ? (
            /* One line each, in one card: the same compact mode My Clients has
               on the hub. Same order, same badges, same tap, just less of it. */
            <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
              {memberRows.map((r, i) => (
                <TouchableOpacity
                  key={r.member.id}
                  onPress={r.onPress}
                  disabled={!r.onPress}
                  activeOpacity={0.7}
                  accessibilityRole={r.onPress ? "button" : "text"}
                  accessibilityLabel={r.onPress ? `Open ${r.member.name}` : r.member.name}
                  style={[
                    styles.summaryRow,
                    { borderBottomColor: t.div, borderBottomWidth: i === memberRows.length - 1 ? 0 : 1 },
                  ]}
                >
                  <Avatar
                    uri={r.member.photoUri}
                    initials={r.member.initials}
                    size={28}
                    backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                    textColor={ACCT}
                    textStyle={[styles.summaryAvatarText, { color: ACCT }]}
                  />
                  <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{r.member.name}</Text>
                  <View style={[styles.statusPill, { backgroundColor: `${r.badgeColor}22` }]}>
                    <Text style={[styles.statusText, { color: r.badgeColor }]}>{r.badge}</Text>
                  </View>
                  {/* Marks the pinned rows; tapping the row opens the same
                      sheet the full card does, which is where starring lives. */}
                  {!r.isMe && favouriteMembers.has(r.member.id) && <FavouriteStar size={15} />}
                  {r.onPress ? <Ionicons name="chevron-forward" size={15} color={t.ts} /> : null}
                </TouchableOpacity>
              ))}
            </NeuCard>
          ) : (
            memberRows.map(r => {
              const m = r.member;
              return (
                <ClientCard
                  key={m.id}
                  client={clientFor(m)}
                  activeProgramName={r.isMe ? myActiveProgramName : activeProgramByClient[m.id]}
                  badge={r.badge}
                  badgeColor={r.badgeColor}
                  // In a group, a badge means standing in THIS group. The
                  // account-type TRAINER tag is the accent green a group OWNER
                  // is drawn in, so a trainer sitting here as a plain member
                  // read as something they weren't.
                  showAccountType={false}
                  // Shown only once starred, and not a control: starring is done
                  // in the member's own sheet, so the row keeps a single tap
                  // target. Never on your own row — pinning yourself to the top
                  // of a roster you're already reading isn't a thing you want.
                  isFavourite={!r.isMe && favouriteMembers.has(m.id)}
                  onPress={r.onPress}
                />
              );
            })
          )}
        </ScrollView>
      )}

      <SimpleSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        <View style={styles.menu}>
          <SheetPill
            label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            tint={isFavourite ? favouriteGold : undefined}
            icon={() => <FavouriteStar size={20} filled={isFavourite} inactiveColor={t.tp} />}
            onPress={onToggleFavourite}
            accessibilityState={{ selected: isFavourite }}
          />
          <SheetPill
            label={group?.isOwner ? "Manage members" : "View members"}
            icon={c => <Ionicons name="people-outline" size={18} color={c} />}
            onPress={openManage}
          />
          {group?.isOwner ? (
            <SheetPill label="Delete group" variant="danger" icon={c => <Ionicons name="trash-outline" size={18} color={c} />} onPress={onDelete} />
          ) : (
            <SheetPill label="Leave group" variant="danger" icon={c => <Ionicons name="exit-outline" size={18} color={c} />} onPress={onLeave} />
          )}
        </View>
      </SimpleSheet>

      {/* Per-member sheet, open to anyone: favouriting is here now, so it can't
          be owner-only. Each row below is gated by what you may actually do —
          starring is yours alone and always available, the client page is a
          coaching surface, and the role is the owner's to change. */}
      <SimpleSheet visible={memberMenu !== null} onClose={() => setMemberMenu(null)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{memberMenu?.name || "Member"}</Text>
        <View style={styles.menu}>
          {(() => {
            const starred = !!memberMenu && favouriteMembers.has(memberMenu.id);
            return (
              <SheetPill
                label={starred ? "Remove from favourites" : "Add to favourites"}
                tint={starred ? favouriteGold : undefined}
                icon={() => <FavouriteStar size={20} filled={starred} inactiveColor={t.tp} />}
                onPress={() => {
                  const m = memberMenu;
                  setMemberMenu(null);
                  if (m) void onToggleMemberFavourite(m.id);
                }}
                accessibilityState={{ selected: starred }}
              />
            );
          })()}
          {/* Only for someone who IS my client. The client page is a trainer's
              tool that opens a person from my own roster, so offering it for
              any group member (as it was, to every coach) sent a gym user made
              a trainer, or a trainer tapping someone they aren't connected to,
              to "Client not found". */}
          {iCoachGroup && accountType === "pt" && !!memberMenu && clients.some(c => c.id === memberMenu.id) && (
            <SheetPill
              label="Open client page"
              icon={c => <Ionicons name="person-outline" size={18} color={c} />}
              onPress={() => {
                const m = memberMenu;
                setMemberMenu(null);
                if (m) router.navigate({ pathname: "/trainer/client/[id]", params: { id: m.id } });
              }}
            />
          )}
          {group?.isOwner && (
            <SheetPill
              label={memberMenu?.role === "trainer" ? "Make a member" : "Make a trainer"}
              tint={memberMenu?.role === "trainer" ? undefined : ROLE_TRAINER}
              icon={c => <Ionicons name={memberMenu?.role === "trainer" ? "arrow-down-circle-outline" : "shield-checkmark-outline"} size={18} color={c} />}
              onPress={() => memberMenu && toggleRole(memberMenu)}
            />
          )}
          {group?.isOwner && (
            <SheetPill
              label={memberMenu?.accepted === false ? "Cancel invite" : "Remove from group"}
              variant="danger"
              icon={c => <UserRoundMinusIcon size={18} color={c} />}
              onPress={() => memberMenu && removeMember(memberMenu)}
            />
          )}
        </View>
      </SimpleSheet>

      <ProgramPickerSheet
        visible={picker !== null}
        title={picker === "review" ? "Ask for a Review" : `Send to ${displayName}`}
        subtitle={picker === "review"
          ? `A trainer in ${displayName} will look at it and send it back with their notes.`
          : `Everyone in this group receives it (${recipientIds.length} member${recipientIds.length === 1 ? "" : "s"}).${otherUnitCount > 0
            ? ` ${otherUnitCount === 1 ? "1 member logs" : `${otherUnitCount} members log`} in ${unitLabel(ownIsKg ? "lb" : "kg")}, and will see your weights in the unit you entered them in.`
            : ""}`}
        programs={myPrograms}
        onPick={picker === "review" ? handleAskForReview : handleSendProgram}
        onClose={() => setPicker(null)}
      />

      {/* The floating keyboard-down button for the member search, the same one
          PTHome's client search and the group edit screen show. Last child so
          it sits above the scroll content; renders nothing without a keyboard. */}
      <KeyboardDismissButton onPress={onKeyboardDown} />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: BACK_LEFT, paddingBottom: 12, borderBottomWidth: 1 },
  iconBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  // Photo, star (when favourited), name. 10 rather than the old 6: a 32pt
  // photo pressed against the title read as one crowded glyph.
  headerTitleRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
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
  // The heading, its count and the chevron are one tap target.
  membersHeaderTap: { flexDirection: "row", alignItems: "center", gap: 8 },
  // Compact mode. SUMMARY_ROW is the shared geometry that keeps a collapsed
  // name sitting exactly where the card's name sat (constants/cards.ts).
  summaryRow:       { ...SUMMARY_ROW },
  summaryName:      { flex: 1, ...CARD_TITLE },
  summaryAvatarText:{ fontFamily: FontFamily.bold, fontSize: 11 },
  // Shares the card geometry the hub uses, so that when this section gains the
  // same list/cards toggle the title is already in the place a summary row
  // would put it.
  // (The program cards' own row + action styles are cardInner/cardTop and
  // revealColumn below; sentRow/sentActions went with the old flat layout.)
  // The detailed card: a padded body holding the title row, the cycle strip and
  // the chevron, matching the hub's program cards.
  // No `gap` on the body: a closed ExpandReveal is a zero-height child, and a
  // gap would still reserve space on both sides of it. The children carry their
  // own top margins instead, and the reveal's lives on its content, which only
  // exists while it's open.
  cardInner: { ...CARD_INNER },
  cardTop:   { ...CARD_TOP },
  // A program card's revealed half, both kinds: a COLUMN, so the action row
  // inside it stretches to the card's full width. The review card used a
  // wrapping ROW here instead, which shrank the action row to its contents and
  // left two equal-flex buttons with no width to share: tiny, overlapping, at
  // the left of the card. The sent card also puts who has it (coaches only)
  // above its actions.
  revealColumn:  { gap: 10, paddingTop: 10 },
  // View and Accept share the width; Remove is only as wide as its label.
  sentActionRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  sentActionFlex: { flex: 1 },
  cycleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 10 },
  cycleChip: { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText: { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  chevronRow: { alignItems: "center", marginTop: 8 },
  // Who has accepted, one line each. Full width inside the wrapping action row.
  recipientList:  { width: "100%", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  recipientRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  recipientDot:   { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  recipientName:  { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
  recipientStatus:{ fontFamily: FontFamily.regular, fontSize: 11 },
  sentName: { ...CARD_TITLE },
  sentMeta: { ...CARD_META },
  statusPill: { ...CARD_PILL },
  statusText: { ...CARD_PILL_TEXT },
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
  menu:         { paddingHorizontal: 20, paddingTop: 10, gap: 12 },
});
