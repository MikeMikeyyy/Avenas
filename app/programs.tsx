import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Animated, PanResponder, Easing, Alert } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";
import Svg, { Path } from "react-native-svg";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { APP_LIGHT, APP_DARK, FontFamily, Colors, ACCT } from "../constants/theme";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import TrashIcon from "../components/TrashIcon";
import { useTheme } from "../contexts/ThemeContext";

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function DumbbellIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
}


const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseStoredDate(dateStr: string): Date {
  const parts = dateStr.split(" ");
  const day = parseInt(parts[0], 10);
  const month = MONTH_NAMES.indexOf(parts[1]);
  const year = parseInt(parts[2], 10);
  return new Date(year, month < 0 ? 0 : month, day);
}

// ─── Set Workout Picker ────────────────────────────────────────────────────────

interface SetWorkoutPickerProps {
  visible: boolean;
  program: SavedProgram;
  isDark: boolean;
  onConfirm: (dayIndex: number) => void;
  onClose: () => void;
}

function SetWorkoutPicker({ visible, program, isDark, onConfirm, onClose }: SetWorkoutPickerProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<number | null>(null);
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

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 800, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(); });
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
    dismiss();
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <View style={styles.swBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.swOverlay, { opacity: backdropOpacity }]} />
        <Animated.View style={[styles.swSheet, { backgroundColor: t.bg, transform: [{ translateY: slideY }] }]}>
          {/* Drag handle */}
          <View {...panResponder.panHandlers} style={styles.swHandleArea}>
            <View style={[styles.swHandle, { backgroundColor: t.div }]} />
          </View>
          {/* Header */}
          <View style={[styles.swHeader, { borderBottomColor: t.div }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.swTitle, { color: t.tp }]}>Which day is it today?</Text>
              <Text style={[styles.swSubtitle, { color: t.ts }]} numberOfLines={2}>
                Pick where you are in your '{program.name}' cycle
              </Text>
            </View>
            <TouchableOpacity onPress={dismiss} style={styles.swClose} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={t.tp} />
            </TouchableOpacity>
          </View>
          {/* Day list */}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            {program.cyclePattern.map((day, index) => {
              const isTraining = day !== "Rest";
              const isSelected = selected === index;
              return (
                <TouchableOpacity key={index} onPress={() => setSelected(index)} activeOpacity={0.7}>
                  <View style={[styles.swDayRow, { borderBottomColor: t.div }, isSelected && { backgroundColor: ACCT + "18" }]}>
                    <View style={[styles.swDayBadge, { backgroundColor: isSelected ? ACCT : t.div }]}>
                      <Text style={[styles.swDayBadgeText, { color: isSelected ? "#fff" : t.ts }]}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.swDayName, { color: isTraining ? t.tp : t.ts }]}>{day}</Text>
                      {!isTraining && <Text style={[styles.swRestLabel, { color: t.ts }]}>Rest day</Text>}
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={ACCT} />}
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
  const dotPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(scale, { toValue: 1,    duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(dotPulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
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
  onEdit: () => void;
  onSetWorkout: () => void;
}

const ActiveProgramCard = React.memo(function ActiveProgramCard({ program, isDark, onEdit, onSetWorkout }: ActiveProgramCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <NeuCard dark={isDark} style={styles.activeProgramCard}>
      <TouchableOpacity activeOpacity={0.8} onPress={() => setIsExpanded(v => !v)}>
        <View style={styles.activeProgramInner}>
          <View style={styles.rowBetween}>
            <Text style={[styles.activeProgramName, { color: t.tp }]} numberOfLines={1}>
              {program.name}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActiveBadge />
              <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={t.ts} />
            </View>
          </View>

          <View style={styles.progressRow}>
            {Array.from({ length: program.totalWeeks }).map((_, i) => (
              <View key={i} style={[styles.progressSeg, { backgroundColor: i < program.currentWeek ? ACCT : isDark ? "rgba(255,255,255,0.1)" : t.div }, i < program.currentWeek && { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 }]} />
            ))}
          </View>
          <Text style={[styles.weekLabel, { color: t.ts }]}>Week {program.currentWeek} of {program.totalWeeks}</Text>

          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={14} color={t.ts} />
            <Text style={[styles.metaText, { color: t.ts }]}>Started {program.startDate}</Text>
            <View style={styles.metaDot} />
            <DumbbellIcon size={14} color={t.ts} />
            <Text style={[styles.metaText, { color: t.ts }]}>{program.trainingDays} days / {program.cycleDays} day cycle</Text>
          </View>

          <View style={styles.cycleGrid}>
            {chunk(program.cyclePattern, 5).map((row, rowIdx) => (
              <View key={rowIdx} style={styles.cycleRow}>
                {row.map((day, i) => {
                  const isTraining = day !== "Rest";
                  return (
                    <View
                      key={i}
                      style={[
                        styles.cycleChip,
                        { backgroundColor: isTraining ? ACCT + "22" : t.div },
                        isTraining && { borderColor: ACCT, borderWidth: 1 },
                      ]}
                    >
                      <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                        {day}
                      </Text>
                    </View>
                  );
                })}
                {Array.from({ length: 5 - row.length }).map((_, i) => (
                  <View key={`ph-${i}`} style={[styles.cycleChip, { opacity: 0 }]} />
                ))}
              </View>
            ))}
          </View>
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <View style={[styles.cardActions, { borderTopColor: t.div }]}>
          <View style={styles.activeBtnRow}>
            <BounceButton style={{ flex: 1 }} onPress={onSetWorkout} accessibilityLabel="Set workout day" accessibilityRole="button">
              <View style={styles.activePrimaryBtnWrap}>
                <View style={styles.activePrimaryBtn}>
                  <Ionicons name="calendar-outline" size={16} color="#fff" />
                  <Text style={styles.activePrimaryBtnText}>Set Workout</Text>
                </View>
              </View>
            </BounceButton>
            <BounceButton style={{ flex: 1 }} onPress={onEdit} accessibilityLabel="Edit program" accessibilityRole="button">
              <NeuCard dark={isDark} radius={14} innerStyle={styles.activeSecondaryBtnInner}>
                <Ionicons name="create-outline" size={16} color={t.tp} />
                <Text style={[styles.activeSecondaryBtnText, { color: t.tp }]}>Edit</Text>
              </NeuCard>
            </BounceButton>
          </View>
        </View>
      )}
    </NeuCard>
  );
});

// ─── Program Card ──────────────────────────────────────────────────────────────

interface ProgramCardProps {
  program: SavedProgram;
  isDark: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onMakeActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const ProgramCard = React.memo(function ProgramCard({ program, isDark, isExpanded, onToggle, onMakeActive, onEdit, onDelete }: ProgramCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;

  const filledWeeks = program.status === "completed" ? program.totalWeeks : program.currentWeek;
  const statusColor =
    program.status === "active"    ? ACCT :
    program.status === "paused"    ? Colors.warning : t.ts;
  const statusLabel =
    program.status === "active"    ? "Active" :
    program.status === "paused"    ? "Paused" :
    program.status === "created"   ? "Not Started" : "Completed";
  const weekText =
    program.status === "completed" ? `Completed ${program.totalWeeks} of ${program.totalWeeks} weeks` :
    program.status === "created"   ? `${program.totalWeeks} weeks planned` :
    `Week ${program.currentWeek} of ${program.totalWeeks}`;
  const dateLabel = program.status === "created" ? "Created" : "Started";

  return (
    <NeuCard dark={isDark} style={styles.programCard}>
      <TouchableOpacity activeOpacity={0.8} onPress={onToggle}>
        <View style={styles.programCardInner}>
          <View style={styles.rowBetween}>
            <Text style={[styles.programName, { color: t.tp }]} numberOfLines={1}>{program.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[styles.statusBadge, { borderColor: statusColor }]}>
                <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={t.ts} />
            </View>
          </View>

          <View style={styles.progressRow}>
            {Array.from({ length: program.totalWeeks }).map((_, i) => (
              <View key={i} style={[styles.progressSeg, { backgroundColor: i < filledWeeks ? statusColor : isDark ? "rgba(255,255,255,0.1)" : t.div }, i < filledWeeks && program.status !== "completed" && { shadowColor: statusColor, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 }]} />
            ))}
          </View>
          <Text style={[styles.weekLabel, { color: t.ts }]}>{weekText}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={13} color={t.ts} />
            <Text style={[styles.metaText, { color: t.ts }]}>{dateLabel} {program.startDate}</Text>
            <View style={styles.metaDot} />
            <DumbbellIcon size={13} color={t.ts} />
            <Text style={[styles.metaText, { color: t.ts }]}>{program.trainingDays} days / {program.cycleDays} day cycle</Text>
          </View>
          <View style={styles.cycleGrid}>
            {chunk(program.cyclePattern, 5).map((row, rowIdx) => (
              <View key={rowIdx} style={styles.cycleRow}>
                {row.map((day, i) => {
                  const isTraining = day !== "Rest";
                  return (
                    <View
                      key={i}
                      style={[
                        styles.cycleChip,
                        { backgroundColor: isTraining ? statusColor + "22" : t.div },
                        isTraining && { borderColor: statusColor, borderWidth: 1 },
                      ]}
                    >
                      <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                        {day}
                      </Text>
                    </View>
                  );
                })}
                {Array.from({ length: 5 - row.length }).map((_, i) => (
                  <View key={`ph-${i}`} style={[styles.cycleChip, { opacity: 0 }]} />
                ))}
              </View>
            ))}
          </View>
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <View style={[styles.cardActions, { borderTopColor: t.div }]}>
          <BounceButton onPress={onMakeActive} style={{ marginBottom: 10 }}>
            <View style={styles.activePrimaryBtnWrap}>
              <View style={styles.activePrimaryBtn}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                <Text style={styles.activePrimaryBtnText}>Make Active Program</Text>
              </View>
            </View>
          </BounceButton>
          <View style={styles.activeBtnRow}>
            <BounceButton style={{ flex: 1 }} onPress={onEdit}>
              <NeuCard dark={isDark} radius={14} innerStyle={styles.activeSecondaryBtnInner}>
                <Ionicons name="create-outline" size={16} color={t.tp} />
                <Text style={[styles.activeSecondaryBtnText, { color: t.tp }]}>Edit</Text>
              </NeuCard>
            </BounceButton>
            <BounceButton style={{ flex: 1 }} onPress={onDelete}>
              <NeuCard dark={isDark} radius={14} innerStyle={styles.activeSecondaryBtnInner}>
                <TrashIcon size={16} color="#E53935" />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </NeuCard>
            </BounceButton>
          </View>
        </View>
      )}
    </NeuCard>
  );
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProgramsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [setWorkoutOpen, setSetWorkoutOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleMakeActive = async (program: SavedProgram) => {
    const updated = programs.map(p => ({
      ...p,
      status: p.id === program.id ? "active" as const : p.status === "active" ? (p.currentWeek > 1 ? "paused" as const : "created" as const) : p.status,
    }));
    setPrograms(updated);
    setExpandedId(null);
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
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
            setExpandedId(null);
            await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
          },
        },
      ]
    );
  };

  const handleSetWorkoutDay = async (targetDayIndex: number) => {
    if (!activeProgram) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = parseStoredDate(activeProgram.startDate);
    start.setHours(0, 0, 0, 0);
    const daysPassed = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const naturalDayIndex = ((daysPassed % activeProgram.cycleDays) + activeProgram.cycleDays) % activeProgram.cycleDays;
    const cycleOffset = ((targetDayIndex - naturalDayIndex) % activeProgram.cycleDays + activeProgram.cycleDays) % activeProgram.cycleDays;
    const updated = programs.map(p =>
      p.id === activeProgram.id ? { ...p, cycleOffset } : p
    );
    setPrograms(updated);
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
  };

  // DEV SEED — remove after testing
  useEffect(() => {
    AsyncStorage.getItem(PROGRAMS_KEY).then(raw => {
      if (!raw) return;
      const programs: SavedProgram[] = JSON.parse(raw);
      const needsPatch = programs.some(p => p.name === "TEST" && (p.currentWeek !== 3 || p.status !== "paused"));
      if (!needsPatch) return;
      const patched = programs.map(p =>
        p.name === "TEST" ? { ...p, currentWeek: 3, status: "paused" as const } : p
      );
      AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(patched));
    }).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(PROGRAMS_KEY).then(raw => {
      if (!raw) { setPrograms([]); return; }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setPrograms(parsed as SavedProgram[]);
      } catch { setPrograms([]); }
    }).catch(() => {});
  }, []));

  const activeProgram = programs.find((p) => p.status === "active") ?? null;
  const totalCount = programs.length;
  const weeksTrained = programs.reduce((sum, p) =>
    sum + (p.status === "completed" ? p.totalWeeks : p.currentWeek), 0);
  const completedCount = programs.filter((p) => p.status === "completed").length;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
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

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFillObject} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      <ScrollView
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
            <Text style={[styles.sectionLabel, { color: t.ts }]}>ACTIVE</Text>
            <ActiveProgramCard
              program={activeProgram}
              isDark={isDark}
              onEdit={() => router.push({ pathname: "/new-program", params: { id: activeProgram.id } })}
              onSetWorkout={() => setSetWorkoutOpen(true)}
            />
          </>
        )}

        {/* All programs */}
        <View style={[styles.rowBetween, { marginBottom: 12 }]}>
          <Text style={[styles.sectionLabel, { color: t.ts, marginBottom: 0 }]}>ALL PROGRAMS</Text>
          <BounceButton onPress={() => router.push("/new-program")} accessibilityLabel="Create new program" accessibilityRole="button">
            <View style={styles.newProgramBtn}>
              <Ionicons name="add" size={14} color="#fff" />
              <Text style={styles.newProgramBtnText}>New</Text>
            </View>
          </BounceButton>
        </View>
        {programs.filter(p => p.status !== "active").length === 0 ? (
          <NeuCard dark={isDark} style={{ borderRadius: 20, marginBottom: 12 }}>
            <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
              <Ionicons name="barbell-outline" size={32} color={t.ts} />
              <Text style={{ fontFamily: FontFamily.semibold, fontSize: 15, color: t.tp, textAlign: "center" }}>No programs yet</Text>
              <Text style={{ fontFamily: FontFamily.regular, fontSize: 13, color: t.ts, textAlign: "center" }}>Tap New to create your first program</Text>
            </View>
          </NeuCard>
        ) : (
          programs.filter(p => p.status !== "active").map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              isDark={isDark}
              isExpanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              onMakeActive={() => handleMakeActive(p)}
              onEdit={() => router.push({ pathname: "/new-program", params: { id: p.id } })}
              onDelete={() => handleDeleteProgram(p)}
            />
          ))
        )}
      </ScrollView>

      {activeProgram && setWorkoutOpen && (
        <SetWorkoutPicker
          visible={setWorkoutOpen}
          program={activeProgram}
          isDark={isDark}
          onConfirm={handleSetWorkoutDay}
          onClose={() => setSetWorkoutOpen(false)}
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
  screenTitle:        { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1 },

  statsCard:          { marginBottom: 24, borderRadius: 20 },
  statsRow:           { flexDirection: "row" },
  statCell:           { flex: 1, flexDirection: "row" },
  divider:            { width: 1, height: 40, alignSelf: "center" },
  statContent:        { flex: 1, alignItems: "center", paddingVertical: 20, gap: 4 },
  statValue:          { fontFamily: FontFamily.bold, fontSize: 22 },
  statLabel:          { fontFamily: FontFamily.regular, fontSize: 14 },

  sectionLabel:       { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 },

  activeProgramCard:  { marginBottom: 20, borderRadius: 20 },
  activeProgramInner: { padding: 20, gap: 14 },
  activeProgramName:  { fontFamily: FontFamily.bold, fontSize: 18, flex: 1, marginRight: 8 },
  activeBtnRow:           { flexDirection: "row", gap: 10 },
  activePrimaryBtnWrap:   { borderRadius: 14, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  activePrimaryBtn:       { borderRadius: 14, backgroundColor: ACCT, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  activePrimaryBtnText:   { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff", letterSpacing: 0.2 },
  activeSecondaryBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13 },
  activeSecondaryBtnText:  { fontFamily: FontFamily.bold, fontSize: 14, letterSpacing: 0.2, lineHeight: 20 },

  programCard:        { marginBottom: 12, borderRadius: 20 },
  programCardInner:   { padding: 16, gap: 10 },
  programName:        { fontFamily: FontFamily.semibold, fontSize: 15, flex: 1, marginRight: 8 },
  statusBadge:        { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText:    { fontFamily: FontFamily.semibold, fontSize: 12 },
  activeBadge:        { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: ACCT, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, shadowColor: ACCT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 10 },
  activeBadgeDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  activeBadgeText:    { fontFamily: FontFamily.bold, fontSize: 12, color: "#fff", letterSpacing: 0.3 },

  rowBetween:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  progressRow:        { flexDirection: "row", gap: 4 },
  progressSeg:        { flex: 1, height: 6, borderRadius: 3 },
  weekLabel:          { fontFamily: FontFamily.regular, fontSize: 13 },
  metaRow:            { flexDirection: "row", alignItems: "center", gap: 6 },
  metaDot:            { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#8896A7" },
  metaText:           { fontFamily: FontFamily.regular, fontSize: 13 },
  newProgramBtn:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: ACCT, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 8 },
  newProgramBtnText:  { fontFamily: FontFamily.semibold, fontSize: 12, color: "#fff" },
  cardActions:        { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 0 },
  deleteBtnText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#E53935", letterSpacing: 0.2 },

  cycleGrid:          { gap: 4 },
  cycleRow:           { flexDirection: "row", gap: 4 },
  cycleChip:          { flex: 1, alignItems: "center", paddingVertical: 6, paddingHorizontal: 2, borderRadius: 8 },
  cycleChipText:      { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },

  // Set Workout Picker
  swBackdrop:         { flex: 1, justifyContent: "flex-end" },
  swOverlay:          { backgroundColor: "rgba(0,0,0,0.45)" },
  swSheet:            { height: "80%", borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  swHandleArea:       { paddingVertical: 12, alignItems: "center" },
  swHandle:           { width: 40, height: 4, borderRadius: 2 },
  swHeader:           { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  swTitle:            { fontFamily: FontFamily.bold, fontSize: 18, marginBottom: 4 },
  swSubtitle:         { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  swClose:            { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginTop: -4 },
  swDayRow:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  swDayBadge:         { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  swDayBadgeText:     { fontFamily: FontFamily.bold, fontSize: 13 },
  swDayName:          { fontFamily: FontFamily.semibold, fontSize: 15 },
  swRestLabel:        { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  swFooter:           { paddingHorizontal: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  swConfirmWrap:      { borderRadius: 16, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  swConfirmBtn:       { borderRadius: 16, backgroundColor: ACCT, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  swConfirmText:      { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff", letterSpacing: 0.2 },
});
