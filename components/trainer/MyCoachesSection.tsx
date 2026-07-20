// "My Coaches" — a section embedded at the top of PTHome that lets a trainer
// also be coached by other trainers (mentors). Mirrors the visual language of
// MyPTHome's "My Trainer" + "From Your Trainer" blocks, but supports a list of
// coaches and adds a one-tap "Send to clients" action on accepted programs so
// the trainer can pass a mentor's program down to their own roster.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { scheduleCloudPush } from "../../lib/syncManager";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import TrashIcon from "../TrashIcon";
import PeopleIcon from "../icons/PeopleIcon";
import SendIcon from "../icons/SendIcon";
import RecipientPickerSheet from "./RecipientPickerSheet";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import {
  acceptSharedProgram,
  appendSharedPrograms,
  disconnectTrainer,
  loadCoaches,
  loadSharedPrograms,
  migrateCoachReceivedShares,
  removeSharedProgram,
  type AssignedPT,
  type Client,
  type SharedProgram,
} from "../../utils/trainerStore";
import { getJSON } from "../../utils/storage";
import { isActiveNow, presenceLabel } from "../../utils/presence";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import { PROGRAMS_KEY, type SavedProgram } from "../../constants/programs";

// Destructive red, matching the inline value used in PTHome / program-view.
const REMOVE_RED = "#E53935";

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

interface Props {
  /** The trainer's clients — needed to power the "Send to clients" RecipientPickerSheet
   *  and to distinguish outgoing shares (clientId is a client) from incoming
   *  shares from a coach (clientId is not a client). */
  clients: Client[];
}

export interface MyCoachesSectionRef {
  openMenu: () => void;
}

const MyCoachesSection = forwardRef<MyCoachesSectionRef, Props>(function MyCoachesSection({ clients }, ref) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();

  const [coaches, setCoaches] = useState<AssignedPT[]>([]);
  const [received, setReceived] = useState<SharedProgram[]>([]);
  const [passDownTarget, setPassDownTarget] = useState<SavedProgram | null>(null);
  // Coach entries are local snapshots; live "last active" comes from the
  // connection presence poll. Coaches without a real connection (legacy/mock)
  // aren't in the map and show no presence row.
  const { presenceById } = useConnectionPresence();

  const reload = useCallback(async () => {
    // Backfill the direction flag on any legacy incoming shares before reading.
    await migrateCoachReceivedShares();
    const [cs, shares] = await Promise.all([loadCoaches(), loadSharedPrograms()]);
    setCoaches(cs);
    // Incoming = a program a coach sent ME (flagged with receivedFromCoachId).
    setReceived(shares.filter(s => !!s.receivedFromCoachId));
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleConnectCoach = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate("/connect");
  }, [router]);

  const handleRemoveCoach = useCallback((coach: AssignedPT) => {
    Alert.alert(
      "Remove Coach",
      `Stop being connected with ${coach.name}? They'll be removed from your clients too. Programs you've already accepted will stay in your library.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await disconnectTrainer(coach.id);
            await reload();
          },
        },
      ]
    );
  }, [reload]);

  // Step into "remove" sub-menu — lists every coach as an Alert button so
  // the user can pick which one to remove. Cancel returns to nothing.
  const openRemovePicker = useCallback(() => {
    if (coaches.length === 0) {
      Alert.alert("No coaches", "You haven't connected to any coaches yet.");
      return;
    }
    Alert.alert(
      "Remove a Coach",
      "Pick a coach to remove.",
      [
        { text: "Cancel", style: "cancel" },
        ...coaches.map(coach => ({
          text: coach.name,
          style: "destructive" as const,
          onPress: () => handleRemoveCoach(coach),
        })),
      ],
    );
  }, [coaches, handleRemoveCoach]);

  // Top-right plus button entry — offers both add and remove paths.
  const openMenu = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Manage Coaches",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Add a Coach", onPress: handleConnectCoach },
        { text: "Remove a Coach", style: "destructive", onPress: openRemovePicker },
      ],
    );
  }, [handleConnectCoach, openRemovePicker]);

  useImperativeHandle(ref, () => ({ openMenu }), [openMenu]);

  const handleAccept = useCallback(async (share: SharedProgram) => {
    if (share.acceptedAtISO) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const importedId = await acceptSharedProgram(share.id);
    scheduleCloudPush(); // the accept materialised/updated @avenas/programs (a synced key)
    const acceptedAt = new Date().toISOString();
    setReceived(prev => prev.map(r => r.id === share.id
      ? { ...r, acceptedAtISO: acceptedAt, acceptedProgramId: importedId ?? undefined }
      : r
    ));
    Alert.alert("Program Added", `"${share.programName}" was added to your programs.`);
  }, []);

  const handleOpenPassDown = useCallback(async (share: SharedProgram) => {
    if (!share.acceptedProgramId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (clients.length === 0) {
      Alert.alert("No clients", "Add a client before passing a program down.");
      return;
    }
    // Look up the materialised local program so the recipients receive a
    // current snapshot (in case the user edited it after accepting).
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    const local = programs.find(p => p.id === share.acceptedProgramId);
    if (!local) {
      Alert.alert("Program not found", "The accepted program no longer exists in your library.");
      return;
    }
    setPassDownTarget(local);
  }, [clients]);

  const handleRemove = useCallback((share: SharedProgram) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const accepted = !!share.acceptedAtISO;
    Alert.alert(
      "Remove Program",
      accepted
        ? `Remove "${share.programName}" from your coaches list? Your accepted copy stays in your library.`
        : `Remove "${share.programName}"? You won't be able to get it back unless your coach sends it again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeSharedProgram(share.id);
            await reload();
          },
        },
      ],
    );
  }, [reload]);

  const handleConfirmPassDown = useCallback(async (recipients: string[] | "all") => {
    if (!passDownTarget) return;
    const now = new Date().toISOString();
    const base = `share_${Date.now()}`;
    // Expand "all" to explicit ids up front (same as PTHome's send flow): a
    // literal "all" entry can only live in the LOCAL blob, so real connected
    // clients would never receive it through the cloud path.
    const targets = recipients === "all" ? clients.map(c => c.id) : recipients;
    const entries: SharedProgram[] = targets.map((cid, i) => ({
      id: `${base}_${i}`,
      clientId: cid,
      programId: passDownTarget.id,
      programName: passDownTarget.name,
      sentAtISO: now,
      programSnapshot: passDownTarget,
    }));
    try {
      await appendSharedPrograms(entries);
    } catch (e) {
      Alert.alert("Couldn't send program", e instanceof Error ? e.message : "Check your internet and try again.");
      return;
    }
    const count = recipients === "all" ? clients.length : recipients.length;
    Alert.alert("Program Sent", `"${passDownTarget.name}" was sent to ${count} client${count === 1 ? "" : "s"}.`);
    setPassDownTarget(null);
  }, [passDownTarget, clients]);

  const coachNameFor = (share: SharedProgram): string => {
    const coach = coaches.find(c => c.id === share.receivedFromCoachId);
    return coach?.name ?? "your coach";
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sub, { color: t.ts }]}>
        Trainers you receive programs from — accept one and pass it on to your clients.
      </Text>

      {coaches.length === 0 ? (
        <NeuCard dark={isDark} radius={20} style={{ marginTop: 12 }}>
          <View style={styles.emptyInner}>
            <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
              <PeopleIcon size={28} color={ACCT} />
            </View>
            <Text style={[styles.emptyTitle, { color: t.tp }]}>No coaches yet</Text>
            <Text style={[styles.emptyBody, { color: t.ts }]}>
              Connect to a senior trainer to receive programs you can adapt and pass on to your own clients.
            </Text>
            <BounceButton style={{ marginTop: 8 }} onPress={handleConnectCoach}>
              <View style={[styles.cta, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                <Text style={styles.ctaText}>Connect to a Trainer</Text>
              </View>
            </BounceButton>
          </View>
        </NeuCard>
      ) : (
        <View style={{ marginTop: 12, gap: 10 }}>
          {coaches.map(coach => (
            <NeuCard key={coach.id} dark={isDark} radius={16}>
              <View style={styles.coachCard}>
                <View style={[styles.avatar, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
                  <Text style={[styles.avatarText, { color: ACCT }]}>{coach.initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.coachLabel, { color: t.ts }]}>COACH</Text>
                  <Text style={[styles.coachName, { color: t.tp }]}>{coach.name}</Text>
                  {(() => {
                    const lastActive = presenceById.get(coach.id);
                    if (!lastActive) return null; // not connected, never active, or sharing off
                    return (
                      <View style={styles.presenceRow}>
                        <View style={[styles.presenceDot, { backgroundColor: isActiveNow(lastActive) ? ACCT : t.ts }]} />
                        <Text style={[styles.presenceText, { color: t.ts }]}>{presenceLabel(lastActive)}</Text>
                      </View>
                    );
                  })()}
                </View>
              </View>
            </NeuCard>
          ))}
        </View>
      )}

      {coaches.length > 0 && (
        <>
          <View style={styles.sectionHeadingRow}>
            <Text style={[styles.sectionHeading, { color: t.tp }]}>From Your Coaches</Text>
          </View>
          {received.length === 0 ? (
            <NeuCard dark={isDark} radius={16}>
              <Text style={[styles.smallEmpty, { color: t.ts }]}>No programs received from coaches yet.</Text>
            </NeuCard>
          ) : (
            <View>
              {received.map(r => {
                const accepted = !!r.acceptedAtISO;
                const cycle = r.programSnapshot?.cyclePattern ?? [];
                return (
                  <TouchableOpacity
                    key={r.id}
                    activeOpacity={0.85}
                    onPress={() => router.navigate({ pathname: "/program-view", params: { sharedId: r.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${r.programName}`}
                    style={{ marginBottom: 10 }}
                  >
                    <NeuCard dark={isDark} radius={16}>
                      <View style={styles.receivedInner}>
                        <View style={styles.receivedTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{r.programName}</Text>
                            <Text style={[styles.itemMeta, { color: t.ts }]}>
                              From {coachNameFor(r)} · {fmtAgo(r.sentAtISO)}
                            </Text>
                          </View>
                          {accepted && (
                            <View style={[styles.acceptedPill, { backgroundColor: `${ACCT}22` }]}>
                              <Ionicons name="checkmark" size={12} color={ACCT} />
                              <Text style={[styles.acceptedPillText, { color: ACCT }]}>Accepted</Text>
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
                        {accepted ? (
                          <View style={styles.actionRow}>
                            <BounceButton style={{ flex: 1 }} onPress={() => handleOpenPassDown(r)} accessibilityLabel={`Send ${r.programName} to your clients`}>
                              <View style={[styles.passBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                                <SendIcon size={16} color="#fff" />
                                <Text style={styles.passBtnText}>Send to my clients</Text>
                              </View>
                            </BounceButton>
                            <BounceButton onPress={() => handleRemove(r)} accessibilityLabel={`Remove ${r.programName}`}>
                              <NeuCard dark={isDark} radius={12} innerStyle={styles.removeIconBtnInner}>
                                <TrashIcon size={16} color={REMOVE_RED} />
                              </NeuCard>
                            </BounceButton>
                          </View>
                        ) : (
                          <View style={styles.actionRow}>
                            <BounceButton style={{ flex: 1 }} onPress={() => handleAccept(r)} accessibilityLabel={`Accept ${r.programName}`}>
                              <View style={[styles.acceptBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                                <Ionicons name="checkmark" size={16} color="#fff" />
                                <Text style={styles.acceptBtnText}>Accept</Text>
                              </View>
                            </BounceButton>
                            <BounceButton style={{ flex: 1 }} onPress={() => handleRemove(r)} accessibilityLabel={`Remove ${r.programName}`}>
                              <View style={[styles.removeBtn, { borderColor: REMOVE_RED }]}>
                                <Text style={[styles.removeBtnText, { color: REMOVE_RED }]}>Remove</Text>
                              </View>
                            </BounceButton>
                          </View>
                        )}
                      </View>
                    </NeuCard>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      )}

      <RecipientPickerSheet
        visible={!!passDownTarget}
        programName={passDownTarget?.name ?? ""}
        clients={clients}
        onConfirm={handleConfirmPassDown}
        onClose={() => setPassDownTarget(null)}
      />
    </View>
  );
});

export default MyCoachesSection;

const styles = StyleSheet.create({
  wrap:         { marginBottom: 8 },
  sub:          { fontFamily: FontFamily.regular, fontSize: 13 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 10 },
  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 16 },

  emptyInner:   { padding: 24, alignItems: "center", gap: 10 },
  emptyIcon:    { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
  cta:          { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 22, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  ctaText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },

  coachCard:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar:       { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 16 },
  coachLabel:   { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 1 },
  coachName:    { fontFamily: FontFamily.bold, fontSize: 16, marginTop: 2 },
  presenceRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  presenceDot:  { width: 6, height: 6, borderRadius: 3 },
  presenceText: { fontFamily: FontFamily.regular, fontSize: 12 },


  receivedInner:{ padding: 14, gap: 10 },
  receivedTop:  { flexDirection: "row", alignItems: "center", gap: 12 },
  itemName:     { fontFamily: FontFamily.semibold, fontSize: 14 },
  itemMeta:     { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  acceptedPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  acceptedPillText: { fontFamily: FontFamily.semibold, fontSize: 11 },

  actionRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  acceptBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 11, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  acceptBtnText:{ fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
  removeBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 11, borderWidth: 1.5 },
  removeBtnText:{ fontFamily: FontFamily.bold, fontSize: 13 },
  removeIconBtnInner: { alignItems: "center", justifyContent: "center", paddingVertical: 12, paddingHorizontal: 20, minHeight: 44 },

  passBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, minHeight: 44, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  passBtnText:  { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },

  cycleGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:    { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:{ fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },

  smallEmpty:   { fontFamily: FontFamily.regular, fontSize: 13, padding: 18, textAlign: "center" },
});
