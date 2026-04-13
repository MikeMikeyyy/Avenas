import { useState, useEffect, useRef } from "react";
import {
  Modal, View, Text, StyleSheet, ScrollView, FlatList,
  TextInput, TouchableOpacity, Animated, Easing, PanResponder,
  Keyboard, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import {
  MUSCLE_GROUPS, MAX_CUSTOM,
  type MuscleGroup, type SelectableMuscle, type CustomExercise,
} from "../constants/exercises";
import TrashIcon from "./TrashIcon";
import BounceButton from "./BounceButton";

// ─── Data ─────────────────────────────────────────────────────────────────────

const PRESET_EXERCISES = [
  "Barbell Back Squat", "Front Squat", "Romanian Deadlift", "Leg Press",
  "Leg Curl", "Leg Extension", "Hip Thrust",
  "Bench Press", "Incline Dumbbell Press", "Cable Fly",
  "Overhead Press", "Lateral Raise", "Face Pull",
  "Barbell Row", "Lat Pulldown", "Seated Cable Row", "Pull-Up",
  "Tricep Pushdown", "Barbell Curl", "Deadlift",
];

const EXERCISE_MUSCLE: Record<string, MuscleGroup> = {
  "Barbell Back Squat": "Legs",  "Front Squat": "Legs",
  "Romanian Deadlift": "Legs",   "Leg Press": "Legs",
  "Leg Curl": "Legs",            "Leg Extension": "Legs",
  "Hip Thrust": "Legs",
  "Bench Press": "Chest",        "Incline Dumbbell Press": "Chest",  "Cable Fly": "Chest",
  "Overhead Press": "Shoulders", "Lateral Raise": "Shoulders",       "Face Pull": "Shoulders",
  "Barbell Row": "Back",         "Lat Pulldown": "Back",
  "Seated Cable Row": "Back",    "Pull-Up": "Back",                  "Deadlift": "Back",
  "Tricep Pushdown": "Arms",     "Barbell Curl": "Arms",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExercisePickerProps {
  visible: boolean;
  /** Short string shown below the title, e.g. "PUSH DAY" or "CHANGE EXERCISE" */
  subtitle: string;
  customExercises: CustomExercise[];
  onSelect: (name: string) => void;
  onDeleteCustom: (name: string) => void;
  onCreateCustom: () => void;
  onClose: () => void;
  isDark: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExercisePicker({
  visible, subtitle, customExercises, onSelect, onDeleteCustom, onCreateCustom, onClose, isDark,
}: ExercisePickerProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup>("All");
  const slideY = useRef(new Animated.Value(600)).current;
  const kbTranslate = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const combinedY = useRef(Animated.add(slideY, kbTranslate)).current;

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
          ]).start(() => { slideY.setValue(0); backdropOpacity.setValue(1); onClose(); });
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
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => {
      Animated.timing(kbTranslate, {
        toValue: -(e.endCoordinates.height - insets.bottom),
        duration: e.duration, easing: Easing.out(Easing.ease), useNativeDriver: true,
      }).start();
    });
    const hide = Keyboard.addListener("keyboardWillHide", e => {
      Animated.timing(kbTranslate, {
        toValue: 0, duration: e.duration, easing: Easing.in(Easing.ease), useNativeDriver: true,
      }).start();
    });
    return () => { show.remove(); hide.remove(); };
  }, [insets.bottom]);

  const filteredPresets = PRESET_EXERCISES.filter(e =>
    e.toLowerCase().includes(search.toLowerCase()) &&
    (selectedMuscle === "All" || EXERCISE_MUSCLE[e] === selectedMuscle)
  );
  const filteredCustom = customExercises.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) &&
    (selectedMuscle === "All" || e.muscles.includes(selectedMuscle as SelectableMuscle))
  );

  const canAddCustom = customExercises.length < MAX_CUSTOM;
  const allFiltered = [
    ...filteredCustom.map(e => ({ name: e.name, isCustom: true })),
    ...filteredPresets.map(e => ({ name: e, isCustom: false })),
  ];

  const handleSelect = (name: string) => {
    onSelect(name);
    setSearch("");
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <View style={styles.pickerBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.pickerOverlay, { opacity: backdropOpacity }]} />
        <Animated.View style={[styles.pickerRoot, { backgroundColor: t.bg, transform: [{ translateY: combinedY }] }]}>
          {/* Drag handle */}
          <View {...panResponder.panHandlers} style={styles.pickerHandleArea}>
            <View style={styles.pickerHandle} />
          </View>

          {/* Header */}
          <View style={[styles.pickerHeader, { borderBottomColor: t.div }]}>
            <Text style={[styles.pickerTitle, { color: t.tp }]}>Add Exercise</Text>
            <Text style={[styles.pickerSubtitle, { color: t.ts }]}>{subtitle}</Text>
            <TouchableOpacity onPress={dismiss} style={styles.pickerClose} activeOpacity={0.7}>
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
              const active = selectedMuscle === group;
              return (
                <TouchableOpacity
                  key={group}
                  onPress={() => setSelectedMuscle(group)}
                  activeOpacity={0.7}
                  style={[styles.muscleChip, active ? { backgroundColor: ACCT } : { backgroundColor: t.div }]}
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
              <TouchableOpacity onPress={() => setSearch("")} activeOpacity={0.7}>
                <Ionicons name="close-circle" size={16} color={t.ts} />
              </TouchableOpacity>
            )}
          </View>

          {/* Exercise list */}
          <FlatList
            data={allFiltered}
            keyExtractor={item => item.name}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            ListHeaderComponent={
              filteredCustom.length > 0 && search.length === 0 ? (
                <Text style={[styles.pickerSectionLabel, { color: t.ts }]}>CUSTOM</Text>
              ) : null
            }
            renderItem={({ item, index }) => {
              const isLastCustom = item.isCustom && index === filteredCustom.length - 1;
              const isFirstPreset = !item.isCustom && filteredCustom.length > 0 && index === filteredCustom.length;
              return (
                <>
                  {isFirstPreset && (
                    <Text style={[styles.pickerSectionLabel, { color: t.ts }]}>EXERCISES</Text>
                  )}
                  <TouchableOpacity
                    onPress={() => handleSelect(item.name)}
                    activeOpacity={0.6}
                    style={[
                      styles.pickerRow,
                      { borderBottomColor: t.div },
                      isLastCustom && { marginBottom: 8 },
                    ]}
                  >
                    <Text style={[styles.pickerExName, { color: t.tp }]}>{item.name}</Text>
                    {item.isCustom && (
                      <TouchableOpacity
                        onPress={e => {
                          e.stopPropagation();
                          Alert.alert(
                            "Delete Exercise",
                            `Are you sure you want to delete "${item.name}"? This will free up a slot.`,
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Delete", style: "destructive", onPress: () => onDeleteCustom(item.name) },
                            ]
                          );
                        }}
                        style={styles.pickerDeleteBtn}
                        activeOpacity={0.7}
                      >
                        <TrashIcon size={16} color={t.ts} />
                      </TouchableOpacity>
                    )}
                    <View style={[styles.pickerAddBtn, { backgroundColor: ACCT + "22", borderColor: ACCT }]}>
                      <Ionicons name="add" size={18} color={ACCT} />
                    </View>
                  </TouchableOpacity>
                </>
              );
            }}
            ListEmptyComponent={
              <Text style={[styles.pickerEmpty, { color: t.ts }]}>No exercises found</Text>
            }
            contentContainerStyle={{ paddingBottom: 8 }}
          />

          {/* Create custom — pinned at bottom */}
          <View style={[styles.customSection, { borderTopColor: t.div, paddingBottom: insets.bottom + 16 }]}>
            {canAddCustom ? (
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
  pickerHeader:        { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1 },
  pickerTitle:         { fontFamily: FontFamily.bold, fontSize: 20, marginBottom: 2 },
  pickerSubtitle:      { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1 },
  pickerClose:         { position: "absolute", right: 20, bottom: 16 },
  muscleChipScroll:    { flexGrow: 0, flexShrink: 0, borderBottomWidth: 1 },
  muscleChipContent:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  muscleChip:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  muscleChipText:      { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
  searchRow:           { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  searchInput:         { flex: 1, fontFamily: FontFamily.regular, fontSize: 15 },
  pickerSectionLabel:  { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  pickerRow:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 10 },
  pickerExName:        { flex: 1, fontFamily: FontFamily.regular, fontSize: 15 },
  pickerDeleteBtn:     { padding: 4 },
  pickerAddBtn:        { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pickerEmpty:         { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 40 },
  customSection:       { paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1, gap: 10 },
  customSlots:         { fontFamily: FontFamily.regular, fontSize: 12 },
  createCustomBtnWrap: { borderRadius: 14, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  createCustomBtn:     { borderRadius: 14, backgroundColor: ACCT, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  createCustomBtnText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
});
