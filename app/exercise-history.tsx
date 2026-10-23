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
import { scrollEndPadding } from "../constants/floatingBars";
import { useFloatingBarsReach } from "../hooks/useFloatingBars";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import GlassButton from "../components/GlassButton";
import FadeScreen from "../components/FadeScreen";
import DumbbellIcon from "../components/DumbbellIcon";
import ExerciseImage from "../components/ExerciseImage";
import PrTrophy from "../components/PrTrophy";
import FavouriteExerciseButton from "../components/FavouriteExerciseButton";
import HistoryFilterSheet from "../components/progress/HistoryFilterSheet";
import {
  APP_LIGHT,
  APP_DARK,
  ACCT,
  CUE_INK,
  CUE_INK_DARK,
  FontFamily,
  GOLD,
  GOLD_DARK,
  WARMUP_ORANGE,
} from "../constants/theme";
import { PILL_H_XS, PILL_SHADOW } from "../constants/buttons";
import { formatWeightForDisplay, toDisplayWeight, trimNumber } from "../utils/units";
import { displayWorkoutName } from "../utils/programDays";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  type SavedProgram,
  type CompletedWorkout,
} from "../constants/programs";
import {
  EXERCISE_RANGE_OPTIONS,
  type ExerciseRangeKey,
} from "../constants/progress";
import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { useClientUnit } from "../hooks/useClientUnit";
import { getJSON } from "../utils/storage";
import { loadCachedClientData } from "../utils/trainerStore";
import { MONTH_FULL, MONTH_NAMES } from "../utils/dates";
import {
  exerciseHistoryOptions,
  exerciseHistoryRows,
  filterLabel,
  picksFromHistoryParams,
  type ExerciseHistoryRow,
  type HistoryPick,
  type TopSetChange,
} from "../utils/exerciseHistory";
import { collectExerciseHistory, computePRs } from "../utils/progressStats";
import { exerciseIdByName } from "../utils/exerciseLookup";
import { carriedExercises, customToShow, exercisePageParams, knownCustomExercises } from "../utils/customExerciseDetails";
import BackButton, { BACK_TOP } from "../components/BackButton";

// Day-of-week strings — local format, not from a library to avoid extra deps.
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The exercise's picture over its name: the library's 192px still stays sharp
// this size (user decision, 2026-10-21: a still, about a big app icon).
const PICTURE_SIZE = 72;

// "YYYY-MM-DD" → "Mon 7 May"
function fmtSessionDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const date = new Date(y, m - 1, d);
  return `${DAY_SHORT[date.getDay()]} ${d} ${MONTH_NAMES[(m - 1) % 12]}`;
}

/** A set lifted with weight on it; blank or 0 is bodyweight. */
function hasWeight(stored: string): boolean {
  const n = parseFloat(stored);
  return Number.isFinite(n) && n > 0;
}

/** What a session's top set did against the one before it, for its row:
 *  "▲ 2.5 kg", "▼ 1 rep", "▲ 5 s", "Same as last". */
function describeChange(c: TopSetChange, isKg: boolean, unit: string, hold: boolean): { text: string; spoken: string; up: boolean } {
  if (c.kind === "same") return { text: "Same as last", spoken: "the same as last time", up: false };
  const amount = c.kind === "weight" ? toDisplayWeight(c.kg, isKg) : c.reps;
  const n = Math.abs(amount);
  const what = c.kind === "weight"
    ? `${trimNumber(n, isKg ? 2 : 1)} ${unit}`
    : hold ? `${trimNumber(n)} s` : `${trimNumber(n)} ${n === 1 ? "rep" : "reps"}`;
  return { text: `${amount > 0 ? "▲" : "▼"} ${what}`, spoken: `${amount > 0 ? "up" : "down"} ${what} on last time`, up: amount > 0 };
}

type SessionRow = ExerciseHistoryRow & { displayDate: string };

/** One of the two numbers at the top: a record lifted (a gold dot, as under the
 *  Progress chart) or the estimate (a ring, since nobody lifted it). */
type SummaryTile = {
  key: string;
  label: string;
  value: string;
  /** Said after the value, quieter: the reps of the heaviest set. */
  suffix?: string;
  sub: string;
  workoutId: string;
  marker: "gold" | "ring";
};

export default function ExerciseHistoryScreen() {
  const router = useRouter();
  // `dayName` / `dayId` / `programId` (optional): the workout day the page
  // opens filtered to — progress is tracked per (day, exercise) pair, and the
  // progression chart forwards its day so this page opens on the same slice
  // the chart plotted. The filter can then widen it.
  // `clientId` makes it a TRAINER reading a client's history, opened from that
  // client's Progress tab or their exercise's screen: it reads the copy the
  // client page loaded (never your own storage, where none of their sessions
  // exist) and a card opens the session read-only, exactly as tapping it on
  // their journal does.
  // `fromSummary`: opened from the exercise's screen, which its picture and
  // name then go back to.
  const { exerciseName, customId, dayName, dayId, programId, customDay, clientId, fromSummary } = useLocalSearchParams<{ exerciseName: string; customId?: string; dayName?: string; dayId?: string; programId?: string; customDay?: string; clientId?: string; fromSummary?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const gold = isDark ? GOLD_DARK : GOLD;
  const { isKg: ownIsKg } = useUnit();
  // A client's sessions read in the unit THEY log in (0036), as on their phone.
  const clientIsKg = useClientUnit(clientId);
  const isKg = clientIsKg ?? ownIsKg;
  const unit = isKg ? "kg" : "lbs";
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();

  const [history, setHistory] = useState<CompletedWorkout[]>([]);
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [customs, setCustoms] = useState<CustomExercise[]>([]);

  // Sliding-window time range — same options the per-exercise progression
  // chart uses (`EXERCISE_RANGE_OPTIONS`). Default "year" so the user sees
  // the broadest slice first; they can narrow it in the filter.
  const [range, setRange] = useState<ExerciseRangeKey>("year");
  const rangeOption = useMemo(
    () => EXERCISE_RANGE_OPTIONS.find(r => r.key === range) ?? EXERCISE_RANGE_OPTIONS[2],
    [range],
  );
  // Which programs, days and Custom workouts it lists (none picked: all). From
  // the chart, its day; from anywhere else, everything.
  const [picks, setPicks] = useState<HistoryPick[]>(() => picksFromHistoryParams({ dayName, dayId, programId, customDay }));
  const [filterOpen, setFilterOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // A client's copy is read from the cache, never refetched: every backup
        // re-mints their workout ids, and the chart that opened this page drew
        // from this copy.
        const [h, p, c] = clientId
          ? await loadCachedClientData(clientId).then(d => [d.workoutHistory, d.programs, d.customExercises ?? []] as const)
          : await Promise.all([
              getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
              getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
              getJSON<CustomExercise[]>(CUSTOM_KEY, []),
            ]);
        if (cancelled) return;
        setHistory(Array.isArray(h) ? h : []);
        setPrograms(Array.isArray(p) ? p : []);
        setCustoms(Array.isArray(c) ? c : []);
      })();
      return () => {
        cancelled = true;
      };
    }, [clientId]),
  );

  // Which sessions, their sets, trophies and change: utils/exerciseHistory.ts.
  const sessions: SessionRow[] = useMemo(() => {
    if (!exerciseName) return [];
    return exerciseHistoryRows(history, programs, { exerciseName, customId, picks, days: rangeOption.days })
      .map(r => ({ ...r, displayDate: fmtSessionDate(r.date) }));
  }, [history, programs, exerciseName, customId, picks, rangeOption.days]);

  // What the filter offers: the programs that did it, their days, free workouts.
  const options = useMemo(
    () => exerciseHistoryOptions(history, programs, { name: exerciseName ?? "", customId }),
    [history, programs, exerciseName, customId],
  );
  const scopeLabel = filterLabel(picks, options, programs);
  // The filter's button counts what a choice in it would list.
  const countFor = useCallback(
    (p: HistoryPick[], r: ExerciseRangeKey) => {
      if (!exerciseName) return 0;
      const days = (EXERCISE_RANGE_OPTIONS.find(o => o.key === r) ?? EXERCISE_RANGE_OPTIONS[2]).days;
      return exerciseHistoryRows(history, programs, { exerciseName, customId, picks: p, days }).length;
    },
    [history, programs, exerciseName, customId],
  );
  const applyFilter = useCallback((p: HistoryPick[], r: ExerciseRangeKey) => {
    setPicks(p);
    setRange(r);
    setFilterOpen(false);
  }, []);
  const closeFilter = useCallback(() => setFilterOpen(false), []);

  // The listed sessions a month at a time, newest first. The year is said only
  // for a month of another year.
  const months = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const out: { key: string; label: string; rows: SessionRow[] }[] = [];
    for (const row of sessions) {
      const key = row.date.slice(0, 7);
      if (out[out.length - 1]?.key !== key) {
        const [y, m] = key.split("-").map(Number);
        const month = MONTH_FULL[(m - 1) % 12] ?? "";
        out.push({ key, label: (y === thisYear ? month : `${month} ${y}`).toUpperCase(), rows: [] });
      }
      out[out.length - 1].rows.push(row);
    }
    return out;
  }, [sessions]);

  // The two numbers at the top, from the listed sessions by the Progress
  // chart's own record rules (utils/progressStats.ts computePRs): the heaviest
  // set, and the estimated 1RM (a hold, or bodyweight only, has none: its most
  // reps or longest hold instead).
  const tiles: SummaryTile[] = useMemo(() => {
    if (!exerciseName || sessions.length === 0) return [];
    const ids = new Set(sessions.map(r => r.workoutId));
    const listed = history.filter(w => ids.has(w.id));
    const ref = { name: exerciseName, customId };
    const prs = computePRs(collectExerciseHistory(listed, ref), listed, ref);
    const hold = sessions.every(r => r.isHold);
    const fmtW = (kg: number) => trimNumber(toDisplayWeight(kg, isKg), isKg ? 2 : 1);
    const out: SummaryTile[] = [];
    if (prs.heaviest) {
      const h = prs.heaviest;
      out.push({
        key: "heaviest",
        label: "Heaviest",
        value: `${fmtW(h.value)} ${unit}`,
        suffix: h.reps ? (hold ? ` for ${h.reps}s` : ` × ${h.reps}`) : undefined,
        sub: fmtSessionDate(h.date),
        workoutId: h.workoutId,
        marker: "gold",
      });
    }
    if (prs.oneRepMax) {
      // Worked out from a set, weight × (1 + reps / 30), and called what it
      // is: never "Best 1RM" (user request, 2026-10-08).
      const e = prs.oneRepMax;
      out.push({
        key: "e1rm",
        label: "Estimated 1RM",
        value: `${Math.round(toDisplayWeight(e.value, isKg))} ${unit}`,
        sub: `from ${fmtW(e.weight ?? 0)} ${unit} × ${e.reps ?? 0}`,
        workoutId: e.workoutId,
        marker: "ring",
      });
    } else if (prs.mostReps) {
      const m = prs.mostReps;
      const at = (m.weight ?? 0) > 0 ? `at ${fmtW(m.weight ?? 0)} ${unit} · ` : "";
      out.push({
        key: "reps",
        label: m.hold ? "Longest hold" : "Most reps",
        value: m.hold ? `${m.value}s` : `${m.value} ${m.value === 1 ? "rep" : "reps"}`,
        sub: `${at}${fmtSessionDate(m.date)}`,
        workoutId: m.workoutId,
        marker: "gold",
      });
    }
    return out;
  }, [history, sessions, exerciseName, customId, isKg, unit]);

  const goToWorkout = (workoutId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/workout-detail", params: { id: workoutId, ...(clientId ? { clientId } : {}) } });
  };

  // The picture: the library's, else the custom exercise's photo (yours, one a
  // program carries, or a client's that's online), else the dumbbell tile. Found
  // by identity, as the exercise screen finds it.
  const imageId = exerciseName ? exerciseIdByName(exerciseName) : undefined;
  const customPhoto = useMemo(() => {
    if (!exerciseName || imageId) return undefined;
    const known = knownCustomExercises(customs, carriedExercises(programs));
    return customToShow({ name: exerciseName, customId }, known, !!clientId)?.imageUri;
  }, [exerciseName, imageId, customId, customs, programs, clientId]);

  // The picture and name open the exercise's screen (user request,
  // 2026-10-21), or go back to it when that's where this page was opened
  // from, rather than stacking the two pages again on top.
  const goToExercise = () => {
    if (fromSummary) {
      router.back();
      return;
    }
    if (!exerciseName) return;
    router.navigate({
      pathname: "/exercise-summary",
      params: { ...exercisePageParams({ name: exerciseName, customId }, clientId), fromHistory: "1" },
    });
  };

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Top gradient blur — mirrors program-history-detail.tsx */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      {/* Back button */}
      <BackButton />
      {/* Whether it's a favourite, as on the exercise's screen. */}
      {exerciseName ? <FavouriteExerciseButton name={exerciseName} /> : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + BACK_TOP,
          paddingBottom: scrollEndPadding(insets.bottom + 40, barsReach),
        }}
      >
        {/* The exercise: its picture over its name, bold and centered (the
            bold tab-title family used elsewhere on the Progress flow). Either
            one opens the exercise's screen. */}
        <BounceButton
          onPress={goToExercise}
          style={styles.header}
          accessibilityRole="button"
          accessibilityLabel={`View ${exerciseName ?? ""} summary`}
        >
          <ExerciseImage
            exerciseId={imageId ?? ""}
            overrideUri={customPhoto}
            size={PICTURE_SIZE}
            radius={16}
            backgroundColor={t.div}
            fallbackColor={t.ts}
          />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={2}>
            {exerciseName ?? ""}
          </Text>
          {/* How many the filter lists (the filter says which day). */}
          <Text style={[styles.screenCount, { color: t.ts }]} numberOfLines={1}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
          </Text>
        </BounceButton>
        {clientIsKg !== undefined && clientIsKg !== ownIsKg && (
          <Text style={[styles.unitNote, { color: t.ts }]}>
            Weights in {unit}, the unit this client logs in
          </Text>
        )}

        {/* The filter: which programs and the time range, one pill that says
            both and opens one sheet for both (user decision, 2026-10-22, the
            Exercise History Program Filter canvas, option C). The Progress
            page's program pill, full width. */}
        <GlassButton
          pill
          size={PILL_H_XS}
          onPress={() => setFilterOpen(true)}
          style={styles.filterWrap}
          contentStyle={styles.filterBtn}
          solidStyle={PILL_SHADOW}
          accessibilityLabel={`Filter: ${scopeLabel}, ${rangeOption.label}. Tap to change.`}
        >
          <Ionicons name="options-outline" size={18} color={t.tp} />
          <Text style={[styles.filterText, { color: t.tp }]} numberOfLines={1}>
            {scopeLabel}
            <Text style={[styles.filterRange, { color: t.ts }]}>{` · ${rangeOption.label}`}</Text>
          </Text>
          <Ionicons name="chevron-down" size={15} color={t.ts} />
        </GlassButton>

        {/* The two numbers worth knowing first, in the range picked (user
            decision, 2026-10-22, the Exercise History canvas, option A). Each
            opens the workout it was set in, as the Records rows do. */}
        {tiles.length > 0 ? (
          <NeuCard dark={isDark} radius={16}>
            <View style={styles.summaryRow}>
              {tiles.map((tile, i) => (
                <TouchableOpacity
                  key={tile.key}
                  activeOpacity={0.6}
                  onPress={() => goToWorkout(tile.workoutId)}
                  style={[styles.tile, i > 0 && { borderLeftWidth: 1, borderLeftColor: t.div }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${tile.label}: ${tile.value}${tile.suffix ?? ""}, ${tile.sub}. Opens the workout.`}
                >
                  <View style={styles.tileLabelRow}>
                    <View
                      style={[
                        styles.marker,
                        tile.marker === "gold"
                          ? { backgroundColor: gold, shadowColor: gold, shadowOpacity: isDark ? 0.45 : 0.6 }
                          : { borderWidth: 1.5, borderColor: t.ts },
                      ]}
                    />
                    <Text style={[styles.tileLabel, { color: t.ts }]} numberOfLines={1}>{tile.label}</Text>
                  </View>
                  <Text style={[styles.tileValue, { color: t.tp }]} numberOfLines={1}>
                    {tile.value}
                    {tile.suffix ? <Text style={[styles.tileSuffix, { color: t.ts }]}>{tile.suffix}</Text> : null}
                  </Text>
                  <Text style={[styles.tileSub, { color: t.ts }]} numberOfLines={1}>{tile.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </NeuCard>
        ) : null}

        {sessions.length === 0 ? (
          <View style={[styles.empty, { paddingTop: 40 }]}>
            <DumbbellIcon size={32} color={t.ts} />
            <Text style={[styles.emptyText, { color: t.ts }]}>
              {options.programs.length > 0 || options.free
                ? "No sessions match this filter."
                : "No sessions logged for this exercise yet."}
            </Text>
          </View>
        ) : (
          months.map(month => (
            <View key={month.key}>
              <View style={styles.monthHead}>
                <Text style={[styles.monthLabel, { color: t.ts }]} numberOfLines={1}>{month.label}</Text>
                <Text style={[styles.monthCount, { color: t.ts }]} numberOfLines={1}>
                  {month.rows.length} session{month.rows.length === 1 ? "" : "s"}
                </Text>
              </View>
              {month.rows.map((row, i) => (
                <View key={row.workoutId} style={{ marginTop: i === 0 ? 0 : 10 }}>
                  <SessionCard
                    row={row}
                    isDark={isDark}
                    t={t}
                    isKg={isKg}
                    unit={unit}
                    onPress={() => goToWorkout(row.workoutId)}
                  />
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* The page's one sheet. */}
      <HistoryFilterSheet
        visible={filterOpen}
        onClose={closeFilter}
        options={options}
        programs={programs}
        picks={picks}
        range={range}
        countFor={countFor}
        onApply={applyFilter}
      />
    </FadeScreen>
  );
}

/**
 * One session: its sets as a table, as its Journal page lists them (the set's
 * number, the trophy on a new PR, weight × reps with the × marks lined up), the
 * change since the session before beside its top set, and what was written on
 * the exercise. Warmups read quieter; the top set reads bolder.
 */
function SessionCard({
  row,
  isDark,
  t,
  isKg,
  unit,
  onPress,
}: {
  row: SessionRow;
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
  isKg: boolean;
  unit: string;
  onPress: () => void;
}) {
  // Done with weight at all: the weight column. Done only at bodyweight (or a
  // plank held), the reps or seconds stand alone.
  const weighted = row.sets.some(s => hasWeight(s.weight));
  const change = row.change ? describeChange(row.change, isKg, unit, row.isHold) : null;
  // The note is information, so it's held to 4.5:1 like a change cue.
  const ink = isDark ? CUE_INK_DARK : CUE_INK;
  const top = row.top >= 0 ? row.sets[row.top] : null;
  const topSpoken = top
    ? `, top set ${hasWeight(top.weight) ? `${formatWeightForDisplay(top.weight.trim(), isKg)} ${unit} ${row.isHold ? "for" : "times"} ` : ""}${top.reps}${row.isHold ? " seconds" : ""}${change ? `, ${change.spoken}` : ""}`
    : "";
  // Each set's number: W for a warmup, the working sets counted 1, 2, 3.
  const labels: string[] = [];
  let working = 0;
  for (const s of row.sets) labels.push(s.type === "warmup" ? "W" : String(++working));

  return (
    <BounceButton
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.displayDate}, ${displayWorkoutName(row.workoutName)}, ${row.programName}${topSpoken}${row.notes ? `. Note: ${row.notes}` : ""}`}
    >
      <NeuCard dark={isDark} radius={20}>
        <View style={styles.cardInner}>
          <View style={styles.cardHead}>
            <View style={styles.cardHeadText}>
              <Text style={[styles.cardDate, { color: t.tp }]} numberOfLines={1}>
                {row.displayDate}
              </Text>
              <Text style={[styles.cardMeta, { color: t.ts }]} numberOfLines={1}>
                {`${row.programName} · ${displayWorkoutName(row.workoutName)}`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.ts} />
          </View>
          <View style={[styles.cardDivider, { backgroundColor: t.div }]} />

          {row.sets.map((s, i) => {
            const warm = s.type === "warmup";
            const isTop = i === row.top;
            // Warmups quieter, the top set bolder, so the working sets lead.
            const numStyle = { color: warm ? t.ts : t.tp, fontFamily: isTop ? FontFamily.bold : FontFamily.semibold };
            const reps = (s.reps ?? "").trim();
            const repsText = !reps
              ? "—"
              : row.isHold
                ? `${reps} s`
                : weighted ? reps : `${reps} ${reps === "1" ? "rep" : "reps"}`;
            return (
              <View key={i} style={styles.setRow}>
                <View style={styles.setLabelCol}>
                  {/* The trophy hangs off the number's own left edge
                      (components/PrTrophy.tsx). Mounted only on a PR: a
                      logged set never gains or loses one here. */}
                  <View>
                    <Text style={[styles.setLabel, { color: warm ? WARMUP_ORANGE : t.tp }]}>
                      {labels[i]}
                    </Text>
                    {row.prs[i] ? <PrTrophy show /> : null}
                  </View>
                </View>
                {weighted ? (
                  <>
                    {hasWeight(s.weight) ? (
                      <Text style={[styles.setWeight, numStyle]} numberOfLines={1}>
                        {formatWeightForDisplay(s.weight.trim(), isKg)}
                        <Text style={[styles.setUnit, { color: t.ts }]}>{` ${unit}`}</Text>
                      </Text>
                    ) : (
                      <Text style={[styles.setWeight, styles.setBodyweight, { color: t.ts }]} numberOfLines={1}>
                        Bodyweight
                      </Text>
                    )}
                    <Text style={[styles.setTimes, { color: t.ts }]}>{row.isHold ? "for" : "×"}</Text>
                  </>
                ) : null}
                <Text style={[styles.setReps, numStyle]} numberOfLines={1}>{repsText}</Text>
                {/* Up in the accent green the Progress page's change uses
                    (user decision, 2026-10-22), down or level in grey: a
                    lighter session isn't a warning. */}
                <Text style={[styles.setChange, { color: change?.up ? ACCT : t.ts }]} numberOfLines={1}>
                  {isTop && change ? change.text : ""}
                </Text>
              </View>
            );
          })}

          {row.notes ? (
            <View style={[styles.note, { borderTopColor: t.div }]}>
              <Ionicons name="chatbox-outline" size={15} color={ink} style={styles.noteIcon} />
              <Text style={[styles.noteText, { color: ink }]}>{row.notes}</Text>
            </View>
          ) : null}
        </View>
      </NeuCard>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },

  // The picture, title and optional day, centered as one block that hugs them
  // (so blank space either side isn't a button). The picture's top is level
  // with the back button's, and clear of it (and of the star across from it)
  // beside a narrow centered square. Generous bottom margin so the dropdown
  // row + session cards have clear breathing room beneath the title rather
  // than crowding it.
  header: {
    alignSelf: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  screenTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    textAlign: "center",
    marginTop: 12,
  },
  unitNote: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    textAlign: "center",
    marginTop: -8,
    marginBottom: 16,
  },
  screenCount: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    textAlign: "center",
    marginTop: 2,
  },

  // The filter: ProgramScopePicker's pill (PILL_H_XS; glass on iOS 26), the
  // width of the page. Its words read from the left, the chevron at the far
  // end.
  filterWrap: { marginBottom: 12 },
  filterBtn: {
    gap: 10,
    paddingHorizontal: 16,
  },
  filterText: { flex: 1, fontFamily: FontFamily.bold, fontSize: 15 },
  filterRange: { fontFamily: FontFamily.semibold },

  // The two numbers: halves of one card, a hairline between them. The marker
  // and type are the Records card's (components/ExerciseProgressionChart.tsx).
  summaryRow: { flexDirection: "row" },
  tile: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
  tileLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  marker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 3,
  },
  tileLabel: { flexShrink: 1, fontFamily: FontFamily.semibold, fontSize: 12 },
  tileValue: { fontFamily: FontFamily.bold, fontSize: 17, lineHeight: 22 },
  tileSuffix: { fontFamily: FontFamily.semibold, fontSize: 13 },
  tileSub: { fontFamily: FontFamily.regular, fontSize: 11, lineHeight: 15 },

  // A month's heading: the section-label look (exercise-summary's), its
  // count across from it.
  monthHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 22,
    marginBottom: 10,
    marginHorizontal: 2,
  },
  monthLabel: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.8 },
  monthCount: { fontFamily: FontFamily.semibold, fontSize: 12 },

  cardInner: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardHeadText: { flex: 1, gap: 1 },
  cardDate: {
    fontFamily: FontFamily.bold,
    fontSize: 15,
  },
  cardMeta: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
  },
  cardDivider: { height: 1, marginTop: 10, marginBottom: 4 },

  // A set's row. Fixed columns so the × marks line up down the card and the
  // weights' units sit under each other; the change takes what's left.
  setRow: { flexDirection: "row", alignItems: "center", height: 30 },
  setLabelCol: { width: 36, alignItems: "center", justifyContent: "center" },
  setLabel: { fontFamily: FontFamily.semibold, fontSize: 14 },
  setWeight: { width: 84, textAlign: "right", fontSize: 15, fontVariant: ["tabular-nums"] },
  setUnit: { fontFamily: FontFamily.semibold, fontSize: 12 },
  setBodyweight: { fontFamily: FontFamily.semibold, fontSize: 13 },
  setTimes: { width: 26, textAlign: "center", fontFamily: FontFamily.regular, fontSize: 13 },
  setReps: { minWidth: 32, fontSize: 15, fontVariant: ["tabular-nums"] },
  setChange: { flex: 1, marginLeft: 8, textAlign: "right", fontFamily: FontFamily.bold, fontSize: 13 },

  // What was written on the exercise that session, under a hairline.
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 6,
    paddingTop: 10,
    paddingBottom: 6,
    borderTopWidth: 1,
  },
  noteIcon: { marginTop: 2 },
  noteText: { flex: 1, fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },

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
