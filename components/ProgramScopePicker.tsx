import { useState, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Animated,
  Easing,
} from "react-native";
import * as Haptics from "expo-haptics";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import type { SavedProgram } from "../constants/programs";
import type { ProgramScope } from "../constants/progress";

interface Props {
  scope: ProgramScope;
  programs: SavedProgram[];
  onChange: (s: ProgramScope) => void;
}

const ChevronDown = ({ color, size = 16 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const CheckIcon = ({ color, size = 16 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 12.5l4.5 4.5L19 7" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export default function ProgramScopePicker({ scope, programs, onChange }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // Sheet has to stay mounted during the close animation so the user actually
  // sees the slide-out. We toggle `visible` (modal-mounted) and `open`
  // (open-state for animations) separately.
  const [mounted, setMounted] = useState(false);

  // Slide-up + backdrop fade — same pattern as SetWorkoutPicker / ExercisePicker.
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      slideY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, {
          toValue: 0,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slideY, {
          toValue: 600,
          duration: 260,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, mounted, slideY, backdropOpacity]);

  const activeProgram = useMemo(() => programs.find(p => p.status === "active") ?? null, [programs]);

  const currentLabel = useMemo(() => {
    if (scope.kind === "current") {
      return activeProgram ? activeProgram.name : "Current program";
    }
    if (scope.kind === "all") return "All programs";
    const found = programs.find(p => p.id === scope.programId);
    return found?.name ?? "Program";
  }, [scope, programs, activeProgram]);

  const isSelected = (s: ProgramScope): boolean => {
    if (s.kind !== scope.kind) return false;
    if (s.kind === "program" && scope.kind === "program") return s.programId === scope.programId;
    return true;
  };

  const choose = (next: ProgramScope) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(false);
    if (!isSelected(next)) onChange(next);
  };

  // Programs list for the bottom section. Excludes the active program — it's
  // already represented by the "Current program" entry above. Sorted by name
  // with paused → completed status order so newer/relevant entries surface
  // first.
  const sortedPrograms = useMemo(() => {
    const order: Record<SavedProgram["status"], number> = { active: 0, created: 1, paused: 2, completed: 3 };
    return [...programs]
      .filter(p => p.status !== "active")
      .sort((a, b) => {
        const sd = (order[a.status] ?? 4) - (order[b.status] ?? 4);
        if (sd !== 0) return sd;
        return a.name.localeCompare(b.name);
      });
  }, [programs]);

  return (
    <>
      <BounceButton
        accessibilityRole="button"
        accessibilityLabel={`Select program scope, currently ${currentLabel}`}
        onPress={() => setOpen(true)}
        style={{ marginHorizontal: 20 }}
      >
        <NeuCard dark={isDark} radius={16} shadowSize="sm">
          <View style={styles.pillRow}>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              <View style={[styles.dot, { backgroundColor: scope.kind === "all" ? t.ts : ACCT }]} />
              <Text style={[styles.pillText, { color: t.tp }]} numberOfLines={1}>
                {currentLabel}
              </Text>
            </View>
            <ChevronDown color={t.ts} />
          </View>
        </NeuCard>
      </BounceButton>

      <Modal visible={mounted} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1 }}>
          {/* Animated backdrop */}
          <TouchableWithoutFeedback onPress={() => setOpen(false)}>
            <Animated.View
              style={[
                StyleSheet.absoluteFillObject,
                { backgroundColor: "rgba(0,0,0,0.45)", opacity: backdropOpacity },
              ]}
            />
          </TouchableWithoutFeedback>

          {/* Slide-up sheet */}
          <View style={styles.sheetWrap} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.sheet,
                {
                  backgroundColor: t.bg,
                  paddingBottom: insets.bottom + 16,
                  transform: [{ translateY: slideY }],
                },
              ]}
            >
              <View style={styles.handleWrap}>
                <View style={styles.handle} />
              </View>
              <Text style={[styles.sheetTitle, { color: t.tp }]}>Show progress for</Text>

              <ScrollView
                // Negative margin + matching content padding widens the
                // ScrollView so the cards' iOS shadows have horizontal room
                // to render inside the ScrollView's clipped bounds.
                // (Don't add `overflow: "visible"` here — it would let scrolled
                // cards bleed past the sheet's title at the top.)
                style={{ maxHeight: 460, marginHorizontal: -14 }}
                contentContainerStyle={{ paddingTop: 8, paddingBottom: 4, paddingHorizontal: 14 }}
                showsVerticalScrollIndicator={false}
              >
                <ScopeCardRow
                  label="Current program"
                  sublabel={activeProgram?.name ?? "No active program"}
                  selected={scope.kind === "current"}
                  isDark={isDark}
                  textColor={t.tp}
                  subColor={t.ts}
                  onPress={() => choose({ kind: "current" })}
                />
                <ScopeCardRow
                  label="All programs"
                  sublabel="Combined view across every program"
                  selected={scope.kind === "all"}
                  isDark={isDark}
                  textColor={t.tp}
                  subColor={t.ts}
                  onPress={() => choose({ kind: "all" })}
                />

                {sortedPrograms.length > 0 ? (
                  <View style={styles.sectionLabelWrap}>
                    <Text style={[styles.sectionLabel, { color: t.ts }]}>All programs</Text>
                  </View>
                ) : null}

                {sortedPrograms.map(p => {
                  const sel = scope.kind === "program" && scope.programId === p.id;
                  const sub =
                    p.status === "active"
                      ? "Active"
                      : p.status === "completed"
                      ? "Completed"
                      : p.status === "paused"
                      ? "Paused"
                      : "Not started";
                  return (
                    <ScopeCardRow
                      key={p.id}
                      label={p.name}
                      sublabel={sub}
                      showActiveDot={p.status === "active"}
                      selected={sel}
                      isDark={isDark}
                      textColor={t.tp}
                      subColor={t.ts}
                      onPress={() => choose({ kind: "program", programId: p.id })}
                    />
                  );
                })}
              </ScrollView>
            </Animated.View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ScopeCardRow({
  label,
  sublabel,
  selected,
  isDark,
  textColor,
  subColor,
  showActiveDot = false,
  onPress,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  isDark: boolean;
  textColor: string;
  subColor: string;
  showActiveDot?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={styles.rowOuter}
    >
      <NeuCard
        dark={isDark}
        radius={14}
        shadowSize="sm"
        // Suppress NeuCard's faint default hairline border on selected so we
        // see only the green ring overlay below — no double line.
        innerStyle={selected ? { borderWidth: 0 } : undefined}
      >
        <View style={styles.rowInner}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
            {showActiveDot ? <View style={[styles.activeDot, { backgroundColor: ACCT }]} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: textColor }]} numberOfLines={1}>
                {label}
              </Text>
              {sublabel ? (
                <Text style={[styles.rowSub, { color: subColor }]} numberOfLines={1}>
                  {sublabel}
                </Text>
              ) : null}
            </View>
          </View>
          {selected ? <CheckIcon color={ACCT} size={20} /> : null}
        </View>
      </NeuCard>

      {/*
        Green selected-ring overlay — rendered AFTER NeuCard (and therefore
        painted on top of everything inside it, including the inner shadow
        layer that was previously bleeding over the border). Positioned
        absolutely to match NeuCard's outermost edge exactly.
        `pointerEvents="none"` keeps the TouchableOpacity press surface intact.
      */}
      {selected ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: ACCT,
          }}
        />
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  pillText: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    flex: 1,
  },

  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  handleWrap: {
    paddingVertical: 12,
    alignItems: "center",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.4)",
  },
  sheetTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    marginTop: 4,
    marginBottom: 16,
    marginLeft: 4,
  },

  sectionLabelWrap: {
    marginTop: 14,
    marginBottom: 6,
    marginLeft: 6,
  },
  sectionLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  rowOuter: {
    marginBottom: 10,
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 16,
  },
  rowSub: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    marginTop: 2,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 10,
  },
});
