import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { scheduleCloudPush } from "../../lib/syncManager";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import ChevronToggle from "../ChevronToggle";
import ChatIcon from "../icons/ChatIcon";
import PeopleIcon from "../icons/PeopleIcon";
import PlusIcon from "../icons/PlusIcon";
import TrashIcon from "../TrashIcon";
import UnreadBadge from "../UnreadBadge";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import ProgramPickerSheet from "./ProgramPickerSheet";
import GroupInviteCard from "./GroupInviteCard";
import { acceptGroupInvite, declineGroupInvite, fetchMyGroupInvites } from "../../lib/groups";
import { loadGroupRows, type GroupChatRow } from "../../utils/groupStore";
import type { GroupInvite } from "../../constants/groups";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER_BRIGHT } from "../../constants/theme";
import { haloGlow, pillGlow, PILL_RADIUS, PILL_SHADOW } from "../../constants/buttons";
import { CARD_INNER, CARD_META, CARD_PAD, CARD_PILL, CARD_PILL_TEXT, CARD_TITLE, CARD_TOP, SUMMARY_ROW } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";
import {
  acceptSharedProgramBatch,
  appendSentProgram,
  applyReturnedProgram,
  backfillAcceptedProgramIds,
  batchKeyOf,
  loadClients,
  loadSentPrograms,
  loadSharedPrograms,
  migrateBroadcastShares,
  removeSentProgram,
  type AssignedPT,
  type SentProgram,
  type SharedProgram,
} from "../../utils/trainerStore";
import { resolveMyTrainers } from "../../utils/roster";
import Avatar from "../Avatar";
import { getJSON } from "../../utils/storage";
import { isActiveNow, presenceLabel } from "../../utils/presence";
import { PROGRAMS_KEY, type SavedProgram } from "../../constants/programs";

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function MyPTHome() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The divider tone on each theme — t.div matches the dark card exactly, so dark
  // needs translucent white to show at all.
  const skeletonFill = isDark ? "rgba(255,255,255,0.08)" : t.div;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const unreadMessages = useUnreadMessages();

  // `undefined` = still resolving, `null` = resolved and there isn't one. The
  // difference is the whole point: with only null, the page drew "No trainer
  // linked yet" for the half-second before the connections came back, to people
  // who have a trainer.
  const [pt, setPT] = useState<AssignedPT | null | undefined>(undefined);
  // Same distinction for the program lists, whose empty states ("No programs
  // received yet") flashed the same way.
  const [programsLoaded, setProgramsLoaded] = useState(false);
  // Live "last active" for the connected trainer + the manage-button badge
  // count. Disconnecting a real connection lives on the Connect screen
  // (app/connect.tsx). A local/mock trainer isn't in the map → no presence row.
  const { presenceById, pendingIncoming } = useConnectionPresence();
  const [received, setReceived] = useState<SharedProgram[]>([]);
  const [sent, setSent] = useState<SentProgram[]>([]);
  const [expandedReceived, setExpandedReceived] = useState<Set<string>>(new Set());
  const [expandedSent, setExpandedSent] = useState<Set<string>>(new Set());
  const [collapsedFromTrainer, setCollapsedFromTrainer] = useState(false);
  const [collapsedSentToTrainer, setCollapsedSentToTrainer] = useState(false);
  // Groups I've joined, and the ones still waiting on an answer. Invites come
  // from their own RPC rather than from the group rows: until you accept, the
  // group itself is not readable to you (migration 0027).
  const [groups, setGroups] = useState<GroupChatRow[]>([]);
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState(false);
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
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

  const toggleReceived = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedReceived(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSent = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedSent(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;

    // The trainer card resolves ON ITS OWN. It used to wait inside one
    // Promise.all for the slowest of six loads — five of them network calls
    // about groups, invites and shares — after three share migrations ran first.
    // One connections lookup is all this card needs. The featured trainer is
    // whichever one is primary on /my-trainers; the resolver honours that
    // choice, falls back to the first connected trainer, and only fills this
    // slot with a PT-typed account. Blocked ids and severed-but-still-local
    // entries are filtered there too.
    resolveMyTrainers()
      .then(t => { if (!cancelled) setPT(t.primary); })
      .catch(err => {
        if (__DEV__) console.warn("[avenas] resolve trainers", err);
        // Settle a first load so the page isn't stuck on a placeholder; keep a
        // trainer already on screen rather than blanking it on a refresh error.
        if (!cancelled) setPT(prev => (prev === undefined ? null : prev));
      });

    (async () => {
      try {
        // Backfill acceptedProgramId on any pre-existing accepted shares so the
        // "tap to view in /programs" navigation can find the local program by id.
        await backfillAcceptedProgramIds();
        const clientsForMigration = await loadClients();
        await migrateBroadcastShares(clientsForMigration);
        const [r, s, progs, groupRows, invites] = await Promise.all([
          loadSharedPrograms(),
          loadSentPrograms(),
          getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
          loadGroupRows(),
          fetchMyGroupInvites(),
        ]);
        if (cancelled) return;
        // Dedupe per batch — broadcasts expand into N per-client entries, but
        // the gym user represents all recipients on this device and should see
        // one card per batch.
        const seen = new Set<string>();
        const dedupedReceived: SharedProgram[] = [];
        for (const entry of r) {
          // Skip trainer-to-trainer programs: they belong on the trainer-side
          // My Trainers page, not a gym user's My Trainer feed.
          if (entry.receivedFromCoachId) continue;
          const k = batchKeyOf(entry);
          if (seen.has(k)) continue;
          seen.add(k);
          dedupedReceived.push(entry);
        }
        setReceived(dedupedReceived);
        setSent(s);
        setMyPrograms(Array.isArray(progs) ? progs : []);
        setGroups(groupRows);
        setGroupInvites(invites);
      } catch (err) {
        if (__DEV__) console.warn("[avenas] load trainer hub", err);
      } finally {
        // Even on failure: an empty state is honest once we've tried, and a list
        // that never settles would hide the "send a program" affordances.
        if (!cancelled) setProgramsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []));

  const openChat = () => {
    if (!pt) return;
    router.navigate({ pathname: "/trainer/chat/[id]", params: { id: pt.id, name: pt.name, initials: pt.initials } });
  };



  /** Join a group I was invited to. The group only becomes readable once the
   *  RPC returns, so the list is re-read rather than moved across optimistically
   *  — a failed accept must not leave a group card that opens to nothing. */
  const handleAcceptInvite = useCallback(async (invite: GroupInvite) => {
    try {
      await acceptGroupInvite(invite.groupId);
    } catch (e) {
      Alert.alert("Couldn't join group", e instanceof Error ? e.message : "Check your connection and try again.");
      return;
    }
    const [groupRows, invites] = await Promise.all([loadGroupRows(), fetchMyGroupInvites()]);
    setGroups(groupRows);
    setGroupInvites(invites);
  }, []);

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

  const handleApplyReturned = useCallback(async (entry: SentProgram) => {
    if (entry.appliedAtISO) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await applyReturnedProgram(entry.id);
    scheduleCloudPush(); // applyReturnedProgram wrote @avenas/programs (a synced key)
    const appliedAt = new Date().toISOString();
    setSent(prev => prev.map(s => s.id === entry.id ? { ...s, appliedAtISO: appliedAt } : s));
    Alert.alert("Program Updated", `"${entry.programName}" in your programs was updated with your trainer's edits.`);
  }, []);

  const handleUnsendProgram = useCallback((entry: SentProgram) => {
    Alert.alert(
      "Unsend Program",
      `Unsend "${entry.programName}" from your trainer? They will no longer see it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unsend",
          style: "destructive",
          onPress: async () => {
            await removeSentProgram(entry.id);
            setSent(prev => prev.filter(s => s.id !== entry.id));
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
      Alert.alert("Couldn't send program", e instanceof Error ? e.message : "Check your internet and try again.");
      return;
    }
    setSent(prev => [entry, ...prev]);
    Alert.alert("Sent", `"${program.name}" was sent to ${pt.name}.`);
  }, [pt]);

  const handleAccept = useCallback(async (share: SharedProgram) => {
    if (share.acceptedAtISO) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const key = batchKeyOf(share);
    const importedId = await acceptSharedProgramBatch(key);
    scheduleCloudPush(); // the accept materialised/updated @avenas/programs (a synced key)
    const acceptedAt = new Date().toISOString();
    setReceived(prev => prev.map(r => batchKeyOf(r) === key
      ? { ...r, acceptedAtISO: acceptedAt, acceptedProgramId: importedId ?? undefined }
      : r));
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
      >
        <View style={styles.topPills}>
          <BounceButton
            style={styles.trainersBtnWrap}
            onPress={() => router.navigate("/my-trainers")}
            accessibilityLabel="Open my trainers"
          >
            <View style={[styles.trainersBtn, { backgroundColor: t.ctrl }]}>
              <Ionicons name="person-outline" size={16} color={ACCT} />
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
                <Ionicons name="add" size={24} color={t.tp} />
              </View>
              <UnreadBadge count={pendingIncoming} style={styles.msgBadge} />
            </View>
          </BounceButton>
        </View>

        <Text style={[styles.title, { color: t.tp }]}>My Trainer</Text>

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

        <Pressable onPress={toggleFromTrainer} style={styles.sectionHeaderRow} accessibilityRole="button">
          <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>From Your Trainer</Text>
          <ChevronToggle expanded={!collapsedFromTrainer} color={t.ts} />
        </Pressable>
        {!collapsedFromTrainer ? (received.length === 0 ? (
          // Only say "none" once we've actually looked; before that it's a lie.
          !programsLoaded ? null : <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.smallEmpty, { color: t.ts }]}>No programs received yet.</Text>
          </NeuCard>
        ) : (
          <View>
            {received.map(r => {
              const accepted = !!r.acceptedAtISO;
              // Was accepted at some point but the gym user deleted it from
              // /programs. acceptedAtISO is cleared on delete and
              // deletedByRecipientAtISO is stamped — see removeSharedProgramByLocalId.
              const wasDeleted = !accepted && !!r.deletedByRecipientAtISO;
              const isExpanded = expandedReceived.has(r.id);
              const cycle = r.programSnapshot?.cyclePattern ?? [];

              // Shared top + cycle grid — used by every state.
              const headerAndCycle = (
                <>
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
                                ? { backgroundColor: ACCT + "22", borderColor: ACCT, borderWidth: 1 }
                                : { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div },
                            ]}
                          >
                            <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                              {day || "Rest"}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              );

              // Inline View + Accept buttons reused by both the "never accepted"
              // state and the expanded body of the "was deleted" state.
              const viewAcceptRow = (
                <View style={styles.actionRow}>
                  <BounceButton
                    style={{ flex: 1 }}
                    onPress={() => router.navigate({ pathname: "/program-view", params: { sharedId: r.id } })}
                    accessibilityLabel={`View ${r.programName}`}
                  >
                    <View style={[styles.viewBtnInner, { backgroundColor: t.ctrl }]}>
                      <Text style={[styles.viewBtnText, { color: t.tp }]}>View</Text>
                    </View>
                  </BounceButton>
                  <BounceButton
                    style={{ flex: 1 }}
                    onPress={() => handleAccept(r)}
                    accessibilityLabel={`Accept ${r.programName}`}
                  >
                    <View style={[styles.acceptCta, { backgroundColor: ACCT }]}>
                      <Text style={styles.acceptCtaText}>Accept program</Text>
                    </View>
                  </BounceButton>
                </View>
              );

              // ── ACCEPTED ──────────────────────────────────────────────
              if (accepted) {
                return (
                  <TouchableOpacity
                    key={r.id}
                    activeOpacity={0.85}
                    onPress={() => router.navigate(
                      r.acceptedProgramId
                        ? { pathname: "/programs", params: { focus: r.acceptedProgramId } }
                        : "/programs"
                    )}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${r.programName} in your programs`}
                    style={{ marginBottom: 10 }}
                  >
                    <NeuCard dark={isDark} radius={16}>
                      <View style={styles.receivedInner}>
                        {headerAndCycle}
                        <Text style={[styles.acceptedLine, { color: ACCT }]}>Added to your programs · Tap to view</Text>
                      </View>
                    </NeuCard>
                  </TouchableOpacity>
                );
              }

              // ── WAS DELETED (accepted-then-removed-from-/programs) ────
              // Expand-on-tap dropdown with View + Accept Program (re-add).
              if (wasDeleted) {
                return (
                  <Animated.View key={r.id} layout={LinearTransition.duration(220)}>
                    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                      <Pressable onPress={() => toggleReceived(r.id)} style={styles.receivedInner}>
                        {headerAndCycle}
                        <Text style={[styles.acceptedLine, { color: t.ts }]}>
                          Removed from your programs · Tap to view or add back
                        </Text>
                        {isExpanded && (
                          <Animated.View
                            entering={FadeIn.duration(180)}
                            exiting={FadeOut.duration(140)}
                          >
                            {viewAcceptRow}
                          </Animated.View>
                        )}
                        <View style={styles.chevronRow}>
                          <ChevronToggle expanded={isExpanded} color={t.ts} upDown />
                        </View>
                      </Pressable>
                    </NeuCard>
                  </Animated.View>
                );
              }

              // ── NEVER ACCEPTED ────────────────────────────────────────
              return (
                <View key={r.id} style={{ marginBottom: 10 }}>
                  <NeuCard dark={isDark} radius={16}>
                    <View style={styles.receivedInner}>
                      {headerAndCycle}
                      {viewAcceptRow}
                    </View>
                  </NeuCard>
                </View>
              );
            })}
          </View>
        )) : received.length > 0 ? (
          <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
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

        <View style={styles.sentHeaderRow}>
          <Pressable onPress={toggleSentToTrainer} style={styles.sectionHeaderTap} accessibilityRole="button">
            <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Sent to Trainer</Text>
            <ChevronToggle expanded={!collapsedSentToTrainer} color={t.ts} />
          </Pressable>
          <BounceButton onPress={() => setSendOpen(true)} accessibilityLabel="Send a program to trainer">
            <View style={[styles.addBtn, { backgroundColor: t.ctrl }]}>
              <PlusIcon size={15} color={t.tp} />
            </View>
          </BounceButton>
        </View>
        {!collapsedSentToTrainer ? (sent.length === 0 ? (
          !programsLoaded ? null : <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.smallEmpty, { color: t.ts }]}>{`You haven't sent any programs to your trainer yet.`}</Text>
          </NeuCard>
        ) : (
          sent.map(s => {
            const returned = s.status === "returned";
            const applied = !!s.appliedAtISO;
            const cycle = s.programSnapshot?.cyclePattern ?? [];
            const isExpanded = expandedSent.has(s.id);

            return (
              <Animated.View key={s.id} layout={LinearTransition.duration(220)}>
                <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                  <Pressable onPress={() => toggleSent(s.id)} style={styles.sentInner}>
                    <View style={styles.sentTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{s.programName}</Text>
                        {/* Where it went matters here: a program posted to a
                            group could come back from any trainer in it, and
                            the name is looked up live so a renamed group reads
                            correctly on old sends. */}
                        <Text style={[styles.itemMeta, { color: t.ts }]} numberOfLines={1}>
                          Sent {fmtAgo(s.sentAtISO)}
                          {s.groupId ? ` · ${groups.find(g => g.group.id === s.groupId)?.group.name ?? "a group"}` : ""}
                          {returned && s.returnedAtISO ? ` · Returned ${fmtAgo(s.returnedAtISO)}` : ""}
                        </Text>
                      </View>
                      {returned && applied ? (
                        <View
                          style={[
                            styles.acceptBox,
                            { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },
                          ]}
                          accessibilityLabel="Changes applied"
                        >
                          <Ionicons name="checkmark" size={14} color="#fff" />
                        </View>
                      ) : returned ? (
                        <View style={[styles.statusPill, { backgroundColor: `${ACCT}22` }]}>
                          <Text style={[styles.statusText, { color: ACCT }]}>Returned</Text>
                        </View>
                      ) : (
                        <View style={[styles.statusPill, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}>
                          <Text style={[styles.statusText, { color: t.ts }]}>Pending</Text>
                        </View>
                      )}
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
                                  ? { backgroundColor: ACCT + "22", borderColor: ACCT, borderWidth: 1 }
                                  : { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div },
                              ]}
                            >
                              <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                                {day || "Rest"}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                    {returned && s.trainerComments ? (
                      <View style={[styles.commentBox, { borderTopColor: t.div }]}>
                        <Text style={[styles.commentLabel, { color: t.ts }]}>TRAINER COMMENTS</Text>
                        <Text style={[styles.commentBody, { color: t.tp }]}>{s.trainerComments}</Text>
                      </View>
                    ) : null}
                    {isExpanded && (
                      <Animated.View
                        entering={FadeIn.duration(180)}
                        exiting={FadeOut.duration(140)}
                        style={styles.actionRow}
                      >
                        {returned && !applied && (
                          <BounceButton
                            style={{ flex: 1 }}
                            onPress={() => handleApplyReturned(s)}
                            accessibilityLabel="Accept trainer's changes"
                          >
                            <View style={[styles.acceptCta, { backgroundColor: ACCT }]}>
                              <Text style={styles.acceptCtaText}>Accept changes</Text>
                            </View>
                          </BounceButton>
                        )}
                        <BounceButton
                          style={{ flex: 1 }}
                          onPress={() => router.navigate({ pathname: "/program-view", params: { sentId: s.id } })}
                          accessibilityLabel={`View ${s.programName}`}
                        >
                          <View style={[styles.viewBtnInner, { backgroundColor: t.ctrl }]}>
                            <Text style={[styles.viewBtnText, { color: t.tp }]}>View</Text>
                          </View>
                        </BounceButton>
                        <BounceButton
                          onPress={() => handleUnsendProgram(s)}
                          accessibilityLabel="Delete program"
                        >
                          <View style={[styles.viewBtnInner, styles.deleteSentBtn, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
                            <TrashIcon size={16} color="#fff" />
                          </View>
                        </BounceButton>
                      </Animated.View>
                    )}
                    <View style={styles.chevronRow}>
                      <ChevronToggle expanded={!isExpanded} color={t.ts} upDown />
                    </View>
                  </Pressable>
                </NeuCard>
              </Animated.View>
            );
          })
        )) : sent.length > 0 ? (
          <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
            {sent.map((s, i) => {
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
                    { borderBottomColor: t.div, borderBottomWidth: i === sent.length - 1 ? 0 : 1 },
                  ]}
                >
                  <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{s.programName}</Text>
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

        {/* Groups a trainer has put me in. The section only exists once there's
            something in it: a gym user who has never been added to one has no
            use for an empty Groups heading.

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
                {groups.length > 0 && (
                  <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                    {groups.map((g, i) => (
                      <TouchableOpacity
                        key={g.group.id}
                        onPress={() => router.navigate({ pathname: "/trainer/group/[id]", params: { id: g.group.id, name: g.group.name } })}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Open group ${g.group.name}`}
                        style={[
                          styles.summaryRow,
                          { borderBottomColor: t.div, borderBottomWidth: i === groups.length - 1 ? 0 : 1 },
                        ]}
                      >
                        <View style={[styles.groupIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
                          <PeopleIcon size={16} color={ACCT} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{g.group.name}</Text>
                          <Text style={[styles.groupMeta, { color: t.ts }]}>
                            {g.group.memberCount} member{g.group.memberCount === 1 ? "" : "s"}
                          </Text>
                        </View>
                        <UnreadBadge count={g.unreadCount} />
                        <Ionicons name="chevron-forward" size={16} color={t.ts} />
                      </TouchableOpacity>
                    ))}
                  </NeuCard>
                )}
              </>
            )}
          </>
        )}
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
  receivedInner:{ ...CARD_INNER, gap: 10 },
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
  // Same geometry as viewBtnInner — the two always sit side by side, and any
  // difference in height reads as a mistake rather than as emphasis.
  acceptCta:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 14, minHeight: 38, borderRadius: PILL_RADIUS, ...pillGlow(ACCT, 0.4) },
  acceptCtaText:{ fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },
  deleteSentBtn:{ width: 56 },
  chevronRow:   { alignItems: "center", paddingTop: 2 },
  sentHeaderRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 12 },
  sectionHeaderRow:{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12 },
  sectionHeaderTap:{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  // Neutral chrome, matching the circular buttons on the trainer hub — a soft
  // drop shadow rather than the ACCT glow reserved for primary green actions.
  addBtn:       { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  sentInner:    { ...CARD_INNER, gap: 10 },
  sentTopRow:   { ...CARD_TOP },
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
