import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Modal, View, Text, StyleSheet, ScrollView, FlatList,
  TextInput, TouchableOpacity, Animated, Easing, PanResponder,
  Alert, Keyboard, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, GOLD, GOLD_DARK, NEU_BG, NEU_BG_DARK } from "../constants/theme";
import { pill, pillGlow, PILL_H_SM, PILL_RADIUS, PILL_SHADOW } from "../constants/buttons";
import { DEFAULT_SET_COUNT_KEY } from "../constants/programs";
import { getJSON, setJSON } from "../utils/storage";
import {
  MUSCLE_GROUPS, MAX_CUSTOM, FAVOURITE_EXERCISES_KEY,
  type SelectableMuscle, type CustomExercise, type Exercise,
} from "../constants/exercises";
import { EXERCISES } from "../constants/exerciseData";
import { isFavourite as isFav, sortByMuscleThenName, toggleFavourite } from "../utils/exerciseFavourites";
import ExerciseImage from "./ExerciseImage";
import FavouriteStar from "./FavouriteStar";
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

/** Label colour on the active gold chip. GOLD and GOLD_DARK are both light, so
 *  white would sit at roughly 1.9:1 against them; this dark ink is ~8:1. */
const GOLD_INK = APP_LIGHT.tp;

/** The lift under an active filter chip, in whatever colour the chip is. */
const chipGlow = (color: string, opacity = 0.5) => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: opacity,
  shadowRadius: 8,
});

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
  const [favourites, setFavourites] = useState<string[]>([]);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const gold = isDark ? GOLD_DARK : GOLD;
  const noFilters = selectedMuscles.size === 0 && !favouritesOnly;
  // Height of the keyboard, and of the bottom bar it overlaps. The list needs
  // to scroll past whatever the keyboard hides — see the contentContainerStyle.
  const [kbHeight, setKbHeight] = useState(0);
  const [bottomBarH, setBottomBarH] = useState(0);
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // iOS fires the `will` pair (ahead of the animation, so the padding lands in
  // step with it); Android only ever fires the `did` pair.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const toggleFav = useCallback((name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFavourites(prev => {
      const next = toggleFavourite(prev, name);
      // Optimistic: the list re-sorts on this tick, storage catches up.
      setJSON(FAVOURITE_EXERCISES_KEY, next).catch(() => {});
      return next;
    });
  }, []);

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
      // Re-read on every open: another picker instance (workout, log-workout)
      // may have starred something since this one last mounted.
      getJSON<string[]>(FAVOURITE_EXERCISES_KEY, []).then(v => {
        if (Array.isArray(v)) setFavourites(v.filter((n): n is string => typeof n === "string"));
      }).catch(() => {});
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
  //
  // Starred exercises are HOISTED to a FAVOURITES block at the top, ordered by
  // muscle group then name, and removed from the section they came from — the
  // same exercise appearing twice in one sheet reads as a bug. Search and the
  // muscle chips filter favourites exactly like everything else, so a filtered
  // view never shows a favourite that doesn't match.
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

    const favCustoms = customs.filter(e => isFav(favourites, e.name));
    const favMatched = matched.filter(e => isFav(favourites, e.name));
    // The Favourites chip is a second filter axis, ANDed with the muscle chips:
    // Favourites + Chest means starred chest exercises, not one or the other.
    const restCustoms = favouritesOnly ? [] : customs.filter(e => !isFav(favourites, e.name));
    const restMatched = favouritesOnly ? [] : matched.filter(e => !isFav(favourites, e.name));

    const rows: Row[] = [];

    if (favCustoms.length || favMatched.length) {
      // With the filter on, everything below IS a favourite, so the header would
      // just be labelling the whole list.
      if (!favouritesOnly) rows.push({ type: "header", key: "h:fav", label: "FAVOURITES" });
      // One ordering across both kinds, so a starred custom sits with the other
      // exercises for its muscle group rather than in a clump of its own.
      const favRows: Row[] = [
        ...favCustoms.map((e): Row => ({ type: "custom", key: `fav-custom:${e.name}`, exercise: e })),
        ...favMatched.map((e): Row => ({ type: "exercise", key: `fav-ex:${e.id}`, exercise: e })),
      ];
      sortByMuscleThenName(
        favRows,
        r => (r.type === "custom" ? r.exercise.muscles[0] : r.type === "exercise" ? r.exercise.primaryMuscle : undefined),
        r => (r.type === "header" ? r.label : r.exercise.name),
      ).forEach(r => rows.push(r));
    }

    if (restCustoms.length) {
      rows.push({ type: "header", key: "h:custom", label: "CUSTOM" });
      restCustoms.forEach(e => rows.push({ type: "custom", key: `custom:${e.name}`, exercise: e }));
    }
    if (restMatched.length && (rows.length > 0)) {
      rows.push({ type: "header", key: "h:ex", label: "EXERCISES" });
    }
    restMatched.forEach(e => rows.push({ type: "exercise", key: `ex:${e.id}`, exercise: e }));

    let offset = 0;
    const layout = rows.map(r => {
      const length = r.type === "header" ? HEADER_H : ROW_H;
      const entry = { length, offset };
      offset += length;
      return entry;
    });
    return { listData: rows, layout };
  }, [search, selectedMuscles, customExercises, favourites, favouritesOnly]);

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

  /** The thumbnail with its star badge. The star lives ON the image rather than
   *  in the row's button cluster so custom rows don't end up with four controls
   *  side by side — and so catalogue and custom rows toggle in the same place. */
  const renderThumb = (name: string, thumb: React.ReactNode) => {
    const starred = isFav(favourites, name);
    return (
      <View style={styles.thumbWrap}>
        {thumb}
        <TouchableOpacity
          onPress={ev => { ev.stopPropagation(); toggleFav(name); }}
          activeOpacity={0.7}
          hitSlop={10}
          style={[styles.favBadge, {
            backgroundColor: isDark ? NEU_BG_DARK : NEU_BG,
            // The outline is what makes it read as a button, and it's also what
            // lets the disc sit half off the thumbnail without looking broken:
            // the circle is defined by its edge, not by fill-vs-background
            // contrast. t.div disappears on dark, hence the explicit rgba.
            borderColor: isDark ? "rgba(255,255,255,0.22)" : t.div,
          }]}
          accessibilityRole="button"
          accessibilityLabel={starred ? `Unfavourite ${name}` : `Favourite ${name}`}
          accessibilityState={{ selected: starred }}
        >
          <FavouriteStar
            size={13}
            filled={starred}
            inactiveColor={t.ts}
            style={starred ? undefined : styles.favBadgeIdle}
          />
        </TouchableOpacity>
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
          {renderThumb(e.name, (
            <ExerciseImage exerciseId={`custom:${e.name}`} overrideUri={e.imageUri} variant="thumb" size={52} radius={10}
              backgroundColor={t.div} fallbackColor={t.ts} />
          ))}
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
        {renderThumb(e.name, (
          <ExerciseImage exerciseId={e.id} variant="thumb" size={52} radius={10}
            backgroundColor={t.div} fallbackColor={t.ts} />
        ))}
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

          {/* Header. The chrome below it used to be three bands each with its own
              hairline (header / chips / search), which is what made the sheet
              feel crowded — now the whole cluster is one block and a single
              divider separates it from the list. */}
          <View style={styles.pickerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pickerTitle, { color: t.tp }]}>Add Exercise</Text>
              <Text style={[styles.pickerSubtitle, { color: t.ts }]}>{subtitle}</Text>
            </View>
            <TouchableOpacity onPress={dismiss} activeOpacity={0.7} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={t.tp} />
            </TouchableOpacity>
          </View>

          {/* Search. A filled, fully-rounded field rather than a bare row of text
              between two hairlines — it reads as something you can type into. */}
          <View style={[styles.searchRow, { backgroundColor: t.ctrl, borderColor: t.div }]}>
            <Ionicons name="search" size={17} color={t.ts} />
            <TextInput
              style={[styles.searchInput, { color: t.tp }]}
              placeholder="Search exercises"
              placeholderTextColor={t.ts}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")} activeOpacity={0.7} hitSlop={8} accessibilityLabel="Clear search" accessibilityRole="button">
                <Ionicons name="close-circle" size={19} color={t.ts} />
              </TouchableOpacity>
            )}
          </View>

          {/* Muscle group filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.muscleChipScroll}
            contentContainerStyle={styles.muscleChipContent}
          >
            {/* All — the reset. Active only when nothing else is, favourites
                included, since Favourites is a second filter axis and not a
                muscle group. */}
            <TouchableOpacity
              onPress={() => { setSelectedMuscles(new Set()); setFavouritesOnly(false); }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: noFilters }}
              style={[styles.muscleChip, noFilters
                ? { backgroundColor: ACCT, ...chipGlow(ACCT) }
                : { backgroundColor: t.div }]}
            >
              <Text style={[styles.muscleChipText, { color: noFilters ? "#fff" : t.ts }]}>All</Text>
            </TouchableOpacity>

            {/* Favourites — gold rather than the accent green, so the filter
                matches the stars it selects for. Combines with the muscle chips
                (Favourites + Chest = starred chest exercises). */}
            <TouchableOpacity
              onPress={() => setFavouritesOnly(v => !v)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Filter to favourites"
              accessibilityState={{ selected: favouritesOnly }}
              style={[styles.muscleChip, styles.favChip, favouritesOnly
                ? { backgroundColor: gold, ...chipGlow(gold, isDark ? 0.4 : 0.55) }
                : { backgroundColor: t.div }]}
            >
              {/* A plain glyph, not <FavouriteStar />: on an active gold chip a
                  gold star with a gold glow disappears into its own background.
                  This star labels the filter, it isn't a favourite indicator. */}
              <Ionicons
                name={favouritesOnly ? "star" : "star-outline"}
                size={12}
                color={favouritesOnly ? GOLD_INK : t.ts}
              />
              {/* Gold is light in both themes, so white text on it is barely
                  legible — the active label takes a dark ink instead. */}
              <Text style={[styles.muscleChipText, { color: favouritesOnly ? GOLD_INK : t.ts }]}>
                Favourites
              </Text>
            </TouchableOpacity>

            {MUSCLE_GROUPS.filter(g => g !== "All").map(group => {
              const muscle = group as SelectableMuscle;
              const active = selectedMuscles.has(muscle);
              return (
                <TouchableOpacity
                  key={group}
                  onPress={() => {
                    setSelectedMuscles(prev => {
                      const next = new Set(prev);
                      if (next.has(muscle)) next.delete(muscle);
                      else next.add(muscle);
                      return next;
                    });
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.muscleChip, active
                    ? { backgroundColor: ACCT, ...chipGlow(ACCT) }
                    : { backgroundColor: t.div }]}
                >
                  <Text style={[styles.muscleChipText, { color: active ? "#fff" : t.ts }]}>{group}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={[styles.chromeDivider, { backgroundColor: t.div }]} />

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
              <Text style={[styles.pickerEmpty, { color: t.ts }]}>
                {favouritesOnly && favourites.length === 0
                  ? "No favourites yet. Tap the star on an exercise to add one."
                  : "No exercises found"}
              </Text>
            }
            // The sheet is a fixed height anchored to the screen bottom, so the
            // keyboard covers the bottom bar first and then eats into the list.
            // Padding by exactly the overlap lets the last row scroll clear of
            // the keyboard, and collapses back to the default when it goes down
            // so the list still ends at the bottom of the sheet.
            contentContainerStyle={{ paddingBottom: 8 + Math.max(0, kbHeight - bottomBarH) }}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={11}
            removeClippedSubviews
          />

          {/* Bottom bar — confirm picks OR create custom */}
          <View
            onLayout={e => setBottomBarH(e.nativeEvent.layout.height)}
            style={[styles.customSection, { borderTopColor: t.div, paddingBottom: insets.bottom + 16 }]}
          >
            {pickedOrder.length > 0 ? (
              <View style={styles.confirmRow}>
                {withSetCount && (
                  <View style={[styles.setCountBox, { backgroundColor: t.div }]}>
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
  pickerHandleArea:    { paddingTop: 10, paddingBottom: 6, alignItems: "center" },
  pickerHandle:        { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  pickerHeader:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  pickerTitle:         { fontFamily: FontFamily.bold, fontSize: 20, marginBottom: 2 },
  pickerSubtitle:      { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1 },
  muscleChipScroll:    { flexGrow: 0, flexShrink: 0 },
  muscleChipContent:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  muscleChip:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: PILL_RADIUS, alignItems: "center", justifyContent: "center" },
  favChip:             { flexDirection: "row", gap: 5, paddingLeft: 11 },
  muscleChipText:      { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
  searchRow:           { flexDirection: "row", alignItems: "center", gap: 9, marginHorizontal: 16, paddingHorizontal: 14, height: 42, borderRadius: PILL_RADIUS, borderWidth: 1, ...PILL_SHADOW },
  searchInput:         { flex: 1, fontFamily: FontFamily.regular, fontSize: 15, padding: 0 },
  chromeDivider:       { height: StyleSheet.hairlineWidth },
  thumbWrap:           { width: 52, height: 52 },
  // Perched on the thumbnail's top-right CORNER, mostly outside it, so it clips
  // about a ninth of the artwork instead of sitting on top of the subject.
  // It survives hanging off the edge because the outline + opaque fill define
  // the circle on their own; the earlier version had neither, filled itself
  // with the row's own background, and so only showed up where it happened to
  // overlap the image.
  favBadge:            { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center", ...PILL_SHADOW },
  // The hollow star sits on every unstarred row, so it has to recede rather
  // than read as 800 controls demanding attention.
  favBadgeIdle:        { opacity: 0.45 },
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
  createCustomBtnWrap: { borderRadius: PILL_RADIUS, backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) },
  createCustomBtn:     { ...pill(PILL_H_SM), backgroundColor: ACCT, gap: 8 },
  createCustomBtnText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
});
