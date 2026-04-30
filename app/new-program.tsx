import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, interpolateColor, LinearTransition, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert,
  Platform,
  Keyboard,
  Animated,
  Easing,
  PanResponder,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useNavigation, useFocusEffect, useLocalSearchParams } from "expo-router";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../constants/theme";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { PROGRAMS_KEY, type SavedProgram, type Exercise, type ProgramSet, type WorkoutMap, normaliseSets } from "../constants/programs";
import NeuCard from "../components/NeuCard";
import TrashIcon from "../components/TrashIcon";
import BounceButton from "../components/BounceButton";
import ExercisePicker from "../components/ExercisePicker";
import CollapsibleCard from "../components/CollapsibleCard";
import { useTheme } from "../contexts/ThemeContext";

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAFT_KEY = "@avenas/new_program_draft";

// ─── Icons ────────────────────────────────────────────────────────────────────

function DumbbellIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
}

function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4"/>
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramDraft = {
  step: 1 | 2;
  name: string;
  totalWeeks: number;
  cycleDays: number;
  cyclePattern: string[];
  isTrainingDay: boolean[];
  workouts: WorkoutMap;
  editId?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

// Returns a unique key per training day in format "index:label"
function trainingDayKeys(names: string[], isTraining: boolean[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < isTraining.length; i++) {
    if (!isTraining[i]) continue;
    const label = names[i].trim() || "Workout";
    result.push(`${i}:${label}`);
  }
  return result;
}

// Extracts the display label from a day key ("3:Push" → "Push")
function dayLabel(key: string): string {
  return key.split(":").slice(1).join(":");
}

// ─── Rest picker helpers ───────────────────────────────────────────────────────

const REST_ITEM_H = 38;
const REST_OPTIONS = [0, ...Array.from({ length: 60 }, (_, i) => (i + 1) * 5)];

function formatRest(secs: number): string {
  if (!secs) return "Off";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ─── Exercise Row ─────────────────────────────────────────────────────────────

const WARMUP_ORANGE = "#ffbf0f";

interface ExerciseRowProps {
  exercise: Exercise;
  exIndex: number;
  totalExercises: number;
  isFirst: boolean;
  isLast: boolean;
  isDark: boolean;
  onUpdate: (field: keyof Exercise, value: string | number | boolean) => void;
  onUpdateSets: (sets: ProgramSet[]) => void;
  onSetRemoved: (sets: ProgramSet[]) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
  onEdit: () => void;
}

function ExerciseRow({ exercise, exIndex, totalExercises, isFirst, isLast, isDark, onUpdate, onUpdateSets, onSetRemoved, onRemove, onMove, onEdit }: ExerciseRowProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;
  const restSecs = exercise.restSeconds ?? 0;
  const sets = normaliseSets(exercise);

  const [showRestPicker, setShowRestPicker] = useState(false);
  const restScrollOffset = useRef(0);
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(500)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const restPanResponder = useRef(
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
            Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); setShowRestPicker(false); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  const openRestPicker = useCallback(() => {
    const initialOffset = Math.max(0, REST_OPTIONS.indexOf(restSecs)) * REST_ITEM_H;
    scrollAnim.setValue(initialOffset);
    restScrollOffset.current = initialOffset;
    slideY.setValue(500);
    backdropOpacity.setValue(0);
    setShowRestPicker(true);
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, [slideY, backdropOpacity, scrollAnim, restSecs]);

  const closeRestPicker = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(500); backdropOpacity.setValue(0); setShowRestPicker(false); });
  }, [slideY, backdropOpacity]);

  const modeOffset     = useSharedValue(exercise.isIsometric ? 1 : 0);
  const modeTrackWidth = useSharedValue(0);
  const modePillStyle  = useAnimatedStyle(() => ({
    width: modeTrackWidth.value / 2,
    transform: [{ translateX: modeOffset.value * (modeTrackWidth.value / 2) }],
  }));
  const repsLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(modeOffset.value, [0, 1], ["#ffffff", isDark ? "#8896A7" : "#8896A7"]),
  }));
  const holdLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(modeOffset.value, [0, 1], [isDark ? "#8896A7" : "#8896A7", "#ffffff"]),
  }));

  const [collapsingSetIdx, setCollapsingSetIdx] = useState<number | null>(null);
  const prevSetCount = useRef(sets.length);
  const newlyAddedIdx = sets.length > prevSetCount.current ? sets.length - 1 : null;
  const setRowHeight = useRef(0);
  useEffect(() => { prevSetCount.current = sets.length; }, [sets.length]);

  // Pre-compute set labels (W for warmup, 1/2/3 for working)
  let wc = 0;
  const setLabels = sets.map(s => s.type === "warmup" ? "W" : String(++wc));

  const patchSet = useCallback((idx: number, patch: Partial<ProgramSet>) => {
    onUpdateSets(sets.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }, [sets, onUpdateSets]);

  // Rep mode is a single per-exercise choice driven from the header toggle.
  const currentRepMode: "target" | "range" = sets[0]?.repMode ?? "target";
  const RANGE_EXTENSION_WIDTH = 72;
  const rangeProgress = useSharedValue(currentRepMode === "range" ? 1 : 0);
  const rangeOuterStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, rangeProgress.value));
    return { width: p * RANGE_EXTENSION_WIDTH };
  });
  const rangeInnerStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, rangeProgress.value));
    return { opacity: p, transform: [{ scaleX: Math.max(p, 0.001) }] };
  });

  const toggleAllRepMode = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = currentRepMode === "target" ? "range" : "target";
    rangeProgress.value = withSpring(next === "range" ? 1 : 0, { damping: 22, stiffness: 300, mass: 0.9 });
    onUpdateSets(sets.map(s => ({ ...s, repMode: next })));
  }, [currentRepMode, sets, onUpdateSets]);


  return (
    <Reanimated.View layout={LinearTransition.duration(250)} style={styles.exRowWrap}>
      {/* Row 1: thumbnail + name + reorder + delete */}
      <View style={styles.exTopRow}>
        <NeuCard dark={isDark} radius={12} shadowSize="sm" style={styles.exThumb}>
          <View style={styles.exThumbInner}>
            <DumbbellIcon size={22} color={t.ts} />
          </View>
        </NeuCard>
        <TouchableOpacity onPress={onEdit} activeOpacity={0.7} style={styles.exNameBtn}>
          <Text style={[styles.exNumLabel, { color: t.ts }]}>EXERCISE {exIndex + 1} OF {totalExercises}</Text>
          <Text style={[styles.exName, { color: t.tp }]} numberOfLines={1} ellipsizeMode="tail">{exercise.name}</Text>
        </TouchableOpacity>
        <View style={styles.exArrows}>
          {!isFirst && (
            <TouchableOpacity onPress={() => onMove("up")} activeOpacity={0.7}>
              <Ionicons name="chevron-up" size={18} color={t.ts} />
            </TouchableOpacity>
          )}
          {!isLast && (
            <TouchableOpacity onPress={() => onMove("down")} activeOpacity={0.7}>
              <Ionicons name="chevron-down" size={18} color={t.ts} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={() =>
            Alert.alert("Remove Exercise", `Remove "${exercise.name}"?`, [
              { text: "Cancel", style: "cancel" },
              { text: "Remove", style: "destructive", onPress: onRemove },
            ])
          }
          activeOpacity={0.7}
        >
          <TrashIcon size={16} color="#FF4D4F" />
        </TouchableOpacity>
      </View>

      {/* Coaching notes */}
      <View style={[styles.exNotesRow, { borderTopColor: divider }]}>
        <TextInput
          style={[styles.exNotesInput, { color: t.tp }]}
          value={exercise.programNotes ?? ""}
          onChangeText={v => onUpdate("programNotes", v)}
          placeholder="Add Exercise Notes..."
          placeholderTextColor={t.ts}
          multiline
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
        />
      </View>

      {/* Row 2: compact rest timer chip + Reps/Hold toggle */}
      <View style={[styles.exCompactRow, { borderTopColor: divider }]}>
        <TouchableOpacity onPress={openRestPicker} activeOpacity={0.7} style={styles.exRestChipGroup}>
          <Text style={[styles.exRestLabel, { color: t.ts }]}>Rest Timer</Text>
          <View style={styles.exRestChip}>
            <Ionicons name="timer-outline" size={14} color={restSecs > 0 ? ACCT : t.ts} />
            <Text style={[styles.exRestChipText, { color: restSecs > 0 ? ACCT : t.ts }]}>{formatRest(restSecs)}</Text>
            <Ionicons name="chevron-down" size={12} color={restSecs > 0 ? ACCT : t.ts} />
          </View>
        </TouchableOpacity>
        <View
          style={[styles.exTogglePills, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div }]}
          onLayout={e => { modeTrackWidth.value = e.nativeEvent.layout.width - 6; }}
        >
          <Reanimated.View style={[styles.exTogglePillPill, modePillStyle]} />
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onUpdate("isIsometric", false);
              modeOffset.value = withSpring(0, { damping: 22, stiffness: 300, mass: 0.9 });
            }}
            style={styles.exTogglePill}
            activeOpacity={0.8}
          >
            <Reanimated.Text style={[styles.exTogglePillText, repsLabelColor]}>Reps</Reanimated.Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onUpdate("isIsometric", true);
              modeOffset.value = withSpring(1, { damping: 22, stiffness: 300, mass: 0.9 });
            }}
            style={styles.exTogglePill}
            activeOpacity={0.8}
          >
            <Reanimated.Text style={[styles.exTogglePillText, holdLabelColor]}>Hold</Reanimated.Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Column headers */}
      <View style={[styles.exSetHeaderRow, { borderTopColor: divider }]}>
        <View style={styles.exSetBadgeCol}>
          <Text style={[styles.exSetHeaderLabel, { color: t.ts, width: 28, textAlign: "center" }]}>Set</Text>
        </View>
        <View style={styles.exSetValueCol}>
          <Text style={[styles.exSetHeaderLabel, { color: t.ts }]}>Weight</Text>
        </View>
        <TouchableOpacity
          style={[styles.exSetValueCol, styles.exSetColRep, styles.exSetHeaderToggle]}
          onPress={toggleAllRepMode}
          activeOpacity={0.7}
        >
          <View style={styles.exSetHeaderToggleSpacer} />
          <Text style={[styles.exSetHeaderLabel, { color: t.ts }]}>
            {exercise.isIsometric
              ? (currentRepMode === "range" ? "Hold Range" : "Hold")
              : (currentRepMode === "range" ? "Rep Range" : "Reps")}
          </Text>
          <Ionicons name="chevron-down" size={12} color={t.ts} style={{ marginLeft: 2 }} />
        </TouchableOpacity>
      </View>

      {/* Set rows */}
      {sets.map((set, idx) => {
        const isWarmup = set.type === "warmup";
        const label = setLabels[idx];
        const repMode = set.repMode ?? currentRepMode;
        return (
          <CollapsibleCard
            key={idx}
            isCollapsing={idx === collapsingSetIdx}
            onCollapsed={() => { setCollapsingSetIdx(null); onSetRemoved(sets.slice(0, -1)); }}
            expanding={idx === newlyAddedIdx}
            naturalHeight={idx === newlyAddedIdx ? setRowHeight.current : undefined}
          >
          <View
            style={[styles.exSetRow, { borderTopColor: divider }]}
            onLayout={(idx !== newlyAddedIdx && idx !== collapsingSetIdx) ? e => { const h = e.nativeEvent.layout.height; if (h > 0) setRowHeight.current = h; } : undefined}
          >
            {/* Set type badge */}
            <View style={styles.exSetBadgeCol}>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  patchSet(idx, { type: isWarmup ? "working" : "warmup" });
                }}
                style={[styles.exSetBadge, { borderColor: isWarmup ? WARMUP_ORANGE : divider }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.exSetBadgeText, { color: isWarmup ? WARMUP_ORANGE : t.tp }]}>{label}</Text>
              </TouchableOpacity>
            </View>

            {/* Weight column */}
            <View style={styles.exSetValueCol}>
              <View style={styles.exSetUnitSpacer} />
              <View style={[styles.exSetInputBox, { borderColor: divider }]}>
                <TextInput
                  style={[styles.exSetInputText, { color: t.tp }]}
                  value={set.weightKg ?? ""}
                  onChangeText={v => patchSet(idx, { weightKg: v })}
                  placeholder="—"
                  placeholderTextColor={t.ts}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
              </View>
              <Text style={[styles.exSetUnit, { color: t.ts }]}>kg</Text>
            </View>

            {/* Rep column */}
            <View style={[styles.exSetValueCol, styles.exSetColRep]}>
              <View style={[styles.exSetInputBox, { borderColor: divider }]}>
                <TextInput
                  style={[styles.exSetInputText, { color: t.tp }]}
                  value={repMode === "target" ? (set.reps ?? "") : (set.repsMin ?? "")}
                  onChangeText={v => patchSet(idx, repMode === "target" ? { reps: v } : { repsMin: v })}
                  placeholder="—"
                  placeholderTextColor={t.ts}
                  keyboardType={exercise.isIsometric ? "number-pad" : "decimal-pad"}
                  selectTextOnFocus
                />
              </View>
              <Reanimated.View style={[{ overflow: "hidden" }, rangeOuterStyle]}>
                <Reanimated.View style={[{ flexDirection: "row", alignItems: "center", width: RANGE_EXTENSION_WIDTH, transformOrigin: "left" }, rangeInnerStyle]}>
                  <Text style={{ color: t.ts, fontSize: 13, fontFamily: FontFamily.semibold, marginHorizontal: 4 }}>–</Text>
                  <View style={[styles.exSetInputBox, { borderColor: divider }]}>
                    <TextInput
                      style={[styles.exSetInputText, { color: t.tp }]}
                      value={set.repsMax ?? ""}
                      onChangeText={v => patchSet(idx, { repsMax: v })}
                      placeholder="—"
                      placeholderTextColor={t.ts}
                      keyboardType="number-pad"
                      selectTextOnFocus
                    />
                  </View>
                </Reanimated.View>
              </Reanimated.View>
            </View>
          </View>
          </CollapsibleCard>
        );
      })}

      {/* Add / Remove row */}
      <View style={[styles.exAddRemoveRow, { borderTopColor: divider }]}>
        <BounceButton
          onPress={() => {
            if (sets.length <= 1 || collapsingSetIdx !== null) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setCollapsingSetIdx(sets.length - 1);
          }}
          style={{ opacity: sets.length <= 1 ? 0.35 : 1, flex: 1, marginRight: 6 }}
        >
          <NeuCard dark={isDark} radius={10} shadowSize="sm" style={{ borderRadius: 10 }}>
            <View style={styles.exAddRemoveBtn}>
              <Ionicons name="remove" size={14} color={t.ts} />
              <Text style={[styles.exAddRemoveText, { color: t.ts }]}>Remove Set</Text>
            </View>
          </NeuCard>
        </BounceButton>
        <BounceButton
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onUpdateSets([...sets, { type: "working" }]);
          }}
          style={{ flex: 1, marginLeft: 6 }}
        >
          <NeuCard dark={isDark} radius={10} shadowSize="sm" style={{ borderRadius: 10 }}>
            <View style={styles.exAddRemoveBtn}>
              <Ionicons name="add" size={14} color={ACCT} />
              <Text style={[styles.exAddRemoveText, { color: ACCT }]}>Add Set</Text>
            </View>
          </NeuCard>
        </BounceButton>
      </View>

      {/* Rest picker modal */}
      <Modal visible={showRestPicker} transparent animationType="none" onRequestClose={closeRestPicker}>
        <View style={styles.restBackdrop}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.restOverlay, { opacity: backdropOpacity }]} />
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeRestPicker} />
          <Animated.View style={[styles.restSheet, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, transform: [{ translateY: slideY }] }]}>
            <View {...restPanResponder.panHandlers} style={styles.restHandleArea}>
              <View style={[styles.restHandle, { backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)" }]} />
            </View>
            <View style={[styles.restHeader, { borderBottomColor: divider }]}>
              <Text style={[styles.restTitle, { color: t.tp, textAlign: 'center' }]}>Rest Timer</Text>
              <Text style={[styles.restSubtitle, { color: t.ts, textAlign: 'center' }]} numberOfLines={1}>{exercise.name}</Text>
            </View>
            <View style={styles.restPickerWrap}>
              <View pointerEvents="none" style={[styles.restSelTop, { borderColor: divider }]} />
              <View pointerEvents="none" style={[styles.restSelBottom, { borderColor: divider }]} />
              <Animated.ScrollView
                showsVerticalScrollIndicator={false}
                snapToInterval={REST_ITEM_H}
                decelerationRate="fast"
                contentContainerStyle={{ paddingVertical: REST_ITEM_H * 2 }}
                contentOffset={{ x: 0, y: Math.max(0, REST_OPTIONS.indexOf(restSecs)) * REST_ITEM_H }}
                scrollEventThrottle={16}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { y: scrollAnim } } }],
                  {
                    useNativeDriver: true,
                    listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
                      restScrollOffset.current = e.nativeEvent.contentOffset.y;
                    },
                  }
                )}
                onMomentumScrollEnd={(e) => {
                  const index = Math.round(e.nativeEvent.contentOffset.y / REST_ITEM_H);
                  const val = REST_OPTIONS[Math.max(0, Math.min(index, REST_OPTIONS.length - 1))];
                  onUpdate("restSeconds", val ?? 0);
                }}
              >
                {REST_OPTIONS.map((item, i) => {
                  const rotateX = scrollAnim.interpolate({
                    inputRange: [
                      (i - 2.5) * REST_ITEM_H, (i - 2) * REST_ITEM_H, (i - 1) * REST_ITEM_H,
                      i * REST_ITEM_H, (i + 1) * REST_ITEM_H, (i + 2) * REST_ITEM_H, (i + 2.5) * REST_ITEM_H,
                    ],
                    outputRange: ['-85deg', '-55deg', '-28deg', '0deg', '28deg', '55deg', '85deg'],
                    extrapolate: 'clamp',
                  });
                  const opacity = scrollAnim.interpolate({
                    inputRange: [
                      (i - 2.5) * REST_ITEM_H, (i - 2) * REST_ITEM_H, (i - 1) * REST_ITEM_H,
                      i * REST_ITEM_H, (i + 1) * REST_ITEM_H, (i + 2) * REST_ITEM_H, (i + 2.5) * REST_ITEM_H,
                    ],
                    outputRange: [0, 0.5, 0.75, 1, 0.75, 0.5, 0],
                    extrapolate: 'clamp',
                  });
                  return (
                    <Animated.View key={item} style={[styles.restItem, { opacity, transform: [{ perspective: 280 }, { rotateX }] }]}>
                      <Text style={[styles.restItemText, { color: t.ts }]}>{formatRest(item)}</Text>
                    </Animated.View>
                  );
                })}
              </Animated.ScrollView>
              <View pointerEvents="none" style={{ position: 'absolute', top: REST_ITEM_H * 2, left: 0, right: 0, height: REST_ITEM_H, overflow: 'hidden', backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg }}>
                <Animated.View style={{ transform: [{ translateY: Animated.multiply(scrollAnim, -1) }] }}>
                  {REST_OPTIONS.map((item) => (
                    <View key={item} style={styles.restItem}>
                      <Text style={[styles.restItemText, { color: t.tp, fontFamily: FontFamily.bold }]}>{formatRest(item)}</Text>
                    </View>
                  ))}
                </Animated.View>
              </View>
            </View>
            <View style={styles.restDoneRow}>
              <BounceButton
                onPress={() => {
                  const index = Math.round(restScrollOffset.current / REST_ITEM_H);
                  const val = REST_OPTIONS[Math.max(0, Math.min(index, REST_OPTIONS.length - 1))] ?? 0;
                  onUpdate("restSeconds", val);
                  closeRestPicker();
                }}
                accessibilityLabel="Confirm rest timer"
                accessibilityRole="button"
              >
                <View style={styles.restDoneWrap}>
                  <View style={styles.restDoneBtn}>
                    <Text style={styles.restDone}>Done</Text>
                  </View>
                </View>
              </BounceButton>
            </View>
          </Animated.View>
        </View>
      </Modal>

    </Reanimated.View>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({
  label, value, onDecrement, onIncrement, isDark,
}: {
  label: string; value: number;
  onDecrement: () => void; onIncrement: () => void; isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <NeuCard dark={isDark} style={styles.stepperCard}>
      <View style={styles.stepperInner}>
        <Text style={[styles.fieldLabel, { color: t.ts }]}>{label}</Text>
        <View style={styles.stepperControls}>
          <TouchableOpacity onPress={onDecrement} style={styles.stepBtn} activeOpacity={0.7}>
            <Ionicons name="remove" size={18} color={t.tp} />
          </TouchableOpacity>
          <Text style={[styles.stepValue, { color: t.tp }]}>{value}</Text>
          <TouchableOpacity onPress={onIncrement} style={styles.stepBtn} activeOpacity={0.7}>
            <Ionicons name="add" size={18} color={t.tp} />
          </TouchableOpacity>
        </View>
      </View>
    </NeuCard>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step, isDark, canStep2, onStepPress }: {
  step: 1 | 2;
  isDark: boolean;
  canStep2: boolean;
  onStepPress: (s: 1 | 2) => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;
  return (
    <View style={styles.stepIndicatorWrap}>
      <View style={[styles.stepLine, { backgroundColor: step === 2 ? ACCT : divider }]} />
      <View style={styles.stepIndicatorRow}>
        <BounceButton style={styles.stepItem} onPress={() => onStepPress(1)} accessibilityLabel="Go to setup" accessibilityRole="button">
          <View style={[styles.stepDot, {
            backgroundColor: ACCT,
            shadowColor: ACCT,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.55,
            shadowRadius: 8,
          }]}>
            <Text style={styles.stepDotText}>1</Text>
          </View>
          <Text style={[styles.stepDotLabel, { color: ACCT }]}>Setup</Text>
        </BounceButton>
        <BounceButton
          style={[styles.stepItem, !canStep2 && { opacity: 0.4 }]}
          onPress={() => canStep2 && onStepPress(2)}
          accessibilityLabel="Go to workouts"
          accessibilityRole="button"
        >
          <View style={[styles.stepDot, step === 2 ? {
            backgroundColor: ACCT,
            shadowColor: ACCT,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.55,
            shadowRadius: 8,
          } : { backgroundColor: divider }]}>
            <Text style={[styles.stepDotText, { color: step === 2 ? "#fff" : t.ts }]}>2</Text>
          </View>
          <Text style={[styles.stepDotLabel, { color: step === 2 ? ACCT : t.ts }]}>Workouts</Text>
        </BounceButton>
      </View>
    </View>
  );
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({
  name, setName,
  totalWeeks, setTotalWeeks,
  cycleDays, onCycleDaysChange,
  cyclePattern, isTrainingDay, onToggleDay, onSetDayName,
  isDark, onNext,
}: {
  name: string; setName: (v: string) => void;
  totalWeeks: number; setTotalWeeks: (v: number) => void;
  cycleDays: number; onCycleDaysChange: (v: number) => void;
  cyclePattern: string[]; isTrainingDay: boolean[];
  onToggleDay: (i: number) => void; onSetDayName: (i: number, t: string) => void;
  isDark: boolean; onNext: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;
  const dayInputRefs = useRef<Array<TextInput | null>>([]);
  const hasRendered = useRef(false);
  useEffect(() => { hasRendered.current = true; }, []);
  const prevCycleDays = useRef(cycleDays);
  const expandingIdx = cycleDays > prevCycleDays.current ? cycleDays - 1 : null;
  useEffect(() => { prevCycleDays.current = cycleDays; }, [cycleDays]);
  const [cycleCollapsingIdx, setCycleCollapsingIdx] = useState<number | null>(null);
  const pendingCycleDays = useRef<number | null>(null);
  const dayRowHeight = useRef(0);

  const handleCycleDecrement = useCallback(() => {
    if (cycleCollapsingIdx !== null) return;
    const next = clamp(cycleDays - 1, 2, 14);
    setCycleCollapsingIdx(cycleDays - 1);
    pendingCycleDays.current = next;
  }, [cycleDays, cycleCollapsingIdx]);

  const handleCycleCollapsed = useCallback(() => {
    const next = pendingCycleDays.current;
    if (next === null) return;
    pendingCycleDays.current = null;
    setCycleCollapsingIdx(null);
    onCycleDaysChange(next);
  }, [onCycleDaysChange]);
  const trainingIndices = cyclePattern.map((_, i) => i).filter(i => isTrainingDay[i]);
  const canProceed =
    name.trim().length > 0 &&
    isTrainingDay.some(Boolean) &&
    isTrainingDay.every((isTraining, i) => !isTraining || cyclePattern[i].trim().length > 0);

  return (
    <>
      <Text style={[styles.fieldLabel, { color: t.ts }]}>PROGRAM NAME</Text>
      <NeuCard dark={isDark} style={styles.inputCard}>
        <TextInput
          style={[styles.textInput, { color: t.tp }]}
          placeholder="e.g. Push Pull Legs (PPL)"
          placeholderTextColor={t.ts}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
          autoCapitalize="words"
        />
      </NeuCard>

      <View style={styles.stepperRow}>
        <View style={{ flex: 1 }}>
          <Stepper
            label="TOTAL WEEKS"
            value={totalWeeks}
            onDecrement={() => setTotalWeeks(clamp(totalWeeks - 1, 1, 52))}
            onIncrement={() => setTotalWeeks(clamp(totalWeeks + 1, 1, 52))}
            isDark={isDark}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Stepper
            label="CYCLE DAYS"
            value={cycleDays}
            onDecrement={handleCycleDecrement}
            onIncrement={() => onCycleDaysChange(cycleDays + 1)}
            isDark={isDark}
          />
        </View>
      </View>

      <Text style={[styles.fieldLabel, { color: t.ts }]}>CYCLE PATTERN</Text>
      <NeuCard dark={isDark} style={styles.cycleCard}>
        <View style={styles.cycleCardInner}>
          {cyclePattern.map((day, i) => {
            const isTraining = isTrainingDay[i];
            return (
              <Reanimated.View key={i}>
              <CollapsibleCard
                isCollapsing={cycleCollapsingIdx === i}
                onCollapsed={handleCycleCollapsed}
                expanding={expandingIdx === i}
                naturalHeight={i === expandingIdx ? dayRowHeight.current : undefined}
              >
              <View
                onLayout={e => {
                  const h = e.nativeEvent.layout.height;
                  if (h > 0 && i !== expandingIdx) dayRowHeight.current = h;
                }}
                style={[
                  styles.dayRow,
                  i > 0 && { borderTopWidth: 1, borderTopColor: divider },
                ]}
              >
                <Text style={[styles.dayLabel, { color: t.ts }]}>Day {i + 1}</Text>
                <View style={styles.nameArea}>
                  {isTraining ? (
                    <>
                      <TextInput
                        ref={(r) => { dayInputRefs.current[i] = r; }}
                        style={[styles.dayNameInput, { color: t.tp }]}
                        value={day}
                        onChangeText={(text) => onSetDayName(i, text)}
                        placeholder="Workout"
                        placeholderTextColor={t.ts}
                        returnKeyType={trainingIndices.at(-1) === i ? "done" : "next"}
                        onSubmitEditing={() => {
                          const pos = trainingIndices.indexOf(i);
                          const nextIdx = trainingIndices[pos + 1];
                          if (nextIdx !== undefined) dayInputRefs.current[nextIdx]?.focus();
                        }}
                      />
                      <Ionicons name="pencil-outline" size={12} color={t.ts} />
                      {/* Absolutely positioned — zero layout impact, text stays centred */}
                      <View style={[styles.nameUnderline, { backgroundColor: t.ts }]} />
                    </>
                  ) : (
                    <Text style={[styles.restLabel, { color: t.ts }]}>Rest</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => onToggleDay(i)}
                  style={[styles.togglePill, isTraining ? {
                    backgroundColor: ACCT,
                    shadowColor: ACCT,
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.5,
                    shadowRadius: 8,
                  } : { backgroundColor: divider }]}
                  activeOpacity={0.7}
                >
                  {isTraining
                    ? <DumbbellIcon size={13} color="#fff" />
                    : <Ionicons name="moon-outline" size={13} color={t.ts} />
                  }
                  <Text style={[styles.togglePillText, { color: isTraining ? "#fff" : t.ts }]}>
                    {isTraining ? "Training" : "Rest"}
                  </Text>
                </TouchableOpacity>
              </View>
              </CollapsibleCard>
              </Reanimated.View>
            );
          })}
        </View>
      </NeuCard>

      <BounceButton
        onPress={canProceed ? onNext : undefined}
        accessibilityLabel="Next step"
        accessibilityRole="button"
        style={{ opacity: canProceed ? 1 : 0.4 }}
      >
        {(() => {
          const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
          const btnContent = isDark ? APP_DARK.bg : "#fff";
          const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";
          return (
            <View style={[styles.primaryBtnWrap, { backgroundColor: btnBg, shadowColor: btnShadow }]}>
              <View style={[styles.primaryBtn, { backgroundColor: btnBg }]}>
                <Text style={[styles.primaryBtnText, { color: btnContent }]}>Next</Text>
                <Ionicons name="arrow-forward" size={18} color={btnContent} />
              </View>
            </View>
          );
        })()}
      </BounceButton>
    </>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────

function Step2({
  workouts, onOpenPicker, onEditExercise, onUpdateExercise, onUpdateExerciseSets, onRemoveExercise, onMoveExercise, isDark, onFinish, isEditMode, collapsingIds, onStartCollapse,
}: {
  workouts: WorkoutMap;
  onOpenPicker: (day: string) => void;
  onEditExercise: (day: string, id: string) => void;
  onUpdateExercise: (day: string, id: string, field: keyof Exercise, value: string | number | boolean) => void;
  onUpdateExerciseSets: (day: string, id: string, sets: ProgramSet[]) => void;
  onRemoveExercise: (day: string, id: string) => void;
  onMoveExercise: (day: string, id: string, dir: "up" | "down") => void;
  isDark: boolean;
  onFinish: () => void;
  isEditMode: boolean;
  collapsingIds: Set<string>;
  onStartCollapse: (day: string, id: string) => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const days = Object.keys(workouts);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  const toggleDay = (day: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedDays(prev => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  };

  return (
    <>
      {days.map((day) => {
        const isCollapsed = collapsedDays.has(day);
        const exercises = workouts[day] ?? [];
        return (
          <Reanimated.View key={day} style={{ marginBottom: 16 }} layout={LinearTransition.duration(300)}>
            <NeuCard dark={isDark} radius={16} style={styles.dayHeadingCard} innerStyle={styles.dayHeadingCardInner}>
              <TouchableOpacity
                onPress={() => toggleDay(day)}
                activeOpacity={0.8}
                style={styles.dayHeadingRow}
              >
                <View style={styles.dayHeadingLeft}>
                  <View style={[styles.dayAccentBar, { backgroundColor: ACCT }]} />
                  <Text style={[styles.dayHeading, { color: t.tp }]}>{dayLabel(day).toUpperCase()}</Text>
                  {exercises.length > 0 && (
                    <View style={[styles.dayExBadge, { backgroundColor: ACCT + "22", borderColor: ACCT }]}>
                      <Text style={[styles.dayExBadgeText, { color: ACCT }]}>{exercises.length}</Text>
                    </View>
                  )}
                </View>
                <Ionicons
                  name={isCollapsed ? "chevron-forward" : "chevron-down"}
                  size={16}
                  color={t.ts}
                />
              </TouchableOpacity>
            </NeuCard>

            {isCollapsed ? (
              <Reanimated.View key="collapsed" entering={FadeIn.duration(220)}>
                {exercises.length === 0 ? (
                  <NeuCard dark={isDark} style={styles.emptyCard}>
                    <Text style={[styles.emptyHint, { color: t.ts }]}>No exercises yet</Text>
                  </NeuCard>
                ) : (
                  <NeuCard dark={isDark} style={styles.daySummaryCard} innerStyle={styles.daySummaryCardInner}>
                    {exercises.map((ex, i) => (
                      <Reanimated.View
                        key={ex.id}
                        layout={LinearTransition.duration(200)}
                        style={[
                          styles.daySummaryRow,
                          i < exercises.length - 1 && { borderBottomWidth: 1, borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)" },
                        ]}
                      >
                        <View style={[styles.daySummaryNumChip, { backgroundColor: ACCT + "18" }]}>
                          <Text style={[styles.daySummaryNum, { color: ACCT }]}>{i + 1}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.daySummaryNameBtn}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onEditExercise(day, ex.id); }}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        >
                          <Text style={[styles.daySummaryName, { color: t.tp }]} numberOfLines={1}>{ex.name}</Text>
                        </TouchableOpacity>
                        <View style={styles.daySummaryActions}>
                          <View style={styles.exArrows}>
                            {i > 0 && (
                              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMoveExercise(day, ex.id, "up"); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                <Ionicons name="chevron-up" size={18} color={t.ts} />
                              </TouchableOpacity>
                            )}
                            {i < exercises.length - 1 && (
                              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMoveExercise(day, ex.id, "down"); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                <Ionicons name="chevron-down" size={18} color={t.ts} />
                              </TouchableOpacity>
                            )}
                          </View>
                          <TouchableOpacity
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              Alert.alert("Remove Exercise", `Remove "${ex.name}"?`, [
                                { text: "Cancel", style: "cancel" },
                                { text: "Remove", style: "destructive", onPress: () => onRemoveExercise(day, ex.id) },
                              ]);
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <TrashIcon size={18} color="#ef4444" />
                          </TouchableOpacity>
                        </View>
                      </Reanimated.View>
                    ))}
                  </NeuCard>
                )}
                <BounceButton onPress={() => onOpenPicker(day)} accessibilityLabel="Add exercise" accessibilityRole="button">
                  <View style={styles.addExBtnWrap}>
                    <View style={styles.addExBtn}>
                      <Ionicons name="add" size={18} color="#fff" />
                      <Text style={styles.addExText}>Add Exercise</Text>
                    </View>
                  </View>
                </BounceButton>
              </Reanimated.View>
            ) : (
              <Reanimated.View key="expanded" entering={FadeIn.duration(220)}>
                {exercises.length === 0 && (
                  <NeuCard dark={isDark} style={styles.emptyCard}>
                    <Text style={[styles.emptyHint, { color: t.ts }]}>No exercises yet</Text>
                  </NeuCard>
                )}
                {exercises.map((ex, i) => (
                  <CollapsibleCard
                    key={ex.id}
                    isCollapsing={collapsingIds.has(ex.id)}
                    onCollapsed={() => onRemoveExercise(day, ex.id)}
                  >
                    <NeuCard dark={isDark} style={styles.exerciseCard}>
                      <ExerciseRow
                        exercise={ex}
                        exIndex={i}
                        totalExercises={exercises.length}
                        isFirst={i === 0}
                        isLast={i === exercises.length - 1}
                        isDark={isDark}
                        onUpdate={(field, value) => onUpdateExercise(day, ex.id, field, value)}
                        onUpdateSets={sets => onUpdateExerciseSets(day, ex.id, sets)}
                        onSetRemoved={sets => onUpdateExerciseSets(day, ex.id, sets)}
                        onRemove={() => onStartCollapse(day, ex.id)}
                        onMove={(dir) => onMoveExercise(day, ex.id, dir)}
                        onEdit={() => onEditExercise(day, ex.id)}
                      />
                    </NeuCard>
                  </CollapsibleCard>
                ))}
                <BounceButton onPress={() => onOpenPicker(day)} accessibilityLabel="Add exercise" accessibilityRole="button">
                  <View style={styles.addExBtnWrap}>
                    <View style={styles.addExBtn}>
                      <Ionicons name="add" size={18} color="#fff" />
                      <Text style={styles.addExText}>Add Exercise</Text>
                    </View>
                  </View>
                </BounceButton>
              </Reanimated.View>
            )}
          </Reanimated.View>
        );
      })}

      {!isEditMode && (
        <BounceButton onPress={onFinish} accessibilityLabel="Create program" accessibilityRole="button">
          <View style={styles.primaryBtnWrap}>
            <View style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Create Program</Text>
            </View>
          </View>
        </BounceButton>
      )}
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NewProgramScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const isEditMode = !!editId;

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(8);
  const [cycleDays, setCycleDays] = useState(7);
  const [cyclePattern, setCyclePattern] = useState<string[]>(Array(7).fill(""));
  const [isTrainingDay, setIsTrainingDay] = useState<boolean[]>([true, true, true, false, false, false, false]);
  const [workouts, setWorkouts] = useState<WorkoutMap>({});
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [collapsingIds, setCollapsingIds] = useState<Set<string>>(new Set());
  const [pickerState, setPickerState] = useState<{ day: string; replaceId?: string } | null>(null);

  // Tracks whether the draft has been loaded — prevents auto-save overwriting it before load completes
  const isDraftLoaded = useRef(false);
  // Set to true before intentional navigation so beforeRemove skips the dialog
  const isLeavingIntentionally = useRef(false);
  // Snapshot of the program state as it was loaded in edit mode
  const originalEdit = useRef<{ name: string; totalWeeks: number; cycleDays: number; isTrainingDay: boolean[]; cyclePattern: string[]; workouts: WorkoutMap } | null>(null);
  // Remembers which day's picker was open before navigating to create-custom-exercise
  const pendingPickerDay = useRef<string | null>(null);

  const hasChanges = useMemo(() => {
    if (!isEditMode) return false;
    const orig = originalEdit.current;
    if (!orig) return false;
    return (
      name !== orig.name ||
      totalWeeks !== orig.totalWeeks ||
      cycleDays !== orig.cycleDays ||
      JSON.stringify(isTrainingDay) !== JSON.stringify(orig.isTrainingDay) ||
      JSON.stringify(cyclePattern) !== JSON.stringify(orig.cyclePattern) ||
      JSON.stringify(workouts) !== JSON.stringify(orig.workouts)
    );
  }, [isEditMode, name, totalWeeks, cycleDays, isTrainingDay, cyclePattern, workouts]);

  const updateBtnScale = useSharedValue(0);
  const updateBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: updateBtnScale.value }],
  }));
  useEffect(() => {
    updateBtnScale.value = withSpring(hasChanges ? 1 : 0, { damping: 18, stiffness: 280, mass: 0.8 });
  }, [hasChanges, updateBtnScale]);

  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Reload custom exercises and re-open picker when returning from create-custom-exercise
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] !== "string") {
        setCustomExercises(parsed as CustomExercise[]);
      }
    }).catch(() => {});

    if (pendingPickerDay.current) {
      setPickerState({ day: pendingPickerDay.current });
      pendingPickerDay.current = null;
    }
  }, []));

  // Load custom exercises and draft on mount
  useEffect(() => {
    AsyncStorage.getItem(CUSTOM_KEY).then(v => {
      if (!v) return;
      const parsed: unknown = JSON.parse(v);
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      if (typeof parsed[0] === "string") {
        // Migrate old string[] format to CustomExercise[]
        const migrated: CustomExercise[] = (parsed as string[]).map(n => ({ name: n, muscles: [] }));
        setCustomExercises(migrated);
        AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(migrated)).catch(() => {});
      } else {
        setCustomExercises(parsed as CustomExercise[]);
      }
    }).catch(() => {});

    (async () => {
      try {
        if (editId) {
          // Edit mode — check for an in-progress draft first, then fall back to saved program
          const draftRaw = await AsyncStorage.getItem(DRAFT_KEY);
          let loadedFromDraft = false;
          if (draftRaw) {
            const draft = JSON.parse(draftRaw) as ProgramDraft;
            if (draft.editId === editId) {
              if (draft.step) setStep(draft.step);
              if (draft.name !== undefined) setName(draft.name);
              if (draft.totalWeeks) setTotalWeeks(draft.totalWeeks);
              if (draft.cycleDays) setCycleDays(draft.cycleDays);
              if (draft.cyclePattern) setCyclePattern(draft.cyclePattern);
              if (draft.isTrainingDay) setIsTrainingDay(draft.isTrainingDay);
              if (draft.workouts) setWorkouts(draft.workouts);
              loadedFromDraft = true;
            }
          }
          // Always load originalEdit from the saved program (for change-detection)
          const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
          const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
          const program = programs.find(p => p.id === editId);
          if (program) {
            const isTraining = program.cyclePattern.map(d => d !== "Rest");
            const names = program.cyclePattern.map(d => d === "Rest" ? "" : d);
            if (!loadedFromDraft) {
              setName(program.name);
              setTotalWeeks(program.totalWeeks);
              setCycleDays(program.cycleDays);
              setIsTrainingDay(isTraining);
              setCyclePattern(names);
              setWorkouts(program.workouts ?? {});
            }
            originalEdit.current = {
              name: program.name,
              totalWeeks: program.totalWeeks,
              cycleDays: program.cycleDays,
              isTrainingDay: isTraining,
              cyclePattern: names,
              workouts: program.workouts ?? {},
            };
          }
        } else {
          // Create mode — load draft (ignore drafts that belong to an edit session)
          const raw = await AsyncStorage.getItem(DRAFT_KEY);
          if (raw) {
            const draft = JSON.parse(raw) as ProgramDraft;
            if (draft.editId) { isDraftLoaded.current = true; return; }
            if (draft.step) setStep(draft.step);
            if (draft.name !== undefined) setName(draft.name);
            if (draft.totalWeeks) setTotalWeeks(draft.totalWeeks);
            if (draft.cycleDays) setCycleDays(draft.cycleDays);
            if (draft.cyclePattern) setCyclePattern(draft.cyclePattern);
            if (draft.isTrainingDay) setIsTrainingDay(draft.isTrainingDay);
            if (draft.workouts) setWorkouts(draft.workouts);
          }
        }
      } catch { /* corrupt data — use defaults */ }
      isDraftLoaded.current = true;
    })();
  }, []);

  // Auto-save draft on every state change
  useEffect(() => {
    if (!isDraftLoaded.current) return;
    const draft: ProgramDraft = { step, name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts, ...(editId ? { editId } : {}) };
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
  }, [step, name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts, editId]);

  // Intercept back navigation — prompt save or discard
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e: any) => {
      if (isLeavingIntentionally.current) return;

      if (isEditMode) {
        const orig = originalEdit.current;
        if (!orig) return;
        const hasChanges =
          name !== orig.name ||
          totalWeeks !== orig.totalWeeks ||
          cycleDays !== orig.cycleDays ||
          JSON.stringify(isTrainingDay) !== JSON.stringify(orig.isTrainingDay) ||
          JSON.stringify(cyclePattern) !== JSON.stringify(orig.cyclePattern) ||
          JSON.stringify(workouts) !== JSON.stringify(orig.workouts);
        if (!hasChanges) return;
      } else {
        const hasDraft =
          name.trim().length > 0 ||
          step === 2 ||
          Object.values(workouts).some(exs => exs.length > 0);
        if (!hasDraft) return;
      }

      e.preventDefault();
      Alert.alert(
        "Unsaved Changes",
        "Would you like to save your progress or discard it?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              isLeavingIntentionally.current = true;
              AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
              navigation.dispatch(e.data.action);
            },
          },
          {
            text: "Save Draft",
            onPress: () => {
              isLeavingIntentionally.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, name, step, workouts, isEditMode, totalWeeks, cycleDays, isTrainingDay, cyclePattern]);

  const handleCycleDaysChange = useCallback((next: number) => {
    const clamped = clamp(next, 2, 14);
    setCycleDays(clamped);
    setCyclePattern(prev =>
      clamped > prev.length ? [...prev, ...Array(clamped - prev.length).fill("")] : prev.slice(0, clamped)
    );
    setIsTrainingDay(prev =>
      clamped > prev.length ? [...prev, ...Array(clamped - prev.length).fill(false)] : prev.slice(0, clamped)
    );
  }, []);

  const toggleDay = useCallback((index: number) => {
    setIsTrainingDay(prev => { const next = [...prev]; next[index] = !next[index]; return next; });
  }, []);

  const setDayName = useCallback((index: number, text: string) => {
    setCyclePattern(prev => { const next = [...prev]; next[index] = text; return next; });
  }, []);

  const handleNext = useCallback(() => {
    const days = trainingDayKeys(cyclePattern, isTrainingDay);
    setWorkouts(prev => {
      const next: WorkoutMap = {};
      days.forEach((d: string) => { next[d] = prev[d] ?? []; });
      return next;
    });
    setStep(2);
  }, [cyclePattern, isTrainingDay]);

  const addExercise = useCallback((day: string, exName: string, idOffset = 0) => {
    setWorkouts(prev => ({
      ...prev,
      [day]: [...(prev[day] ?? []), { id: (Date.now() + idOffset).toString(), name: exName, sets: [{ type: "working" as const }] }],
    }));
  }, []);

  const updateExercise = useCallback((day: string, id: string, field: keyof Exercise, value: string | number | boolean) => {
    setWorkouts(prev => ({
      ...prev,
      [day]: prev[day].map(e => e.id === id ? { ...e, [field]: value } : e),
    }));
  }, []);

  const updateExerciseSets = useCallback((day: string, id: string, sets: ProgramSet[]) => {
    setWorkouts(prev => ({
      ...prev,
      [day]: prev[day].map(e => e.id === id ? { ...e, sets } : e),
    }));
  }, []);

  const removeExercise = useCallback((day: string, id: string) => {
    setWorkouts(prev => ({ ...prev, [day]: prev[day].filter(e => e.id !== id) }));
    setCollapsingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const startCollapse = useCallback((day: string, id: string) => {
    setCollapsingIds(prev => new Set(prev).add(id));
  }, []);

  const moveExercise = useCallback((day: string, id: string, dir: "up" | "down") => {
    setWorkouts(prev => {
      const arr = [...prev[day]];
      const idx = arr.findIndex(e => e.id === id);
      const target = dir === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= arr.length) return prev;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...prev, [day]: arr };
    });
  }, []);

  const deleteCustomExercise = useCallback((exName: string) => {
    const next = customExercises.filter(e => e.name !== exName);
    setCustomExercises(next);
    AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next)).catch(() => {});
    // Also remove this exercise from every day in the current program
    setWorkouts(prev => {
      const updated: WorkoutMap = {};
      for (const day of Object.keys(prev)) {
        updated[day] = prev[day].filter(e => e.name !== exName);
      }
      return updated;
    });
  }, [customExercises]);

  const handleFinish = useCallback(() => {
    const programName = name.trim() || "My Program";
    const savedCyclePattern = cyclePattern.map((n, i) => isTrainingDay[i] ? (n.trim() || "Workout") : "Rest");
    const trainingDays = isTrainingDay.filter(Boolean).length;
    const today = new Date();
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const startDate = `${String(today.getDate()).padStart(2, "0")} ${months[today.getMonth()]} ${today.getFullYear()}`;

    if (isEditMode) {
      // Edit mode — update the existing program in place
      const doUpdate = async () => {
        try {
          const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
          const existing: SavedProgram[] = raw ? JSON.parse(raw) : [];
          const updated = existing.map(p => p.id === editId ? {
            ...p,
            name: programName,
            totalWeeks,
            trainingDays,
            cycleDays,
            cyclePattern: savedCyclePattern,
            workouts,
          } : p);
          await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
          await AsyncStorage.removeItem(DRAFT_KEY);
        } catch (e) {
          Alert.alert("Save failed", e instanceof Error ? e.message : String(e));
          return;
        }
        isLeavingIntentionally.current = true;
        router.back();
      };
      doUpdate();
      return;
    }

    // Create mode — add new program
    const newProgram: SavedProgram = {
      id: Date.now().toString(),
      name: programName,
      totalWeeks,
      currentWeek: 0,
      status: "created",
      startDate,
      trainingDays,
      cycleDays,
      cyclePattern: savedCyclePattern,
      workouts,
    };

    const save = async (makeActive: boolean) => {
      try {
        const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
        const existing: SavedProgram[] = raw ? JSON.parse(raw) : [];
        let updated = [...existing, newProgram];
        if (makeActive) {
          updated = updated.map(p => ({
            ...p,
            status: p.id === newProgram.id ? "active" : p.status === "active" ? "paused" : p.status,
            currentWeek: p.id === newProgram.id ? 1 : p.currentWeek,
          })) as SavedProgram[];
        }
        await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
      } catch (e) {
        Alert.alert("Save failed", e instanceof Error ? e.message : String(e));
        return;
      }
      isLeavingIntentionally.current = true;
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
      router.back();
    };

    Alert.alert(
      "Program Created!",
      `"${programName}" has been saved. Would you like to set it as your active program?`,
      [
        { text: "Set as Active", onPress: () => save(true) },
        { text: "Not Now", onPress: () => save(false) },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }, [name, totalWeeks, cycleDays, cyclePattern, isTrainingDay, workouts, router, isEditMode, editId]);

  const handleBack = () => { if (step === 2) setStep(1); else router.back(); };

  const canProceed =
    name.trim().length > 0 &&
    isTrainingDay.some(Boolean) &&
    isTrainingDay.every((isTraining, i) => !isTraining || cyclePattern[i].trim().length > 0);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* Back button */}
      <TouchableOpacity
        onPress={handleBack}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel={step === 2 ? "Back to setup" : "Go back"}
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


      {isEditMode && (
        <Reanimated.View style={[{ position: "absolute", top: insets.top + 16, right: 26, zIndex: 10 }, updateBtnStyle]}>
          <BounceButton onPress={handleFinish} accessibilityLabel="Save changes" accessibilityRole="button">
            <View style={styles.updateBtn}>
              <Text style={styles.updateBtnText}>Update</Text>
            </View>
          </BounceButton>
        </Reanimated.View>
      )}

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

      <Reanimated.ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      >
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>{isEditMode ? "EDIT PROGRAM" : "NEW PROGRAM"}</Text>
          <View style={{ width: 66 }} />
        </View>

        <StepIndicator
          step={step}
          isDark={isDark}
          canStep2={canProceed}
          onStepPress={(s) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (s === 2) handleNext(); else setStep(1); }}
        />

        {step === 1 ? (
          <Step1
            name={name} setName={setName}
            totalWeeks={totalWeeks} setTotalWeeks={setTotalWeeks}
            cycleDays={cycleDays} onCycleDaysChange={handleCycleDaysChange}
            cyclePattern={cyclePattern} isTrainingDay={isTrainingDay}
            onToggleDay={toggleDay} onSetDayName={setDayName}
            isDark={isDark} onNext={handleNext}
          />
        ) : (
          <Step2
            workouts={workouts}
            onOpenPicker={day => setPickerState({ day })}
            onEditExercise={(day, id) => setPickerState({ day, replaceId: id })}
            onUpdateExercise={updateExercise}
            onUpdateExerciseSets={updateExerciseSets}
            onRemoveExercise={removeExercise}
            onMoveExercise={moveExercise}
            isDark={isDark}
            onFinish={handleFinish}
            isEditMode={isEditMode}
            collapsingIds={collapsingIds}
            onStartCollapse={startCollapse}
          />
        )}
      </Reanimated.ScrollView>

      {/* Floating keyboard dismiss button */}
      {kbHeight > 0 && Platform.OS === "ios" && (
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          activeOpacity={0.75}
          style={{
            position: "absolute",
            right: 10,
            bottom: kbHeight + 8,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 9,
            backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.15,
            shadowRadius: 4,
            zIndex: 999,
          }}
        >
          <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
        </TouchableOpacity>
      )}

      {/* Exercise picker — rendered above ScrollView so it's never clipped */}
      {pickerState !== null && (
        <ExercisePicker
          visible
          subtitle={dayLabel(pickerState.day).toUpperCase()}
          customExercises={customExercises}
          onSelectMultiple={exNames => {
            if (pickerState.replaceId) {
              updateExercise(pickerState.day, pickerState.replaceId, "name", exNames[0]);
            } else {
              exNames.forEach((name, i) => addExercise(pickerState.day, name, i));
            }
            setPickerState(null);
          }}
          onCreateCustom={() => {
            pendingPickerDay.current = pickerState?.day ?? null;
            setPickerState(null);
            router.push("/create-custom-exercise");
          }}
          onEditCustom={name => {
            pendingPickerDay.current = pickerState?.day ?? null;
            setPickerState(null);
            router.push({ pathname: "/create-custom-exercise", params: { edit: name } });
          }}
          onDeleteCustom={deleteCustomExercise}
          onClose={() => setPickerState(null)}
          isDark={isDark}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:             { flex: 1 },
  topGradient:      { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn:          { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  header:           { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 20 },
  screenTitle:      { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textAlign: "center", flex: 1 },

  // Step indicator
  stepIndicatorWrap: { marginBottom: 28, position: "relative" },
  stepLine:          { position: "absolute", left: "32%", right: "32%", top: 13, height: 2 },
  stepIndicatorRow:  { flexDirection: "row" },
  stepItem:          { flex: 1, alignItems: "center", gap: 6, zIndex: 1 },
  stepDot:           { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotText:       { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
  stepDotLabel:      { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.5 },

  // Fields
  fieldLabel:       { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginTop: 4 },
  inputCard:        { marginBottom: 20, borderRadius: 16 },
  textInput:        { fontFamily: FontFamily.regular, fontSize: 16, paddingHorizontal: 18, paddingVertical: 16 },

  // Steppers
  stepperRow:       { flexDirection: "row", gap: 12, marginBottom: 20 },
  stepperCard:      { borderRadius: 16 },
  stepperInner:     { padding: 16, alignItems: "center", gap: 12 },
  stepperControls:  { flexDirection: "row", alignItems: "center", gap: 20 },
  stepBtn:          { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  stepValue:        { fontFamily: FontFamily.bold, fontSize: 24, minWidth: 36, textAlign: "center" },

  // Cycle pattern
  cycleCard:        { marginBottom: 28, borderRadius: 16 },
  cycleCardInner:   { paddingVertical: 4 },
  dayRow:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 54, gap: 12 },
  dayLabel:         { fontFamily: FontFamily.semibold, fontSize: 13, width: 44 },
  nameArea:         { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  nameUnderline:    { position: "absolute", bottom: -6, left: 0, right: 20, height: 1 },
  dayNameInput:     { flex: 1, fontFamily: FontFamily.regular, fontSize: 14 },
  restLabel:        { flex: 1, fontFamily: FontFamily.regular, fontSize: 14 },
  togglePill:       { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  togglePillText:   { fontFamily: FontFamily.semibold, fontSize: 12 },

  // Primary button
  primaryBtnWrap:   { borderRadius: 16, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  primaryBtn:       { borderRadius: 16, backgroundColor: ACCT, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  primaryBtnText:   { fontFamily: FontFamily.bold, fontSize: 16, color: "#FFFFFF", letterSpacing: 0.3 },
  updateBtn:        { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 8, paddingHorizontal: 16, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 12 },
  updateBtnText:    { fontFamily: FontFamily.bold, fontSize: 14, color: "#FFFFFF", letterSpacing: 0.3 },

  // Step 2 — workout days
  dayHeadingCard:       { borderRadius: 16, marginBottom: 8 },
  dayHeadingCardInner:  { paddingVertical: 12, paddingHorizontal: 16 },
  dayHeadingRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayHeadingLeft:       { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  dayAccentBar:         { width: 3, height: 18, borderRadius: 2 },
  dayHeading:           { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 1.2 },
  dayExBadge:           { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  dayExBadgeText:       { fontFamily: FontFamily.semibold, fontSize: 12 },
  daySummaryCard:       { borderRadius: 16, marginBottom: 14 },
  daySummaryCardInner:  { paddingVertical: 4, paddingHorizontal: 0 },
  daySummaryEmpty:      { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", paddingVertical: 14, paddingHorizontal: 16 },
  daySummaryRow:        { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  daySummaryNumChip:    { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  daySummaryActions:    { flexDirection: "row", alignItems: "center", gap: 14 },
  daySummaryNum:        { fontFamily: FontFamily.bold, fontSize: 13 },
  daySummaryNameBtn:    { flex: 1, flexDirection: "row", alignItems: "center" },
  daySummaryName:       { fontFamily: FontFamily.regular, fontSize: 15, flex: 1 },
  workoutDayCard:   { borderRadius: 16 },
  exerciseCard:     { borderRadius: 16, marginBottom: 14 },
  emptyCard:        { borderRadius: 16, marginBottom: 14 },
  emptyHint:        { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 16 },
  addExBtnWrap:     { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12, marginTop: 6, marginBottom: 8 },
  addExBtn:         { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 10, paddingHorizontal: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  addExText:        { fontFamily: FontFamily.semibold, fontSize: 14, color: "#FFFFFF" },

  // Exercise row
  exRowWrap:        { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0 },
  exThumb:          { width: 52, height: 52 },
  exThumbInner:     { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  exTopRow:           { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  exArrows:           { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, width: 50 },
  exNameBtn:        { flex: 1, flexDirection: "column", justifyContent: "center", gap: 3 },
  exNumLabel:       { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.8 },
  exName:           { fontFamily: FontFamily.bold, fontSize: 16, flexShrink: 1 },
  exCompactRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 9, borderTopWidth: 1 },
  exRestChipGroup:  { flexDirection: "row", alignItems: "center", gap: 8 },
  exRestLabel:      { fontFamily: FontFamily.semibold, fontSize: 13 },
  exRestChip:       { flexDirection: "row", alignItems: "center", gap: 5 },
  exRestChipText:   { fontFamily: FontFamily.semibold, fontSize: 13 },
  exTogglePills:    { flexDirection: "row", borderRadius: 20, padding: 3 },
  exTogglePillPill: { position: "absolute", top: 3, left: 3, bottom: 3, borderRadius: 17, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6 },
  exTogglePill:     { paddingHorizontal: 14, paddingVertical: 6, alignItems: "center" },
  exTogglePillText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  exSetHeaderRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, paddingRight: 16 },
  exSetHeaderLabel: { fontFamily: FontFamily.semibold, fontSize: 13 },
  exSetHeaderToggle:{ flexDirection: "row", alignItems: "center", justifyContent: "center" },
  exSetHeaderToggleSpacer: { width: 14 },
  exSetRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 48, borderTopWidth: 1, paddingRight: 16 },
  exSetBadgeCol:    { width: 54, alignItems: "flex-start", paddingLeft: 10 },
  exSetValueCol:    { width: 100, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  exSetColRep:      { width: 128 },
  exSetUnitSpacer:  { width: 22 },
  exSetBadge:       { width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  exSetBadgeText:   { fontFamily: FontFamily.bold, fontSize: 12 },
  exSetInputBox:    { height: 32, width: 56, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  exSetInputText:   { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: "center", width: "100%" },
  exSetUnit:        { fontFamily: FontFamily.semibold, fontSize: 13, marginLeft: 4 },
  exAddRemoveRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 9, borderTopWidth: 1 },
  exAddRemoveBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10 },
  exAddRemoveText:  { fontFamily: FontFamily.semibold, fontSize: 13 },
  exNotesRow:       { borderTopWidth: 1, paddingVertical: 10, paddingLeft: 9 },
  exNotesInput:     { fontFamily: FontFamily.semibold, fontSize: 13, minHeight: 36, lineHeight: 20, paddingLeft: 0 },

  // Rest picker modal
  restBackdrop:     { flex: 1, justifyContent: "flex-end" },
  restOverlay:      { backgroundColor: "rgba(0,0,0,0.45)" },
  restSheet:        { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 },
  restHandleArea:   { paddingVertical: 12, alignItems: "center" },
  restHandle:       { width: 40, height: 4, borderRadius: 2 },
  restHeader:       { alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  restDoneRow:      { alignItems: "center", paddingTop: 16, paddingBottom: 4 },
  restTitle:        { fontFamily: FontFamily.bold, fontSize: 16 },
  restSubtitle:     { fontFamily: FontFamily.regular, fontSize: 14, marginTop: 2 },
  restDoneWrap:     { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  restDoneBtn:      { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 13, paddingHorizontal: 40 },
  restDone:         { fontFamily: FontFamily.semibold, fontSize: 16, color: "#FFFFFF" },
  restPickerWrap:   { height: REST_ITEM_H * 5, overflow: "hidden" },
  restSelTop:       { position: "absolute", top: REST_ITEM_H * 2, left: 24, right: 24, borderTopWidth: 1, zIndex: 1 },
  restSelBottom:    { position: "absolute", top: REST_ITEM_H * 3, left: 24, right: 24, borderTopWidth: 1, zIndex: 1 },
  restItem:         { height: REST_ITEM_H, alignItems: "center", justifyContent: "center" },
  restItemText:     { fontSize: 20 },

});
