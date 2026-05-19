import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import ChatIcon from "../icons/ChatIcon";
import PeopleIcon from "../icons/PeopleIcon";
import SendIcon from "../icons/SendIcon";
import PlusIcon from "../icons/PlusIcon";
import TrashIcon from "../TrashIcon";
import ProgramPickerSheet from "./ProgramPickerSheet";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import {
  acceptSharedProgram,
  appendSentProgram,
  applyReturnedProgram,
  backfillAcceptedProgramIds,
  loadAssignedPT,
  loadSentPrograms,
  loadSharedPrograms,
  removeSentProgram,
  saveAssignedPT,
  type AssignedPT,
  type SentProgram,
  type SharedProgram,
} from "../../utils/trainerStore";
import { getJSON } from "../../utils/storage";
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
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [pt, setPT] = useState<AssignedPT | null>(null);
  const [received, setReceived] = useState<SharedProgram[]>([]);
  const [sent, setSent] = useState<SentProgram[]>([]);
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  const [sendOpen, setSendOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      // Backfill acceptedProgramId on any pre-existing accepted shares so the
      // "tap to view in /programs" navigation can find the local program by id.
      await backfillAcceptedProgramIds();
      const [p, r, s, progs] = await Promise.all([
        loadAssignedPT(),
        loadSharedPrograms(),
        loadSentPrograms(),
        getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
      ]);
      if (cancelled) return;
      setPT(p);
      setReceived(r);
      setSent(s);
      setMyPrograms(Array.isArray(progs) ? progs : []);
    })();
    return () => { cancelled = true; };
  }, []));

  const assignMockPT = useCallback(async () => {
    const mock: AssignedPT = { id: "mock_pt_1", name: "Sam Rivera", initials: "SR" };
    await saveAssignedPT(mock);
    setPT(mock);
  }, []);

  const openChatStub = () => Alert.alert("Chat", "Chat is coming soon.");

  const handleApplyReturned = useCallback(async (entry: SentProgram) => {
    if (entry.appliedAtISO) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await applyReturnedProgram(entry.id);
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
    const importedId = await acceptSharedProgram(share.id);
    const acceptedAt = new Date().toISOString();
    setReceived(prev => prev.map(r => r.id === share.id ? { ...r, acceptedAtISO: acceptedAt, acceptedProgramId: importedId ?? undefined } : r));
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
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 140 }}
      >
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
              <BounceButton style={{ marginTop: 8 }} onPress={assignMockPT}>
                <View style={[styles.cta, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                  <Text style={styles.ctaText}>Connect a Mock Trainer</Text>
                </View>
              </BounceButton>
            </View>
          </NeuCard>
        ) : (
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 16 }}>
            <View style={styles.ptCard}>
              <View style={[styles.avatar, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
                <Text style={[styles.avatarText, { color: ACCT }]}>{pt.initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ptLabel, { color: t.ts }]}>YOUR TRAINER</Text>
                <Text style={[styles.ptName, { color: t.tp }]}>{pt.name}</Text>
              </View>
              <BounceButton onPress={openChatStub} accessibilityLabel="Chat with trainer">
                <View style={[styles.chatBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }]}>
                  <ChatIcon size={18} color={t.tp} />
                </View>
              </BounceButton>
            </View>
          </NeuCard>
        )}

        <Text style={[styles.sectionHeading, { color: t.tp }]}>From Your Trainer</Text>
        {received.length === 0 ? (
          <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.smallEmpty, { color: t.ts }]}>No programs received yet.</Text>
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
                    <View style={styles.receivedTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{r.programName}</Text>
                        <Text style={[styles.itemMeta, { color: t.ts }]}>Received {fmtAgo(r.sentAtISO)}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleAccept(r)}
                        activeOpacity={0.8}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: accepted }}
                        accessibilityLabel={accepted ? "Program accepted" : "Accept program"}
                        disabled={accepted}
                      >
                        <View style={[
                          styles.acceptBox,
                          accepted
                            ? { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }
                            : { backgroundColor: "transparent", borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)" },
                        ]}>
                          {accepted && <Ionicons name="checkmark" size={16} color="#fff" />}
                        </View>
                      </TouchableOpacity>
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
                      <Text style={[styles.acceptedLine, { color: ACCT }]}>Added to your programs · Tap to view</Text>
                    ) : (
                      <Text style={[styles.acceptedLine, { color: t.ts }]}>Tick to accept · Tap to view</Text>
                    )}
                  </View>
                </NeuCard>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={styles.sentHeaderRow}>
          <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Sent to Trainer</Text>
          <BounceButton onPress={() => setSendOpen(true)} accessibilityLabel="Send a program to trainer">
            <View style={[styles.addBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
              <PlusIcon size={18} color="#fff" />
            </View>
          </BounceButton>
        </View>
        {sent.length === 0 ? (
          <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.smallEmpty, { color: t.ts }]}>You haven't sent any programs to your trainer yet.</Text>
          </NeuCard>
        ) : (
          sent.map(s => {
            const returned = s.status === "returned";
            const applied = !!s.appliedAtISO;
            const cycle = s.programSnapshot?.cyclePattern ?? [];
            const cardBody = (
              <NeuCard dark={isDark} radius={16}>
                <View style={styles.sentInner}>
                  <View style={styles.sentTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{s.programName}</Text>
                      <Text style={[styles.itemMeta, { color: t.ts }]}>
                        Sent {fmtAgo(s.sentAtISO)}
                        {returned && s.returnedAtISO ? ` · Returned ${fmtAgo(s.returnedAtISO)}` : ""}
                      </Text>
                    </View>
                    {returned ? (
                      <TouchableOpacity
                        onPress={() => handleApplyReturned(s)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: applied }}
                        accessibilityLabel={applied ? "Changes applied" : "Apply trainer's changes"}
                        disabled={applied}
                      >
                        <View style={[
                          styles.acceptBox,
                          applied
                            ? { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }
                            : { backgroundColor: "transparent", borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)" },
                        ]}>
                          {applied && <Ionicons name="checkmark" size={16} color="#fff" />}
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleUnsendProgram(s)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                        accessibilityLabel="Unsend program"
                        accessibilityRole="button"
                      >
                        <TrashIcon size={18} color="#E53935" />
                      </TouchableOpacity>
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
                  {returned && (
                    applied ? (
                      <Text style={[styles.acceptedLine, { color: ACCT }]}>Changes applied · Tap to view</Text>
                    ) : (
                      <Text style={[styles.acceptedLine, { color: t.ts }]}>Tick to accept changes · Tap to view</Text>
                    )
                  )}
                </View>
              </NeuCard>
            );
            return returned ? (
              <TouchableOpacity
                key={s.id}
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: "/programs", params: { focus: s.programId } })}
                style={{ marginBottom: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.programName} in your programs`}
              >
                {cardBody}
              </TouchableOpacity>
            ) : (
              <View key={s.id} style={{ marginBottom: 10 }}>
                {cardBody}
              </View>
            );
          })
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
  title:        { fontFamily: FontFamily.bold, fontSize: 32 },
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
  chatBtn:      { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  itemRow:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  itemName:     { fontFamily: FontFamily.semibold, fontSize: 14 },
  itemMeta:     { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  receivedInner:{ padding: 14, gap: 10 },
  receivedTop:  { flexDirection: "row", alignItems: "center", gap: 12 },
  acceptBox:    { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cycleGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:    { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:{ fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  acceptedLine: { fontFamily: FontFamily.semibold, fontSize: 12 },
  sentHeaderRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 12 },
  addBtn:       { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  sentInner:    { padding: 14, gap: 10 },
  sentTopRow:   { flexDirection: "row", alignItems: "center", gap: 12 },
  commentBox:   { paddingTop: 10, borderTopWidth: 1, gap: 6 },
  commentLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.8 },
  commentBody:  { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  statusPill:   { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText:   { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.3 },
  smallEmpty:   { fontFamily: FontFamily.regular, fontSize: 13, padding: 18, textAlign: "center" },
});
