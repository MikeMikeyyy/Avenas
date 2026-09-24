import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Animated,
  PanResponder,
  Easing,
  TouchableWithoutFeedback,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import FadeScreen from "../components/FadeScreen";
import AuroraBackdrop from "../components/AuroraBackdrop";
import ActiveBadge from "../components/ActiveBadge";
import TrashIcon from "../components/TrashIcon";
import JournalCalendar from "../components/JournalCalendar";
import JournalWorkoutCard, { useJournalWorkoutInfo } from "../components/journal/JournalWorkoutCard";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, ORB_GRADS } from "../constants/theme";
import { pill, pillGlow, PILL_H_SM, PILL_RADIUS } from "../constants/buttons";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY,
  getCurrentWeek, type SavedProgram, type CompletedWorkout, type ProgramDayRef,
} from "../constants/programs";
import { programDays } from "../utils/programDays";
import { JOURNAL_KEY, type JournalEntry } from "../constants/journal";
import { buildJournalFeed } from "../utils/journalFeed";
import { scheduleCloudPush } from "../lib/syncManager";
import { useTheme } from "../contexts/ThemeContext";

// Dev-only warning helper. Compiled out of release builds via `__DEV__`.
function warnStorage(op: string, key: string, err: unknown) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn("[avenas]", op, key, err);
  }
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBR    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w ago`;
  return formatEntryDate(iso);
}

// Static values for StyleSheet
const TP  = APP_LIGHT.tp;
const TS  = APP_LIGHT.ts;
const DIV = APP_LIGHT.div;

// Custom dumbbell icon (3-path SVG from _layout.tsx)
// TODO(program-page-prep): unify with components/DumbbellIcon after a pixel-diff
// confirms equivalence — this variant's `d` path differs subtly from the canonical.
const WorkoutIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={color} strokeWidth="1.5" />
    <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={color} strokeWidth="1.5" />
    <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={color} strokeWidth="1.5" />
  </Svg>
);

// ─── Delete sheet ─────────────────────────────────────────────────────────────

function DeleteSheet({ visible, isDark, entryTitle, onConfirm, onClose, title = "Delete Entry?" }: {
  visible: boolean; isDark: boolean; entryTitle: string;
  onConfirm: () => void; onClose: () => void; title?: string;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 400, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(400); backdropOpacity.setValue(0); onClose(); });
  }, [onClose]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 200)); } },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.8) {
        Animated.parallel([
          Animated.timing(slideY, { toValue: 400, duration: 220, useNativeDriver: true }),
          Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => { slideY.setValue(400); backdropOpacity.setValue(0); onClose(); });
      } else {
        Animated.parallel([
          Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
          Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      }
    },
  })).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <TouchableWithoutFeedback onPress={dismiss}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
      </TouchableWithoutFeedback>
      <Animated.View style={[styles.deleteSheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 12, transform: [{ translateY: slideY }] }]}>
        <View {...panResponder.panHandlers}>
          <View style={styles.handleArea}><View style={styles.handle} /></View>
        </View>
        <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 8 }}>
          <Text style={[styles.deleteTitle, { color: t.tp }]}>{title}</Text>
          <Text style={[styles.deleteSubtitle, { color: t.ts }]} numberOfLines={2}>
            "{entryTitle}" will be permanently removed.
          </Text>
        </View>
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <BounceButton onPress={() => { onConfirm(); dismiss(); }}>
            <View style={styles.deleteBtn}><Text style={styles.deleteBtnText}>Delete</Text></View>
          </BounceButton>
          <BounceButton onPress={dismiss}>
            <View style={[styles.cancelBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
              <Text style={[styles.cancelBtnText, { color: t.tp }]}>Cancel</Text>
            </View>
          </BounceButton>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── Workout picker sheet (multi-step) ────────────────────────────────────────

type PickerStep = "menu" | "active" | "others" | "program" | "custom";

function WorkoutPickerSheet({ visible, isDark, activeProgram, programs, onSelect, onClose }: {
  visible: boolean; isDark: boolean;
  activeProgram: SavedProgram | null; programs: SavedProgram[];
  /** `day` is the picked program slot (identity, not just a name) — undefined
   *  for the free-workout step, which has no slot to point at. */
  onSelect: (name: string, addToProgramId?: string, fromProgramId?: string, dayId?: string) => void;
  onClose: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const customInputRef = useRef<TextInput>(null);

  const [step, setStep] = useState<PickerStep>("menu");
  const [focusedProgram, setFocusedProgram] = useState<SavedProgram | null>(null);
  const [customName, setCustomName] = useState("");
  const [assocProgramId, setAssocProgramId] = useState<string | null>(null);

  // Reset internal state each time sheet opens
  useEffect(() => {
    if (visible) {
      setStep("menu");
      setCustomName("Custom Workout");
      setAssocProgramId(null);
    }
  }, [visible, activeProgram]);

  // Focus + select all when custom step opens
  useEffect(() => {
    if (step === "custom") {
      setTimeout(() => customInputRef.current?.focus(), 80);
    }
  }, [step]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(); });
  }, [onClose]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300)); } },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.8) {
        Animated.parallel([
          Animated.timing(slideY, { toValue: 600, duration: 220, useNativeDriver: true }),
          Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(); });
      } else {
        Animated.parallel([
          Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
          Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      }
    },
  })).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const otherPrograms = programs.filter(p => p.id !== activeProgram?.id);
  // Every training slot, not a name-deduped set: a cycle that schedules "Upper"
  // twice offers both, and each logs against its own day.
  const activeWorkouts = activeProgram ? programDays(activeProgram) : [];

  const pick = (day: ProgramDayRef) => { dismiss(); onSelect(day.label, undefined, day.programId, day.dayId); };

  // ── Step header with back button ──
  function StepHeader({ title, onBack }: { title: string; onBack: () => void }) {
    return (
      <View style={styles.pickerStepHeader}>
        <TouchableOpacity onPress={onBack} style={styles.pickerBackBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={t.tp} />
        </TouchableOpacity>
        <Text style={[styles.pickerStepTitle, { color: t.tp }]}>{title}</Text>
        <View style={styles.pickerBackBtn} />
      </View>
    );
  }

  // ── Workout row ──
  function WorkoutRow({ day, accent }: { day: ProgramDayRef; accent?: boolean }) {
    return (
      <BounceButton style={{ marginBottom: 16 }} onPress={() => pick(day)}>
        <NeuCard dark={isDark} radius={14}>
          <View style={styles.pickerOptionInner}>
            <WorkoutIcon size={18} color={accent ? ACCT : t.ts} />
            <Text style={[styles.pickerOptionText, { color: t.tp }]}>
              {/* Only qualified when the name repeats in this program. */}
              {day.duplicateLabel ? `${day.label} · day ${day.index + 1}` : day.label}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={t.ts} />
          </View>
        </NeuCard>
      </BounceButton>
    );
  }

  // ── Step content ──
  const renderStep = () => {
    if (step === "menu") {
      return (
        <View style={styles.pickerMenuContent}>
          <Text style={[styles.pickerTitle, { color: t.tp }]}>Log a Workout</Text>
          <View style={{ gap: 16 }}>
            {activeProgram && (
              <BounceButton onPress={() => setStep("active")}>
                <NeuCard dark={isDark} radius={14}>
                  <View style={styles.pickerOptionInner}>
                    <WorkoutIcon size={18} color={t.tp} />
                    <Text style={[styles.pickerOptionText, { color: t.tp }]}>Active Program</Text>
                    <Ionicons name="chevron-forward" size={16} color={t.ts} />
                  </View>
                </NeuCard>
              </BounceButton>
            )}
            {otherPrograms.length > 0 && (
              <BounceButton onPress={() => setStep("others")}>
                <NeuCard dark={isDark} radius={14}>
                  <View style={styles.pickerOptionInner}>
                    <Ionicons name="albums-outline" size={18} color={t.tp} />
                    <Text style={[styles.pickerOptionText, { color: t.tp }]}>Other Programs</Text>
                    <Ionicons name="chevron-forward" size={16} color={t.ts} />
                  </View>
                </NeuCard>
              </BounceButton>
            )}
            <BounceButton onPress={() => setStep("custom")}>
              <NeuCard dark={isDark} radius={14}>
                <View style={styles.pickerOptionInner}>
                  <Ionicons name="pencil-outline" size={18} color={t.tp} />
                  <Text style={[styles.pickerOptionText, { color: t.tp }]}>Custom Workout</Text>
                  <Ionicons name="chevron-forward" size={16} color={t.ts} />
                </View>
              </NeuCard>
            </BounceButton>
            <BounceButton onPress={dismiss}>
              <View style={[styles.cancelBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
                <Text style={[styles.cancelBtnText, { color: t.tp }]}>Cancel</Text>
              </View>
            </BounceButton>
          </View>
        </View>
      );
    }

    if (step === "active") {
      return (
        <>
          <StepHeader title="Active Program" onBack={() => setStep("menu")} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerContent}>
            <Text style={[styles.pickerSection, { color: t.tp }]}>{activeProgram?.name.toUpperCase()}</Text>
            {activeWorkouts.map(day => <WorkoutRow key={day.key} day={day} />)}
          </ScrollView>
        </>
      );
    }

    if (step === "others") {
      return (
        <>
          <StepHeader title="Other Programs" onBack={() => setStep("menu")} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerContent}>
            {otherPrograms.map(prog => (
              <BounceButton key={prog.id} style={{ marginBottom: 16 }} onPress={() => { setFocusedProgram(prog); setStep("program"); }}>
                <NeuCard dark={isDark} radius={14}>
                  <View style={styles.pickerOptionInner}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerOptionText, { color: t.tp }]}>{prog.name}</Text>
                      <Text style={[styles.pickerOptionSub, { color: t.ts }]}>
                        {[...new Set(prog.cyclePattern.filter(n => n && n !== "Rest"))].join(" · ")}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={t.ts} />
                  </View>
                </NeuCard>
              </BounceButton>
            ))}
          </ScrollView>
        </>
      );
    }

    if (step === "program" && focusedProgram) {
      return (
        <>
          <StepHeader title={focusedProgram.name} onBack={() => setStep("others")} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerContent}>
            {programDays(focusedProgram).map(day => <WorkoutRow key={day.key} day={day} />)}
          </ScrollView>
        </>
      );
    }

    if (step === "custom") {
      const addToActive = assocProgramId === activeProgram?.id && activeProgram != null;
      return (
        <>
          <StepHeader title="Name Your Workout" onBack={() => setStep("menu")} />
          <View style={[styles.pickerContent, { paddingBottom: 0 }]}>
            <TextInput
              ref={customInputRef}
              style={[styles.customInput, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", color: t.tp, borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" }]}
              placeholder="Workout name"
              placeholderTextColor={t.ts}
              value={customName}
              onChangeText={setCustomName}
              selectTextOnFocus
            />
            {activeProgram && (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => setAssocProgramId(addToActive ? null : activeProgram.id)}
                style={[styles.cnToggleRow, { borderTopColor: t.div, borderBottomColor: t.div }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cnToggleTitle, { color: t.tp }]}>Add to {activeProgram.name}</Text>
                  <Text style={[styles.cnToggleSub, { color: t.ts }]}>Saves stats under this program in your journal</Text>
                </View>
                <View style={[styles.cnToggle, addToActive
                  ? { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }
                  : { backgroundColor: "transparent", borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)" }
                ]}>
                  {addToActive && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.confirmRow, !customName.trim() && { opacity: 0.35 }]}>
            <BounceButton onPress={() => { if (customName.trim()) { dismiss(); onSelect(customName.trim(), assocProgramId ?? undefined, undefined); } }}>
              <View style={styles.confirmBtn}>
                <Text style={styles.confirmBtnText}>Custom Workout</Text>
              </View>
            </BounceButton>
          </View>
        </>
      );
    }

    return null;
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismiss} />
          <Animated.View style={[styles.pickerSheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 8, transform: [{ translateY: slideY }] }]}>
            <View {...panResponder.panHandlers}>
              <View style={styles.handleArea}><View style={styles.handle} /></View>
            </View>
            {renderStep()}
            <View style={{ height: 8 }} />
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [workoutHistory, setWorkoutHistory] = useState<CompletedWorkout[]>([]);
  const [workoutDates, setWorkoutDates] = useState<string[]>([]);
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [activeProgram, setActiveProgram] = useState<SavedProgram | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null);
  const [workoutPickerVisible, setWorkoutPickerVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(JOURNAL_KEY)
        .then(raw => { if (raw) setEntries(JSON.parse(raw)); })
        .catch((e) => warnStorage("getItem", JOURNAL_KEY, e));
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY)
        .then(raw => { if (raw) setWorkoutHistory(JSON.parse(raw)); })
        .catch((e) => warnStorage("getItem", WORKOUT_HISTORY_KEY, e));
      AsyncStorage.getItem(WORKOUT_DATES_KEY)
        .then(raw => { if (raw) setWorkoutDates(JSON.parse(raw)); })
        .catch((e) => warnStorage("getItem", WORKOUT_DATES_KEY, e));
      AsyncStorage.getItem(PROGRAMS_KEY)
        .then(raw => {
          if (!raw) return;
          const progs: SavedProgram[] = JSON.parse(raw);
          setPrograms(progs);
          setActiveProgram(progs.find(p => p.status === "active") ?? null);
        })
        .catch((e) => warnStorage("getItem", PROGRAMS_KEY, e));
    }, [])
  );

  // Optimistic UI update with rollback on storage failure — keeps the list
  // responsive while ensuring AsyncStorage stays in sync. Previously the
  // setItem was uncaught, so a failed write would leave UI and disk diverging.
  const saveEntries = async (updated: JournalEntry[]) => {
    const previous = entries;
    setEntries(updated);
    try {
      await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(updated));
      // Back up promptly. Journal was the one user-data write that didn't
      // schedule a push, so a new/edited/deleted entry only reached the cloud
      // incidentally (a later workout/program write, or the background flush) —
      // a reinstall in between lost it. Same debounced full-snapshot push every
      // other write site uses; a no-op when signed out / wrong cache owner.
      scheduleCloudPush();
    } catch (e) {
      warnStorage("setItem", JOURNAL_KEY, e);
      setEntries(previous);
    }
  };

  const handleCalendarDayPress = useCallback((date: string, workoutId?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (workoutId) {
      router.navigate({ pathname: "/workout-detail", params: { id: workoutId } });
    } else {
      setSelectedDate(date);
      setWorkoutPickerVisible(true);
    }
  }, [router]);

  const handleWorkoutSelect = useCallback((
    workoutName: string,
    addToProgramId?: string,
    fromProgramId?: string,
    dayId?: string,
  ) => {
    router.navigate({
      pathname: "/log-workout",
      params: {
        date: selectedDate,
        workoutName,
        programId: fromProgramId ?? "",
        addToProgramId: addToProgramId ?? "",
        // The exact slot picked, so the backdated session attaches to that day
        // rather than to whichever day happens to share its name.
        dayId: dayId ?? "",
      },
    });
  }, [router, selectedDate]);

  // The program row under each workout card (program, which session, the
  // track). Shared with the trainer's view of a client's journal, which draws
  // the same card from the client's history.
  const workoutInfoOf = useJournalWorkoutInfo(workoutHistory, programs);

  // Journal entries and completed workouts as one newest-first list. The merge
  // lives in utils/journalFeed.ts, shared with the client-side journal a trainer
  // reads — only the window differs (two weeks here, a month there).
  const timeline = useMemo(
    () => buildJournalFeed({ entries, workouts: workoutHistory, windowDays: 14 }),
    [entries, workoutHistory],
  );

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Pastel glow matching the blush Journal orb on Home */}
      <AuroraBackdrop dark={isDark} tint="blush" />

      {/* Top gradient blur */}
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

      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 14, left: 20, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
          <Ionicons name="chevron-back" size={22} color={t.tp} />
        </View>
      </TouchableOpacity>


      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      >
        {/* Page header */}
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>JOURNAL</Text>
          <View style={{ width: 66 }} />
        </View>

        {/* Monthly activity calendar */}
        <JournalCalendar
          isDark={isDark}
          workoutDates={workoutDates}
          workoutHistory={workoutHistory}
          activeProgram={activeProgram}
          onDayPress={handleCalendarDayPress}
        />

        {/* Programs shortcut */}
        <View style={styles.programsBlock}>
          <View style={styles.programsHeadingRow}>
            {activeProgram && (
              <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Active Program</Text>
            )}
            <BounceButton onPress={() => router.navigate("/program-history")} accessibilityLabel="View all programs" accessibilityRole="button">
              <View style={[styles.allProgramsBtn, { backgroundColor: t.ctrl }]}>
                <Text style={[styles.allProgramsText, { color: t.tp }]}>All Programs</Text>
                <Ionicons name="chevron-forward" size={14} color={t.tp} />
              </View>
            </BounceButton>
          </View>
          {activeProgram && (
            <BounceButton
              style={{ marginBottom: 10 }}
              onPress={() => router.navigate({ pathname: "/program-history-detail", params: { programId: activeProgram.id } })}
            >
              <NeuCard dark={isDark} style={styles.activeProgramCard}>
                <View style={styles.apCardInner}>
                  <View style={styles.apNameRow}>
                    <Text style={[styles.apName, { color: t.tp, flex: 1 }]} numberOfLines={1}>{activeProgram.name}</Text>
                    <ActiveBadge />
                    <Ionicons name="chevron-forward" size={16} color={t.ts} style={{ marginLeft: 6 }} />
                  </View>
                  <Text style={[styles.apSub, { color: t.ts }]}>
                    Week {getCurrentWeek(activeProgram)} of {activeProgram.totalWeeks}
                  </Text>
                  <View style={styles.apDateRow}>
                    <Ionicons name="calendar-outline" size={13} color={t.ts} />
                    <Text style={[styles.apDate, { color: t.ts }]}>Started {activeProgram.startDate}</Text>
                  </View>
                  <View style={styles.apProgressRow}>
                    {Array.from({ length: activeProgram.totalWeeks }).map((_, i) => {
                      const filled = i < getCurrentWeek(activeProgram);
                      return (
                        <View
                          key={i}
                          style={[
                            styles.apProgressSeg,
                            { backgroundColor: filled ? ACCT : t.div },
                            filled && { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 },
                          ]}
                        />
                      );
                    })}
                  </View>
                </View>
              </NeuCard>
            </BounceButton>
          )}
        </View>

        {/* Recent activity heading */}
        {timeline.length > 0 && (
          <Text style={[styles.sectionHeading, { color: t.tp }]}>Recent Activity</Text>
        )}

        {/* Empty state */}
        {timeline.length === 0 && (
          <NeuCard dark={isDark} style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyOrbGlow, {
                backgroundColor: ORB_GRADS.blush.glow,
                shadowColor: ORB_GRADS.blush.glow,
                shadowOpacity: isDark ? 0.45 : 0.55,
              }]}>
                <LinearGradient
                  colors={ORB_GRADS.blush.colors}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={[styles.emptyOrb, { borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.65)" }]}
                >
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                    <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M9 7h6M9 11h4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
                  </Svg>
                </LinearGradient>
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>Nothing here yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>Completed workouts and journal entries will appear here.</Text>
            </View>
          </NeuCard>
        )}

        {/* Unified timeline */}
        {timeline.map(item => {
          if (item.kind === "workout") {
            const w = item.data;
            return (
              <JournalWorkoutCard
                key={w.id}
                workout={w}
                info={workoutInfoOf(w)}
                isDark={isDark}
                onPress={() => router.navigate({ pathname: "/workout-detail", params: { id: w.id } })}
              />
            );
          }

          const entry = item.data;
          return (
            <BounceButton key={entry.id} style={{ marginBottom: 12 }}>
              <NeuCard dark={isDark} style={[styles.entryCard, { marginBottom: 0 }]}>
                <View style={styles.entryInner}>
                  <View style={styles.entryMain}>
                    <View style={styles.entryTopRow}>
                      <Text style={[styles.entryTitle, { color: t.tp }]} numberOfLines={1}>{entry.title}</Text>
                      <TouchableOpacity
                        onPress={() => setDeleteTarget(entry)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                      >
                        <TrashIcon size={18} color={t.ts} />
                      </TouchableOpacity>
                    </View>
                    {entry.body.length > 0 && (
                      <Text style={[styles.entryPreview, { color: t.ts }]} numberOfLines={2}>{entry.body}</Text>
                    )}
                    <View style={[styles.entryMeta, { borderTopColor: t.div }]}>
                      <Ionicons name="time-outline" size={13} color={t.ts} />
                      <Text style={[styles.entryMetaText, { color: t.ts }]}>{formatTimeAgo(entry.createdAt)}</Text>
                      <Text style={[styles.entryDot, { color: t.div }]}>·</Text>
                      <Text style={[styles.entryMetaText, { color: t.ts }]}>{formatEntryDate(entry.createdAt)}</Text>
                    </View>
                  </View>
                </View>
              </NeuCard>
            </BounceButton>
          );
        })}
      </ScrollView>

      <DeleteSheet
        visible={deleteTarget !== null}
        isDark={isDark}
        entryTitle={deleteTarget?.title ?? ""}
        onConfirm={() => { if (deleteTarget) saveEntries(entries.filter(e => e.id !== deleteTarget.id)); }}
        onClose={() => setDeleteTarget(null)}
      />

      <WorkoutPickerSheet
        visible={workoutPickerVisible}
        isDark={isDark}
        activeProgram={activeProgram}
        programs={programs}
        onSelect={handleWorkoutSelect}
        onClose={() => setWorkoutPickerVisible(false)}
      />

    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scroll: { paddingHorizontal: 20 },

  header:      { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 24 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1, color: TP },

  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18, color: TP, marginTop: 24, marginBottom: 12 },

  programsBlock:       { marginTop: 20, marginBottom: 4 },
  programsHeadingRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  activeProgramCard:{ borderRadius: 20 },
  apCardInner:      { padding: 18, gap: 8 },
  apNameRow:        { flexDirection: "row", alignItems: "center", gap: 8 },
  apName:           { fontFamily: FontFamily.bold, fontSize: 16, color: TP },
  // Fully rounded like every other button in the app. paddingHorizontal goes up
  // with it: rounded ends eat into the usable width, so the same 10 that looked
  // balanced at radius 10 reads tight on a pill.
  apSub:            { fontFamily: FontFamily.regular, fontSize: 13, color: TS },
  apDateRow:        { flexDirection: "row", alignItems: "center", gap: 6 },
  apDate:           { fontFamily: FontFamily.regular, fontSize: 13, color: TS },
  apProgressRow:    { flexDirection: "row", gap: 4, marginTop: 4 },
  apProgressSeg:    { flex: 1, height: 6, borderRadius: 3 },
  // Flat chrome pill (background from t.ctrl inline), matching the "+ New"
  // button on My Programs rather than the neumorphic card it used to be.
  allProgramsBtn:      { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 50, paddingVertical: 7, paddingHorizontal: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  allProgramsText:     { fontFamily: FontFamily.bold, fontSize: 14, letterSpacing: 0.2 },

  emptyCard:    { borderRadius: 24, marginBottom: 20 },
  emptyInner:   { padding: 32, alignItems: "center", gap: 12 },
  emptyOrbGlow: { width: 56, height: 56, borderRadius: 28, shadowOffset: { width: 0, height: 5 }, shadowRadius: 10, marginBottom: 4 },
  emptyOrb:     { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center" },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 14, color: TS, textAlign: "center", lineHeight: 20 },

  // Journal entry card
  entryCard:    { borderRadius: 20 },
  entryInner:   { padding: 18 },
  entryMain:    { gap: 8 },
  entryTopRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  entryTitle:   { fontFamily: FontFamily.semibold, fontSize: 16, color: TP, flex: 1 },
  entryPreview: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, lineHeight: 20 },
  entryMeta:    { flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 10, borderTopWidth: 1, borderTopColor: DIV },
  entryMetaText:{ fontFamily: FontFamily.regular, fontSize: 12, color: TS },
  entryDot:     { fontFamily: FontFamily.regular, fontSize: 12, color: DIV },

  // Bottom sheet shared
  backdrop:    { backgroundColor: "rgba(0,0,0,0.45)" },
  handleArea:  { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },

  // Delete sheet
  deleteSheet:    { position: "absolute", bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  deleteTitle:    { fontFamily: FontFamily.bold, fontSize: 20, color: TP },
  deleteSubtitle: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, lineHeight: 20 },
  deleteBtn:      { ...pill(PILL_H_SM), backgroundColor: "#FF3B30", ...pillGlow("#FF3B30", 0.35) },
  deleteBtnText:  { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff" },
  cancelBtn:      { ...pill(PILL_H_SM) },
  cancelBtnText:  { fontFamily: FontFamily.bold, fontSize: 16, color: TP },

  // Workout picker sheet
  pickerSheet:       { borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  pickerTitle:       { fontFamily: FontFamily.bold, fontSize: 20, color: TP, paddingHorizontal: 24, paddingBottom: 12, textAlign: "center" },
  pickerContent:     { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  pickerSection:     { fontFamily: FontFamily.bold, fontSize: 13, letterSpacing: 0.8, color: TS, marginTop: 8, marginBottom: 12 },
  pickerOptionInner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  pickerOptionText:  { fontFamily: FontFamily.semibold, fontSize: 15, color: TP, flex: 1 },
  pickerOptionSub:   { fontFamily: FontFamily.regular, fontSize: 12, color: TS, marginTop: 2 },
  pickerMenuContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20 },
  pickerStepHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  pickerBackBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  pickerStepTitle:   { fontFamily: FontFamily.bold, fontSize: 17, color: TP, textAlign: "center", flex: 1 },
  customInput:       { fontFamily: FontFamily.regular, fontSize: 16, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 4 },
  confirmRow:        { alignItems: "center", paddingTop: 16, paddingBottom: 4 },
  confirmBtn:        { borderRadius: 50, paddingVertical: 13, paddingHorizontal: 40, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10 },
  confirmBtnText:    { fontFamily: FontFamily.semibold, fontSize: 16, color: "#fff" },
  cnToggleRow:       { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 4, paddingVertical: 16, marginTop: 12, borderTopWidth: 1, borderBottomWidth: 1 },
  cnToggleTitle:     { fontFamily: FontFamily.semibold, fontSize: 15 },
  cnToggleSub:       { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },
  cnToggle:          { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },

});
