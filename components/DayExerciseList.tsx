import { useState, useMemo, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing as ReEasing } from "react-native-reanimated";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import DumbbellIcon from "./DumbbellIcon";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { collectLoggedExercisesForDay, sessionCountForDay } from "../utils/progressStats";
import type { CompletedWorkout } from "../constants/programs";
import type { LoggedExerciseRow } from "../constants/progress";

interface Props {
  /** Unique non-Rest day names from the in-scope program(s). */
  days: string[];
  /** Workouts already filtered to the active scope. */
  workouts: CompletedWorkout[];
  /** Currently selected exercise name (case-insensitive), or null. */
  selectedExercise: string | null;
  onSelectExercise: (name: string) => void;
}

// Accordion panel — animates height between 0 and the children's measured
// natural height. Measures once via a hidden absolute layer, then re-uses the
// captured value. Same pattern as programs.tsx's ExpandablePanel.
function ExpandablePanel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  const height = useSharedValue(0);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    if (measuredHeight === null) return;
    height.value = withTiming(expanded ? measuredHeight : 0, {
      duration: 280,
      easing: ReEasing.out(ReEasing.cubic),
    });
  }, [expanded, measuredHeight, height]);

  const style = useAnimatedStyle(() => ({ height: height.value, overflow: "hidden" as const }));

  return (
    <View>
      {measuredHeight === null && (
        <View
          style={{ position: "absolute", left: 0, right: 0, top: 0, opacity: 0 }}
          pointerEvents="none"
          onLayout={e => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) setMeasuredHeight(h);
          }}
        >
          {children}
        </View>
      )}
      <Reanimated.View style={style}>
        <View style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
          {children}
        </View>
      </Reanimated.View>
    </View>
  );
}

const RotatingChevron = ({ color, rotated }: { color: string; rotated: boolean }) => {
  const r = useSharedValue(rotated ? 1 : 0);
  useEffect(() => {
    r.value = withTiming(rotated ? 1 : 0, { duration: 180 });
  }, [rotated, r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 90}deg` }] }));
  return (
    <Reanimated.View style={style}>
      <Ionicons name="chevron-forward" size={16} color={color} />
    </Reanimated.View>
  );
};

/**
 * Drill-down list of workout days. Each day row is tappable and expands to
 * reveal the exercises that have been logged on that day name across the
 * in-scope completed workouts. Tapping an exercise selects it (the parent
 * Progress screen will render the per-exercise progression chart).
 */
export default function DayExerciseList({ days, workouts, selectedExercise, onSelectExercise }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Precompute counts per day so the row labels are stable.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) m.set(d, sessionCountForDay(workouts, d));
    return m;
  }, [days, workouts]);

  if (days.length === 0) {
    return (
      <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 36 }}>
        <View style={styles.empty}>
          <DumbbellIcon size={28} color={t.ts} />
          <Text style={[styles.emptyText, { color: t.ts }]}>No workout days yet.</Text>
        </View>
      </NeuCard>
    );
  }

  return (
    <View style={{ marginHorizontal: 20, marginTop: 36 }}>
      <Text style={[styles.sectionTitle, { color: t.tp }]}>Exercise Progress</Text>

      {days.map((day, i) => {
        const isOpen = expandedDay === day;
        const c = counts.get(day) ?? 0;
        return (
          <View key={day} style={{ marginTop: i === 0 ? 0 : 12 }}>
            <NeuCard dark={isDark} radius={20}>
              <BounceButton
                onPress={() => setExpandedDay(prev => (prev === day ? null : day))}
                accessibilityRole="button"
                accessibilityLabel={`${day} — ${c} session${c === 1 ? "" : "s"} logged`}
              >
                <View style={styles.dayRow}>
                  <Text style={[styles.dayName, { color: t.tp }]} numberOfLines={1}>{day}</Text>
                  <Text style={[styles.daySub, { color: t.ts }]} numberOfLines={1}>
                    {c === 0 ? "No sessions yet" : `${c} session${c === 1 ? "" : "s"}`}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <RotatingChevron color={t.ts} rotated={isOpen} />
                </View>
              </BounceButton>

              <ExpandablePanel expanded={isOpen}>
                <ExpandedExercises
                  workouts={workouts}
                  day={day}
                  selectedExercise={selectedExercise}
                  onSelectExercise={onSelectExercise}
                  textPrimary={t.tp}
                  textSecondary={t.ts}
                  divider={t.div}
                />
              </ExpandablePanel>
            </NeuCard>
          </View>
        );
      })}
    </View>
  );
}

function ExpandedExercises({
  workouts,
  day,
  selectedExercise,
  onSelectExercise,
  textPrimary,
  textSecondary,
  divider,
}: {
  workouts: CompletedWorkout[];
  day: string;
  selectedExercise: string | null;
  onSelectExercise: (name: string) => void;
  textPrimary: string;
  textSecondary: string;
  divider: string;
}) {
  const rows: LoggedExerciseRow[] = useMemo(
    () => collectLoggedExercisesForDay(workouts, day),
    [workouts, day],
  );

  if (rows.length === 0) {
    return (
      <View style={[styles.expandedBody, { borderTopColor: divider }]}>
        <Text style={[styles.placeholder, { color: textSecondary }]}>
          No exercises logged on this day yet.
        </Text>
      </View>
    );
  }

  const selKey = selectedExercise?.trim().toLowerCase() ?? "";

  return (
    <View style={[styles.expandedBody, { borderTopColor: divider }]}>
      {rows.map((r, i) => {
        const k = r.name.trim().toLowerCase();
        const selected = k === selKey;
        return (
          <TouchableOpacity
            key={`${k}-${i}`}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelectExercise(r.name);
            }}
            style={[styles.exRow, i > 0 && { marginTop: 2 }]}
            accessibilityRole="button"
            accessibilityLabel={r.name}
            accessibilityState={{ selected }}
          >
            {selected ? <View style={styles.exAccent} /> : null}
            <Text style={[styles.exName, { color: selected ? ACCT : textPrimary, flex: 1 }]} numberOfLines={1}>
              {r.name}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={selected ? ACCT : textSecondary} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 18, marginBottom: 12 },

  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  dayName: { fontFamily: FontFamily.bold, fontSize: 15 },
  daySub: { fontFamily: FontFamily.regular, fontSize: 12 },

  expandedBody: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  exRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingLeft: 10,
    gap: 8,
  },
  // Selected exercise indicator: 3px ACCT bar pinned to the row's left edge.
  exAccent: {
    position: "absolute",
    left: 0,
    top: 5,
    bottom: 5,
    width: 3,
    borderRadius: 2,
    backgroundColor: ACCT,
  },
  exName: { fontFamily: FontFamily.semibold, fontSize: 14 },
  placeholder: { fontFamily: FontFamily.regular, fontSize: 13, paddingVertical: 8, textAlign: "center" },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
});
