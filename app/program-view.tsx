// Read-only viewer for a SharedProgram's snapshot — walks each non-rest day
// in the cycle and lists its exercises + sets. Reached by tapping a shared-
// program card on either PTHome ("Programs Sent") or the My Coaches
// page ("From Your Coaches"). Action buttons (Edit / Delete / Accept / Send
// to clients) are surfaced contextually based on whether the share is the
// trainer's own outgoing share or one received from a coach.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { scheduleCloudPush } from "../lib/syncManager";

import FadeScreen from "../components/FadeScreen";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import ProgramHeaderCard from "../components/ProgramHeaderCard";
import ProgramSnapshotView from "../components/ProgramSnapshotView";
import ProgramActionFabs from "../components/ProgramActionFabs";
import ProgramSummarySheet from "../components/ProgramSummarySheet";
import TrashIcon from "../components/TrashIcon";
import RecipientPickerSheet from "../components/trainer/RecipientPickerSheet";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../constants/theme";
import { pill, PILL_H_SM } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import { useAccountType } from "../contexts/AccountTypeContext";
import { getMyUid } from "../lib/chat";
import { fetchGroupMembers } from "../lib/groups";
import { canCoachGroup, type GroupRole } from "../constants/groups";
import {
  acceptSharedProgram,
  appendSharedPrograms,
  applyReturnedProgram,
  batchKeyOf,
  loadClients,
  loadGroupSharedPrograms,
  loadSentPrograms,
  loadSharedPrograms,
  removeGroupSharedProgramBatch,
  removeSharedProgram,
  type Client,
  type SentProgram,
  type SharedProgram,
} from "../utils/trainerStore";
import { getJSON } from "../utils/storage";
import { removeShareConfirm } from "../utils/removeShare";
import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";

export default function ProgramViewScreen() {
  const router = useRouter();
  const { sharedId, sentId } = useLocalSearchParams<{ sharedId?: string; sentId?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { accountType } = useAccountType();
  const insets = useSafeAreaInsets();

  // The viewer supports two record types:
  //  - `share`: a SharedProgram (sent by a trainer/coach to this user, or sent
  //    by this trainer to a client). Reached via ?sharedId=...
  //  - `sent`:  a SentProgram (sent by THIS gym user to their trainer for
  //    review; may have been returned with edits). Reached via ?sentId=...
  const [share, setShare] = useState<SharedProgram | null>(null);
  const [sent, setSent] = useState<SentProgram | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [passDownTarget, setPassDownTarget] = useState<SavedProgram | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!sharedId && !sentId) {
      setLoaded(true);
      return;
    }
    const [shares, sents, cs, uid] = await Promise.all([
      loadSharedPrograms(),
      loadSentPrograms(),
      loadClients(),
      // Who I am, so "did I send this" is a comparison rather than a guess.
      getMyUid().catch(() => null),
    ]);
    setMyUid(uid);
    setShare(sharedId ? shares.find(s => s.id === sharedId) ?? null : null);
    setSent(sentId ? sents.find(s => s.id === sentId) ?? null : null);
    setClients(cs);
    setLoaded(true);
  }, [sharedId, sentId]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      await reload();
      if (cancelled) {/* no-op */}
    })();
    return () => { cancelled = true; };
  }, [reload]));

  // A share is "outgoing" (this trainer sent it to one of their clients) when
  // the share's clientId is "all" or matches a Client in this trainer's roster.
  // Gym users never have outgoing shares — any program reaching them was sent
  // BY a trainer, even if that trainer broadcast it with clientId === "all".
  const isOutgoing = useMemo(() => {
    if (!share) return false;
    // Authoritative when the row carries it: I sent this. Checked before
    // anything else, and before the account-type gate, because the roster
    // heuristic below is wrong for a group send — a group member need not be
    // one of my clients, so my own send read as incoming and offered me an
    // Accept button for a program I had just sent.
    if (share.senderId && myUid) return share.senderId === myUid;
    if (accountType !== "pt") return false;
    // A program a coach sent ME is incoming, even though that coach now also
    // lives in my client roster (so clientId could match a Client).
    if (share.receivedFromCoachId) return false;
    if (share.clientId === "all") return true;
    return clients.some(c => c.id === share.clientId);
  }, [share, clients, accountType, myUid]);

  /**
   * Whether I coach the group this program was shared into — owner or trainer,
   * the same test the database enforces for sending to it.
   *
   * Decides who may DELETE a group share. A coach can pull a program out of a
   * group they run even if someone else sent it; a plain member can only view
   * and accept. Null for a non-group share, or while the role is still loading.
   */
  const [groupRole, setGroupRole] = useState<GroupRole | null>(null);
  const shareGroupId = share?.groupId;
  useEffect(() => {
    if (!shareGroupId) return;
    let cancelled = false;
    (async () => {
      try {
        const uid = await getMyUid();
        if (!uid) return;
        const members = await fetchGroupMembers(shareGroupId);
        if (!cancelled) setGroupRole(members.find(m => m.id === uid)?.role ?? null);
      } catch (e) {
        if (__DEV__) console.warn("[avenas] group role", e);
      }
    })();
    return () => { cancelled = true; };
  }, [shareGroupId]);

  /**
   * Sender always; otherwise only a coach of the group it went to.
   *
   * Gated on `shareGroupId` as well as the role, so a role left over from a
   * previously-viewed group share can't grant delete on a direct one — the
   * effect deliberately doesn't clear it, since clearing state synchronously in
   * an effect body is what triggers cascading renders.
   */
  const canDelete = isOutgoing || (!!shareGroupId && !!groupRole && canCoachGroup(groupRole));
  /** The widest of the round buttons pinned across the top: the back button
   *  alone (40 + gap), or Edit and Remove side by side on the right. */
  const topChromeW = isOutgoing ? 88 : 44;

  // Snapshot + title come from whichever record was loaded.
  const snapshot = share?.programSnapshot ?? sent?.programSnapshot ?? null;
  const headerName = share?.programName ?? sent?.programName ?? "Program";
  const accepted = !!share?.acceptedAtISO;

  // Sent-program-specific flags. `returned` = trainer has reviewed and sent
  // edits back; `applied` = the gym user has already merged those edits into
  // their local program.
  const isSent = !!sent;
  const sentReturned = !!sent && sent.status === "returned";
  const sentApplied = !!sent?.appliedAtISO;

  // Two states surface a floating bottom Accept button instead of inline
  // header/footer ones: (1) trainer-shared program the user hasn't accepted
  // yet, (2) a returned SentProgram with unapplied trainer edits.
  // Never offered to the sender — accepting your own send is meaningless, and
  // it was the thing appearing on group sends. Everyone else in the group, coach
  // or member, can accept a copy for themselves.
  const showFloatingAcceptProgram = !isOutgoing && !isSent && !!share && !accepted;
  const showFloatingAcceptChanges = sentReturned && !sentApplied;
  const showFloatingAccept = showFloatingAcceptProgram || showFloatingAcceptChanges;

  const handleAccept = useCallback(async () => {
    if (!share || accepted) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await acceptSharedProgram(share.id);
    scheduleCloudPush(); // the accept materialised/updated @avenas/programs (a synced key)
    await reload();
    Alert.alert("Program Added", `"${share.programName}" was added to your programs.`);
  }, [share, accepted, reload]);

  const handleApplyReturned = useCallback(async () => {
    if (!sent || sentApplied) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await applyReturnedProgram(sent.id);
    scheduleCloudPush(); // applyReturnedProgram wrote @avenas/programs (a synced key)
    await reload();
    Alert.alert("Program Updated", `"${sent.programName}" in your programs was updated with your trainer's edits.`);
  }, [sent, sentApplied, reload]);

  const handleEdit = useCallback(() => {
    if (!share) return;
    router.navigate({ pathname: "/new-program", params: { sharedId: share.id } });
  }, [router, share]);

  const handleDelete = useCallback(async () => {
    if (!share) return;

    // A GROUP send is one program in the group, however it was opened here:
    // the bin takes it out of the group for everyone, exactly like the group
    // page's Remove. It used to go through removeSharedProgram, which only
    // knows "I sent it" vs "I received it": the group's OWNER removing another
    // trainer's send was treated as a recipient and only hid their own copy (so
    // nothing visibly happened), and the sender removed one member's copy out of
    // many. canDelete already limits the bin to the sender or a group coach.
    if (share.groupId) {
      const groupId = share.groupId;
      const key = batchKeyOf(share);
      const batch = (await loadGroupSharedPrograms(groupId).catch(() => [] as SharedProgram[]))
        .filter(s => batchKeyOf(s) === key);
      const prompt = removeShareConfirm({
        programName: share.programName,
        recipients: "this group",
        total: batch.length || 1,
        accepted: batch.length ? batch.filter(s => s.acceptedAtISO).length : (share.acceptedAtISO ? 1 : 0),
      });
      Alert.alert(prompt.title, prompt.body, [
        { text: prompt.cancel, style: "cancel" },
        {
          text: prompt.confirm,
          style: "destructive",
          onPress: async () => {
            try {
              await removeGroupSharedProgramBatch(groupId, key);
            } catch (e) {
              Alert.alert("Couldn't remove program", e instanceof Error ? e.message : "Check your connection and try again.");
              return;
            }
            router.back();
          },
        },
      ]);
      return;
    }

    // A direct send: this screen shows ONE row, so it's one recipient.
    const prompt = removeShareConfirm({
      programName: share.programName,
      recipients: "them",
      total: 1,
      accepted: share.acceptedAtISO ? 1 : 0,
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
            await removeSharedProgram(share.id);
            router.back();
          },
        },
      ]
    );
  }, [share, router]);

  const handleOpenPassDown = useCallback(async () => {
    if (!share?.acceptedProgramId) return;
    if (clients.length === 0) {
      Alert.alert("No clients", "Add a client before passing a program down.");
      return;
    }
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    const local = programs.find(p => p.id === share.acceptedProgramId);
    if (!local) {
      Alert.alert("Program not found", "The accepted program no longer exists in your library.");
      return;
    }
    setPassDownTarget(local);
  }, [share, clients]);

  const handleConfirmPassDown = useCallback(async (recipients: string[] | "all") => {
    if (!passDownTarget) return;
    const now = new Date().toISOString();
    const base = `share_${Date.now()}`;
    const entries: SharedProgram[] = recipients === "all"
      ? [{
          id: base,
          clientId: "all",
          programId: passDownTarget.id,
          programName: passDownTarget.name,
          sentAtISO: now,
          programSnapshot: passDownTarget,
        }]
      : recipients.map((cid, i) => ({
          id: `${base}_${i}`,
          clientId: cid,
          programId: passDownTarget.id,
          programName: passDownTarget.name,
          sentAtISO: now,
          programSnapshot: passDownTarget,
        }));
    await appendSharedPrograms(entries);
    const count = recipients === "all" ? clients.length : recipients.length;
    Alert.alert("Program Sent", `"${passDownTarget.name}" was sent to ${count} client${count === 1 ? "" : "s"}.`);
    setPassDownTarget(null);
  }, [passDownTarget, clients]);

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 20, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
          <Ionicons name="chevron-back" size={22} color={t.tp} />
        </View>
      </TouchableOpacity>

      {/* Edit + Delete pinned top-right so they stay visible through a long
          program. EDIT is the sender's alone — editing a shared snapshot
          re-sends it, which isn't a group coach's call. DELETE is wider: the
          sender, plus anyone who coaches the group it went to, so a program can
          be pulled out of a group by whoever runs it. Members get neither. */}
      {canDelete && (
        <View style={[styles.topActions, { top: insets.top + 16 }]}>
          {isOutgoing && (
          <TouchableOpacity
            onPress={handleEdit}
            activeOpacity={0.8}
            accessibilityLabel="Edit program"
            accessibilityRole="button"
          >
            <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
              <Ionicons name="create-outline" size={20} color={t.tp} />
            </View>
          </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleDelete}
            activeOpacity={0.8}
            accessibilityLabel="Remove program"
            accessibilityRole="button"
          >
            <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
              <TrashIcon size={20} color="#E53935" />
            </View>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + 16,
          // Clears whichever floats above it: the Builder/Summary pills always,
          // plus the Accept CTA below them when that's showing.
          paddingBottom: insets.bottom + (showFloatingAccept ? 170 : 100),
        }}
      >
        {/* A screen title in the review screen's style, with the program's name
            on the card below rather than up here: the two screens show the
            same program from the two ends of one flow, so they open the same
            way. The spacers match the widest chrome either side (the back
            button, or Edit + Remove on the right) so the title stays centred
            and clear of both. */}
        <View style={styles.header}>
          <View style={{ width: topChromeW }} />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>View Program</Text>
          <View style={{ width: topChromeW }} />
        </View>

        {!loaded ? null : (!share && !sent) ? (
          <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.bodyText, { color: t.ts, padding: 18, textAlign: "center" }]}>
              This program is no longer available.
            </Text>
          </NeuCard>
        ) : (
          <>
            {/* Name, weeks, training days and cycle length: the same card the
                review screen opens with (components/ProgramHeaderCard.tsx). It
                also says so when a legacy row has no details to show. */}
            <ProgramHeaderCard name={snapshot?.name ?? headerName} snapshot={snapshot} isDark={isDark} />

            {snapshot && (
              <View style={styles.programBody}>
                {/* The program itself, drawn by the same component the trainer's
                    review screen uses — the two are the same program seen from the
                    two ends of one flow, and must read identically. */}
                <ProgramSnapshotView
                  snapshot={snapshot}
                  isDark={isDark}
                  afterCycle={
                    /* Trainer comments on a returned SentProgram — surfaced near the
                       top because the user is here specifically to consider those
                       edits before applying them. */
                    sentReturned && sent?.trainerComments ? (
                      <NeuCard dark={isDark} radius={14} style={{ marginBottom: 18 }}>
                        <View style={styles.commentBox}>
                          <Text style={[styles.commentLabel, { color: t.ts }]}>TRAINER COMMENTS</Text>
                          <Text style={[styles.commentBody, { color: t.tp }]}>{sent.trainerComments}</Text>
                        </View>
                      </NeuCard>
                    ) : null
                  }
                />

                {/* Action row — contextual to which record (shared vs sent) and
                    its current state. Skipped for outgoing shares (Edit + Delete
                    live in the top-right header) and for any state with a floating
                    bottom Accept CTA (handled below). */}
                {!isOutgoing && !showFloatingAccept && (
                <View style={styles.actionsWrap}>
                  {isSent ? (
                    sentReturned ? (
                      <BounceButton
                        style={{ flex: 1 }}
                        onPress={() => router.navigate({ pathname: "/programs", params: { focus: sent!.programId } })}
                      >
                        <View style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                          <Text style={styles.primaryBtnText}>Open in My Programs</Text>
                        </View>
                      </BounceButton>
                    ) : (
                      <View style={[styles.statusInfo, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}>
                        <Ionicons name="time-outline" size={16} color={t.ts} />
                        <Text style={[styles.statusInfoText, { color: t.ts }]}>Awaiting trainer review</Text>
                      </View>
                    )
                  ) : accepted ? (
                    accountType === "pt" ? (
                      <BounceButton style={{ flex: 1 }} onPress={handleOpenPassDown}>
                        <View style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                          <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                          <Text style={styles.primaryBtnText}>Send to my clients</Text>
                        </View>
                      </BounceButton>
                    ) : (
                      <BounceButton
                        style={{ flex: 1 }}
                        onPress={() => router.navigate(
                          share?.acceptedProgramId
                            ? { pathname: "/programs", params: { focus: share.acceptedProgramId } }
                            : "/programs"
                        )}
                      >
                        <View style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                          <Ionicons name="folder-open-outline" size={16} color="#fff" />
                          <Text style={styles.primaryBtnText}>Open in My Programs</Text>
                        </View>
                      </BounceButton>
                    )
                  ) : null}
                </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {showFloatingAccept && (
        <View
          pointerEvents="box-none"
          style={[styles.floatingBtnWrap, { bottom: insets.bottom + 16 }]}
        >
          {/* Slate, not green: it sits directly under the green Summary pill,
              and two green buttons stacked read as one cluster with no clear
              primary. Slate is the app's other primary colour, the same as
              the builder's Create pill and "Open in Builder". */}
          <BounceButton
            onPress={showFloatingAcceptChanges ? handleApplyReturned : handleAccept}
            accessibilityLabel={showFloatingAcceptChanges ? "Accept changes" : "Accept program"}
          >
            <View style={[styles.primaryBtn, styles.slateBtn, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}>
              <Text style={[styles.primaryBtnText, { color: isDark ? APP_DARK.bg : "#fff" }]}>
                {showFloatingAcceptChanges ? "Accept changes" : "Accept program"}
              </Text>
            </View>
          </BounceButton>
        </View>
      )}

      {/* Builder + Summary, sitting above the Accept CTA when there is one. */}
      {snapshot && (
        <ProgramActionFabs
          bottom={insets.bottom + (showFloatingAccept ? 80 : 24)}
          isDark={isDark}
          // Only the sender edits: a program sent TO you becomes yours to change
          // once you accept it, and until then the builder would be editing
          // someone else's copy.
          onOpenBuilder={isOutgoing ? handleEdit : undefined}
          onOpenSummary={() => setSummaryOpen(true)}
        />
      )}

      {/* One RN Modal on screen at a time: two mounted at once and the second
          never presents again for the life of the screen. The summary is only
          reachable from the page itself, and the recipient picker only from the
          "Send to my clients" action, so they can never both be wanted. */}
      {summaryOpen && snapshot ? (
        <ProgramSummarySheet
          visible
          snapshot={snapshot}
          isDark={isDark}
          onClose={() => setSummaryOpen(false)}
        />
      ) : (
        <RecipientPickerSheet
          visible={!!passDownTarget}
          programName={passDownTarget?.name ?? ""}
          clients={clients}
          onConfirm={handleConfirmPassDown}
          onClose={() => setPassDownTarget(null)}
        />
      )}
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  topActions: {
    position: "absolute",
    right: 20,
    zIndex: 10,
    flexDirection: "row",
    gap: 8,
  },
  // Same as the review screen's title row: 40 tall so the title centres on the
  // round buttons pinned beside it.
  header: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    marginBottom: 24,
  },
  screenTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 17,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    textAlign: "center",
    flex: 1,
  },
  programBody: { marginTop: 18 },

  // The name card is components/ProgramHeaderCard.tsx; the cycle strip, day
  // cards, exercise rows and set rows live in components/ProgramSnapshotView.tsx,
  // along with the styles that drew them.
  bodyText: { fontFamily: FontFamily.regular, fontSize: 13 },

  actionsWrap: { flexDirection: "row", gap: 10, marginTop: 18 },
  statusInfo: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  statusInfoText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  commentBox: { padding: 14, gap: 6 },
  commentLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.8 },
  commentBody: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  primaryBtn: { ...pill(PILL_H_SM), gap: 8, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  primaryBtnText: { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff", letterSpacing: 0.3 },
  // The slate pill's own shadow (components/ProgramActionFabs.tsx): a neutral
  // drop rather than a coloured glow, which is reserved for accent buttons.
  slateBtn: { shadowColor: "#000", shadowOpacity: 0.3 },
  floatingBtnWrap: { position: "absolute", left: 20, right: 20, zIndex: 20 },
});
