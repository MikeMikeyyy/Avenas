import { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  ScrollView,
  Animated,
  Easing,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import GlassButton from "./GlassButton";
import SheetPill from "./SheetPill";
import { SHEET_DIM, SHEET_TOP_ROW, SheetCloseButton, SheetGlass, sheetFootGap, sheetSurface } from "./SheetChrome";
import { PILL_H_XS, PILL_SHADOW } from "../constants/buttons";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { useSheetDrag } from "../hooks/useSheetDrag";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import type { ProgramScope } from "../constants/progress";
import { CUSTOM_WORKOUTS_NAME, currentScopeProgram } from "../utils/progressStats";

interface Props {
  scope: ProgramScope;
  programs: SavedProgram[];
  /** Every session: which program Current program is turns on whether the
   *  active one has a workout logged (currentScopeProgram). */
  history: CompletedWorkout[];
  onChange: (s: ProgramScope) => void;
  /** Some sessions are in no program (free workouts, imported ones, a deleted
   *  program's): Custom workouts is offered. */
  hasCustom?: boolean;
  /** Where the pill sits in its parent (the Progress page's filter row gives
   *  it `flex: 1` beside the time range). */
  style?: StyleProp<ViewStyle>;
  /** Its sheet, opened from outside (the Progress page's filter dock draws
   *  the button, components/progress/FilterDock.tsx). Left out, the button
   *  opens it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The button unseen, holding its place in the row, for the dock to draw
   *  over (GlassButton's `ghost`). */
  ghost?: boolean;
}

/** The words on the button: the scope, a program's name for one program. */
export function scopeLabel(scope: ProgramScope, programs: readonly SavedProgram[]): string {
  // The words, not the program's name: always one line, the range pill's
  // height (user request, 2026-11-06: a long name took the pill to two
  // lines, taller than the range beside it).
  if (scope.kind === "current") return "Current program";
  if (scope.kind === "all") return "All programs";
  if (scope.kind === "custom") return CUSTOM_WORKOUTS_NAME;
  return programs.find(p => p.id === scope.programId)?.name ?? "Program";
}

const ChevronDown = ({ color, size = 16 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export default function ProgramScopePicker({ scope, programs, history, onChange, hasCustom = false, style, open: openProp, onOpenChange, ghost = false }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => (onOpenChange ? onOpenChange(next) : setOwnOpen(next));
  // Sheet has to stay mounted during the close animation so the user actually
  // sees the slide-out. We toggle `visible` (modal-mounted) and `open`
  // (open-state for animations) separately.
  const [mounted, setMounted] = useState(false);

  // Slide-up + backdrop fade — same pattern as SetWorkoutPicker / ExercisePicker.
  const [slideY] = useState(() => new Animated.Value(600));
  const [backdropOpacity] = useState(() => new Animated.Value(0));

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

  // Held by its top and dragged down, it closes the way a tap outside does.
  const drag = useSheetDrag({ slideY, backdrop: backdropOpacity, onClose: () => setOpen(false) });

  // The active program once a workout's logged in it, else the one finished
  // last.
  const currentProgram = useMemo(() => currentScopeProgram(programs, history), [programs, history]);

  const currentLabel = useMemo(() => scopeLabel(scope, programs), [scope, programs]);

  const isSelected = (s: ProgramScope): boolean => {
    if (s.kind !== scope.kind) return false;
    if (s.kind === "program" && scope.kind === "program") return s.programId === scope.programId;
    return true;
  };

  const choose = (next: ProgramScope) => {
    setOpen(false);
    if (!isSelected(next)) onChange(next);
  };

  // Programs list for the bottom section. Leaves out the one Current program
  // stands for, already the entry above, and nothing else: a new program made
  // active with nothing logged, while Current is still the one finished last,
  // is here to pick. Sorted by name with paused → completed status order so
  // newer/relevant entries surface first.
  const sortedPrograms = useMemo(() => {
    const order: Record<SavedProgram["status"], number> = { active: 0, created: 1, paused: 2, completed: 3 };
    return [...programs]
      .filter(p => p.id !== currentProgram?.id)
      .sort((a, b) => {
        const sd = (order[a.status] ?? 4) - (order[b.status] ?? 4);
        if (sd !== 0) return sd;
        return a.name.localeCompare(b.name);
      });
  }, [programs, currentProgram]);

  return (
    <>
      {/* The app's pill (it was a squared-off NeuCard, the one non-pill
          button on the page), glass on iOS 26 (components/GlassButton.tsx; user
          request, 2026-10-23; the white pill for a moment on 2026-11-15, then
          glass again at the user's word). Laid out as a dropdown: the program
          name reads from the left, the chevron sits at the far end. */}
      <GlassButton
        pill
        // A long program name wraps onto a second line, the pill growing with
        // it, never "…" (user request, 2026-11-06).
        grow
        size={PILL_H_XS}
        ghost={ghost}
        onPress={() => setOpen(true)}
        style={style}
        contentStyle={PROGRAM_SCOPE_FACE}
        solidStyle={PILL_SHADOW}
        accessibilityLabel={programScopeA11y(currentLabel)}
      >
        <ProgramScopeFace scope={scope} programs={programs} />
      </GlassButton>

      <Modal visible={mounted} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1 }}>
          {/* Animated backdrop */}
          <TouchableWithoutFeedback onPress={() => setOpen(false)}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: SHEET_DIM, opacity: backdropOpacity },
              ]}
            />
          </TouchableWithoutFeedback>

          {/* Slide-up sheet */}
          <View style={styles.sheetWrap} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.sheet,
                sheetSurface(t.bg),
                {
                  paddingBottom: sheetFootGap(insets.bottom) + 16,
                  transform: [{ translateY: slideY }],
                },
              ]}
            >
              <SheetGlass />
              <View {...drag}>
                <View style={styles.handleWrap}>
                  <View style={styles.handle} />
                </View>
                <Text style={[styles.sheetTitle, { color: t.tp }]}>Show progress for</Text>
              </View>

              <ScrollView
                // Negative margin + matching content padding widens the
                // ScrollView so the cards' iOS shadows have horizontal room
                // to render inside the ScrollView's clipped bounds.
                // (Don't add `overflow: "visible"` here — it would let scrolled
                // cards bleed past the sheet's title at the top.)
                style={{ maxHeight: 460, marginHorizontal: -14 }}
                contentContainerStyle={{ paddingTop: 8, paddingBottom: 8, paddingHorizontal: 14, gap: 12 }}
                showsVerticalScrollIndicator={false}
              >
                <ScopeCardRow
                  label="Current program"
                  sublabel={currentProgram
                    ? currentProgram.status === "active" ? currentProgram.name : `${currentProgram.name}, finished`
                    : "No active program"}
                  selected={scope.kind === "current"}
                  onPress={() => choose({ kind: "current" })}
                />
                <ScopeCardRow
                  label="All programs"
                  sublabel="Combined view across every program"
                  selected={scope.kind === "all"}
                  onPress={() => choose({ kind: "all" })}
                />
                {hasCustom ? (
                  <ScopeCardRow
                    label={CUSTOM_WORKOUTS_NAME}
                    sublabel="Workouts that aren't in a program"
                    selected={scope.kind === "custom"}
                    onPress={() => choose({ kind: "custom" })}
                  />
                ) : null}

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
                      onPress={() => choose({ kind: "program", programId: p.id })}
                    />
                  );
                })}
              </ScrollView>
              <SheetCloseButton onPress={() => setOpen(false)} />
            </Animated.View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** The button's words for VoiceOver. */
export const programScopeA11y = (label: string) => `Select program scope, currently ${label}`;

/**
 * What's on the button: the dot, the scope's words, the chevron. Its own, so
 * the filter dock (components/progress/FilterDock.tsx) draws the very same
 * face on its big button, laid out with PROGRAM_SCOPE_FACE inside the pill's
 * content (glassContentStyle).
 */
export function ProgramScopeFace({ scope, programs }: { scope: ProgramScope; programs: readonly SavedProgram[] }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const currentLabel = scopeLabel(scope, programs);
  // Whether the label runs past one line at the pill's own size, as measured
  // for it (the unseen copy below), so it steps down to the range pill's size.
  const [fit, setFit] = useState<{ label: string; long: boolean } | null>(null);
  const fitted = fit !== null && fit.label === currentLabel;
  return (
    <>
      <View style={[styles.dot, { backgroundColor: scope.kind === "all" || scope.kind === "custom" ? t.ts : ACCT }]} />
      {/* On one line where it can be: at its own size, else at the size of
          the range pill beside it, and only a name too long even for that
          on two, never "…" (user request, 2026-11-06). Measured unseen at
          its own size first, so it never shows a size it then leaves. */}
      <View style={styles.labelSlot}>
        <Text
          style={[styles.pillText, styles.measure]}
          onTextLayout={e => {
            const long = e.nativeEvent.lines.length > 1;
            setFit(f => (f && f.label === currentLabel && f.long === long ? f : { label: currentLabel, long }));
          }}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {currentLabel}
        </Text>
        <Text
          style={[styles.pillText, fitted && fit.long ? styles.pillTextSmall : null, { color: t.tp }, !fitted && styles.unmeasured]}
          numberOfLines={fitted ? undefined : 1}
        >
          {currentLabel}
        </Text>
      </View>
      <ChevronDown color={t.ts} />
    </>
  );
}

function ScopeCardRow({
  label,
  sublabel,
  selected,
  showActiveDot = false,
  onPress,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  showActiveDot?: boolean;
  onPress: () => void;
}) {
  return (
    <SheetPill
      label={label}
      sub={sublabel}
      selected={selected}
      icon={showActiveDot ? () => <View style={[styles.activeDot, { backgroundColor: ACCT }]} /> : undefined}
      onPress={onPress}
      accessibilityState={{ selected }}
    />
  );
}

const styles = StyleSheet.create({
  // What's on the compact pill (PILL_H_XS), a step down from the full-size one
  // it was (user request, 2026-10-21: the page's two filters stood too tall
  // under its title). DropdownPicker's "bar" beside it matches.
  // The range pill's own padding and about its gap, which leaves the label
  // room for "Current program" on one line on the narrowest phones (at 15
  // there, 17 from a 6.1" phone up).
  trigger: {
    gap: 8,
    paddingHorizontal: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // flex: 1 takes the pill's spare width, so the name starts at the left
  // after the dot and pushes the chevron to the right edge.
  labelSlot: { flex: 1 },
  pillText: {
    fontFamily: FontFamily.bold,
    fontSize: 17,
  },
  // A name too long for one line at 17: the range pill's size beside it
  // (DropdownPicker's bar), no smaller.
  pillTextSmall: { fontSize: 15 },
  // The copy measured at 17, unseen and taking no room.
  measure: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  // Until it's measured: there, holding its line, not yet seen.
  unmeasured: { opacity: 0 },

  sheetWrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  // The grabber row, with the X beside it (SheetChrome).
  handleWrap: {
    ...SHEET_TOP_ROW,
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

  // The list's 12pt gap already sits above and below this.
  sectionLabelWrap: {
    marginTop: 2,
    marginLeft: 6,
  },
  sectionLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});

/** The face's place inside the pill: its padding and the gap between dot,
 *  words and chevron. */
export const PROGRAM_SCOPE_FACE = styles.trigger;
