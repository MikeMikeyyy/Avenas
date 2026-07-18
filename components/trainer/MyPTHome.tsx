import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { scheduleCloudPush } from "../../lib/syncManager";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Animated, {
  FadeIn, FadeOut, LinearTransition,
  useSharedValue, useAnimatedStyle, withTiming,
} from "react-native-reanimated";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import ChatIcon from "../icons/ChatIcon";
import PeopleIcon from "../icons/PeopleIcon";
import PlusIcon from "../icons/PlusIcon";
import TrashIcon from "../TrashIcon";
import UnreadBadge from "../UnreadBadge";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import ProgramPickerSheet from "./ProgramPickerSheet";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import {
  acceptSharedProgramBatch,
  appendSentProgram,
  applyReturnedProgram,
  backfillAcceptedProgramIds,
  batchKeyOf,
  loadAssignedPT,
  loadClients,
  loadSentPrograms,
  loadSharedPrograms,
  makeInitials,
  migrateBroadcastShares,
  removeSentProgram,
  type AssignedPT,
  type SentProgram,
  type SharedProgram,
} from "../../utils/trainerStore";
import { getMyConnections } from "../../lib/connections";
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

function ChevronToggle({ expanded, color, upDown }: { expanded: boolean; color: string; upDown?: boolean }) {
  const sv = useSharedValue(expanded ? 1 : 0);
  useEffect(() => { sv.value = withTiming(expanded ? 1 : 0, { duration: 220 }); }, [expanded, sv]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: upDown ? `${sv.value * 180}deg` : `${sv.value * 90 - 90}deg` }],
  }));
  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={20} color={color} />
    </Animated.View>
  );
}

export default function MyPTHome() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const unreadMessages = useUnreadMessages();

  const [pt, setPT] = useState<AssignedPT | null>(null);
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
    (async () => {
      // Backfill acceptedProgramId on any pre-existing accepted shares so the
      // "tap to view in /programs" navigation can find the local program by id.
      await backfillAcceptedProgramIds();
      const clientsForMigration = await loadClients();
      await migrateBroadcastShares(clientsForMigration);
      const [p, r, s, progs] = await Promise.all([
        loadAssignedPT(),
        loadSharedPrograms(),
        loadSentPrograms(),
        getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
      ]);
      if (cancelled) return;
      // Dedupe per batch — broadcasts expand into N per-client entries, but
      // the gym user represents all recipients on this device and should see
      // one card per batch.
      const seen = new Set<string>();
      const dedupedReceived: SharedProgram[] = [];
      for (const entry of r) {
        // Skip trainer-to-trainer programs (a coach sent them to a trainer) —
        // they belong on the trainer's My Coaches page, not a gym user's
        // My Trainer feed.
        if (entry.receivedFromCoachId) continue;
        const k = batchKeyOf(entry);
        if (seen.has(k)) continue;
        seen.add(k);
        dedupedReceived.push(entry);
      }
      // A real accepted connection whose counterpart is a trainer (PT) takes
      // over the displayed trainer with their real name + photo. Only PT-typed
      // connections fill this slot — a non-PT accepted connection used to be
      // accepted as a fallback "in case account_type was stale," but that
      // surfaced gym-user friends under the "YOUR TRAINER" label. Better to
      // keep the empty state than mislabel the relationship; account_type is
      // set during onboarding and should be fixed at source if stale.
      let trainer: AssignedPT | null = p;
      try {
        const conns = await getMyConnections();
        const accepted = conns.filter(c => c.status === "accepted");
        const trainerConn = accepted.find(c => c.accountType === "pt");
        if (trainerConn) {
          trainer = { id: trainerConn.otherId, name: trainerConn.name || "Trainer", initials: makeInitials(trainerConn.name || "Trainer"), photoUri: trainerConn.photoUri };
        }
      } catch { /* keep the local trainer */ }
      if (cancelled) return;
      setPT(trainer);
      setReceived(dedupedReceived);
      setSent(s);
      setMyPrograms(Array.isArray(progs) ? progs : []);
    })();
    return () => { cancelled = true; };
  }, []));

  const openChat = () => {
    if (!pt) return;
    router.push({ pathname: "/trainer/chat/[id]", params: { id: pt.id, name: pt.name, initials: pt.initials } });
  };



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
    await appendSentProgram(entry);
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
        <MaskedView style={StyleSheet.absoluteFillObject} maskElement={
          <LinearGradient
            colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.5)", "transparent"]}
            locations={[0, 0.6, 0.85, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top, paddingBottom: insets.bottom + 140 }}
      >
        <View style={styles.topPills}>
          <BounceButton
            style={styles.trainersBtnWrap}
            onPress={() => router.push("/my-trainers")}
            accessibilityLabel="Open my trainers"
          >
            <View style={[styles.trainersBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "#ffffff" }]}>
              <Ionicons name="person-outline" size={16} color={ACCT} />
              <Text style={[styles.trainersBtnText, { color: t.tp }]}>My Trainers</Text>
            </View>
          </BounceButton>
          <View style={{ flex: 1 }} />
          <BounceButton onPress={() => router.push("/trainer/messages")} accessibilityLabel="Open messages">
            <View>
              <View style={[styles.circleBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "#ffffff" }]}>
                <ChatIcon size={18} color={t.tp} />
              </View>
              <UnreadBadge count={unreadMessages} style={styles.msgBadge} />
            </View>
          </BounceButton>
          <BounceButton onPress={() => router.push("/connect")} accessibilityLabel="Connect with someone">
            <View>
              <View style={[styles.circleBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "#ffffff" }]}>
                <Ionicons name="add" size={24} color={t.tp} />
              </View>
              <UnreadBadge count={pendingIncoming} style={styles.msgBadge} />
            </View>
          </BounceButton>
        </View>

        <Text style={[styles.title, { color: t.tp }]}>My Trainer</Text>

        {!pt ? (
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 16 }}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
                <PeopleIcon size={28} color={ACCT} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No trainer linked yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                Connect with a personal trainer to share programs and get feedback on your progress.
              </Text>
              <BounceButton style={{ marginTop: 8 }} onPress={() => router.push("/connect")}>
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
                <View style={[styles.chatBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "#ffffff" }]}>
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
          <NeuCard dark={isDark} radius={16}>
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
                    onPress={() => router.push({ pathname: "/program-view", params: { sharedId: r.id } })}
                    accessibilityLabel={`View ${r.programName}`}
                  >
                    <NeuCard dark={isDark} radius={14} innerStyle={styles.viewBtnInner}>
                      <Text style={[styles.viewBtnText, { color: t.tp }]}>View</Text>
                    </NeuCard>
                  </BounceButton>
                  <BounceButton
                    style={{ flex: 1 }}
                    onPress={() => handleAccept(r)}
                    accessibilityLabel={`Accept ${r.programName}`}
                  >
                    <View style={[styles.acceptCta, { backgroundColor: ACCT, shadowColor: ACCT }]}>
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
                    onPress={() => router.push(
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
                  onPress={() => router.push({ pathname: "/program-view", params: { sharedId: r.id } })}
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
            <View style={[styles.addBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
              <PlusIcon size={15} color="#fff" />
            </View>
          </BounceButton>
        </View>
        {!collapsedSentToTrainer ? (sent.length === 0 ? (
          <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.smallEmpty, { color: t.ts }]}>You haven't sent any programs to your trainer yet.</Text>
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
                        <Text style={[styles.itemMeta, { color: t.ts }]}>
                          Sent {fmtAgo(s.sentAtISO)}
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
                            <View style={[styles.acceptCta, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                              <Text style={styles.acceptCtaText}>Accept changes</Text>
                            </View>
                          </BounceButton>
                        )}
                        <BounceButton
                          style={{ flex: 1 }}
                          onPress={() => router.push({ pathname: "/program-view", params: { sentId: s.id } })}
                          accessibilityLabel={`View ${s.programName}`}
                        >
                          <NeuCard dark={isDark} radius={14} innerStyle={styles.viewBtnInner}>
                            <Text style={[styles.viewBtnText, { color: t.tp }]}>View</Text>
                          </NeuCard>
                        </BounceButton>
                        <BounceButton
                          onPress={() => handleUnsendProgram(s)}
                          accessibilityLabel="Delete program"
                        >
                          <NeuCard dark={isDark} radius={14} innerStyle={[styles.viewBtnInner, styles.deleteSentBtn]}>
                            <TrashIcon size={16} color="#E53935" />
                          </NeuCard>
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
                if (applied) router.push({ pathname: "/programs", params: { focus: s.programId } });
                else router.push({ pathname: "/program-view", params: { sentId: s.id } });
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
  cta:          { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 24, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  ctaText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },
  ptCard:       { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  avatar:       { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 18 },
  ptLabel:      { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 1 },
  ptName:       { fontFamily: FontFamily.bold, fontSize: 18, marginTop: 2 },
  presenceRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  presenceDot:  { width: 6, height: 6, borderRadius: 3 },
  presenceText: { fontFamily: FontFamily.regular, fontSize: 12 },
  chatBtn:      { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  itemRow:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  itemName:     { fontFamily: FontFamily.semibold, fontSize: 14 },
  itemMeta:     { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  receivedInner:{ padding: 14, gap: 10 },
  receivedTop:  { flexDirection: "row", alignItems: "center", gap: 12 },
  acceptBox:    { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cycleGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:    { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:{ fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  acceptedLine: { fontFamily: FontFamily.semibold, fontSize: 12 },
  actionRow:    { flexDirection: "row", gap: 10 },
  viewBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, minHeight: 44 },
  viewBtnText:  { fontFamily: FontFamily.bold, fontSize: 14 },
  acceptCta:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, minHeight: 44, borderRadius: 14, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  acceptCtaText:{ fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },
  deleteSentBtn:{ width: 56 },
  chevronRow:   { alignItems: "center", paddingTop: 2 },
  sentHeaderRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 12 },
  sectionHeaderRow:{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12 },
  sectionHeaderTap:{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  addBtn:       { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  sentInner:    { padding: 14, gap: 10 },
  sentTopRow:   { flexDirection: "row", alignItems: "center", gap: 12 },
  commentBox:   { paddingTop: 10, borderTopWidth: 1, gap: 6 },
  commentLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.8 },
  commentBody:  { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  statusPill:   { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText:   { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.3 },
  summaryRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  summaryName:  { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14 },
  smallEmpty:   { fontFamily: FontFamily.regular, fontSize: 13, padding: 18, textAlign: "center" },
});
