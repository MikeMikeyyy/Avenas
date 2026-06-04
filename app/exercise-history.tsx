import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import DropdownPicker from "../components/DropdownPicker";
import FadeScreen from "../components/FadeScreen";
import DumbbellIcon from "../components/DumbbellIcon";
import { APP_LIGHT, APP_DARK, FontFamily } from "../constants/theme";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  type SavedProgram,
  type CompletedWorkout,
  type CompletedSet,
} from "../constants/programs";
import {
  EXERCISE_RANGE_OPTIONS,
  type ExerciseRangeKey,
} from "../constants/progress";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { getJSON } from "../utils/storage";
import { MONTH_NAMES } from "../utils/dates";
import { programIncludes } from "../utils/progressStats";

// Day-of-week strings — local format, not from a library to avoid extra deps.
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Matches the warmup-row accent used in workout-detail / log-workout / etc.
const WARMUP_ORANGE = "#ffbf0f";

// "YYYY-MM-DD" → "Mon 7 May"
function fmtSessionDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const date = new Date(y, m - 1, d);
  return `${DAY_SHORT[date.getDay()]} ${d} ${MONTH_NAMES[(m - 1) % 12]}`;
}

// Lowercase-trim match used across the codebase for exercise names.
function key(s: string): string {
  return s.trim().toLowerCase();
}

interface SessionRow {
  workoutId: string;
  date: string;            // YYYY-MM-DD
  completedAt: string;     // ISO
  displayDate: string;     // "Mon 7 May"
  workoutName: string;     // e.g. "Push" / "Pull A" — the day's workout label
  programName: string;     // program label, or "Free workout"
  sets: CompletedSet[];    // working+done sets for this exercise in this session
}

export default function ExerciseHistoryScreen() {
  const router = useRouter();
  const { exerciseName } = useLocalSearchParams<{ exerciseName: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isKg } = useUnit();
  const unit = isKg ? "kg" : "lbs";
  const insets = useSafeAreaInsets();

  const [history, setHistory] = useState<CompletedWorkout[]>([]);
  const [programs, setPrograms] = useState<SavedProgram[]>([]);

  // Sliding-window time range — same options the per-exercise progression
  // chart uses (`EXERCISE_RANGE_OPTIONS`). Default "year" so the user sees
  // the broadest slice first; they can narrow via the dropdown.
  const [range, setRange] = useState<ExerciseRangeKey>("year");
  const rangeOption = useMemo(
    () => EXERCISE_RANGE_OPTIONS.find(r => r.key === range) ?? EXERCISE_RANGE_OPTIONS[2],
    [range],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [h, p] = await Promise.all([
          getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
          getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
        ]);
        if (cancelled) return;
        setHistory(Array.isArray(h) ? h : []);
        setPrograms(Array.isArray(p) ? p : []);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const sessions: SessionRow[] = useMemo(() => {
    if (!exerciseName) return [];
    const want = key(exerciseName);
    // Date cutoff for the active range — sessions older than this are dropped.
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - rangeOption.days);
    const cutoffMs = cutoff.getTime();

    const rows: SessionRow[] = [];
    for (const w of history) {
      // Filter by date window first (cheaper than walking exercises).
      const [yy, mm, dd] = w.date.split("-").map(Number);
      if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) continue;
      if (new Date(yy, mm - 1, dd).getTime() < cutoffMs) continue;
      // Find the matching exercise inside this workout (case-insensitive trim).
      const ex = w.exercises.find(e => key(e.name) === want);
      if (!ex) continue;
      // Include warmup + working — drop only un-done sets. Warmups render
      // with a neutral chip below so the user can still tell them apart.
      const doneSets = ex.sets.filter(s => s.done);
      if (doneSets.length === 0) continue;
      // Resolve the owning program: by stamped id for new records (""/no match
      // → "Free workout"), else the legacy day-name match for old records.
      const owningProgram = w.programId !== undefined
        ? programs.find(p => p.id === w.programId)
        : programs.find(p => programIncludes(p, w.workoutName));
      rows.push({
        workoutId: w.id,
        date: w.date,
        completedAt: w.completedAt,
        displayDate: fmtSessionDate(w.date),
        workoutName: w.workoutName,
        programName: owningProgram?.name ?? "Free workout",
        sets: doneSets,
      });
    }
    // Newest first.
    rows.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return rows;
  }, [history, programs, exerciseName, rangeOption.days]);

  const goToWorkout = (workoutId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/workout-detail", params: { id: workoutId } });
  };

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Top gradient blur — mirrors program-history-detail.tsx */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
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

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 40,
        }}
      >
        {/* Page title — bold, centered, matches the bold tab-title family
            used elsewhere on the Progress flow. */}
        <View style={styles.header}>
          <View style={{ width: 44 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={2}>
            {exerciseName ?? ""}
          </Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Time-range dropdown — identical button + sheet as the ones on the
            Progress page chart cards. Session count is wrapped in a matching
            NeuCard pill sized to the dropdown trigger so the row reads as
            two paired controls instead of raw text against the background. */}
        <View style={styles.rangeRow}>
          <NeuCard dark={isDark} radius={12} shadowSize="sm">
            <View style={styles.countPill}>
              <Text style={[styles.countText, { color: t.tp }]} numberOfLines={1}>
                {sessions.length} session{sessions.length === 1 ? "" : "s"}
              </Text>
            </View>
          </NeuCard>
          <DropdownPicker<ExerciseRangeKey>
            value={range}
            options={EXERCISE_RANGE_OPTIONS}
            onChange={setRange}
            sheetTitle="Time range"
          />
        </View>

        {sessions.length === 0 ? (
          <View style={[styles.empty, { paddingTop: 40 }]}>
            <DumbbellIcon size={32} color={t.ts} />
            <Text style={[styles.emptyText, { color: t.ts }]}>
              No sessions logged for this exercise yet.
            </Text>
          </View>
        ) : (
          sessions.map((row, i) => (
            <View key={row.workoutId} style={{ marginTop: i === 0 ? 0 : 10 }}>
              <SessionCard
                row={row}
                isDark={isDark}
                textPrimary={t.tp}
                textSecondary={t.ts}
                unit={unit}
                onPress={() => goToWorkout(row.workoutId)}
              />
            </View>
          ))
        )}
      </ScrollView>
    </FadeScreen>
  );
}

function SessionCard({
  row,
  isDark,
  textPrimary,
  textSecondary,
  unit,
  onPress,
}: {
  row: SessionRow;
  isDark: boolean;
  textPrimary: string;
  textSecondary: string;
  unit: string;
  onPress: () => void;
}) {
  // Working sets get a neutral fill; warmups get the orange accent that the
  // rest of the app uses to mark warmup rows.
  const workingBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,26,20,0.05)";
  const warmupBg  = isDark ? `${WARMUP_ORANGE}26` : `${WARMUP_ORANGE}1F`;

  return (
    <BounceButton onPress={onPress} accessibilityRole="button" accessibilityLabel={`${row.displayDate}, ${row.workoutName}, ${row.programName}`}>
      <NeuCard dark={isDark} radius={20}>
        <View style={styles.cardInner}>
          <View style={styles.cardTopRow}>
            <Text style={[styles.cardDate, { color: textPrimary }]} numberOfLines={1}>
              {row.displayDate}
            </Text>
            <View style={styles.cardMetaGroup}>
              <Text style={[styles.cardProgram, { color: textSecondary }]} numberOfLines={1}>
                {row.programName}
              </Text>
              <Text style={[styles.cardDot, { color: textSecondary }]}>·</Text>
              <Text style={[styles.cardWorkout, { color: textSecondary }]} numberOfLines={1}>
                {row.workoutName}
              </Text>
            </View>
          </View>

          {/* Each set as its own chip — single Text in one weight, size,
              and color so the row scans cleanly. Warmups get a neutral fill,
              working sets get the ACCT tint. */}
          <View style={styles.setsRow}>
            {row.sets.map((s, i) => {
              const w = (s.weight ?? "").trim() || "—";
              const r = (s.reps ?? "").trim() || "—";
              const isWarmup = s.type === "warmup";
              return (
                <View
                  key={i}
                  style={[styles.setChip, { backgroundColor: isWarmup ? warmupBg : workingBg }]}
                >
                  <Text style={[styles.chipText, { color: textPrimary }]} numberOfLines={1}>
                    {`${w} ${unit} × ${r}`}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </NeuCard>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },

  // Centered page title — bold and prominent so it reads like a section
  // header on its own page (the left/right spacer Views keep the title
  // visually centered even with the back chevron pinned to the left edge).
  // Generous bottom margin so the dropdown row + session cards have clear
  // breathing room beneath the title rather than crowding it.
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 28,
  },
  screenTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    textAlign: "center",
    flex: 1,
  },

  // Range-filter row — session count on the left for context, dropdown
  // button (same NeuCard pill as the chart page) on the right.
  rangeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  countPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  countText: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
  },

  cardInner: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  cardDate: {
    fontFamily: FontFamily.bold,
    fontSize: 15,
    flex: 1,
  },
  cardMetaGroup: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    flexShrink: 1,
  },
  cardDot: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
  },
  cardProgram: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    flexShrink: 1,
  },
  cardWorkout: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    flexShrink: 1,
  },
  // Set chips — each working set rendered as a small rounded badge so the
  // numbers pop and the row scans without parsing punctuation.
  setsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
    gap: 6,
  },
  setChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  chipText: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
  },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    textAlign: "center",
  },
});
