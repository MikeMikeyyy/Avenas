// app/trainer/programs.tsx
//
// A trainer's programs, opened from the Programs card at the top of their
// Trainer tab (components/trainer/ProgramsCard.tsx; user decisions, 2026-10-21,
// the Trainer Page canvas): Send a Program, then what's waiting on them (TO
// REVIEW: the white Review button), what they've reviewed (REVIEWED: sent back,
// or taken up), and everything they've sent (SENT: who's accepted it), with the
// archive top right. They were sections at the foot of the Trainer tab, under
// every client, so the more clients a trainer had the further away they were.
//
// Each row opens in place, as the cards it replaces did (the rows are shared
// with a gym user's program pages, components/trainer/ProgramRow.tsx): a review
// shows its cycle with Review and Remove; a send shows its cycle, who it went to
// and who's accepted, with View Program and Remove. Remove is Archive or Delete,
// as before.
//
// It reads and saves the same page copy as the Trainer tab (utils/trainerHub.ts),
// so it opens at once on what the tab last saw.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scrollEndPadding } from "../../constants/floatingBars";
import { useFloatingBarsReach } from "../../hooks/useFloatingBars";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../components/FadeScreen";
import NeuCard from "../../components/NeuCard";
import BounceButton from "../../components/BounceButton";
import BackButton, { BACK_SIZE, BACK_TOP } from "../../components/BackButton";
import ArchiveButton from "../../components/ArchiveButton";
import OfflineBanner from "../../components/OfflineBanner";
import Avatar from "../../components/Avatar";
import SendIcon from "../../components/icons/SendIcon";
import NotebookIcon from "../../components/icons/NotebookIcon";
import GroupAvatar from "../../components/trainer/GroupAvatar";
import ProgramRow, { CycleStrip, RowActions, StatusPill, rowButtonStyles } from "../../components/trainer/ProgramRow";
import ProgramPickerSheet from "../../components/trainer/ProgramPickerSheet";
import RecipientPickerSheet from "../../components/trainer/RecipientPickerSheet";
import ReviewStatusPill, { REVIEW_STAGE_LABEL, removeReviewNote } from "../../components/trainer/ReviewStatusPill";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { pill, pillGlow, PILL_H_SM, PILL_SHADOW } from "../../constants/buttons";
import { PROGRAMS_KEY, type SavedProgram } from "../../constants/programs";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { EMPTY_PT_HUB, fetchPTHub, peekPTHub, savePTHub, type PTHubData } from "../../utils/trainerHub";
import {
  appendSharedPrograms,
  dismissReceivedReview,
  removeSharedProgramBatch,
  setGroupReviewDone,
  setReviewArchived,
  setSendBatchArchived,
  type Client,
  type SentProgram,
  type SharedProgram,
} from "../../utils/trainerStore";
import { batchKeyOf, receivedReviews, reviewStage, sendBatches, type SendBatch } from "../../utils/trainerLists";
import { getJSON } from "../../utils/storage";
import { archiveShareChoice } from "../../utils/removeShare";
import { askArchiveOrDelete } from "../../utils/archiveChoice";
import { alertMessage } from "../../utils/errors";

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** One program sent to me for review (components/trainer/ProgramRow.tsx). */
function ReviewRow({ review, sender, groupPhotoUri, from, first, open, onToggle, onOpen, onRemove }: {
  review: SentProgram;
  /** Who asked, when they're someone on my roster. */
  sender: Client | null;
  /** Otherwise the photo of the group it came through, or the people mark. */
  groupPhotoUri?: string;
  /** The line under its name: who it's from, or the group it came through. */
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
      leading={sender ? (
        <Avatar
          uri={sender.photoUri}
          initials={sender.initials}
          size={36}
          backgroundColor={isDark ? `${ACCT}1F` : `${ACCT}2E`}
          textColor={ACCT}
          textStyle={[styles.avatarText, { color: ACCT }]}
        />
      ) : (
        <GroupAvatar uri={groupPhotoUri} size={36} isDark={isDark} />
      )}
      title={review.programName}
      meta={`${from} · ${fmtAgo(review.sentAtISO)}`}
      // Waiting on me: a white Review, the small twin of the one the open row
      // shows beside Remove, so it fades out as the row opens (user decision,
      // 2026-10-22; it was orange). Done: where it stands, as everywhere else.
      trailing={awaiting ? (
        <BounceButton onPress={onOpen} accessibilityLabel={`Review ${review.programName}`}>
          <View style={[rowButtonStyles.pill, { backgroundColor: t.ctrl, ...PILL_SHADOW }]}>
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

/** One send: a program sent at one moment, to one person, several, or a group. */
function SentRow({ batch, sentTo, nameFor, first, open, onToggle, onView, onRemove }: {
  batch: SendBatch;
  /** "Morning Crew · 6 members" or "3 clients": worked out by the caller,
   *  which holds the group list. */
  sentTo: string;
  nameFor: (clientId: string) => string;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  onView: () => void;
  onRemove: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const label = batch.allAccepted ? "Accepted" : `${batch.acceptedCount}/${batch.total} accepted`;

  return (
    <ProgramRow
      first={first}
      open={open}
      onToggle={onToggle}
      accessibilityLabel={`${batch.programName}, ${label}`}
      title={batch.programName}
      // Where it went belongs on the closed row: it's the first thing you want
      // to know, and behind a tap you'd open every one to find out.
      meta={`Sent ${fmtAgo(batch.sentAtISO)} · ${sentTo}`}
      trailing={<StatusPill label={label} done={batch.allAccepted} />}
    >
      <CycleStrip cycle={batch.programSnapshot?.cyclePattern ?? []} />
      <View style={[styles.recipientList, { borderColor: t.div }]}>
        {batch.entries.map((e, i) => {
          const accepted = !!e.acceptedAtISO;
          return (
            <View
              key={e.id}
              style={[
                styles.recipientRow,
                { borderBottomColor: t.div, borderBottomWidth: i === batch.entries.length - 1 ? 0 : StyleSheet.hairlineWidth },
              ]}
            >
              <View style={[styles.recipientDot, accepted
                ? { backgroundColor: ACCT, borderColor: ACCT }
                : { backgroundColor: "transparent", borderColor: t.ts },
              ]} />
              <Text style={[styles.recipientName, { color: t.tp }]} numberOfLines={1}>{nameFor(e.clientId)}</Text>
              <Text style={[styles.recipientStatus, { color: accepted ? ACCT : t.ts }]}>
                {accepted ? `Accepted · ${fmtAgo(e.acceptedAtISO!)}` : "Pending"}
              </Text>
            </View>
          );
        })}
      </View>
      <RowActions
        label="View Program"
        onOpen={onView}
        onRemove={onRemove}
        accessibilityLabel={`View ${batch.programName}`}
        removeLabel={`Remove ${batch.programName}`}
      />
    </ProgramRow>
  );
}

export default function TrainerProgramsScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const router = useRouter();
  const { userId } = useAuth();
  const owner = userId ?? "";

  // The Trainer tab's page copy (utils/trainerHub.ts): this page opens on it,
  // refreshes it, and saves what changes here (a removed send, a new one) so
  // the tab shows it too.
  const [hub, setHub] = useState<PTHubData | null>(() => peekPTHub(owner));
  const loaded = hub !== null;
  const { clients, reviews, groupReviews, sharedOut, groups, groupMemberships, groupFaces } = hub ?? EMPTY_PT_HUB;
  // My own programs, for the send sheet. Local, so not part of the hub.
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);

  useEffect(() => {
    if (hub) savePTHub(owner, hub);
  }, [hub, owner]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void fetchPTHub(owner).then(next => { if (!cancelled) setHub(next); });
    void getJSON<SavedProgram[]>(PROGRAMS_KEY, []).then(progs => {
      if (!cancelled) setMyPrograms(Array.isArray(progs) ? progs : []);
    });
    return () => { cancelled = true; };
  }, [owner]));

  // Pull down for what the server says now: a review someone just sent, a
  // client who's just accepted. Its own read (`fresh`), never a shared one.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const [next, progs] = await Promise.all([
      fetchPTHub(owner, { fresh: true }),
      getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
    ]);
    setHub(next);
    setMyPrograms(Array.isArray(progs) ? progs : []);
    setRefreshing(false);
  }, [owner]);

  const received = useMemo(() => receivedReviews(reviews, groupReviews), [reviews, groupReviews]);
  const toReview = useMemo(() => received.filter(r => reviewStage(r) === "awaiting"), [received]);
  const reviewed = useMemo(() => received.filter(r => reviewStage(r) !== "awaiting"), [received]);
  const batches = useMemo(() => sendBatches(sharedOut), [sharedOut]);

  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = useCallback((key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpenRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);

  /** Who asked, when they're on my roster. */
  const senderOf = useCallback(
    (r: SentProgram) => (r.senderId ? clientById.get(r.senderId) ?? null : null),
    [clientById],
  );

  /** The photo of the group a review came through, if it has one. */
  const groupPhotoOf = useCallback(
    (r: SentProgram) => (r.groupId ? groups.find(g => g.id === r.groupId)?.photoUri : undefined),
    [groups],
  );

  /** The line under a review's name: the group it came through (looked up
   *  live, so a rename carries; a group since left still names itself as one),
   *  or who sent it. */
  const fromOf = useCallback((r: SentProgram) => {
    if (r.groupId) return groups.find(g => g.id === r.groupId)?.name ?? "A group";
    const sender = senderOf(r);
    return sender ? `From ${sender.name}` : "From a client";
  }, [groups, senderOf]);

  /** Open a review. A group one has to carry its groupId: the review screen
   *  looks a direct review up in my own inbox, where a group's row (addressed
   *  to the group's owner) isn't. */
  const openReview = useCallback((r: SentProgram) => {
    router.navigate({
      pathname: "/trainer/review/[id]",
      params: r.groupId ? { id: r.id, groupId: r.groupId } : { id: r.id },
    });
  }, [router]);

  /**
   * Take a program off my reviews: Archive (back from the archive button, top
   * right) or Delete. Where either reaches depends on where it came from, and
   * the prompt says which, because the two reach different people:
   *
   *   a GROUP review — off the group's queue, for every coach of the group.
   *     Delete is `set_group_review_completed` (coach-only at the database);
   *     Archive is the same, restorable.
   *   a 1:1 review — off MY list only (Delete: dismissReceivedReview).
   *
   * Either way the person who sent it keeps their copy and any feedback, and
   * can still accept what was sent back. The prompt says where it stands
   * (removeReviewNote), and warns when it hasn't been sent back yet, since
   * removing it then leaves them waiting on a review nobody will do.
   */
  const handleRemoveReview = useCallback((entry: SentProgram) => {
    const where = entry.groupId ? "the group's review list" : "your list";
    const drop = () => setHub(h => h && (entry.groupId
      ? { ...h, groupReviews: h.groupReviews.filter(r => r.id !== entry.id) }
      : { ...h, reviews: h.reviews.filter(r => r.id !== entry.id) }));
    askArchiveOrDelete({
      title: "Remove Program",
      body: `Archive "${entry.programName}" to take it off ${where} until you restore it, or delete it. ${removeReviewNote(entry)}`,
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
          if (entry.groupId) await setGroupReviewDone(entry.id, true);
          else await dismissReceivedReview(entry.id);
        } catch (e) {
          Alert.alert("Couldn't remove it", alertMessage(e, "Check your connection and try again."));
          return;
        }
        drop();
      },
    });
  }, []);

  const sentToOf = useCallback((b: SendBatch) => (b.groupId
    ? `${groups.find(g => g.id === b.groupId)?.name ?? "a group"} · ${b.total} member${b.total === 1 ? "" : "s"}`
    : `${b.total} client${b.total === 1 ? "" : "s"}`), [groups]);

  const nameFor = useCallback((clientId: string) => clientById.get(clientId)?.name ?? "Removed client", [clientById]);

  /** Remove on a send: Archive it (off this list and every recipient's, until
   *  it's restored from the archive) or Delete it for good. Accepted copies are
   *  untouched either way. */
  const handleUnshareBatch = useCallback((batch: SendBatch) => {
    const prompt = archiveShareChoice({
      programName: batch.programName,
      recipients: batch.groupId
        ? `${groups.find(g => g.id === batch.groupId)?.name ?? "this group"}`
        : `${batch.total} client${batch.total === 1 ? "" : "s"}`,
      total: batch.total,
      accepted: batch.acceptedCount,
    });
    const drop = () => setHub(h => h && { ...h, sharedOut: h.sharedOut.filter(s => batchKeyOf(s) !== batch.key) });
    askArchiveOrDelete({
      title: prompt.title,
      body: prompt.body,
      onArchive: async () => {
        try {
          await setSendBatchArchived(batch.key, true);
        } catch (e) {
          Alert.alert("Couldn't archive it", alertMessage(e, "Check your connection and try again."));
          return;
        }
        drop();
      },
      onDelete: async () => {
        try {
          await removeSharedProgramBatch(batch.key);
        } catch (e) {
          Alert.alert("Couldn't remove it", alertMessage(e, "Check your connection and try again."));
          return;
        }
        drop();
      },
    });
  }, [groups]);

  // Sending: pick a program, then who gets it. The program sheet closes itself
  // as it hands over (ProgramPickerSheet), so only one sheet is ever up.
  const [sendOpen, setSendOpen] = useState(false);
  const [pendingProgram, setPendingProgram] = useState<SavedProgram | null>(null);

  // Group shortcuts for the recipient picker: ticking one ticks its members, and
  // the send still goes out per person through the existing share path. Each
  // brings its faces, so it shows who's in it as its Trainer tab card does.
  const recipientGroups = useMemo(
    () => groups.map(g => ({
      id: g.id,
      name: g.name,
      memberIds: groupMemberships[g.id] ?? [],
      photoUri: g.photoUri,
      faces: groupFaces?.[g.id],
    })),
    [groups, groupMemberships, groupFaces],
  );

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
      // Real-account sends go through the server and genuinely fail offline:
      // don't pretend it worked.
      Alert.alert("Couldn't send program", alertMessage(e, "Check your connection and try again."));
      return;
    }
    setHub(h => h && { ...h, sharedOut: [...entries, ...h.sharedOut] });
    Alert.alert("Program Sent", `"${pendingProgram.name}" was sent to ${targets.length} client${targets.length === 1 ? "" : "s"}.`);
    setPendingProgram(null);
  }, [pendingProgram, clients]);

  const nothingYet = loaded && received.length === 0 && batches.length === 0;

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
      {/* Programs archived off these lists, restored from there. */}
      <ArchiveButton floating onPress={() => router.navigate({ pathname: "/program-archive", params: { scope: "trainer" } })} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + BACK_TOP, paddingBottom: scrollEndPadding(insets.bottom + 40, barsReach) }}
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
        <View style={styles.header}>
          <View style={{ width: 44 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>Programs</Text>
          <View style={{ width: 44 }} />
        </View>

        <OfflineBanner />

        <BounceButton onPress={() => setSendOpen(true)} needsConnection accessibilityLabel="Send a program">
          <View style={[styles.sendBtn, { backgroundColor: ACCT }]}>
            <SendIcon size={18} color="#fff" />
            <Text style={styles.sendText}>Send a Program</Text>
          </View>
        </BounceButton>

        {toReview.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>TO REVIEW</Text>
            <NeuCard dark={isDark} radius={16}>
              {toReview.map((r, i) => (
                <ReviewRow
                  key={r.id}
                  review={r}
                  sender={senderOf(r)}
                  groupPhotoUri={groupPhotoOf(r)}
                  from={fromOf(r)}
                  first={i === 0}
                  open={openRows.has(`r:${r.id}`)}
                  onToggle={() => toggleRow(`r:${r.id}`)}
                  onOpen={() => openReview(r)}
                  onRemove={() => handleRemoveReview(r)}
                />
              ))}
            </NeuCard>
          </>
        ) : null}

        {reviewed.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>REVIEWED</Text>
            <NeuCard dark={isDark} radius={16}>
              {reviewed.map((r, i) => (
                <ReviewRow
                  key={r.id}
                  review={r}
                  sender={senderOf(r)}
                  groupPhotoUri={groupPhotoOf(r)}
                  from={fromOf(r)}
                  first={i === 0}
                  open={openRows.has(`r:${r.id}`)}
                  onToggle={() => toggleRow(`r:${r.id}`)}
                  onOpen={() => openReview(r)}
                  onRemove={() => handleRemoveReview(r)}
                />
              ))}
            </NeuCard>
          </>
        ) : null}

        {batches.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>SENT</Text>
            <NeuCard dark={isDark} radius={16}>
              {batches.map((b, i) => (
                <SentRow
                  key={b.key}
                  batch={b}
                  sentTo={sentToOf(b)}
                  nameFor={nameFor}
                  first={i === 0}
                  open={openRows.has(`s:${b.key}`)}
                  onToggle={() => toggleRow(`s:${b.key}`)}
                  onView={() => router.navigate({ pathname: "/program-view", params: { sharedId: b.entries[0].id } })}
                  onRemove={() => handleUnshareBatch(b)}
                />
              ))}
            </NeuCard>
          </>
        ) : null}

        {nothingYet ? (
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 24 }}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIcon, { backgroundColor: `${ACCT}24` }]}>
                <NotebookIcon size={26} color={ACCT} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No programs yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                Programs you send show here with who has accepted them, and so do the ones clients send you to review.
              </Text>
            </View>
          </NeuCard>
        ) : null}
      </ScrollView>

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
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  header: { flexDirection: "row", alignItems: "center", height: BACK_SIZE, marginBottom: 18 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center", flex: 1 },
  sendBtn: { ...pill(PILL_H_SM), gap: 10, ...pillGlow(ACCT, 0.4) },
  sendText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff", letterSpacing: 0.2 },
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
