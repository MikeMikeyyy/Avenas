import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TouchableOpacity, TouchableWithoutFeedback, Modal, Animated, PanResponder, Easing, Alert, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
// Aliased: `Animated` in this file is React Native's, used by the sheets' pan
// responders. Reanimated drives the collapse transition.
import Reanimated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PROGRAMS_KEY, WORKOUT_DAY_OVERRIDE_KEY, type SavedProgram, getCurrentWeek, programFinishDate } from "../constants/programs";
import { scheduleCloudPush } from "../lib/syncManager";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, PAUSED_ORANGE } from "../constants/theme";
import { pill, pillGlow, PILL_H_SM, PILL_RADIUS } from "../constants/buttons";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import ChevronToggle from "../components/ChevronToggle";
import AuroraBackdrop from "../components/AuroraBackdrop";
import { formatStoredDate, todayYMD } from "../utils/dates";
import { cycleIndexForDate, normalizeDriftDates } from "../utils/workout";
import { clearShifts } from "../utils/skippedDates";
import { pauseProgram, resumeWithPrompt } from "../utils/programPause";
import { useTheme } from "../contexts/ThemeContext";
import { useWorkoutTimer } from "../contexts/WorkoutTimerContext";
import { useAccountType } from "../contexts/AccountTypeContext";
import { appendSentProgram, loadAssignedPT, removeSharedProgramByLocalId, type AssignedPT, type SentProgram } from "../utils/trainerStore";

// Warmup-set accent (matches the orange used for warmup sets across the app).
const WARMUP_ORANGE = "#ffbf0f";

// One layout transition for the whole collapse: the card's own height and the
// cards sliding beneath it must run at the same speed or the list tears.
const CARD_LAYOUT = LinearTransition.duration(220);

// ─── Set Workout Picker ────────────────────────────────────────────────────────

interface SetWorkoutPickerProps {
  visible: boolean;
  program: SavedProgram;
  isDark: boolean;
  onConfirm: (dayIndex: number) => void;
  // reopenMenu=true when dismissed via back/swipe/backdrop (return to the action
  // menu); false after a confirmed day (exit straight to the programs list).
  onClose: (reopenMenu: boolean) => void;
}

function SetWorkoutPicker({ visible, program, isDark, onConfirm, onClose }: SetWorkoutPickerProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [selected, setSelected] = useState<number | null>(null);

  const ROW_H = 52;
  const OVERHEAD = 28 + 90 + 16 + 54 + 12 + insets.bottom; // handle + header + footer padding + button + gap
  const sheetHeight = Math.min(OVERHEAD + program.cyclePattern.length * ROW_H, screenHeight * 0.82);
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          slideY.setValue(g.dy);
          backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.parallel([
            Animated.timing(slideY, { toValue: 800, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(true); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  const dismiss = (reopenMenu: boolean) => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 800, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(reopenMenu); });
  };

  useEffect(() => {
    if (visible) {
      setSelected(null);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const handleConfirm = () => {
    if (selected === null) return;
    onConfirm(selected);
    dismiss(false);   // confirmed → exit to the programs list, not back to the menu
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss(true)}>
      <View style={styles.swBackdrop}>
        <TouchableWithoutFeedback onPress={() => dismiss(true)}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.swOverlay, { opacity: backdropOpacity }]} />
        </TouchableWithoutFeedback>
        <Animated.View style={[styles.swSheet, { backgroundColor: t.bg, height: sheetHeight, transform: [{ translateY: slideY }] }]}>
          {/* Drag handle + header share the pan responder so both areas dismiss on swipe down */}
          <View {...panResponder.panHandlers}>
            <View style={styles.swHandleArea}>
              <View style={styles.swHandle} />
            </View>
            {/* Header — back chevron returns to the action menu */}
            <View style={[styles.swHeader, { borderBottomColor: t.div }]}>
            <TouchableOpacity onPress={() => dismiss(true)} style={styles.swBack} activeOpacity={0.7} accessibilityLabel="Back" accessibilityRole="button">
              <Ionicons name="chevron-back" size={24} color={t.tp} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.swTitle, { color: t.tp }]}>Which day is it today?</Text>
              <Text style={[styles.swSubtitle, { color: t.ts }]} numberOfLines={2}>
                {`Pick where you are in your '${program.name}' cycle`}
              </Text>
            </View>
          </View>
          </View>
          {/* Day list */}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            {program.cyclePattern.map((day, index) => {
              const isTraining = day !== "Rest";
              const isSelected = selected === index;
              return (
                <TouchableOpacity key={index} onPress={() => setSelected(index)} activeOpacity={0.7}>
                  <View style={[styles.swDayRow, { borderBottomColor: t.div }, isSelected && { backgroundColor: ACCT + "18" }]}>
                    <View style={[styles.swDayBadge, { backgroundColor: isSelected ? ACCT : t.div }, isSelected && { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 10 }]}>
                      <Text style={[styles.swDayBadgeText, { color: isSelected ? "#fff" : t.ts }]}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.swDayName, { color: isTraining ? t.tp : t.ts }]}>{day}</Text>
                      {!isTraining && <Text style={[styles.swRestLabel, { color: t.ts }]}>Rest day</Text>}
                    </View>
                    {isSelected && (
                      <View style={{ width: 36, alignItems: "center" }}>
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: ACCT, alignItems: "center", justifyContent: "center", shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 10 }}>
                          <Ionicons name="checkmark" size={14} color="#fff" />
                        </View>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {/* Confirm button */}
          <View style={[styles.swFooter, { paddingBottom: insets.bottom + 12, borderTopColor: t.div }]}>
            <BounceButton onPress={selected !== null ? handleConfirm : undefined}>
              <View style={[styles.swConfirmWrap, { opacity: selected === null ? 0.45 : 1 }]}>
                <View style={styles.swConfirmBtn}>
                  <Ionicons name="calendar-outline" size={16} color="#fff" />
                  <Text style={styles.swConfirmText}>
                    {selected !== null ? `Set as Day ${selected + 1}` : "Select a day"}
                  </Text>
                </View>
              </View>
            </BounceButton>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Active Badge ─────────────────────────────────────────────────────────────

function ActiveBadge() {
  const scale    = useRef(new Animated.Value(1)).current;
  const dotPulse = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale,    { toValue: 1.08, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(dotPulse, { toValue: 1,    duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale,    { toValue: 1,    duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(dotPulse, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={[styles.activeBadge, { transform: [{ scale }] }]}>
      <Animated.View style={[styles.activeBadgeDot, { opacity: dotPulse }]} />
      <Text style={styles.activeBadgeText}>Active</Text>
    </Animated.View>
  );
}

// ─── Active Program Card ───────────────────────────────────────────────────────

interface ActiveProgramCardProps {
  program: SavedProgram;
  isDark: boolean;
  onOpenActions: () => void;
}

const ActiveProgramCard = React.memo(function ActiveProgramCard({ program, isDark, onOpenActions }: ActiveProgramCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  // A held program is still status "active", so everything here has to key off
  // pausedAt or it reads as running: green bars and an "Active" badge.
  const paused = !!program.pausedAt;
  const accent = paused ? PAUSED_ORANGE : ACCT;
  const week = getCurrentWeek(program);
  const finish = programFinishDate(program);
  const finishLabel = finish ? formatStoredDate(finish) : null;

  return (
    <NeuCard dark={isDark} style={styles.activeProgramCard}>
      <TouchableOpacity activeOpacity={0.8} onPress={onOpenActions} accessibilityLabel={`${program.name} options`} accessibilityRole="button">
        <View style={styles.activeProgramInner}>
          <View style={styles.rowBetween}>
            <Text style={[styles.activeProgramName, { color: t.tp }]} numberOfLines={1}>
              {program.name}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {paused ? (
                <View style={[styles.statusBadge, { backgroundColor: isDark ? `${PAUSED_ORANGE}22` : `${PAUSED_ORANGE}18` }]}>
                  <Text style={[styles.statusBadgeText, { color: PAUSED_ORANGE }]}>Paused</Text>
                </View>
              ) : (
                <ActiveBadge />
              )}
              <Ionicons name="ellipsis-horizontal" size={18} color={t.ts} />
            </View>
          </View>

          <View style={styles.progressRow}>
            {Array.from({ length: program.totalWeeks }).map((_, i) => (
              <View key={i} style={[styles.progressSeg, { backgroundColor: i < week ? accent : isDark ? "rgba(255,255,255,0.1)" : t.div }, i < week && { shadowColor: accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 }]} />
            ))}
          </View>
          <Text style={[styles.weekLabel, { color: t.ts }]}>
            {paused ? `Paused on week ${week} of ${program.totalWeeks}` : `Week ${week} of ${program.totalWeeks}`}
          </Text>

          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={14} color={t.ts} />
            <Text style={[styles.metaText, { color: t.ts }]}>Started {program.startDate}</Text>
          </View>

          {/* The other end of the timeline. Moves out when a day is pushed and
              back when a rest day is spent, which is the only place that trade
              is visible. Not shown while held — a hold has no finish date until
              it's resumed. */}
          {!paused && finishLabel && (
            <View style={styles.metaRow}>
              <Ionicons name="flag-outline" size={14} color={t.ts} />
              <Text style={[styles.metaText, { color: t.ts }]}>Finishes {finishLabel}</Text>
            </View>
          )}

          <View style={styles.cycleGrid}>
            {program.cyclePattern.map((day, i) => {
              const isTraining = day !== "Rest";
              return (
                <View
                  key={i}
                  style={[
                    styles.cycleChip,
                    { backgroundColor: isTraining ? accent + "22" : isDark ? "rgba(255,255,255,0.1)" : t.div },
                    isTraining && { borderColor: accent, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                    {day}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </TouchableOpacity>
    </NeuCard>
  );
});

// ─── Program Card ──────────────────────────────────────────────────────────────

interface ProgramCardProps {
  program: SavedProgram;
  isDark: boolean;
  /** Hide everything below the header row. The header itself stays mounted. */
  collapsed?: boolean;
  onOpenActions: () => void;
}

/** Badge colour + wording for a program. Shared by the full and compact cards so
 *  the two can't drift apart. Takes the secondary text colour rather than the
 *  whole theme: the palettes are `as const`, so a `typeof APP_LIGHT` parameter
 *  would reject APP_DARK on its literal types.
 *
 *  A HELD program keeps status "active", so pausedAt has to be checked first or
 *  it would show as Active. */
function statusStyle(program: SavedProgram, mutedColor: string): { color: string; label: string } {
  if (program.pausedAt)              return { color: PAUSED_ORANGE, label: "Paused" };
  if (program.status === "active")    return { color: ACCT,          label: "Active" };
  if (program.status === "paused")    return { color: PAUSED_ORANGE, label: "Paused" };
  if (program.status === "completed") return { color: ACCT,          label: "Completed" };
  return { color: mutedColor, label: "Not Started" };
}

// Collapsing does NOT swap in a different component. The header row (name,
// status badge, ellipsis) stays mounted either way, so it physically cannot
// shift position — only the detail beneath it is added and removed. An earlier
// version rendered a separate compact card, and its slightly different paddings
// and gaps made everything jump on every toggle.
const ProgramCard = React.memo(function ProgramCard({ program, isDark, collapsed, onOpenActions }: ProgramCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;

  const computedWeek = getCurrentWeek(program);
  const filledWeeks = program.status === "completed" ? program.currentWeek : computedWeek;
  const { color: statusColor, label: statusLabel } = statusStyle(program, t.ts);
  const weekText =
    program.status === "completed" ? `Completed ${program.currentWeek} of ${program.totalWeeks} weeks` :
    program.status === "created"   ? `${program.totalWeeks} weeks planned` :
    `Week ${computedWeek} of ${program.totalWeeks}`;
  const dateLabel = program.status === "created" ? "Created" : "Started";

  return (
    <NeuCard dark={isDark} style={styles.programCard}>
      <TouchableOpacity activeOpacity={0.8} onPress={onOpenActions} accessibilityLabel={`${program.name} options`} accessibilityRole="button">
        <Reanimated.View style={styles.programCardInner} layout={CARD_LAYOUT}>
          <View style={styles.rowBetween}>
            <Text style={[styles.programName, { color: t.tp }]} numberOfLines={1}>{program.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[styles.statusBadge, { backgroundColor: isDark ? `${statusColor}22` : `${statusColor}18` }]}>
                <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <Ionicons name="ellipsis-horizontal" size={18} color={t.ts} />
            </View>
          </View>

          {!collapsed && (
          <Reanimated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(110)}
            style={styles.programCardDetail}
          >
          <View style={styles.progressRow}>
            {Array.from({ length: program.totalWeeks }).map((_, i) => (
              <View key={i} style={[styles.progressSeg, { backgroundColor: i < filledWeeks ? statusColor : isDark ? "rgba(255,255,255,0.1)" : t.div }, i < filledWeeks && { shadowColor: statusColor, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 }]} />
            ))}
          </View>
          <Text style={[styles.weekLabel, { color: t.ts }]}>{weekText}</Text>
          <View style={{ gap: 4 }}>
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={13} color={t.ts} />
              <Text style={[styles.metaText, { color: t.ts }]}>{dateLabel} {program.startDate}</Text>
            </View>
            {program.status === "completed" && program.completedDate && (
              <View style={styles.metaRow}>
                <Ionicons name="flag-outline" size={13} color={ACCT} />
                <Text style={[styles.metaText, { color: ACCT }]}>Completed {program.completedDate}</Text>
              </View>
            )}
          </View>
          <View style={styles.cycleGrid}>
            {program.cyclePattern.map((day, i) => {
              const isTraining = day !== "Rest";
              return (
                <View
                  key={i}
                  style={[
                    styles.cycleChip,
                    { backgroundColor: isTraining ? statusColor + "22" : isDark ? "rgba(255,255,255,0.1)" : t.div },
                    isTraining && { borderColor: statusColor, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                    {day}
                  </Text>
                </View>
              );
            })}
          </View>
          </Reanimated.View>
          )}
        </Reanimated.View>
      </TouchableOpacity>
    </NeuCard>
  );
});

// ─── Program Actions Sheet ──────────────────────────────────────────────────────
// Bottom-sheet popup opened by tapping a program card. Shows the status-appropriate
// actions (Set Workout / Edit / Mark Complete / Duplicate / Make Inactive for the
// active program; Make Active / Edit / Duplicate / Delete otherwise). Replaces the
// old inline dropdown so tapping a card no longer expands it.

interface ProgramAction {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  primary?: boolean;      // filled accent button
  destructive?: boolean;  // red icon + text
  tint?: string;          // custom icon/text colour
}

function ProgramActionsSheet({ visible, program, actions, isDark, onClose }: {
  visible: boolean;
  program: SavedProgram | null;
  actions: ProgramAction[];
  isDark: boolean;
  onClose: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          slideY.setValue(g.dy);
          backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.parallel([
            Animated.timing(slideY, { toValue: 800, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  // Close animates out; `after` (an action) runs once the sheet is gone so any
  // navigation / alert / follow-up sheet appears cleanly.
  const close = (after?: () => void) => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 800, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(); after?.(); });
  };

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!program) return null;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => close()}>
      <View style={styles.swBackdrop}>
        <TouchableWithoutFeedback onPress={() => close()}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.swOverlay, { opacity: backdropOpacity }]} />
        </TouchableWithoutFeedback>
        <Animated.View style={[styles.paSheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 16, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers}>
            <View style={styles.swHandleArea}>
              <View style={styles.swHandle} />
            </View>
            <View style={[styles.paHeader, { borderBottomColor: t.div }]}>
              <Text style={[styles.paTitle, { color: t.tp }]} numberOfLines={1}>{program.name}</Text>
              <TouchableOpacity onPress={() => close()} style={styles.swClose} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={t.tp} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.paList}>
            {actions.map((a) => (
              <BounceButton key={a.key} onPress={() => close(a.onPress)} accessibilityLabel={a.label} accessibilityRole="button">
                {a.primary ? (
                  <View style={[styles.activePrimaryBtnWrap, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                    <View style={[styles.activePrimaryBtn, { backgroundColor: ACCT }]}>
                      <Ionicons name={a.icon} size={16} color="#fff" />
                      <Text style={[styles.activePrimaryBtnText, { color: "#fff" }]}>{a.label}</Text>
                    </View>
                  </View>
                ) : (
                  <NeuCard dark={isDark} radius={14} innerStyle={styles.paRowInner}>
                    <Ionicons name={a.icon} size={18} color={a.destructive ? "#E53935" : (a.tint ?? t.tp)} />
                    <Text style={[styles.paRowText, { color: a.destructive ? "#E53935" : (a.tint ?? t.tp) }]}>{a.label}</Text>
                  </NeuCard>
                )}
              </BounceButton>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProgramsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isRunning } = useWorkoutTimer();
  const { accountType } = useAccountType();
  const [assignedPT, setAssignedPT] = useState<AssignedPT | null>(null);

  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [setWorkoutOpen, setSetWorkoutOpen] = useState(false);
  const [actionsProgram, setActionsProgram] = useState<SavedProgram | null>(null);
  // Transient, like the trainer hub's collapsible sections — not persisted.
  const [collapsedAll, setCollapsedAll] = useState(false);

  const toggleCollapsed = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedAll(v => !v);
  }, []);
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const scrollRef = useRef<ScrollView | null>(null);
  const cardOffsets = useRef<Record<string, number>>({});
  const focusHandled = useRef<string | null>(null);

  const todayFormatted = () => formatStoredDate(new Date());

  const handleMakeActive = async (program: SavedProgram) => {
    const todayStr = todayFormatted();
    const updated = programs.map(p => {
      if (p.id === program.id) {
        // A (re-)activation is a fresh run from today: any cycleOffset left over
        // from a previous run's "set workout day" would shift day 1 arbitrarily.
        // pausedAt goes for the same reason — a hold belongs to the run it was
        // taken during, and carrying it over would make the new run start paused.
        //
        // The rest/push/pull marks go too, and they matter most: every one of
        // them is dated BEFORE the new startDate, so all of them would count as
        // drift against day 1 — landing the fresh run's first day several slots
        // into the cycle and moving its finish date out by the same amount.
        return {
          ...p,
          status: "active" as const,
          startDate: todayStr,
          currentWeek: 1,
          cycleOffset: undefined,
          pausedAt: undefined,
          skippedDates: undefined,
          pushedDates: undefined,
          pulledDates: undefined,
        };
      }
      if (p.status === "active") {
        const week = getCurrentWeek(p);
        if (week >= p.totalWeeks) {
          return { ...p, status: "completed" as const, currentWeek: p.totalWeeks, completedDate: todayStr, pausedAt: undefined };
        }
        // Demoting a HELD program: it's inactive now, not on hold. Leaving
        // pausedAt set would show it as paused in the list and, worse, make it
        // resume already-paused if it were activated again.
        return { ...p, status: week > 1 ? "paused" as const : "created" as const, currentWeek: week, pausedAt: undefined };
      }
      return p;
    });
    setPrograms(updated);
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    // A same-day change-day override belongs to the PREVIOUS active program —
    // without this the workout tab keeps showing that program's day until the
    // date rolls over.
    AsyncStorage.removeItem(WORKOUT_DAY_OVERRIDE_KEY).catch(() => {});
    scheduleCloudPush();
  };

  // Deactivate the active program without completing it — drops it back to paused
  // (or "created" if it never got past week 1) so no program is active.
  //
  // Clears any hold: "inactive" and "on hold" are different states, and a
  // program can't be both. Once it's out of the active slot the hold is
  // meaningless, and activating it later must give a clean run.
  const handleMakeInactive = async (program: SavedProgram) => {
    const week = getCurrentWeek(program);
    const updated = programs.map(p =>
      p.id === program.id
        ? { ...p, status: week > 1 ? ("paused" as const) : ("created" as const), currentWeek: week, pausedAt: undefined }
        : p
    );
    setPrograms(updated);
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    scheduleCloudPush();
  };

  // Put the active program on hold. Unlike Make Inactive it keeps the active
  // slot — nothing is scheduled and the week counter stops until it's resumed.
  const handlePauseProgram = async (program: SavedProgram) => {
    const updated = pauseProgram(programs, program.id);
    setPrograms(updated);
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    // A change-day override belongs to a running program; it would resurface a
    // workout on the day the hold starts.
    AsyncStorage.removeItem(WORKOUT_DAY_OVERRIDE_KEY).catch(() => {});
    scheduleCloudPush();
    Alert.alert(
      "Program Paused",
      `"${program.name}" is on hold. No workouts are scheduled and the weeks stop counting until you resume.`,
    );
  };

  // The prompt, the day maths and the write all live in resumeWithPrompt, so
  // this and the Workout tab's paused screen can't offer different behaviour.
  const handleResumeProgram = async (program: SavedProgram) => {
    const updated = await resumeWithPrompt(program.id);
    if (updated) setPrograms(updated);
  };

  const handleCompleteProgram = () => {
    if (!activeProgram) return;
    const weeksRemaining = activeProgram.totalWeeks - getCurrentWeek(activeProgram);
    const message = weeksRemaining > 0
      ? `Are you sure you want to mark this program as complete? You still have ${weeksRemaining} week${weeksRemaining === 1 ? "" : "s"} remaining.`
      : "Are you sure you want to mark this program as complete?";
    Alert.alert("Mark as Complete", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Complete",
        style: "destructive",
        onPress: async () => {
          const todayStr = todayFormatted();
          const updated = programs.map(p =>
            p.id === activeProgram.id
              // Completing ends the run, hold and all — a finished program is
              // never "on hold".
              ? { ...p, status: "completed" as const, currentWeek: getCurrentWeek(activeProgram), completedDate: todayStr, pausedAt: undefined }
              : p
          );
          setPrograms(updated);
          await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
          scheduleCloudPush();
        },
      },
    ]);
  };

  const handleDuplicateProgram = async (program: SavedProgram) => {
    const todayStr = todayFormatted();
    const copy: SavedProgram = {
      ...program,
      id: `program_${Date.now()}`,
      status: "created",
      currentWeek: 0,
      startDate: todayStr,
      cycleOffset: undefined,
      completedDate: undefined,
      // A copy is a brand-new program; the original's hold doesn't come with it,
      // and neither do the days the user rested, pushed or spent during it —
      // those are dated before this copy exists and would all count as drift.
      pausedAt: undefined,
      skippedDates: undefined,
      pushedDates: undefined,
      pulledDates: undefined,
    };
    const updated = [...programs, copy];
    setPrograms(updated);
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    scheduleCloudPush();
    Alert.alert("Program Duplicated", `"${program.name}" has been duplicated. Find it in your program list to start or edit.`);
  };

  const handleDeleteProgram = (program: SavedProgram) => {
    Alert.alert(
      "Delete Program",
      `Are you sure you want to delete "${program.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const updated = programs.filter(p => p.id !== program.id);
            setPrograms(updated);
            await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
            scheduleCloudPush();
            // Clear any SharedProgram entries that pointed at this local program
            // so the gym user's My Trainer page doesn't keep stale "received" cards.
            await removeSharedProgramByLocalId(program.id);
          },
        },
      ]
    );
  };

  const handleSetWorkoutDay = async (targetDayIndex: number) => {
    if (!activeProgram) return;
    const today = todayYMD();
    // A clean reset. "Today is Push" is the user saying where they are, so every
    // move that got them here is dropped FIRST — left in, they kept counting,
    // and the week looked back on plan while the finish date stayed however
    // many days late. See clearShifts for what survives (past moves become plain
    // skips so the calendar still says rest).
    const reset = clearShifts(activeProgram, today);
    // Then solve against the reset program, asking the shared resolver where
    // today lands with NO offset rather than recomputing daysPassed here.
    const naturalDayIndex = cycleIndexForDate({ ...reset, cycleOffset: 0 }, today);
    if (naturalDayIndex === null) return;
    const n = reset.cycleDays;
    const cycleOffset = ((targetDayIndex - naturalDayIndex) % n + n) % n;
    const updated = programs.map(p =>
      p.id === activeProgram.id ? normalizeDriftDates({ ...reset, cycleOffset }) : p
    );
    setPrograms(updated);
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    // Picking today's workout by hand is the most explicit statement there is
    // about what today should be, so a leftover same-day override has to go —
    // otherwise the Workout tab keeps honouring it (a stale "Rest", say) while
    // Home's week strip reads the re-aligned cycle, and the two disagree.
    AsyncStorage.removeItem(WORKOUT_DAY_OVERRIDE_KEY).catch(() => {});
    scheduleCloudPush();
  };

  // Honor ?focus=<programId>: expand and scroll that program into view once after
  // the cards have laid out. We track the last handled focus value in a ref so we
  // don't re-scroll on every render or when the user manually scrolls away.
  useEffect(() => {
    if (!focus || typeof focus !== "string") return;
    if (focusHandled.current === focus) return;
    if (programs.length === 0) return;
    if (!programs.some(p => p.id === focus)) return;

    let cancelled = false;
    const tryScroll = (attempt: number) => {
      if (cancelled) return;
      const y = cardOffsets.current[focus];
      if (typeof y === "number") {
        // Leave room for: safe-area top + back button (40) + gradient blur fade
        // + a generous breathing gap so the program title isn't hugging the chrome.
        const target = Math.max(0, y - (insets.top + 110));
        scrollRef.current?.scrollTo({ y: target, animated: true });
        focusHandled.current = focus;
        return;
      }
      if (attempt < 10) setTimeout(() => tryScroll(attempt + 1), 60);
    };
    const t = setTimeout(() => tryScroll(0), 80);
    return () => { cancelled = true; clearTimeout(t); };
  }, [focus, programs, insets.top]);

  useFocusEffect(useCallback(() => {
    loadAssignedPT().then(setAssignedPT).catch(() => {});
    AsyncStorage.getItem(PROGRAMS_KEY).then(raw => {
      if (!raw) { setPrograms([]); return; }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setPrograms(parsed as SavedProgram[]);
      } catch { setPrograms([]); }
    }).catch(() => {});
  }, []));

  const activeProgram = programs.find((p) => p.status === "active") ?? null;
  // Everything under the All Programs heading — the active one has its own
  // section above. Derived once: the list, its empty state and the heading's
  // accessibility label all need the same count.
  const otherPrograms = programs.filter((p) => p.status !== "active");
  const canSendToPT = accountType === "gym_user" && assignedPT !== null;

  const handleSendToPT = (program: SavedProgram) => {
    if (!assignedPT) return;
    Alert.alert(
      "Send to Trainer",
      `Send "${program.name}" to ${assignedPT.name} for review?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: async () => {
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
              await appendSentProgram(entry, assignedPT.id);
            } catch (e) {
              Alert.alert("Couldn't send program", e instanceof Error ? e.message : "Check your internet and try again.");
              return;
            }
            Alert.alert("Sent", `"${program.name}" was sent to ${assignedPT.name}.`);
          },
        },
      ]
    );
  };
  const totalCount = programs.length;
  const weeksTrained = programs.reduce((sum, p) =>
    sum + (p.status === "completed" ? p.totalWeeks : getCurrentWeek(p)), 0);
  const completedCount = programs.filter((p) => p.status === "completed").length;

  // Status-appropriate action buttons for the tapped program, shown in the popup
  // sheet. Each onPress runs after the sheet closes (see ProgramActionsSheet.close).
  const buildActions = (program: SavedProgram): ProgramAction[] => {
    const editAction: ProgramAction = { key: "edit", label: "Edit Program", icon: "create-outline", onPress: () => router.navigate({ pathname: "/new-program", params: { id: program.id } }) };
    const duplicateAction: ProgramAction = { key: "duplicate", label: "Duplicate Program", icon: "copy-outline", onPress: () => handleDuplicateProgram(program) };
    const deleteAction: ProgramAction = { key: "delete", label: "Delete", icon: "trash-outline", destructive: true, onPress: () => handleDeleteProgram(program) };
    const sendAction: ProgramAction | null = canSendToPT ? { key: "send", label: "Send to Trainer", icon: "paper-plane-outline", tint: ACCT, onPress: () => handleSendToPT(program) } : null;

    let list: ProgramAction[];
    if (program.status === "active") {
      list = [
        // Set Workout Date shifts cycleOffset, which resuming also does — offering
        // both while paused would just mean the resume overwrites your choice.
        ...(program.pausedAt ? [] : [{ key: "setworkout", label: "Set Workout Date", icon: "calendar-outline", primary: true, onPress: () => {
          if (isRunning) {
            Alert.alert("Workout In Progress", "Please end or discard your current workout before changing the workout day.", [{ text: "OK" }]);
          } else {
            setSetWorkoutOpen(true);
          }
        } } as ProgramAction]),
        editAction,
        { key: "complete", label: "Mark Complete", icon: "checkmark-circle-outline", tint: ACCT, onPress: handleCompleteProgram },
        // Pause sits between Mark Complete and Make Inactive. The two are
        // different actions: pause keeps the active slot, Make Inactive frees it
        // so another program can take over — hence the different oranges, and
        // why Make Inactive gives up the pause icon.
        program.pausedAt
          ? { key: "resume", label: "Resume Program", icon: "play-circle-outline", tint: ACCT, onPress: () => handleResumeProgram(program) }
          : { key: "pause", label: "Pause Program", icon: "pause-circle-outline", tint: PAUSED_ORANGE, onPress: () => handlePauseProgram(program) },
        { key: "inactive", label: "Make Inactive", icon: "remove-circle-outline", tint: WARMUP_ORANGE, onPress: () => handleMakeInactive(program) },
        duplicateAction,
      ];
    } else if (program.status === "completed") {
      list = [duplicateAction, deleteAction];
    } else {
      list = [
        { key: "makeactive", label: "Make Active Program", icon: "checkmark-circle-outline", primary: true, onPress: () => handleMakeActive(program) },
        editAction,
        duplicateAction,
        deleteAction,
      ];
    }
    if (sendAction) list.push(sendAction);
    return list;
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* Pastel glow matching the aqua My Programs orb on Home */}
      <AuroraBackdrop dark={isDark} tint="aqua" />

      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
          <Ionicons name="chevron-back" size={22} color={t.tp} />
        </View>
      </TouchableOpacity>

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      >
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>MY PROGRAMS</Text>
          <View style={{ width: 66 }} />
        </View>

        {/* Stats */}
        <NeuCard dark={isDark} style={styles.statsCard}>
          <View style={styles.statsRow}>
            {([
              { value: String(totalCount),    label: "Total"     },
              { value: String(weeksTrained),  label: "Weeks Logged" },
              { value: String(completedCount), label: "Completed" },
            ] as const).map((s, i) => (
              <View key={s.label} style={styles.statCell}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
                <View style={styles.statContent}>
                  <Text style={[styles.statValue, { color: t.tp }]}>{s.value}</Text>
                  <Text style={[styles.statLabel, { color: t.ts }]}>{s.label}</Text>
                </View>
              </View>
            ))}
          </View>
        </NeuCard>

        {/* Active program */}
        {activeProgram !== null && (
          <>
            <Text style={[styles.sectionLabel, { color: t.tp }]}>Active</Text>
            <View onLayout={e => { cardOffsets.current[activeProgram.id] = e.nativeEvent.layout.y; }}>
              <ActiveProgramCard
                program={activeProgram}
                isDark={isDark}
                onOpenActions={() => setActionsProgram(activeProgram)}
              />
            </View>
          </>
        )}

        {/* All programs. The heading collapses the list to compact cards; only
            the left side is pressable, so tapping New never toggles it. */}
        <View style={[styles.rowBetween, { marginBottom: 12 }]}>
          <Pressable
            onPress={toggleCollapsed}
            style={styles.allProgramsTap}
            accessibilityRole="button"
            accessibilityLabel={`All Programs, ${otherPrograms.length} ${otherPrograms.length === 1 ? "program" : "programs"}. Toggle list`}
          >
            <Text style={[styles.sectionLabel, { color: t.tp, marginBottom: 0 }]}>All Programs</Text>
            <ChevronToggle expanded={!collapsedAll} color={t.ts} />
          </Pressable>
          <BounceButton onPress={() => router.navigate("/new-program")} accessibilityLabel="Create new program" accessibilityRole="button">
            <View style={[styles.newProgramBtn, { backgroundColor: t.ctrl }]}>
              <Ionicons name="add" size={14} color={t.tp} />
              <Text style={[styles.newProgramBtnText, { color: t.tp }]}>New</Text>
            </View>
          </BounceButton>
        </View>
        {otherPrograms.length === 0 ? (
          <NeuCard dark={isDark} style={{ borderRadius: 20, marginBottom: 12 }}>
            <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
              <Ionicons name="barbell-outline" size={32} color={t.ts} />
              <Text style={{ fontFamily: FontFamily.semibold, fontSize: 15, color: t.tp, textAlign: "center" }}>No programs yet</Text>
              <Text style={{ fontFamily: FontFamily.regular, fontSize: 13, color: t.ts, textAlign: "center" }}>Tap New to create your first program</Text>
            </View>
          </NeuCard>
        ) : (
          otherPrograms.map((p) => (
            // onLayout feeds cardOffsets, which drives scroll-to-program.
            // Reanimated layout on the wrapper is what makes the cards below
            // slide up and down instead of snapping as one card changes height.
            <Reanimated.View
              key={p.id}
              layout={CARD_LAYOUT}
              onLayout={e => { cardOffsets.current[p.id] = e.nativeEvent.layout.y; }}
            >
              <ProgramCard
                program={p}
                isDark={isDark}
                collapsed={collapsedAll}
                onOpenActions={() => setActionsProgram(p)}
              />
            </Reanimated.View>
          ))
        )}
      </ScrollView>

      <ProgramActionsSheet
        visible={actionsProgram !== null}
        program={actionsProgram}
        actions={actionsProgram ? buildActions(actionsProgram) : []}
        isDark={isDark}
        onClose={() => setActionsProgram(null)}
      />

      {activeProgram && setWorkoutOpen && (
        <SetWorkoutPicker
          visible={setWorkoutOpen}
          program={activeProgram}
          isDark={isDark}
          onConfirm={handleSetWorkoutDay}
          onClose={(reopenMenu) => {
            setSetWorkoutOpen(false);
            // Back/swipe/backdrop → return to the program's action menu; a confirmed
            // day exits straight to the programs list.
            if (reopenMenu && activeProgram) setActionsProgram(activeProgram);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:               { flex: 1 },
  topGradient:        { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn:            { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  header:             { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 24 },
  screenTitle:        { fontFamily: FontFamily.bold, fontSize: 20, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1 },

  statsCard:          { marginBottom: 24, borderRadius: 20 },
  statsRow:           { flexDirection: "row" },
  statCell:           { flex: 1, flexDirection: "row" },
  divider:            { width: 1, height: 40, alignSelf: "center" },
  statContent:        { flex: 1, alignItems: "center", paddingVertical: 20, gap: 4 },
  statValue:          { fontFamily: FontFamily.bold, fontSize: 22 },
  statLabel:          { fontFamily: FontFamily.regular, fontSize: 14 },

  // Section headings, matching the trainer hub's ("My Clients", "Groups"):
  // bold 18 in primary text. They were 13px uppercase in secondary grey, which
  // read as a caption rather than a heading.
  sectionLabel:       { fontFamily: FontFamily.bold, fontSize: 18, marginBottom: 12 },

  activeProgramCard:  { marginBottom: 20, borderRadius: 20 },
  activeProgramInner: { padding: 20, gap: 14 },
  activeProgramName:  { fontFamily: FontFamily.bold, fontSize: 18, flex: 1, marginRight: 8 },
  activeBtnRow:           { flexDirection: "row", gap: 10 },
  activePrimaryBtnWrap:   { borderRadius: PILL_RADIUS, backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) },
  activePrimaryBtn:       { ...pill(PILL_H_SM), backgroundColor: ACCT, gap: 7 },
  activePrimaryBtnText:   { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff", letterSpacing: 0.2 },
  activeSecondaryBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12 },
  activeSecondaryBtnText:  { fontFamily: FontFamily.bold, fontSize: 14, letterSpacing: 0.2, lineHeight: 20 },

  programCard:        { marginBottom: 12, borderRadius: 20 },
  programCardInner:   { padding: 16, gap: 10 },
  programName:        { fontFamily: FontFamily.semibold, fontSize: 15, flex: 1, marginRight: 8 },
  statusBadge:        { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  statusBadgeText:    { fontFamily: FontFamily.semibold, fontSize: 12 },
  activeBadge:        { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: ACCT, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 8 },
  activeBadgeDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  activeBadgeText:    { fontFamily: FontFamily.bold, fontSize: 12, color: "#fff", letterSpacing: 0.3 },

  rowBetween:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  progressRow:        { flexDirection: "row", gap: 4 },
  progressSeg:        { flex: 1, height: 6, borderRadius: 3 },
  weekLabel:          { fontFamily: FontFamily.regular, fontSize: 13 },
  metaRow:            { flexDirection: "row", alignItems: "center", gap: 6 },
  metaDot:            { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#8896A7" },
  metaText:           { fontFamily: FontFamily.regular, fontSize: 13 },
  // Neutral chrome (background comes from t.ctrl inline) — a soft drop shadow
  // rather than the ACCT glow reserved for primary green actions.
  newProgramBtn:      { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 50, paddingHorizontal: 10, paddingVertical: 5, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  // flex:1 so the tap target spans the row up to the New pill, not just the words.
  allProgramsTap:     { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  // The collapsible half of the card. `gap: 10` matches programCardInner's, so
  // the spacing under the header is identical whether it's mounted or not.
  programCardDetail:  { gap: 10 },
  newProgramBtnText:  { fontFamily: FontFamily.semibold, fontSize: 12, color: "#fff" },
  cardActions:        { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 0 },
  deleteBtnText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#E53935", letterSpacing: 0.2 },

  cycleGrid:          { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:          { alignItems: "center", paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, minWidth: 60 },
  cycleChipText:      { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },

  // Program Actions Sheet
  paSheet:            { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  paHeader:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  paTitle:            { flex: 1, fontFamily: FontFamily.bold, fontSize: 18 },
  paList:             { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  paRowInner:         { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  paRowText:          { fontFamily: FontFamily.bold, fontSize: 15, letterSpacing: 0.2 },

  // Set Workout Picker
  swBackdrop:         { flex: 1, justifyContent: "flex-end" },
  swOverlay:          { backgroundColor: "rgba(0,0,0,0.45)" },
  swSheet:            { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  swHandleArea:       { paddingVertical: 12, alignItems: "center" },
  swHandle:           { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  swHeader:           { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  swTitle:            { fontFamily: FontFamily.bold, fontSize: 18, marginBottom: 4 },
  swSubtitle:         { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  swClose:            { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginTop: -4 },
  swBack:             { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginLeft: -6, marginTop: -2 },
  swDayRow:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  swDayBadge:         { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  swDayBadgeText:     { fontFamily: FontFamily.bold, fontSize: 13 },
  swDayName:          { fontFamily: FontFamily.semibold, fontSize: 15 },
  swRestLabel:        { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  swFooter:           { paddingHorizontal: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  swConfirmWrap:      { borderRadius: 16, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  swConfirmBtn:       { borderRadius: PILL_RADIUS, backgroundColor: ACCT, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  swConfirmText:      { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff", letterSpacing: 0.2 },
});
