import { useState, useEffect, useRef, useMemo } from "react";
import {
  Modal, View, Text, StyleSheet, ScrollView, FlatList,
  TextInput, TouchableOpacity, Animated, Easing, PanResponder,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import { DEFAULT_SET_COUNT_KEY } from "../constants/programs";
import { getJSON, setJSON } from "../utils/storage";
import {
  MUSCLE_GROUPS, MAX_CUSTOM,
  type SelectableMuscle, type CustomExercise, type Exercise,
} from "../constants/exercises";
import { EXERCISES } from "../constants/exerciseData";
import ExerciseImage from "./ExerciseImage";
import TrashIcon from "./TrashIcon";
import BounceButton from "./BounceButton";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExercisePickerProps {
  visible: boolean;
  /** Short string shown below the title, e.g. "PUSH DAY" or "CHANGE EXERCISE" */
  subtitle: string;
  customExercises: CustomExercise[];
  /**
   * `setCount` is the picker's "sets per exercise" stepper value — only
   * meaningful when `withSetCount` is on; callers that don't show the stepper
   * can ignore it.
   */
  onSelectMultiple: (names: string[], setCount: number) => void;
  /**
   * Show the "sets per exercise" stepper next to the confirm button. The value
   * is a device-local preference (DEFAULT_SET_COUNT_KEY) remembered across
   * sessions. Off by default so add/change flows outside the program builder
   * keep their current behavior.
   */
  withSetCount?: boolean;
  onDeleteCustom: (name: string) => void;
  onEditCustom: (name: string) => void;
  onCreateCustom: () => void;
  onClose: () => void;
  isDark: boolean;
}

// Flat list rows — section headers + the two exercise kinds, mixed into one
// FlatList so the whole sheet scrolls as a single list.
type Row =
  | { type: "header"; key: string; label: string }
  | { type: "custom"; key: string; exercise: CustomExercise }
  | { type: "exercise"; key: string; exercise: Exercise };

// Fixed row heights — both the row styles AND getItemLayout depend on these,
// so the scroll indicator reflects true content height from the first frame.
const ROW_H = 73;
const HEADER_H = 36;

// ─── Component ────────────────────────────────────────────────────────────────

const MIN_SET_COUNT = 1;
const MAX_SET_COUNT = 10;
const FALLBACK_SET_COUNT = 3;

export default function ExercisePicker({
  visible, subtitle, customExercises, onSelectMultiple, withSetCount, onDeleteCustom, onEditCustom, onCreateCustom, onClose, isDark,
}: ExercisePickerProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [selectedMuscles, setSelectedMuscles] = useState<Set<SelectableMuscle>>(new Set());
  const [pickedOrder, setPickedOrder] = useState<string[]>([]);
  const [setCount, setSetCount] = useState(FALLBACK_SET_COUNT);
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
          ]).start(() => { onClose(); });
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
    // Only call onClose here — do NOT reset slideY/backdropOpacity first. Resetting
    // slideY to 600 (above the off-screen 800) flashes the sheet back up for a frame
    // before it unmounts. The open effect (useEffect([visible])) already re-inits
    // these on reopen, so the reset is redundant. (Matches the drag-to-dismiss path.)
    Animated.parallel([
      Animated.timing(slideY, { toValue: 800, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { onClose(); });
  };

  // Load the remembered "sets per exercise" preference once. Only relevant
  // when the stepper is shown, but loading is harmless either way.
  useEffect(() => {
    if (!withSetCount) return;
    let cancelled = false;
    getJSON<number>(DEFAULT_SET_COUNT_KEY, FALLBACK_SET_COUNT).then(v => {
      if (cancelled) return;
      const n = Math.round(Number(v));
      if (Number.isFinite(n)) setSetCount(Math.max(MIN_SET_COUNT, Math.min(MAX_SET_COUNT, n)));
    });
    return () => { cancelled = true; };
  }, [withSetCount]);

  const changeSetCount = (delta: number) => {
    const next = Math.max(MIN_SET_COUNT, Math.min(MAX_SET_COUNT, setCount + delta));
    if (next === setCount) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSetCount(next);
    setJSON(DEFAULT_SET_COUNT_KEY, next);
  };

  useEffect(() => {
    if (visible) {
      setPickedOrder([]);
      setSearch("");
      slideY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  // ─── Filtering + list assembly ──────────────────────────────────────────────
  // Returns both the rows and a precomputed layout (length + offset per row) so
  // FlatList's getItemLayout is O(1) and the scrollbar is accurate immediately.
  const { listData, layout } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const muscleOk = (m: SelectableMuscle) => selectedMuscles.size === 0 || selectedMuscles.has(m);

    const customs = customExercises.filter(e =>
      (q === "" || e.name.toLowerCase().includes(q)) &&
      (selectedMuscles.size === 0 || e.muscles.some(m => selectedMuscles.has(m)))
    );
    // EXERCISES is the curated catalogue, already sorted alphabetically.
    const matched = EXERCISES.filter(e =>
      (q === "" || e.name.toLowerCase().includes(q) || e.equipment.toLowerCase().includes(q)) &&
      muscleOk(e.primaryMuscle)
    );

    const rows: Row[] = [];
    if (customs.length) {
      rows.push({ type: "header", key: "h:custom", label: "CUSTOM" });
      customs.forEach(e => rows.push({ type: "custom", key: `custom:${e.name}`, exercise: e }));
      rows.push({ type: "header", key: "h:ex", label: "EXERCISES" });
    }
    matched.forEach(e => rows.push({ type: "exercise", key: `ex:${e.id}`, exercise: e }));

    let offset = 0;
    const layout = rows.map(r => {
      const length = r.type === "header" ? HEADER_H : ROW_H;
      const entry = { length, offset };
      offset += length;
      return entry;
    });
    return { listData: rows, layout };
  }, [search, selectedMuscles, customExercises]);

  const canAddCustom = customExercises.length < MAX_CUSTOM;

  const togglePick = (name: string) => {
    setPickedOrder(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const confirmPicks = () => {
    if (pickedOrder.length === 0) return;
    onSelectMultiple(pickedOrder, setCount);
    setPickedOrder([]);
    setSearch("");
  };

  // ─── Row renderers ──────────────────────────────────────────────────────────
  const renderPickBadge = (name: string) => {
    const pickIndex = pickedOrder.indexOf(name);
    const isPicked = pickIndex !== -1;
    return (
      <View style={[styles.pickerAddBtn, isPicked
        ? { backgroundColor: ACCT, borderColor: ACCT }
        : { backgroundColor: ACCT + "22", borderColor: ACCT }
      ]}>
        {isPicked
          ? <Text style={styles.pickerAddNum}>{pickIndex + 1}</Text>
          : <Ionicons name="add" size={18} color={ACCT} />}
      </View>
    );
  };

  const renderRow = (item: Row) => {
    if (item.type === "header") {
      return (
        <View style={styles.pickerSectionHeader}>
          <Text style={[styles.pickerSectionLabel, { color: t.ts }]}>{item.label}</Text>
        </View>
      );
    }

    if (item.type === "custom") {
      const e = item.exercise;
      return (
        <TouchableOpacity
          onPress={() => togglePick(e.name)}
          activeOpacity={0.6}
          style={[styles.pickerRow, { borderBottomColor: t.div }]}
        >
          <ExerciseImage exerciseId={`custom:${e.name}`} overrideUri={e.imageUri} variant="thumb" size={52} radius={10}
            backgroundColor={t.div} fallbackColor={t.ts} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.pickerExName, { color: t.tp }]} numberOfLines={1}>{e.name}</Text>
            <Text style={[styles.pickerExMeta, { color: t.ts }]} numberOfLines={1}>
              {e.muscles.join(", ") || "Custom"}
            </Text>
          </View>
          <TouchableOpacity
            onPress={ev => { ev.stopPropagation(); onEditCustom(e.name); }}
            style={styles.pickerDeleteBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={16} color={t.ts} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={ev => {
              ev.stopPropagation();
              Alert.alert(
                "Delete Exercise",
                `Are you sure you want to delete "${e.name}"? This will free up a slot.`,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => onDeleteCustom(e.name) },
                ]
              );
            }}
            style={styles.pickerDeleteBtn}
            activeOpacity={0.7}
          >
            <TrashIcon size={16} color="#FF4D4F" />
          </TouchableOpacity>
          {renderPickBadge(e.name)}
        </TouchableOpacity>
      );
    }

    // type === "exercise"
    const e = item.exercise;
    return (
      <TouchableOpacity
        onPress={() => togglePick(e.name)}
        activeOpacity={0.6}
        style={[styles.pickerRow, { borderBottomColor: t.div }]}
      >
        <ExerciseImage exerciseId={e.id} variant="thumb" size={52} radius={10}
          backgroundColor={t.div} fallbackColor={t.ts} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.pickerExName, { color: t.tp }]} numberOfLines={1}>{e.name}</Text>
          <Text style={[styles.pickerExMeta, { color: t.ts }]} numberOfLines={1}>
            {e.equipment} · {e.primaryMuscle}
          </Text>
        </View>
        {renderPickBadge(e.name)}
      </TouchableOpacity>
    );
  };

  // presentationStyle="overFullScreen" presents over the current screen WITHOUT
  // detaching it. Without this, iOS removes the screen behind the modal while it's up
  // and re-attaches it on dismiss, flashing the nav bar / bottom buttons for a frame
  // as the sheet finishes sliding down. statusBarTranslucent does the same on Android.
  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={styles.pickerBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.pickerOverlay, { opacity: backdropOpacity }]} />
        <Animated.View style={[styles.pickerRoot, { backgroundColor: t.bg, transform: [{ translateY: slideY }] }]}>
          {/* Drag handle */}
          <View {...panResponder.panHandlers} style={styles.pickerHandleArea}>
            <View style={styles.pickerHandle} />
          </View>

          {/* Header */}
          <View style={[styles.pickerHeader, { borderBottomColor: t.div }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pickerTitle, { color: t.tp }]}>Add Exercise</Text>
              <Text style={[styles.pickerSubtitle, { color: t.ts }]}>{subtitle}</Text>
            </View>
            <TouchableOpacity onPress={dismiss} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={t.tp} />
            </TouchableOpacity>
          </View>

          {/* Muscle group filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.muscleChipScroll, { borderBottomColor: t.div }]}
            contentContainerStyle={styles.muscleChipContent}
          >
            {MUSCLE_GROUPS.map(group => {
              const isAll = group === "All";
              const active = isAll ? selectedMuscles.size === 0 : selectedMuscles.has(group as SelectableMuscle);
              return (
                <TouchableOpacity
                  key={group}
                  onPress={() => {
                    if (isAll) {
                      setSelectedMuscles(new Set());
                    } else {
                      setSelectedMuscles(prev => {
                        const next = new Set(prev);
                        if (next.has(group as SelectableMuscle)) next.delete(group as SelectableMuscle);
                        else next.add(group as SelectableMuscle);
                        return next;
                      });
                    }
                  }}
                  activeOpacity={0.7}
                  style={[styles.muscleChip, active ? {
                    backgroundColor: ACCT,
                    shadowColor: ACCT,
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.5,
                    shadowRadius: 8,
                  } : { backgroundColor: t.div }]}
                >
                  <Text style={[styles.muscleChipText, { color: active ? "#fff" : t.ts }]}>{group}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Search */}
          <View style={[styles.searchRow, { borderBottomColor: t.div }]}>
            <Ionicons name="search-outline" size={16} color={t.ts} />
            <TextInput
              style={[styles.searchInput, { color: t.tp }]}
              placeholder="Search exercises..."
              placeholderTextColor={t.ts}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")} activeOpacity={0.7} hitSlop={8} accessibilityLabel="Clear search" accessibilityRole="button">
                <Ionicons name="close-circle" size={20} color={t.ts} />
              </TouchableOpacity>
            )}
          </View>

          {/* Exercise list. Images are bundled require() assets (synchronous),
              so FlatList virtualization stays smooth even across 800+ rows. */}
          <FlatList
            data={listData}
            keyExtractor={item => item.key}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={true}
            indicatorStyle={isDark ? "white" : "black"}
            style={{ flex: 1 }}
            renderItem={({ item }) => renderRow(item)}
            getItemLayout={(_, index) => {
              const l = layout[index] ?? { length: ROW_H, offset: index * ROW_H };
              return { length: l.length, offset: l.offset, index };
            }}
            ListEmptyComponent={
              <Text style={[styles.pickerEmpty, { color: t.ts }]}>No exercises found</Text>
            }
            contentContainerStyle={{ paddingBottom: 8 }}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={11}
            removeClippedSubviews
          />

          {/* Bottom bar — confirm picks OR create custom */}
          <View style={[styles.customSection, { borderTopColor: t.div, paddingBottom: insets.bottom + 16 }]}>
            {pickedOrder.length > 0 ? (
              <View style={styles.confirmRow}>
                {withSetCount && (
                  <View style={[styles.setCountBox, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div }]}>
                    <TouchableOpacity
                      onPress={() => changeSetCount(-1)}
                      style={styles.setCountBtn}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                      accessibilityLabel="Fewer sets per exercise"
                      accessibilityRole="button"
                    >
                      <Ionicons name="remove" size={16} color={setCount <= MIN_SET_COUNT ? t.ts : t.tp} />
                    </TouchableOpacity>
                    <View style={styles.setCountMid}>
                      <Text style={[styles.setCountNum, { color: t.tp }]}>{setCount}</Text>
                      <Text style={[styles.setCountLabel, { color: t.ts }]}>{setCount === 1 ? "set" : "sets"}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => changeSetCount(1)}
                      style={styles.setCountBtn}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                      accessibilityLabel="More sets per exercise"
                      accessibilityRole="button"
                    >
                      <Ionicons name="add" size={16} color={setCount >= MAX_SET_COUNT ? t.ts : t.tp} />
                    </TouchableOpacity>
                  </View>
                )}
                <BounceButton style={{ flex: 1 }} onPress={confirmPicks} accessibilityLabel={`Add ${pickedOrder.length} exercise${pickedOrder.length > 1 ? "s" : ""}`} accessibilityRole="button">
                  <View style={styles.createCustomBtnWrap}>
                    <View style={styles.createCustomBtn}>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={styles.createCustomBtnText}>
                        Add {pickedOrder.length} Exercise{pickedOrder.length > 1 ? "s" : ""}
                      </Text>
                    </View>
                  </View>
                </BounceButton>
              </View>
            ) : canAddCustom ? (
              <BounceButton onPress={onCreateCustom} accessibilityLabel="Create custom exercise" accessibilityRole="button">
                <View style={styles.createCustomBtnWrap}>
                  <View style={styles.createCustomBtn}>
                    <Ionicons name="add-circle-outline" size={18} color="#fff" />
                    <Text style={styles.createCustomBtnText}>Create Custom Exercise</Text>
                  </View>
                </View>
              </BounceButton>
            ) : (
              <Text style={[styles.customSlots, { color: t.ts, textAlign: "center" }]}>
                Custom exercise limit reached (5/5). Delete one to add more.
              </Text>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pickerBackdrop:      { flex: 1, justifyContent: "flex-end" },
  pickerOverlay:       { backgroundColor: "rgba(0,0,0,0.45)" },
  pickerRoot:          { height: "88%", borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  pickerHandleArea:    { paddingVertical: 12, alignItems: "center" },
  pickerHandle:        { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  pickerHeader:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1 },
  pickerTitle:         { fontFamily: FontFamily.bold, fontSize: 20, marginBottom: 2 },
  pickerSubtitle:      { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1 },
  muscleChipScroll:    { flexGrow: 0, flexShrink: 0, borderBottomWidth: 1 },
  muscleChipContent:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  muscleChip:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  muscleChipText:      { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
  searchRow:           { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  searchInput:         { flex: 1, fontFamily: FontFamily.regular, fontSize: 15 },
  pickerSectionHeader: { height: HEADER_H, justifyContent: "flex-end", paddingHorizontal: 16, paddingBottom: 6 },
  pickerSectionLabel:  { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 1.2 },
  pickerRow:           { height: ROW_H, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: 1, gap: 12 },
  pickerExName:        { fontFamily: FontFamily.semibold, fontSize: 15 },
  pickerExMeta:        { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  pickerDeleteBtn:     { padding: 4 },
  pickerAddBtn:        { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pickerAddNum:        { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
  pickerEmpty:         { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 40 },
  customSection:       { paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1, gap: 10 },
  customSlots:         { fontFamily: FontFamily.regular, fontSize: 12 },
  confirmRow:          { flexDirection: "row", alignItems: "stretch", gap: 10 },
  setCountBox:         { flexDirection: "row", alignItems: "center", borderRadius: 14, paddingHorizontal: 4 },
  setCountBtn:         { paddingHorizontal: 9, alignSelf: "stretch", justifyContent: "center" },
  setCountMid:         { alignItems: "center", minWidth: 32 },
  setCountNum:         { fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 19 },
  setCountLabel:       { fontFamily: FontFamily.semibold, fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase" },
  createCustomBtnWrap: { borderRadius: 14, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  createCustomBtn:     { borderRadius: 14, backgroundColor: ACCT, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  createCustomBtnText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
});
