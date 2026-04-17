import { useState, useCallback, useEffect, useRef } from "react";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, interpolateColor, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Modal,
  Alert,
  Platform,
  Keyboard,
  Animated,
  Easing,
  PanResponder,
  LayoutAnimation,
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
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { PROGRAMS_KEY, type SavedProgram, type Exercise, type WorkoutMap } from "../constants/programs";
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


interface ExerciseRowProps {
  exercise: Exercise;
  isFirst: boolean;
  isLast: boolean;
  isDark: boolean;
  onUpdate: (field: keyof Exercise, value: string | number | boolean) => void;
  onUpdateNotes: (notes: string) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
  onEdit: () => void;
}

function ExerciseRow({ exercise, isFirst, isLast, isDark, onUpdate, onUpdateNotes, onRemove, onMove, onEdit }: ExerciseRowProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;
  const restSecs = exercise.restSeconds ?? 0;
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
  return (
    <View style={styles.exRowWrap}>
      {/* Sub-row 1: thumbnail + name + reorder + delete */}
      <View style={styles.exTopRow}>
        <NeuCard dark={isDark} radius={12} shadowSize="sm" style={styles.exThumb}>
          <View style={styles.exThumbInner}>
            <DumbbellIcon size={20} color={t.ts} />
          </View>
        </NeuCard>
        <TouchableOpacity onPress={onEdit} activeOpacity={0.7} style={styles.exNameBtn}>
          <Text style={[styles.exName, { color: t.tp }]} numberOfLines={1} ellipsizeMode="tail">{exercise.name}</Text>
        </TouchableOpacity>
        <View style={styles.exArrows}>
          {isLast ? (
            // Last exercise: show only up arrow in the down-arrow slot to avoid empty left space
            <>
              <View style={styles.exArrowPlaceholder} />
              <TouchableOpacity onPress={() => onMove("up")} activeOpacity={0.7}>
                <Ionicons name="chevron-up" size={18} color={t.ts} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              {isFirst
                ? <View style={styles.exArrowPlaceholder} />
                : <TouchableOpacity onPress={() => onMove("up")} activeOpacity={0.7}>
                    <Ionicons name="chevron-up" size={18} color={t.ts} />
                  </TouchableOpacity>
              }
              <TouchableOpacity onPress={() => onMove("down")} activeOpacity={0.7}>
                <Ionicons name="chevron-down" size={18} color={t.ts} />
              </TouchableOpacity>
            </>
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

      {/* Sub-row 1b: Reps / Hold toggle */}
      <View style={[styles.exToggleRow, { borderTopColor: divider }]}>
        <Text style={[styles.exSetLabel, { color: t.ts }]}>Exercise Type</Text>
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

      {/* Sub-row 2: warmup sets, working sets, reps/hold */}
      <View style={[styles.exBottomRow, { borderTopColor: divider }]}>
        {/* Warmup sets */}
        <View style={styles.exSetGroup}>
          <Text style={[styles.exSetLabel, { color: t.ts }]}>Warmup Sets</Text>
          <View style={styles.exMiniStepper}>
            <TouchableOpacity onPress={() => onUpdate("warmupSets", clamp(exercise.warmupSets - 1, 0, 10))} activeOpacity={0.7}>
              <Ionicons name="remove-circle-outline" size={20} color={t.ts} />
            </TouchableOpacity>
            <Text style={[styles.exSetCount, { color: t.tp }]}>{exercise.warmupSets}</Text>
            <TouchableOpacity onPress={() => onUpdate("warmupSets", clamp(exercise.warmupSets + 1, 0, 10))} activeOpacity={0.7}>
              <Ionicons name="add-circle-outline" size={20} color={t.ts} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.exSetDivider, { backgroundColor: divider }]} />

        {/* Working sets */}
        <View style={styles.exSetGroup}>
          <Text style={[styles.exSetLabel, { color: t.ts }]}>Working Sets</Text>
          <View style={styles.exMiniStepper}>
            <TouchableOpacity onPress={() => onUpdate("workingSets", clamp(exercise.workingSets - 1, 1, 20))} activeOpacity={0.7}>
              <Ionicons name="remove-circle-outline" size={20} color={t.ts} />
            </TouchableOpacity>
            <Text style={[styles.exSetCount, { color: t.tp }]}>{exercise.workingSets}</Text>
            <TouchableOpacity onPress={() => onUpdate("workingSets", clamp(exercise.workingSets + 1, 1, 20))} activeOpacity={0.7}>
              <Ionicons name="add-circle-outline" size={20} color={t.ts} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.exSetDivider, { backgroundColor: divider }]} />

        {/* Reps / Hold */}
        <View style={styles.exSetGroup}>
          <Text style={[styles.exSetLabel, { color: t.ts }]}>{exercise.isIsometric ? "Duration (s)" : "Rep Range"}</Text>
          <TextInput
            style={[styles.exRepsInput, { color: t.tp }]}
            value={exercise.reps}
            onChangeText={v => onUpdate("reps", v)}
            placeholder={exercise.isIsometric ? "30" : "8-12"}
            placeholderTextColor={t.ts}
            returnKeyType="done"
            keyboardType={exercise.isIsometric ? "number-pad" : "default"}
            selectTextOnFocus
          />
        </View>
      </View>

      {/* Rest Timer row */}
      <TouchableOpacity
        style={[styles.exRestRow, { borderTopColor: divider }]}
        onPress={openRestPicker}
        activeOpacity={0.7}
      >
        <Text style={[styles.exSetLabel, { color: t.ts }]}>Rest Timer</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={[styles.exRestValue, { color: restSecs > 0 ? ACCT : t.ts }]}>{formatRest(restSecs)}</Text>
          <Ionicons name="chevron-forward" size={14} color={t.ts} />
        </View>
      </TouchableOpacity>

      {/* Rest picker slide-up */}
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
                      (i - 2.5) * REST_ITEM_H,
                      (i - 2) * REST_ITEM_H,
                      (i - 1) * REST_ITEM_H,
                      i * REST_ITEM_H,
                      (i + 1) * REST_ITEM_H,
                      (i + 2) * REST_ITEM_H,
                      (i + 2.5) * REST_ITEM_H,
                    ],
                    outputRange: ['-85deg', '-55deg', '-28deg', '0deg', '28deg', '55deg', '85deg'],
                    extrapolate: 'clamp',
                  });
                  const opacity = scrollAnim.interpolate({
                    inputRange: [
                      (i - 2.5) * REST_ITEM_H,
                      (i - 2) * REST_ITEM_H,
                      (i - 1) * REST_ITEM_H,
                      i * REST_ITEM_H,
                      (i + 1) * REST_ITEM_H,
                      (i + 2) * REST_ITEM_H,
                      (i + 2.5) * REST_ITEM_H,
                    ],
                    outputRange: [0, 0.5, 0.75, 1, 0.75, 0.5, 0],
                    extrapolate: 'clamp',
                  });
                  return (
                    <Animated.View
                      key={item}
                      style={[styles.restItem, { opacity, transform: [{ perspective: 280 }, { rotateX }] }]}
                    >
                      <Text style={[styles.restItemText, { color: t.ts }]}>
                        {formatRest(item)}
                      </Text>
                    </Animated.View>
                  );
                })}
              </Animated.ScrollView>
              {/* Bold clip overlay — only items physically inside the selection zone show bold */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: REST_ITEM_H * 2,
                  left: 0,
                  right: 0,
                  height: REST_ITEM_H,
                  overflow: 'hidden',
                  backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg,
                }}
              >
                <Animated.View
                  style={{
                    transform: [{
                      translateY: Animated.multiply(scrollAnim, -1),
                    }],
                  }}
                >
                  {REST_OPTIONS.map((item) => (
                    <View key={item} style={styles.restItem}>
                      <Text style={[styles.restItemText, { color: t.tp, fontFamily: FontFamily.bold }]}>
                        {formatRest(item)}
                      </Text>
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

      {/* Coaching notes */}
      <View style={[styles.exNotesRow, { borderTopColor: divider }]}>
        <TextInput
          style={[styles.exNotesInput, { color: t.tp }]}
          value={exercise.programNotes ?? ""}
          onChangeText={onUpdateNotes}
          placeholder="Notes..."
          placeholderTextColor={t.ts}
          multiline
          returnKeyType="done"
          blurOnSubmit
        />
      </View>
    </View>
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
  const [cycleCollapsingIdx, setCycleCollapsingIdx] = useState<number | null>(null);
  const pendingCycleDays = useRef<number | null>(null);

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
              <Reanimated.View
                key={i}
                entering={hasRendered.current ? FadeInDown.springify().damping(18).stiffness(160) : undefined}
              >
              <CollapsibleCard
                isCollapsing={cycleCollapsingIdx === i}
                onCollapsed={handleCycleCollapsed}
              >
              <View
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
        <View style={styles.primaryBtnWrap}>
          <View style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </View>
        </View>
      </BounceButton>
    </>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────

function Step2({
  workouts, onOpenPicker, onEditExercise, onUpdateExercise, onRemoveExercise, onMoveExercise, isDark, onFinish, isEditMode, collapsingIds, onStartCollapse,
}: {
  workouts: WorkoutMap;
  onOpenPicker: (day: string) => void;
  onEditExercise: (day: string, id: string) => void;
  onUpdateExercise: (day: string, id: string, field: keyof Exercise, value: string | number | boolean) => void;
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

  return (
    <>
      {days.map((day) => (
        <View key={day} style={{ marginBottom: 20 }}>
          <Text style={[styles.dayHeading, { color: t.tp }]}>{dayLabel(day).toUpperCase()}</Text>
          {workouts[day].length === 0 && (
            <NeuCard dark={isDark} style={styles.emptyCard}>
              <Text style={[styles.emptyHint, { color: t.ts }]}>No exercises yet. Tap below to add.</Text>
            </NeuCard>
          )}
            {workouts[day].map((ex, i) => (
              <CollapsibleCard
                key={ex.id}
                isCollapsing={collapsingIds.has(ex.id)}
                onCollapsed={() => onRemoveExercise(day, ex.id)}
              >
                <NeuCard dark={isDark} style={styles.exerciseCard}>
                  <ExerciseRow
                    exercise={ex}
                    isFirst={i === 0}
                    isLast={i === workouts[day].length - 1}
                    isDark={isDark}
                    onUpdate={(field, value) => onUpdateExercise(day, ex.id, field, value)}
                    onUpdateNotes={notes => onUpdateExercise(day, ex.id, "programNotes", notes)}
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
        </View>
      ))}

      <BounceButton onPress={onFinish} accessibilityLabel={isEditMode ? "Save changes" : "Create program"} accessibilityRole="button">
        <View style={styles.primaryBtnWrap}>
          <View style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{isEditMode ? "Save Changes" : "Create Program"}</Text>
          </View>
        </View>
      </BounceButton>
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
          // Create mode — load draft
          const raw = await AsyncStorage.getItem(DRAFT_KEY);
          if (raw) {
            const draft = JSON.parse(raw) as ProgramDraft;
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
      [day]: [...(prev[day] ?? []), { id: (Date.now() + idOffset).toString(), name: exName, warmupSets: 0, workingSets: 3, reps: "8-12" }],
    }));
  }, []);

  const updateExercise = useCallback((day: string, id: string, field: keyof Exercise, value: string | number | boolean) => {
    setWorkouts(prev => ({
      ...prev,
      [day]: prev[day].map(e => e.id === id ? { ...e, [field]: value } : e),
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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: t.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
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
        keyboardShouldPersistTaps="handled"
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
            onRemoveExercise={removeExercise}
            onMoveExercise={moveExercise}
            isDark={isDark}
            onFinish={handleFinish}
            isEditMode={isEditMode}
            collapsingIds={collapsingIds}
            onStartCollapse={startCollapse}
          />
        )}
      </ScrollView>

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
    </KeyboardAvoidingView>
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

  // Step 2 — workout days
  dayHeading:       { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 1.2, marginBottom: 8 },
  workoutDayCard:   { borderRadius: 16 },
  exerciseCard:     { borderRadius: 16, marginBottom: 14 },
  emptyCard:        { borderRadius: 16, marginBottom: 14 },
  emptyHint:        { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 16 },
  addExBtnWrap:     { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12, marginTop: 6, marginBottom: 8 },
  addExBtn:         { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 10, paddingHorizontal: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  addExText:        { fontFamily: FontFamily.semibold, fontSize: 14, color: "#FFFFFF" },

  // Exercise row
  exRowWrap:        { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0 },
  exThumb:          { width: 44, height: 44 },
  exThumbInner:     { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  exTopRow:           { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  exArrows:           { flexDirection: "row", alignItems: "center", gap: 14 },
  exArrowPlaceholder: { width: 18, height: 18 },
  exNameBtn:        { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  exName:           { fontFamily: FontFamily.semibold, fontSize: 14, flexShrink: 1 },
  exToggleRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, paddingVertical: 10, borderTopWidth: 1, gap: 12 },
  exTogglePills:    { flexDirection: "row", borderRadius: 20, padding: 3 },
  exTogglePillPill: { position: "absolute", top: 3, left: 3, bottom: 3, borderRadius: 17, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6 },
  exTogglePill:     { paddingHorizontal: 14, paddingVertical: 6, alignItems: "center" },
  exTogglePillText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  exBottomRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, marginBottom: 2 },
  exSetGroup:       { flex: 1, alignItems: "center", gap: 4 },
  exSetLabel:       { fontFamily: FontFamily.regular, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" },
  exMiniStepper:    { flexDirection: "row", alignItems: "center", gap: 6 },
  exSetCount:       { fontFamily: FontFamily.bold, fontSize: 16, minWidth: 20, textAlign: "center" },
  exSetDivider:     { width: 1, height: 36, marginHorizontal: 4 },
  exRepsInput:      { fontFamily: FontFamily.bold, fontSize: 16, minWidth: 44, textAlign: "center" },
  exRestRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, paddingVertical: 12, borderTopWidth: 1 },
  exRestValue:      { fontFamily: FontFamily.semibold, fontSize: 13 },
  exNotesRow:       { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  exNotesInput:     { fontFamily: FontFamily.regular, fontSize: 13, minHeight: 36, lineHeight: 20 },

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
