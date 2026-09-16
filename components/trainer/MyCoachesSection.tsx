// "My Trainers" (trainer side) — rendered inside the /trainer/coaches route.
// Lets a trainer also be coached by other trainers. Mirrors the visual language
// of MyPTHome's "My Trainer" + "From Your Trainer" blocks, but supports a list
// of trainers and adds a one-tap "Send to clients" action on accepted programs
// so the trainer can pass a mentor's program down to their own roster.
//
// The list is DERIVED from real accepted connections whose counterpart holds a
// trainer account (utils/roster.ts), merged with any local/mock entries — the
// connect handshake writes no local roster, so reading a local key here is what
// used to leave this page permanently empty.

import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { scheduleCloudPush } from "../../lib/syncManager";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import Avatar from "../Avatar";
import TrashIcon from "../TrashIcon";
import PeopleIcon from "../icons/PeopleIcon";
import SendIcon from "../icons/SendIcon";
import RecipientPickerSheet from "./RecipientPickerSheet";
import ProgramPickerSheet from "./ProgramPickerSheet";
import SimpleSheet from "./SimpleSheet";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { pill, PILL_H_SM, PILL_H_XS } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import {
  acceptSharedProgram,
  addTrainerAsClient,
  appendSharedPrograms,
  loadSharedPrograms,
  migrateCoachReceivedShares,
  removeSharedProgram,
  removeTrainerAsClient,
  type AssignedPT,
  type Client,
  type SharedProgram,
} from "../../utils/trainerStore";
import { resolveTrainerRoster } from "../../utils/roster";
import { unaddContact } from "../../utils/moderation";
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

  const [trainers, setTrainers] = useState<AssignedPT[]>([]);
  const [received, setReceived] = useState<SharedProgram[]>([]);
  const [passDownTarget, setPassDownTarget] = useState<SavedProgram | null>(null);
  /** Which trainers are also my clients — drives the toggle's wording. */
  const [trainerClientIds, setTrainerClientIds] = useState<Set<string>>(new Set());
  /** The trainer whose action sheet is open (null = closed). */
  const [menuFor, setMenuFor] = useState<AssignedPT | null>(null);
  /** Set while picking which program to send to `sendTo`. */
  const [sendTo, setSendTo] = useState<AssignedPT | null>(null);
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  // Live "last active" comes from the connection presence poll. Trainers
  // without a real connection (legacy/mock) aren't in the map and show no
  // presence row.
  const { presenceById } = useConnectionPresence();

  // "None" is only true once we've looked. Both lists drew their empty states
  // ("No trainers yet") during the load, to people who have trainers.
  const [trainersLoaded, setTrainersLoaded] = useState(false);
  const [receivedLoaded, setReceivedLoaded] = useState(false);

  const reload = useCallback(async () => {
    // The trainer list resolves on its own. It used to wait for the incoming
    // shares too (another network call) and for a share migration before that,
    // neither of which it needs.
    const trainersTask = resolveTrainerRoster()
      .then(roster => {
        setTrainers(roster.trainers);
        setTrainerClientIds(roster.trainerClientIds);
      })
      .catch(err => { if (__DEV__) console.warn("[avenas] resolve trainer roster", err); })
      .finally(() => setTrainersLoaded(true));

    const sharesTask = (async () => {
      try {
        // Backfill the direction flag on any legacy incoming shares before reading.
        await migrateCoachReceivedShares();
        const [shares, progs] = await Promise.all([
          loadSharedPrograms(),
          getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
        ]);
        setMyPrograms(Array.isArray(progs) ? progs : []);
        // Incoming = a program another trainer sent ME (receivedFromCoachId).
        setReceived(shares.filter(s => !!s.receivedFromCoachId));
      } catch (err) {
        if (__DEV__) console.warn("[avenas] load coach shares", err);
      } finally {
        setReceivedLoaded(true);
      }
    })();

    await Promise.all([trainersTask, sharesTask]);
  }, []);

  // useFocusEffect (not useEffect) — this route stays mounted while the user
  // steps out to /connect, so a trainer added there only appears if we refresh
  // on the way back.
  useFocusEffect(useCallback(() => {
    void reload();
  }, [reload]));

  const handleConnectTrainer = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate("/connect");
  }, [router]);

  // Take a fellow trainer on as a client, or stop. Only the local filing
  // changes: the connection stays, so they remain on this page either way and
  // programs keep flowing in both directions.
  const toggleAsClient = useCallback(async (trainer: AssignedPT) => {
    setMenuFor(null);
    const isClient = trainerClientIds.has(trainer.id);
    if (isClient) {
      await removeTrainerAsClient(trainer.id);
      await reload();
      Alert.alert("Removed from clients", `${trainer.name} is no longer one of your clients. You're still connected.`);
      return;
    }
    await addTrainerAsClient(trainer.id);
    await reload();
    Alert.alert("Added to clients", `${trainer.name} now appears in My Clients, and you can add them to groups.`);
  }, [trainerClientIds, reload]);

  const openSendProgram = useCallback((trainer: AssignedPT) => {
    setMenuFor(null);
    if (myPrograms.length === 0) {
      Alert.alert("No programs", "Build a program before sending one.");
      return;
    }
    setSendTo(trainer);
  }, [myPrograms]);

  // Send one program to one trainer. Same cloud path PTHome's send uses, so it
  // lands in their library exactly like any other share.
  const handleSendProgram = useCallback(async (program: SavedProgram) => {
    const target = sendTo;
    setSendTo(null);
    if (!target) return;
    const entry: SharedProgram = {
      id: `share_${Date.now()}_0`,
      clientId: target.id,
      programId: program.id,
      programName: program.name,
      sentAtISO: new Date().toISOString(),
      programSnapshot: program,
    };
    try {
      await appendSharedPrograms([entry]);
    } catch (e) {
      Alert.alert("Couldn't send program", e instanceof Error ? e.message : "Check your internet and try again.");
      return;
    }
    Alert.alert("Program Sent", `"${program.name}" was sent to ${target.name}.`);
  }, [sendTo]);

  const handleRemoveTrainer = useCallback((trainer: AssignedPT) => {
    Alert.alert(
      "Remove Trainer",
      `Stop being coached by ${trainer.name}? Programs you've already accepted will stay in your library.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            // unaddContact (not a local-only delete): this list is derived from
            // live connections, so without the server-side sever they'd simply
            // reappear on the next focus.
            const { severed } = await unaddContact(trainer.id, "pt");
            await reload();
            if (!severed) {
              Alert.alert(
                "Couldn't remove them",
                `We couldn't reach the server to disconnect from ${trainer.name}. Check your connection and try again.`,
              );
            }
          },
        },
      ]
    );
  }, [reload]);

  // Step into "remove" sub-menu — lists every trainer as an Alert button so
  // the user can pick which one to remove. Cancel returns to nothing.
  const openRemovePicker = useCallback(() => {
    if (trainers.length === 0) {
      Alert.alert("No trainers", "You haven't connected to any trainers yet.");
      return;
    }
    Alert.alert(
      "Remove a Trainer",
      "Pick a trainer to remove.",
      [
        { text: "Cancel", style: "cancel" },
        ...trainers.map(trainer => ({
          text: trainer.name,
          style: "destructive" as const,
          onPress: () => handleRemoveTrainer(trainer),
        })),
      ],
    );
  }, [trainers, handleRemoveTrainer]);

  // Top-right plus button entry — offers both add and remove paths.
  const openMenu = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Manage Trainers",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Add a Trainer", onPress: handleConnectTrainer },
        { text: "Remove a Trainer", style: "destructive", onPress: openRemovePicker },
      ],
    );
  }, [handleConnectTrainer, openRemovePicker]);

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
        ? `Remove "${share.programName}" from your trainers list? Your accepted copy stays in your library.`
        : `Remove "${share.programName}"? You won't be able to get it back unless your trainer sends it again.`,
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

  const trainerNameFor = (share: SharedProgram): string => {
    const trainer = trainers.find(c => c.id === share.receivedFromCoachId);
    return trainer?.name ?? "your trainer";
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sub, { color: t.ts }]}>
        Trainers you receive programs from. Accept one and pass it on to your clients.
      </Text>

      {!trainersLoaded ? null : trainers.length === 0 ? (
        <NeuCard dark={isDark} radius={20} style={{ marginTop: 12 }}>
          <View style={styles.emptyInner}>
            <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
              <PeopleIcon size={28} color={ACCT} />
            </View>
            <Text style={[styles.emptyTitle, { color: t.tp }]}>No trainers yet</Text>
            <Text style={[styles.emptyBody, { color: t.ts }]}>
              Connect to a senior trainer to receive programs you can adapt and pass on to your own clients.
            </Text>
            <BounceButton style={{ marginTop: 8 }} onPress={handleConnectTrainer}>
              <View style={[styles.cta, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                <Text style={styles.ctaText}>Connect to a Trainer</Text>
              </View>
            </BounceButton>
          </View>
        </NeuCard>
      ) : (
        <View style={{ marginTop: 12, gap: 10 }}>
          {trainers.map(coach => {
            const alsoClient = trainerClientIds.has(coach.id);
            return (
              <TouchableOpacity
                key={coach.id}
                activeOpacity={0.85}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMenuFor(coach); }}
                accessibilityRole="button"
                accessibilityLabel={`Options for ${coach.name}`}
              >
                <NeuCard dark={isDark} radius={16}>
                  <View style={styles.coachCard}>
                    <Avatar
                      uri={coach.photoUri}
                      initials={coach.initials}
                      size={48}
                      backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                      textColor={ACCT}
                      textStyle={[styles.avatarText, { color: ACCT }]}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={styles.labelRow}>
                        <Text style={[styles.coachLabel, { color: t.ts }]}>TRAINER</Text>
                        {alsoClient && (
                          <View style={[styles.clientTag, { backgroundColor: `${ACCT}22` }]}>
                            <Text style={[styles.clientTagText, { color: ACCT }]}>ALSO YOUR CLIENT</Text>
                          </View>
                        )}
                      </View>
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
                    <Ionicons name="ellipsis-horizontal" size={18} color={t.ts} />
                  </View>
                </NeuCard>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {trainers.length > 0 && (
        <>
          <View style={styles.sectionHeadingRow}>
            <Text style={[styles.sectionHeading, { color: t.tp }]}>From Your Trainers</Text>
          </View>
          {!receivedLoaded ? null : received.length === 0 ? (
            <NeuCard dark={isDark} radius={16}>
              <Text style={[styles.smallEmpty, { color: t.ts }]}>No programs received from your trainers yet.</Text>
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
                              From {trainerNameFor(r)} · {fmtAgo(r.sentAtISO)}
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

      {/* Tapping a trainer's card. Sending a program works whether or not they
          are also your client — the connection is what allows it, not the
          filing. */}
      <SimpleSheet visible={menuFor !== null} onClose={() => setMenuFor(null)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{menuFor?.name || "Trainer"}</Text>
        <View style={styles.menu}>
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.8}
            onPress={() => menuFor && openSendProgram(menuFor)}
            accessibilityRole="button"
            accessibilityLabel={`Send a program to ${menuFor?.name ?? "this trainer"}`}
          >
            <SendIcon size={19} color={t.tp} />
            <Text style={[styles.menuText, { color: t.tp }]}>Send a program</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.8}
            // Close before navigating: the sheet is a Modal, so leaving it open
            // parks it on top of the chat screen you just pushed.
            onPress={() => {
              const c = menuFor;
              setMenuFor(null);
              if (c) router.navigate({ pathname: "/trainer/chat/[id]", params: { id: c.id, name: c.name, initials: c.initials, photo: c.photoUri ?? "" } });
            }}
            accessibilityRole="button"
            accessibilityLabel={`Message ${menuFor?.name ?? "this trainer"}`}
          >
            <Ionicons name="chatbubble-outline" size={19} color={t.tp} />
            <Text style={[styles.menuText, { color: t.tp }]}>Message</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.8}
            onPress={() => menuFor && toggleAsClient(menuFor)}
            accessibilityRole="button"
            accessibilityLabel={menuFor && trainerClientIds.has(menuFor.id) ? "Remove from my clients" : "Add as my client"}
          >
            <Ionicons
              name={menuFor && trainerClientIds.has(menuFor.id) ? "person-remove-outline" : "person-add-outline"}
              size={19}
              color={t.tp}
            />
            <Text style={[styles.menuText, { color: t.tp }]}>
              {menuFor && trainerClientIds.has(menuFor.id) ? "Remove from my clients" : "Add as my client"}
            </Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.8}
            onPress={() => { const c = menuFor; setMenuFor(null); if (c) handleRemoveTrainer(c); }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${menuFor?.name ?? "this trainer"}`}
          >
            <Ionicons name="close-circle-outline" size={19} color={REMOVE_RED} />
            <Text style={[styles.menuText, { color: REMOVE_RED }]}>Remove trainer</Text>
          </TouchableOpacity>
        </View>
      </SimpleSheet>

      <ProgramPickerSheet
        visible={sendTo !== null}
        title={`Send to ${sendTo?.name ?? ""}`}
        subtitle="Pick a program to send."
        programs={myPrograms}
        onPick={handleSendProgram}
        onClose={() => setSendTo(null)}
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
  cta:          { ...pill(PILL_H_SM), paddingHorizontal: 22, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  ctaText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },

  coachCard:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 16 },
  coachLabel:   { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 1 },
  labelRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  clientTag:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  clientTagText:{ fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },

  menuName:     { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu:         { paddingHorizontal: 16, paddingTop: 4 },
  menuRow:      { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 8 },
  menuDivider:  { height: 1, marginHorizontal: 8 },
  menuText:     { fontFamily: FontFamily.semibold, fontSize: 16 },
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
  acceptBtn:    { ...pill(PILL_H_XS), gap: 6, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  acceptBtnText:{ fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
  removeBtn:    { ...pill(PILL_H_XS), borderWidth: 1.5 },
  removeBtnText:{ fontFamily: FontFamily.bold, fontSize: 13 },
  removeIconBtnInner: { alignItems: "center", justifyContent: "center", paddingVertical: 12, paddingHorizontal: 20, minHeight: 44 },

  passBtn:      { ...pill(PILL_H_SM), gap: 8, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  passBtnText:  { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },

  cycleGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:    { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:{ fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },

  smallEmpty:   { fontFamily: FontFamily.regular, fontSize: 13, padding: 18, textAlign: "center" },
});
