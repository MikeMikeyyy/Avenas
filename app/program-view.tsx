// Read-only viewer for a SharedProgram's snapshot — walks each non-rest day
// in the cycle and lists its exercises + sets. Reached by tapping a shared-
// program card on either PTHome ("Programs You've Sent") or the My Coaches
// page ("From Your Coaches"). Action buttons (Edit / Delete / Accept / Send
// to clients) are surfaced contextually based on whether the share is the
// trainer's own outgoing share or one received from a coach.

import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { scheduleCloudPush } from "../lib/syncManager";

import FadeScreen from "../components/FadeScreen";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import TrashIcon from "../components/TrashIcon";
import RecipientPickerSheet from "../components/trainer/RecipientPickerSheet";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { formatWeightForDisplay } from "../utils/units";
import { useAccountType } from "../contexts/AccountTypeContext";
import {
  acceptSharedProgram,
  appendSharedPrograms,
  applyReturnedProgram,
  loadClients,
  loadSentPrograms,
  loadSharedPrograms,
  removeSharedProgram,
  type Client,
  type SentProgram,
  type SharedProgram,
} from "../utils/trainerStore";
import { getJSON } from "../utils/storage";
import { normaliseSets, PROGRAMS_KEY, type Exercise, type ProgramSet, type SavedProgram } from "../constants/programs";

// `${dayIndex}:${dayName}` — matches the convention documented in CLAUDE.md.
function workoutKey(idx: number, name: string): string {
  return `${idx}:${name}`;
}

function fmtRest(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function setsSummary(set: ProgramSet): string {
  if (set.repMode === "range") {
    const lo = set.repsMin?.trim();
    const hi = set.repsMax?.trim();
    if (lo && hi) return `${lo}–${hi} reps`;
    if (lo) return `${lo}+ reps`;
    if (hi) return `up to ${hi} reps`;
    return "reps";
  }
  const reps = set.reps?.trim();
  return reps ? `${reps} reps` : "reps";
}

export default function ProgramViewScreen() {
  const router = useRouter();
  const { sharedId, sentId } = useLocalSearchParams<{ sharedId?: string; sentId?: string }>();
  const { isDark } = useTheme();
  const { isKg } = useUnit();
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
  const [passDownTarget, setPassDownTarget] = useState<SavedProgram | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const toggleNote = useCallback((key: string) => {
    Haptics.selectionAsync();
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    if (!sharedId && !sentId) {
      setLoaded(true);
      return;
    }
    const [shares, sents, cs] = await Promise.all([
      loadSharedPrograms(),
      loadSentPrograms(),
      loadClients(),
    ]);
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
    if (accountType !== "pt") return false;
    // A program a coach sent ME is incoming, even though that coach now also
    // lives in my client roster (so clientId could match a Client).
    if (share.receivedFromCoachId) return false;
    if (share.clientId === "all") return true;
    return clients.some(c => c.id === share.clientId);
  }, [share, clients, accountType]);

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
    router.push({ pathname: "/new-program", params: { sharedId: share.id } });
  }, [router, share]);

  const handleDelete = useCallback(() => {
    if (!share) return;
    Alert.alert(
      "Unsend Program",
      `Unsend "${share.programName}"? ${share.acceptedAtISO ? "The recipient already accepted it — their copy will stay in their library." : "They will no longer see it."}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unsend",
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
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 14, left: 20, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      {/* Trainer-only Edit + Delete pair pinned to the top-right so they stay
          visible while the user scrolls through a long program. Mirrors the
          glass-or-white pill styling of the back button. */}
      {isOutgoing && (
        <View style={[styles.topActions, { top: insets.top + 14 }]}>
          <TouchableOpacity
            onPress={handleEdit}
            activeOpacity={0.8}
            accessibilityLabel="Edit program"
            accessibilityRole="button"
          >
            {isGlassEffectAPIAvailable() ? (
              <GlassView glassEffectStyle="regular" style={styles.backBtn}>
                <Ionicons name="create-outline" size={20} color={t.tp} />
              </GlassView>
            ) : (
              <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
                <Ionicons name="create-outline" size={20} color={t.tp} />
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            activeOpacity={0.8}
            accessibilityLabel="Delete program"
            accessibilityRole="button"
          >
            {isGlassEffectAPIAvailable() ? (
              <GlassView glassEffectStyle="regular" style={styles.backBtn}>
                <TrashIcon size={20} color="#E53935" />
              </GlassView>
            ) : (
              <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
                <TrashIcon size={20} color="#E53935" />
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + (showFloatingAccept ? 110 : 40),
        }}
      >
        <View style={styles.header}>
          <View style={{ width: 44 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>
            {snapshot?.name ?? headerName}
          </Text>
          <View style={{ width: 44 }} />
        </View>

        {!loaded ? null : (!share && !sent) ? (
          <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.bodyText, { color: t.ts, padding: 18, textAlign: "center" }]}>
              This program is no longer available.
            </Text>
          </NeuCard>
        ) : !snapshot ? (
          <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.bodyText, { color: t.ts, padding: 18, textAlign: "center" }]}>
              No program details to show.
            </Text>
          </NeuCard>
        ) : (
          <>
            <View style={styles.metaRow}>
              <Text style={[styles.metaText, { color: t.ts }]}>
                {snapshot.totalWeeks} week{snapshot.totalWeeks === 1 ? "" : "s"} · {snapshot.trainingDays} training day{snapshot.trainingDays === 1 ? "" : "s"} · {snapshot.cycleDays}-day cycle
              </Text>
            </View>

            {/* Cycle preview — at-a-glance row of every day in the rotation so
                the user can scan the week before drilling into a specific day. */}
            {snapshot.cyclePattern.length > 0 && (
              <View style={styles.cycleGrid}>
                {snapshot.cyclePattern.map((day, i) => {
                  const isTraining = day !== "Rest" && day !== "";
                  return (
                    <View
                      key={i}
                      style={[
                        styles.cycleChip,
                        isTraining
                          ? { backgroundColor: `${ACCT}22`, borderColor: ACCT, borderWidth: 1 }
                          : { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div },
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

            {/* Trainer comments on a returned SentProgram — surfaced near the
                top because the user is here specifically to consider those
                edits before applying them. */}
            {sentReturned && sent?.trainerComments ? (
              <NeuCard dark={isDark} radius={14} style={{ marginBottom: 18 }}>
                <View style={styles.commentBox}>
                  <Text style={[styles.commentLabel, { color: t.ts }]}>TRAINER COMMENTS</Text>
                  <Text style={[styles.commentBody, { color: t.tp }]}>{sent.trainerComments}</Text>
                </View>
              </NeuCard>
            ) : null}

            {snapshot.cyclePattern.map((dayName, idx) => {
              const isRest = !dayName || dayName.toLowerCase() === "rest";
              if (isRest) {
                return (
                  <View key={idx} style={styles.daySection}>
                    <NeuCard dark={isDark} radius={16}>
                      <View style={styles.restCard}>
                        <Ionicons name="moon-outline" size={18} color={t.ts} />
                        <Text style={[styles.restText, { color: t.ts }]}>Day {idx + 1} · Rest</Text>
                      </View>
                    </NeuCard>
                  </View>
                );
              }
              const exercises: Exercise[] = snapshot.workouts[workoutKey(idx, dayName)] ?? [];
              return (
                <View key={idx} style={styles.daySection}>
                  <NeuCard dark={isDark} radius={16}>
                    <View style={styles.dayCard}>
                      <View style={styles.dayHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.dayLabel, { color: t.ts }]}>DAY {idx + 1}</Text>
                          <Text style={[styles.dayName, { color: t.tp }]} numberOfLines={1}>{dayName}</Text>
                        </View>
                        <Text style={[styles.dayCount, { color: t.ts }]}>
                          {exercises.length} {exercises.length === 1 ? "exercise" : "exercises"}
                        </Text>
                      </View>
                      {exercises.length === 0 ? (
                        <Text style={[styles.bodyText, { color: t.ts, marginTop: 8 }]}>
                          No exercises added.
                        </Text>
                      ) : (
                        exercises.map((ex, ei) => {
                          const noteKey = `${idx}|${ei}`;
                          const noteExpanded = expandedNotes.has(noteKey);
                          const note = ex.programNotes?.trim();
                          return (
                          <Animated.View
                            key={ex.id ?? `${ei}-${ex.name}`}
                            layout={LinearTransition.duration(220)}
                            style={[styles.exerciseRow, ei > 0 && { borderTopWidth: 1, borderTopColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }]}
                          >
                            <View style={styles.exerciseTop}>
                              <Text style={[styles.exerciseName, { color: t.tp }]} numberOfLines={2}>{ex.name}</Text>
                              {ex.isIsometric && (
                                <View style={[styles.tag, { backgroundColor: `${ACCT}22` }]}>
                                  <Text style={[styles.tagText, { color: ACCT }]}>HOLD</Text>
                                </View>
                              )}
                            </View>
                            {(ex.restSeconds || note) && (
                              <View style={styles.metaPills}>
                                {ex.restSeconds ? (
                                  <View style={[styles.metaPill, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}>
                                    <Ionicons name="time-outline" size={11} color={t.ts} />
                                    <Text style={[styles.metaPillText, { color: t.ts }]}>{fmtRest(ex.restSeconds)} rest</Text>
                                  </View>
                                ) : null}
                                {note ? (
                                  <Pressable
                                    onPress={() => toggleNote(noteKey)}
                                    style={({ pressed }) => [
                                      styles.exerciseNotesPress,
                                      { backgroundColor: isDark
                                          ? (pressed ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)")
                                          : (pressed ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.04)") },
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityLabel={noteExpanded ? "Collapse note" : "Expand note"}
                                  >
                                    <Ionicons name="document-text-outline" size={12} color={t.ts} style={{ marginTop: 1 }} />
                                    <Text style={[styles.exerciseNotes, { color: t.ts }]} numberOfLines={noteExpanded ? undefined : 2}>
                                      {note}
                                    </Text>
                                    <Ionicons
                                      name={noteExpanded ? "chevron-up" : "chevron-down"}
                                      size={12}
                                      color={t.ts}
                                      style={{ marginTop: 2 }}
                                    />
                                  </Pressable>
                                ) : null}
                              </View>
                            )}
                            <View style={styles.setsList}>
                              {(() => {
                                // Legacy exercises may have `sets` undefined and rely on
                                // warmupSets/workingSets — use normaliseSets so the renderer
                                // never crashes on stale data.
                                const sets = normaliseSets(ex);
                                if (sets.length === 0) {
                                  return <Text style={[styles.setText, { color: t.ts }]}>No sets defined.</Text>;
                                }
                                return sets.map((set, si) => {
                                  const isWarmup = set.type === "warmup";
                                  const weight = set.weightKg?.trim();
                                  return (
                                    <View key={si} style={styles.setRow}>
                                      <View style={[styles.setBadge, isWarmup
                                        ? { backgroundColor: "rgba(255,191,15,0.18)" }
                                        : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" },
                                      ]}>
                                        <Text style={[styles.setBadgeText, { color: isWarmup ? "#ffbf0f" : t.tp }]}>
                                          {isWarmup ? "W" : String(si + 1)}
                                        </Text>
                                      </View>
                                      <Text style={[styles.setText, { color: t.tp }]} numberOfLines={1}>
                                        {weight ? `${formatWeightForDisplay(weight, isKg)} ${isKg ? "kg" : "lbs"} · ` : ""}{setsSummary(set)}
                                      </Text>
                                    </View>
                                  );
                                });
                              })()}
                            </View>
                          </Animated.View>
                          );
                        })
                      )}
                    </View>
                  </NeuCard>
                </View>
              );
            })}

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
                    onPress={() => router.push({ pathname: "/programs", params: { focus: sent!.programId } })}
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
                    onPress={() => router.push(
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
          </>
        )}
      </ScrollView>

      {showFloatingAccept && (
        <View
          pointerEvents="box-none"
          style={[styles.floatingBtnWrap, { bottom: insets.bottom + 16 }]}
        >
          <BounceButton
            onPress={showFloatingAcceptChanges ? handleApplyReturned : handleAccept}
            accessibilityLabel={showFloatingAcceptChanges ? "Accept changes" : "Accept program"}
          >
            <View style={[styles.primaryBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
              <Text style={styles.primaryBtnText}>
                {showFloatingAcceptChanges ? "Accept changes" : "Accept program"}
              </Text>
            </View>
          </BounceButton>
        </View>
      )}

      <RecipientPickerSheet
        visible={!!passDownTarget}
        programName={passDownTarget?.name ?? ""}
        clients={clients}
        onConfirm={handleConfirmPassDown}
        onClose={() => setPassDownTarget(null)}
      />
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  screenTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    textAlign: "center",
    flex: 1,
  },
  metaRow: { marginBottom: 14, alignItems: "center" },
  metaText: { fontFamily: FontFamily.regular, fontSize: 12 },

  cycleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 18 },
  cycleChip: { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText: { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },

  daySection: { marginBottom: 14 },
  dayLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 1, marginBottom: 2 },
  dayCard: { padding: 14 },
  dayHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6, gap: 8 },
  dayName: { fontFamily: FontFamily.bold, fontSize: 16 },
  dayCount: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  restCard: { padding: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  restText: { fontFamily: FontFamily.semibold, fontSize: 14 },

  exerciseRow: { paddingTop: 12, marginTop: 8 },
  exerciseTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  exerciseName: { fontFamily: FontFamily.semibold, fontSize: 14, flex: 1 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
  metaPills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  metaPillText: { fontFamily: FontFamily.semibold, fontSize: 11 },
  exerciseNotesPress: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  exerciseNotes: { fontFamily: FontFamily.regular, fontSize: 12, flex: 1 },
  setsList: { gap: 6 },
  setRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  setBadge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  setBadgeText: { fontFamily: FontFamily.bold, fontSize: 11 },
  setText: { fontFamily: FontFamily.regular, fontSize: 13, flex: 1 },

  bodyText: { fontFamily: FontFamily.regular, fontSize: 13 },

  actionsWrap: { flexDirection: "row", gap: 10, marginTop: 18 },
  statusInfo: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  statusInfoText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  commentBox: { padding: 14, gap: 6 },
  commentLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.8 },
  commentBody: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  primaryBtnText: { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff", letterSpacing: 0.3 },
  floatingBtnWrap: { position: "absolute", left: 20, right: 20, zIndex: 20 },
});
