// A group's programs, opened from the Programs tile on its page (user
// decisions, 2026-10-22, the Group Page canvas, option B). They were sections
// down the group's page under its banner, above every member; here they're
// the trainer's Programs page for one group (app/trainer/programs.tsx): the
// send button at the top, then one-line rows in one card per section, each
// opening in place on its cycle and what can be done with it.
//
// The sections, from where the reader stands (utils/groupPrograms.ts): a
// coach's To Review, To Accept, Reviewed, Group Programs and Sent for Review;
// a member's To Accept, Added and Sent for Review. The group's archive is top
// right, for its trainers, as the trainer's own archive is on their Programs
// page; a member's Remove is a hide on their phone, with nothing to restore.
//
// It reads and saves the same copy as the group's page (utils/groupPage.ts),
// so it opens at once on what that page last saw, and what's done here shows
// there on the way back.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "../../../../components/MaskedView";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../../../components/FadeScreen";
import NeuCard from "../../../../components/NeuCard";
import BounceButton from "../../../../components/BounceButton";
import BackButton, { BACK_SIZE, BACK_TOP } from "../../../../components/BackButton";
import ArchiveButton from "../../../../components/ArchiveButton";
import OfflineBanner from "../../../../components/OfflineBanner";
import Avatar from "../../../../components/Avatar";
import SendIcon from "../../../../components/icons/SendIcon";
import NotebookIcon from "../../../../components/icons/NotebookIcon";
import ProgramRow, { CycleStrip, RowActions, StatusPill, rowButtonStyles } from "../../../../components/trainer/ProgramRow";
import ReviewStatusPill, { REVIEW_STAGE_LABEL, removeReviewNote, reviewStage } from "../../../../components/trainer/ReviewStatusPill";
import GroupSendSheet, { type GroupSendMode } from "../../../../components/trainer/GroupSendSheet";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../../../constants/theme";
import { cardButton, darkGlow, pill, pillGlow, PILL_H_SM, PILL_SHADOW } from "../../../../constants/buttons";
import { scrollEndPadding } from "../../../../constants/floatingBars";
import { useFloatingBarsReach } from "../../../../hooks/useFloatingBars";
import { useTheme } from "../../../../contexts/ThemeContext";
import { useAuth } from "../../../../contexts/AuthContext";
import { canCoachGroup, type GroupMember, type GroupRole } from "../../../../constants/groups";
import { PROGRAMS_KEY, type SavedProgram } from "../../../../constants/programs";
import {
  EMPTY_GROUP_PAGE,
  hydrateGroupPage,
  loadGroupPage,
  peekGroupPage,
  saveGroupPage,
  type GroupPageData,
  type GroupPageLoad,
} from "../../../../utils/groupPage";
import { groupProgramLists, myEntry, type GroupBatch } from "../../../../utils/groupPrograms";
import {
  acceptSharedProgramBatch,
  applyReturnedProgram,
  dismissKeyOf,
  dismissSharedBatch,
  loadGroupReviewPrograms,
  loadGroupSharedPrograms,
  removeGroupSharedProgramBatch,
  removeSentProgram,
  returnedKeyOf,
  setGroupReviewDone,
  setReviewArchived,
  setSendBatchArchived,
  type SentProgram,
} from "../../../../utils/trainerStore";
import { scheduleCloudPush } from "../../../../lib/syncManager";
import { getJSON } from "../../../../utils/storage";
import { fmtAgo } from "../../../../utils/dates";
import { archiveShareChoice, removeShareConfirm } from "../../../../utils/removeShare";
import { askArchiveOrDelete } from "../../../../utils/archiveChoice";
import { alertMessage } from "../../../../utils/errors";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A member's face, for a review row: who asked. */
function MemberFace({ member }: { member: GroupMember | undefined }) {
  return (
    <Avatar
      uri={member?.photoUri}
      initials={member?.initials || "?"}
      size={36}
      colorKey={member?.id}
      textStyle={styles.avatarText}
    />
  );
}

/** Someone's request for a review, to a coach: the trainer's Programs page's
 *  row. Still waiting, its white Review (hidden once open, where the bigger
 *  one shows beside Remove); otherwise where it stands. */
function ReviewRequestRow({ review, sender, from, first, open, onToggle, onOpen, onRemove }: {
  review: SentProgram;
  sender: GroupMember | undefined;
  from: string;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const awaiting = reviewStage(review) === "awaiting";
  return (
    <ProgramRow
      first={first}
      open={open}
      onToggle={onToggle}
      accessibilityLabel={`${review.programName}, ${from}, ${REVIEW_STAGE_LABEL[reviewStage(review)].toLowerCase()}`}
      leading={<MemberFace member={sender} />}
      title={review.programName}
      meta={`${from} · ${fmtAgo(review.sentAtISO)}`}
      trailing={awaiting ? (
        <BounceButton onPress={onOpen} accessibilityLabel={`Review ${review.programName}`}>
          <View style={[rowButtonStyles.pill, cardButton(t)]}>
            <Text style={[rowButtonStyles.text, { color: t.tp }]}>Review</Text>
          </View>
        </BounceButton>
      ) : (
        <ReviewStatusPill review={review} />
      )}
      hideTrailingWhenOpen={awaiting}
    >
      <CycleStrip cycle={review.programSnapshot?.cyclePattern ?? []} />
      <RowActions
        label="Review"
        onOpen={onOpen}
        onRemove={onRemove}
        accessibilityLabel={awaiting ? `Review ${review.programName}` : `Review ${review.programName}, already sent back`}
        removeLabel={`Remove ${review.programName}`}
      />
    </ProgramRow>
  );
}

/** One send to the group, three ways: waiting on me (the green Accept), a
 *  coach's view of it (who's accepted it), or one a member has taken. */
function BatchRow({ batch, kind, myUid, iCoachGroup, from, nameFor, first, open, onToggle, onView, onAccept, onRemove, onDismiss }: {
  batch: GroupBatch;
  kind: "accept" | "sent" | "added";
  myUid: string | null;
  iCoachGroup: boolean;
  /** Who sent it ("From Jordan"). */
  from: string;
  nameFor: (userId: string) => string;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  onView: (sharedId: string) => void;
  onAccept: () => void;
  /** Takes the send out of the group, for everyone (members who accepted
   *  keep their copy). */
  onRemove: () => void;
  /** Off MY list only: never My Programs, the group, or anyone else's view. */
  onDismiss: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const mine = myEntry(batch, myUid);
  // The sender can always take their own send back out of the group, trainer
  // role or not; anyone else who isn't a coach takes it off their own list.
  const iSent = !!myUid && batch.entries.some(e => e.senderId === myUid);
  const canRemoveForAll = iCoachGroup || iSent;
  const allAccepted = batch.acceptedCount === batch.entries.length;
  // The count is only the truth for a coach, who's served the whole send; a
  // member sees their own row alone.
  const status = mine?.acceptedAtISO
    ? "Accepted"
    : iCoachGroup ? (allAccepted ? "Accepted" : `${batch.acceptedCount}/${batch.entries.length} accepted`) : "Shared";
  const done = !!mine?.acceptedAtISO || (iCoachGroup && allAccepted);
  const meta = kind === "sent"
    ? `${from} · Sent ${fmtAgo(batch.sentAtISO)} · ${plural(batch.entries.length, "member")}`
    : `${from} · ${fmtAgo(batch.sentAtISO)}`;

  return (
    <ProgramRow
      first={first}
      open={open}
      onToggle={onToggle}
      accessibilityLabel={`${batch.programName}, ${kind === "accept" ? "to accept" : status.toLowerCase()}`}
      title={batch.programName}
      meta={meta}
      trailing={kind === "accept" ? (
        <BounceButton onPress={onAccept} needsConnection accessibilityLabel={`Accept ${batch.programName}`}>
          <View style={[rowButtonStyles.pill, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }]}>
            <Text style={rowButtonStyles.text}>Accept</Text>
          </View>
        </BounceButton>
      ) : (
        <StatusPill label={status} done={done} />
      )}
    >
      <CycleStrip cycle={batch.entries[0]?.programSnapshot?.cyclePattern ?? []} />
      {/* Who has it and who hasn't: a coach is served the whole send. */}
      {kind === "sent" ? (
        <View style={[styles.recipientList, { borderColor: t.div }]}>
          {batch.entries.map((e, i) => {
            const accepted = !!e.acceptedAtISO;
            return (
              <View
                key={e.id}
                style={[styles.recipientRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.div }]}
              >
                <View style={[styles.recipientDot, accepted ? { backgroundColor: ACCT, borderColor: ACCT } : { borderColor: t.ts }]} />
                <Text style={[styles.recipientName, { color: t.tp }]} numberOfLines={1}>{nameFor(e.clientId)}</Text>
                <Text style={[styles.recipientStatus, { color: t.ts }]}>
                  {accepted ? `Accepted · ${fmtAgo(e.acceptedAtISO!)}` : "Pending"}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      <RowActions
        label="View"
        onOpen={() => onView((mine ?? batch.entries[0]).id)}
        onRemove={canRemoveForAll ? onRemove : onDismiss}
        removeNeedsConnection={canRemoveForAll}
        accessibilityLabel={`View ${batch.programName}`}
        removeLabel={canRemoveForAll ? `Remove ${batch.programName} from the group` : `Remove ${batch.programName} from your list`}
      />
    </ProgramRow>
  );
}

/** My own request: back with changes (the green Accept), still waiting, taken
 *  up, or removed by a coach without being sent back (Not reviewed, in red,
 *  with when; user request, 2026-10-29: it used to vanish from here). Nothing
 *  to do on one still waiting but see its cycle; Remove on one not reviewed
 *  clears it. */
function MyRequestRow({ review, first, open, onToggle, onAccept, onView, onRemove }: {
  review: SentProgram;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onView: () => void;
  onRemove: () => void;
}) {
  const { isDark } = useTheme();
  const stage = reviewStage(review);
  const back = stage === "returned";
  const removed = stage === "removed";
  return (
    <ProgramRow
      first={first}
      open={open}
      onToggle={onToggle}
      accessibilityLabel={`${review.programName}, ${back ? "back from review, to accept" : REVIEW_STAGE_LABEL[stage].toLowerCase()}`}
      title={review.programName}
      meta={back ? `Back from review · ${fmtAgo(review.returnedAtISO ?? review.sentAtISO)}`
        : removed ? `Removed without a review · ${fmtAgo(review.removedUnreviewedAtISO ?? review.sentAtISO)}`
        : `Sent ${fmtAgo(review.sentAtISO)}`}
      trailing={back ? (
        <BounceButton onPress={onAccept} needsConnection accessibilityLabel={`Accept the trainer's changes to ${review.programName}`}>
          <View style={[rowButtonStyles.pill, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }]}>
            <Text style={rowButtonStyles.text}>Accept</Text>
          </View>
        </BounceButton>
      ) : (
        <ReviewStatusPill review={review} />
      )}
    >
      <CycleStrip cycle={review.programSnapshot?.cyclePattern ?? []} />
      {stage !== "awaiting" ? (
        <RowActions
          label={back ? "See Changes" : "View"}
          onOpen={onView}
          onRemove={onRemove}
          // Clearing one not reviewed deletes it (the server's); the others
          // are a hide on this phone.
          removeNeedsConnection={removed}
          accessibilityLabel={back ? `See the changes to ${review.programName}` : `View ${review.programName}`}
          removeLabel={`Remove ${review.programName} from your list`}
        />
      ) : null}
    </ProgramRow>
  );
}

export default function GroupProgramsScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const groupId = id ?? "";
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const barsReach = useFloatingBarsReach();
  const { userId } = useAuth();
  const owner = userId ?? "";

  // The group page's copy (utils/groupPage.ts), so this opens whole and what's
  // done here is what that page shows on the way back.
  const [page, setPage] = useState<GroupPageData | null>(() => peekGroupPage(owner, groupId));
  const [settled, setSettled] = useState(false);
  const { group, members, groupShares, groupReviews, myUid } = page ?? EMPTY_GROUP_PAGE;
  useEffect(() => {
    if (page) saveGroupPage(owner, groupId, page);
  }, [page, owner, groupId]);
  useEffect(() => {
    let live = true;
    void hydrateGroupPage(owner, groupId).then(() => {
      const saved = peekGroupPage(owner, groupId);
      if (live && saved) setPage(p => p ?? saved);
    });
    return () => { live = false; };
  }, [owner, groupId]);

  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  const [picker, setPicker] = useState<GroupSendMode | null>(null);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = useCallback((key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpenRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const displayName = group?.name || name || "Group";
  const myRole: GroupRole = members.find(m => m.id === myUid)?.role ?? "member";
  /** Owner or trainer here: sends to the group, reviews, removes for everyone. */
  const iCoachGroup = canCoachGroup(myRole);
  const lists = useMemo(
    () => groupProgramLists({ groupShares, groupReviews, iCoachGroup, myUid }),
    [groupShares, groupReviews, iCoachGroup, myUid],
  );
  // Everyone a send reaches: never me.
  const recipientIds = useMemo(() => members.filter(m => m.id !== myUid).map(m => m.id), [members, myUid]);

  const applyLoad = useCallback((result: GroupPageLoad) => {
    setSettled(true);
    if (result.status === "loaded") setPage(result.data);
    else if (result.status === "gone") {
      Alert.alert("Group unavailable", "This group no longer exists, or you're no longer a member.");
      router.back();
    }
  }, [router]);
  const loadMyPrograms = useCallback(
    () => getJSON<SavedProgram[]>(PROGRAMS_KEY, []).then(progs => (Array.isArray(progs) ? progs : [])),
    [],
  );
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void loadGroupPage(owner, groupId).then(result => { if (!cancelled) applyLoad(result); });
    void loadMyPrograms().then(progs => { if (!cancelled) setMyPrograms(progs); });
    return () => { cancelled = true; };
  }, [owner, groupId, applyLoad, loadMyPrograms]));

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const [result, progs] = await Promise.all([loadGroupPage(owner, groupId), loadMyPrograms()]);
    applyLoad(result);
    setMyPrograms(progs);
    setRefreshing(false);
  }, [owner, groupId, applyLoad, loadMyPrograms]);

  /** Re-read the group's programs, after anything here changes them. */
  const refreshPrograms = useCallback(async () => {
    try {
      const [shares, reviews] = await Promise.all([loadGroupSharedPrograms(groupId), loadGroupReviewPrograms(groupId)]);
      setPage(p => p && { ...p, groupShares: shares, groupReviews: reviews });
    } catch (err) {
      if (__DEV__) console.warn("[avenas] refresh group programs", err);
    }
  }, [groupId]);

  const memberNameFor = useCallback((uid: string): string => {
    if (uid === myUid) return "You";
    return members.find(m => m.id === uid)?.name ?? "A member";
  }, [members, myUid]);
  /** Who sent a send: every row in it shares a sender. */
  const fromFor = (batch: GroupBatch): string => {
    const senderId = batch.entries[0]?.senderId;
    return senderId ? `From ${memberNameFor(senderId)}` : "From a coach";
  };
  const reviewFrom = (r: SentProgram): string =>
    members.find(m => m.id === r.senderId)?.name ?? "A member";

  const openReview = useCallback((r: SentProgram) => {
    router.navigate({ pathname: "/trainer/review/[id]", params: { id: r.id, groupId } });
  }, [router, groupId]);
  const viewShared = useCallback((sharedId: string) => {
    router.navigate({ pathname: "/program-view", params: { sharedId } });
  }, [router]);
  /** What came back on my own request: my program once the changes are in it;
   *  the returned version until then, through this group (a trainer's own
   *  sent list doesn't hold it). */
  const viewReturned = useCallback((r: SentProgram) => {
    router.navigate(r.appliedAtISO
      ? { pathname: "/programs", params: { focus: r.programId } }
      : { pathname: "/program-view", params: { sentId: r.id, groupId } });
  }, [router, groupId]);

  /** Take a review out of the group's queue, for every coach: Archive (back
   *  from the archive, top right) or Delete (what Mark Done was). */
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

  /** A member taking a send off THEIR list (a hide on this phone): an accepted
   *  copy stays in My Programs, and the coach still sees it as sent. */
  const handleDismissBatch = useCallback((batch: GroupBatch) => {
    const mine = myEntry(batch, myUid);
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
            await refreshPrograms();
          },
        },
      ],
    );
  }, [myUid, refreshPrograms]);

  /** Take a send out of the group, for everyone. A coach gets Archive beside
   *  Delete; a sender who has since lost the trainer role has no archive here
   *  to restore from, so they get the plain confirm. */
  const handleRemoveBatch = useCallback((batch: GroupBatch) => {
    const removeForGood = async () => {
      try {
        await removeGroupSharedProgramBatch(groupId, batch.key);
      } catch (e) {
        Alert.alert("Couldn't remove program", alertMessage(e, "Check your connection and try again."));
      }
      await refreshPrograms();
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
          await refreshPrograms();
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
    Alert.alert(prompt.title, prompt.body, [
      { text: prompt.cancel, style: "cancel" },
      { text: prompt.confirm, style: "destructive", onPress: removeForGood },
    ]);
  }, [groupId, iCoachGroup, refreshPrograms]);

  // Accepts in flight: a second tap while the first is on its way would say
  // "added" twice (the store adds it once either way).
  const accepting = useRef(new Set<string>());

  const handleAcceptBatch = useCallback(async (batch: GroupBatch) => {
    if (accepting.current.has(batch.key)) return;
    accepting.current.add(batch.key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await acceptSharedProgramBatch(batch.key);
    } catch (e) {
      // Deleted or archived since the row was drawn: the refresh takes it away.
      Alert.alert("Couldn't add program", alertMessage(e, "Check your connection and try again."));
      await refreshPrograms();
      return;
    } finally {
      accepting.current.delete(batch.key);
    }
    scheduleCloudPush(); // the accept materialised a local program
    await refreshPrograms();
    Alert.alert("Program Added", `"${batch.programName}" is now in your programs.`);
  }, [refreshPrograms]);

  /** Take a trainer's changes to my own request: they go over my original
   *  program, as from a gym user's Programs page. */
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

  /** Take my own returned request off this list (this version only: an
   *  update from the trainer brings it back). The coaches' queue is theirs. */
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

  /** Clear my request a coach removed without a review. It's already off their
   *  list, so this deletes it (removeSentProgram, as withdrawing one still
   *  waiting does); my own program stays. */
  const handleClearNotReviewed = useCallback((entry: SentProgram) => {
    Alert.alert(
      "Remove Program",
      `Remove "${entry.programName}" from this list? Your own copy stays in your programs.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeSentProgram(entry.id);
            } catch (e) {
              Alert.alert("Couldn't remove it", alertMessage(e, "Check your connection and try again."));
              return;
            }
            setPage(p => p && { ...p, groupReviews: p.groupReviews.filter(r => r.id !== entry.id) });
          },
        },
      ],
    );
  }, []);

  const batchRow = (b: GroupBatch, kind: "accept" | "sent" | "added", i: number) => (
    <BatchRow
      key={b.key}
      batch={b}
      kind={kind}
      myUid={myUid}
      iCoachGroup={iCoachGroup}
      from={fromFor(b)}
      nameFor={memberNameFor}
      first={i === 0}
      open={openRows.has(`b:${b.key}`)}
      onToggle={() => toggleRow(`b:${b.key}`)}
      onView={viewShared}
      onAccept={() => handleAcceptBatch(b)}
      onRemove={() => handleRemoveBatch(b)}
      onDismiss={() => handleDismissBatch(b)}
    />
  );
  const myRequestRow = (r: SentProgram, i: number) => (
    <MyRequestRow
      key={r.id}
      review={r}
      first={i === 0}
      open={openRows.has(`m:${r.id}`)}
      onToggle={() => toggleRow(`m:${r.id}`)}
      onAccept={() => handleAcceptReturned(r)}
      onView={() => viewReturned(r)}
      onRemove={() => (reviewStage(r) === "removed" ? handleClearNotReviewed(r) : handleRemoveReturned(r))}
    />
  );
  const reviewRow = (r: SentProgram, i: number) => (
    <ReviewRequestRow
      key={r.id}
      review={r}
      sender={members.find(m => m.id === r.senderId)}
      from={reviewFrom(r)}
      first={i === 0}
      open={openRows.has(`r:${r.id}`)}
      onToggle={() => toggleRow(`r:${r.id}`)}
      onOpen={() => openReview(r)}
      onRemove={() => handleCompleteReview(r)}
    />
  );

  const section = (label: string, rows: ReactNode[]) => rows.length === 0 ? null : (
    <>
      <Text style={[styles.sectionLabel, { color: t.ts }]}>{label}</Text>
      <NeuCard dark={isDark} radius={16}>{rows}</NeuCard>
    </>
  );

  const nothingYet = lists.toReview.length + lists.toAccept.length + lists.reviewed.length
    + lists.sent.length + lists.added.length + lists.sentForReview.length === 0;

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

      <BackButton />
      {/* The group's archive, for the people who can archive here: its
          trainers. A member's Remove is a hide on their phone. */}
      {iCoachGroup ? (
        <ArchiveButton
          floating
          onPress={() => router.navigate({ pathname: "/program-archive", params: { scope: "group", groupId, groupName: displayName } })}
        />
      ) : null}

      {page === null && !settled ? (
        <View style={styles.loading}><ActivityIndicator color={ACCT} /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + BACK_TOP, paddingBottom: scrollEndPadding(insets.bottom + 40, barsReach) }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCT} colors={[ACCT]} progressViewOffset={insets.top} />
          }
        >
          {/* "Programs", and which group's, centred on the back button's line. */}
          <View style={styles.header}>
            <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>Programs</Text>
            <Text style={[styles.groupName, { color: t.ts }]} numberOfLines={1}>{displayName}</Text>
          </View>

          <OfflineBanner />

          {/* A coach sends out; anyone the owner made a trainer can still ask
              for a review of their own, under it (the owner has no one above
              them here). A member asks for one. */}
          {iCoachGroup ? (
            <>
              <BounceButton onPress={() => setPicker("send")} needsConnection accessibilityLabel="Send a program to this group">
                <View style={[styles.sendBtn, { backgroundColor: ACCT }, darkGlow(styles.sendBtn, isDark)]}>
                  <SendIcon size={18} color="#fff" />
                  <Text style={styles.sendText}>Send a Program</Text>
                </View>
              </BounceButton>
              {myRole !== "owner" ? (
                <BounceButton style={styles.secondBtn} onPress={() => setPicker("review")} needsConnection accessibilityLabel="Send a program to this group for review">
                  <View style={[styles.reviewBtn, { backgroundColor: t.ctrl }]}>
                    <SendIcon size={17} color={t.tp} />
                    <Text style={[styles.reviewText, { color: t.tp }]}>Send a Program for Review</Text>
                  </View>
                </BounceButton>
              ) : null}
            </>
          ) : (
            <BounceButton onPress={() => setPicker("review")} needsConnection accessibilityLabel="Send a program to this group for review">
              <View style={[styles.sendBtn, { backgroundColor: ACCT }, darkGlow(styles.sendBtn, isDark)]}>
                <SendIcon size={18} color="#fff" />
                <Text style={styles.sendText}>Send a Program for Review</Text>
              </View>
            </BounceButton>
          )}

          {section("TO REVIEW", lists.toReview.map(reviewRow))}
          {section("TO ACCEPT", lists.toAccept.map((item, i) => (
            item.kind === "returned" ? myRequestRow(item.review, i) : batchRow(item.batch, "accept", i)
          )))}
          {section("REVIEWED", lists.reviewed.map(reviewRow))}
          {section("GROUP PROGRAMS", lists.sent.map((b, i) => batchRow(b, "sent", i)))}
          {section("ADDED", lists.added.map((b, i) => batchRow(b, "added", i)))}
          {section("SENT FOR REVIEW", lists.sentForReview.map(myRequestRow))}

          {nothingYet ? (
            <NeuCard dark={isDark} radius={20} style={{ marginTop: 24 }}>
              <View style={styles.emptyInner}>
                <View style={[styles.emptyIcon, { backgroundColor: `${ACCT}24` }]}>
                  <NotebookIcon size={26} color={ACCT} />
                </View>
                <Text style={[styles.emptyTitle, { color: t.tp }]}>No programs yet</Text>
                <Text style={[styles.emptyBody, { color: t.ts }]}>
                  {iCoachGroup
                    ? "Programs sent to this group show here with who has accepted them, and so do the ones members send for review."
                    : "Programs the group's trainers send you show here, and so do the ones you send them for review."}
                </Text>
              </View>
            </NeuCard>
          ) : null}
        </ScrollView>
      )}

      <GroupSendSheet
        mode={picker}
        onClose={() => setPicker(null)}
        groupId={groupId}
        groupName={displayName}
        ownerId={group?.ownerId}
        recipientIds={recipientIds}
        programs={myPrograms}
        onSent={refreshPrograms}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  // As tall as the back button and centred on it, the name a line under.
  header: { minHeight: BACK_SIZE, alignItems: "center", justifyContent: "center", paddingHorizontal: 52, marginBottom: 18 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 22, lineHeight: 26, textAlign: "center" },
  groupName: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 17, textAlign: "center" },
  sendBtn: { ...pill(PILL_H_SM), gap: 10, ...pillGlow(ACCT, 0.4) },
  sendText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff", letterSpacing: 0.2 },
  secondBtn: { marginTop: 12 },
  reviewBtn: { ...pill(PILL_H_SM), gap: 9, ...PILL_SHADOW },
  reviewText: { fontFamily: FontFamily.bold, fontSize: 15 },
  // The Programs page's section labels, value for value.
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.6, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 13 },
  recipientList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10 },
  recipientRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  recipientDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  recipientName: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
  recipientStatus: { fontFamily: FontFamily.regular, fontSize: 11 },
  emptyInner: { padding: 28, alignItems: "center", gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 18 },
});
