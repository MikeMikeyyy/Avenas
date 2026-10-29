// The read-only rendering of a program snapshot: the cycle strip, then one card
// per day with its exercises, their sets, rest and notes.
//
// One component because two screens show the SAME program and a reader can't
// tell which one they're on: /program-view (a program someone sent) and the
// trainer's review screen (a program someone asked them to look at). The review
// screen used to list bare exercise names, so a trainer deciding whether a
// program needed changing couldn't see the sets, reps, weights or rest they
// were being asked to judge — the detail lived one screen away, on the other
// direction of the same flow.
//
// Weights are stored in kg and expressed in the viewer's unit here, so the same
// snapshot reads correctly for a lb user without anything being converted on
// disk.

import { Fragment, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import NeuCard from "./NeuCard";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, WARMUP_ORANGE } from "../constants/theme";
import { useUnit } from "../contexts/UnitContext";
import { prescribedWeight, unitLabel } from "../utils/units";
import { workoutKey } from "../utils/programDays";
import { normaliseSets, type Exercise, type ProgramSet, type SavedProgram } from "../constants/programs";
import { exerciseSummaryParams } from "../utils/customExerciseDetails";

function fmtRest(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// A hold's target is in seconds.
function repsText(set: ProgramSet, isHold: boolean): string | null {
  const unit = isHold ? "s" : "reps";
  if (set.repMode === "range") {
    const lo = set.repsMin?.trim();
    const hi = set.repsMax?.trim();
    if (lo && hi) return `${lo}–${hi} ${unit}`;
    if (lo) return `${lo}+ ${unit}`;
    if (hi) return `up to ${hi} ${unit}`;
    return null;
  }
  const reps = set.reps?.trim();
  if (!reps) return null;
  return `${reps} ${reps === "1" && !isHold ? "rep" : unit}`;
}

/** A set's target in words ("60 kg · 8 reps", "8–12 reps", "30 s"), or null
 *  when the builder left its weight and reps blank. */
function targetText(set: ProgramSet, isHold: boolean, isKg: boolean): string | null {
  const weight = set.weightKg?.trim();
  // In the unit it was written in, for everyone.
  const shown = weight ? prescribedWeight(weight, set.weightUnit, isKg) : null;
  const parts = [shown && `${shown.text} ${unitLabel(shown.unit)}`, repsText(set, isHold)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "2 warm-up · 3 working sets" as one pill, each count after its own dot:
 *  warm-ups in their orange, working sets in the accent, the marks the
 *  timer's up-next card gives them. */
function SetCountPill({ warmups, working, fill, ink }: { warmups: number; working: number; fill: string; ink: string }) {
  const parts = [
    { n: warmups, kind: "warm-up", dot: WARMUP_ORANGE },
    { n: working, kind: "working", dot: ACCT },
  ].filter(p => p.n > 0);
  const setWord = (n: number) => (n === 1 ? "set" : "sets");
  const spoken = parts.map(p => `${p.n} ${p.kind} ${setWord(p.n)}`).join(", ");
  return (
    <View style={[styles.metaPill, { backgroundColor: fill }]} accessible accessibilityLabel={spoken || "No sets"}>
      {parts.length === 0 ? (
        <Text style={[styles.metaPillText, { color: ink }]}>No sets</Text>
      ) : parts.map((p, i) => (
        <Fragment key={p.kind}>
          <View style={[styles.countDot, { backgroundColor: p.dot }, i > 0 && { marginLeft: 4 }]} />
          <Text style={[styles.metaPillText, { color: ink }]}>
            {p.n} {p.kind}{i === parts.length - 1 ? ` ${setWord(p.n)}` : ""}
          </Text>
        </Fragment>
      ))}
    </View>
  );
}

export default function ProgramSnapshotView({ snapshot, isDark, afterCycle }: {
  snapshot: SavedProgram;
  isDark: boolean;
  /** Rendered between the cycle strip and the day cards — where a screen puts
   *  something about this program that isn't part of the program, such as the
   *  trainer's comments on a returned review. */
  afterCycle?: React.ReactNode;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();
  const { isKg } = useUnit();
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const toggleNote = useCallback((key: string) => {
    Haptics.selectionAsync();
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  return (
    <>
      {/* Cycle preview — at-a-glance row of every day in the rotation so the
          reader can scan the week before drilling into a specific day. */}
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

      {afterCycle}

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
                    // Legacy exercises may have `sets` undefined and rely on
                    // warmupSets/workingSets — use normaliseSets so the renderer
                    // never crashes on stale data.
                    const sets = normaliseSets(ex);
                    const targets = sets.map(s => targetText(s, !!ex.isIsometric, isKg));
                    const warmupCount = sets.filter(s => s.type === "warmup").length;
                    // A kind of set gets rows only when one of them has a target:
                    // the count pill already says how many there are, and a set
                    // with nothing typed in it was a row of the badge and the
                    // bare word "reps". Decided per kind, because warm-ups are
                    // often left blank while the working sets carry the numbers.
                    const listed = (type: ProgramSet["type"]) => sets.some((s, i) => s.type === type && targets[i]);
                    const listWarmups = listed("warmup");
                    const listWorking = listed("working");
                    let workingNo = 0;
                    const rows = sets.flatMap((set, i) => {
                      const isWarmup = set.type === "warmup";
                      const label = isWarmup ? "W" : String(++workingNo);
                      if (isWarmup ? !listWarmups : !listWorking) return [];
                      return [{ key: i, isWarmup, label, target: targets[i] }];
                    });
                    return (
                      <Animated.View
                        key={ex.id ?? `${ei}-${ex.name}`}
                        layout={LinearTransition.duration(220)}
                        style={[styles.exerciseRow, ei > 0 && { borderTopWidth: 1, borderTopColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }]}
                      >
                        <View style={styles.exerciseTop}>
                          {/* The name opens the exercise's page, as on the
                              Workout tab (user request, 2026-10-30), with its
                              custom details carried, so a program you don't
                              own still opens its author's exercise. */}
                          <TouchableOpacity
                            style={styles.exerciseNameBtn}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              router.navigate({ pathname: "/exercise-summary", params: exerciseSummaryParams(ex) });
                            }}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={`View ${ex.name} summary`}
                          >
                            <Text style={[styles.exerciseName, { color: t.tp }]} numberOfLines={2}>{ex.name}</Text>
                          </TouchableOpacity>
                          {ex.isIsometric && (
                            <View style={[styles.tag, { backgroundColor: `${ACCT}22` }]}>
                              <Text style={[styles.tagText, { color: ACCT }]}>HOLD</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.exerciseBody}>
                          <View style={styles.metaPills}>
                            <SetCountPill warmups={warmupCount} working={sets.length - warmupCount} fill={t.field} ink={t.ts} />
                            {ex.restSeconds ? (
                              <View style={[styles.metaPill, { backgroundColor: t.field }]}>
                                <Ionicons name="time-outline" size={11} color={t.ts} />
                                <Text style={[styles.metaPillText, { color: t.ts }]}>{fmtRest(ex.restSeconds)} rest</Text>
                              </View>
                            ) : null}
                          </View>
                          {note ? (
                            <Pressable
                              onPress={() => toggleNote(noteKey)}
                              style={({ pressed }) => [
                                styles.exerciseNotesPress,
                                { backgroundColor: pressed ? t.div : t.field },
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
                          {rows.length > 0 && (
                            <View style={styles.setsList}>
                              {rows.map(row => (
                                <View key={row.key} style={styles.setRow}>
                                  <View style={[styles.setBadge, { backgroundColor: row.isWarmup ? `${WARMUP_ORANGE}2E` : t.field }]}>
                                    <Text style={[styles.setBadgeText, { color: row.isWarmup ? WARMUP_ORANGE : t.tp }]}>
                                      {row.label}
                                    </Text>
                                  </View>
                                  <Text style={[styles.setText, { color: row.target ? t.tp : t.ts }]} numberOfLines={1}>
                                    {row.target ?? "No target"}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}
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
    </>
  );
}

const styles = StyleSheet.create({
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
  exerciseNameBtn: { flex: 1 },
  exerciseName: { fontFamily: FontFamily.semibold, fontSize: 14 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
  exerciseBody: { gap: 8 },
  metaPills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  metaPillText: { fontFamily: FontFamily.semibold, fontSize: 11 },
  countDot: { width: 6, height: 6, borderRadius: 3 },
  exerciseNotesPress: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  exerciseNotes: { fontFamily: FontFamily.regular, fontSize: 12, flex: 1 },
  setsList: { gap: 6 },
  setRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  setBadge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  setBadgeText: { fontFamily: FontFamily.bold, fontSize: 11 },
  setText: { fontFamily: FontFamily.regular, fontSize: 13, flex: 1 },

  bodyText: { fontFamily: FontFamily.regular, fontSize: 13 },
});
