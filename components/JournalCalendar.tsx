// The Journal's month calendar, and a trainer's view of a client's (user pick,
// 2026-10-30, option C of the Journal Calendar canvas): flat days on the card,
// days trained back to back joined in one soft band, days missed back to back
// in one dashed outline, a rest day just its number, today a ring. What each
// day is, and the line under the month's name, come from
// utils/journalCalendar.ts.

import React, { useState, useMemo, useCallback, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, LayoutChangeEvent } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, accentTextColor, journalCalendarInk } from "../constants/theme";
import { cardButton } from "../constants/buttons";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import { MONTH_FULL } from "../utils/dates";
import {
  calendarWeeks, monthWorkouts, summaryLine, ymdOf,
  type CalendarDay, type CalendarDayState, type CalendarRun,
} from "../utils/journalCalendar";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

// A day's circle and the row it sits in. A band is a circle high, and its ends
// are its first and last days' circles.
const DISC  = 36;
const ROW_H = 46;
// How far today's pale halo reaches past its ring.
const HALO  = 4;

/** What VoiceOver says after a day's date. */
const STATE_WORDS: Record<CalendarDayState, string> = {
  workout: "trained",
  todayWorkout: "today, trained",
  today: "today",
  rest: "rest day",
  missed: "missed",
  future: "still to come",
  plain: "nothing logged",
};

interface Props {
  isDark: boolean;
  workoutDates: string[];
  workoutHistory: CompletedWorkout[];
  activeProgram: SavedProgram | null;
  onDayPress: (date: string, workoutId?: string) => void;
  /** The month to open on, "YYYY-MM" (Home's calendar sends the month before
   *  this one when that month is tapped). Otherwise it opens on this month. */
  initialMonth?: string;
}

// The first month the calendar goes back to.
const FIRST_YEAR  = 2026;
const FIRST_MONTH = 0;

/** The month the calendar opens on: `initialMonth` ("YYYY-MM") when one is
 *  given, held between FIRST_YEAR/FIRST_MONTH and this month; else this month. */
function openingMonth(initialMonth: string | undefined, curYear: number, curMonth: number): { year: number; month: number } {
  const m = initialMonth?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return { year: curYear, month: curMonth };
  const asked = Number(m[1]) * 12 + Number(m[2]) - 1;
  const shown = Math.min(Math.max(asked, FIRST_YEAR * 12 + FIRST_MONTH), curYear * 12 + curMonth);
  return { year: Math.floor(shown / 12), month: shown % 12 };
}

/**
 * A week's bands, laid out by flex across its seven columns, so they're right
 * on the first frame at any width with nothing measured. A band's basis is one
 * circle, and half a circle of negative margin each side takes it back; gaps
 * grow by the distance between column middles (half a column at each end of
 * the week), a band by the columns it spans past its first. Nothing is left
 * over but the row's width, so one unit of grow is exactly one column, and each
 * band starts on its first day's circle and ends on its last's.
 *
 * A dashed outline is one view for the whole run: pieced together from each
 * day's part of it, its dashes would break at every join, and iOS draws dashes
 * only on a border whose four sides match.
 */
function RunLayer({ runs, ink }: { runs: CalendarRun[]; ink: ReturnType<typeof journalCalendarInk> }) {
  const items: React.ReactNode[] = [];
  // Where the last item ended, in columns from the week's left edge.
  let end = 0;
  runs.forEach((run, i) => {
    const middle = run.start + 0.5;
    items.push(<View key={`gap${i}`} style={{ flexGrow: middle - end, flexBasis: 0 }} />);
    items.push(
      <View
        key={`run${i}`}
        style={[
          s.run,
          { flexGrow: run.length - 1 },
          run.kind === "trained"
            ? { backgroundColor: ink.run, borderWidth: 1, borderColor: ink.runEdge }
            : { borderWidth: 1.5, borderStyle: "dashed", borderColor: ink.missed },
        ]}
      />,
    );
    end = middle + run.length - 1;
  });
  items.push(<View key="end" style={{ flexGrow: 7 - end, flexBasis: 0 }} />);
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.runLayer]}>{items}</View>;
}

/** A month arrow in the card's button look. At the first or last month the
 *  calendar goes to, only its chevron fades, and it takes no taps. */
function MonthArrow({ back, disabled, onPress, t }: {
  back: boolean;
  disabled: boolean;
  onPress: () => void;
  t: { tp: string; cardCtrl: string; div: string };
}) {
  const label = back ? "Previous month" : "Next month";
  const chevron = (
    <Ionicons name={back ? "chevron-back" : "chevron-forward"} size={16} color={t.tp} style={disabled ? s.arrowOff : undefined} />
  );
  if (disabled) {
    return (
      <View style={[s.arrow, cardButton(t)]} accessible accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: true }}>
        {chevron}
      </View>
    );
  }
  return (
    <BounceButton onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[s.arrow, cardButton(t)]}>{chevron}</View>
    </BounceButton>
  );
}

export default function JournalCalendar({ isDark, workoutDates, workoutHistory, activeProgram, onDayPress, initialMonth }: Props) {
  const today    = useMemo(() => new Date(), []);
  const curYear  = today.getFullYear();
  const curMonth = today.getMonth();
  const todayStr = ymdOf(curYear, curMonth, today.getDate());

  const [viewYear, setViewYear]   = useState(() => openingMonth(initialMonth, curYear, curMonth).year);
  const [viewMonth, setViewMonth] = useState(() => openingMonth(initialMonth, curYear, curMonth).month);

  const gridHeight       = useSharedValue(0);
  const gridInitialized  = useRef(false);

  const animatedGridStyle = useAnimatedStyle(() => ({
    height: gridHeight.value === 0 ? undefined : gridHeight.value,
    overflow: "hidden" as const,
  }));

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (!gridInitialized.current) {
      gridHeight.value = h;
      gridInitialized.current = true;
    } else {
      gridHeight.value = withTiming(h, { duration: 300, easing: Easing.inOut(Easing.ease) });
    }
  }, [gridHeight]);

  const t = isDark ? APP_DARK : APP_LIGHT;
  const ink = journalCalendarInk(isDark);
  const atCurrentMonth = viewYear === curYear && viewMonth === curMonth;
  const atMinMonth = viewYear === FIRST_YEAR && viewMonth === FIRST_MONTH;

  const goBack = useCallback(() => {
    if (atMinMonth) return;
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }, [viewMonth, atMinMonth]);

  const goForward = useCallback(() => {
    if (atCurrentMonth) return;
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }, [viewMonth, atCurrentMonth]);

  const dateToWorkoutId = useMemo(() => {
    const map: Record<string, string> = {};
    const sorted = [...workoutHistory].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    for (const w of sorted) map[w.date] = w.id;
    return map;
  }, [workoutHistory]);

  const workoutSet = useMemo(() => new Set(workoutDates), [workoutDates]);

  const weeks = useMemo(
    () => calendarWeeks(viewYear, viewMonth, todayStr, workoutSet, activeProgram),
    [viewYear, viewMonth, todayStr, workoutSet, activeProgram],
  );
  const summary = useMemo(
    () => summaryLine(monthWorkouts(viewYear, viewMonth, workoutHistory), atCurrentMonth),
    [viewYear, viewMonth, workoutHistory, atCurrentMonth],
  );

  function renderDay(day: CalendarDay | null, col: number) {
    if (!day) return <View key={col} style={s.cell} />;
    const { state } = day;
    const trained = state === "workout" || state === "todayWorkout";
    const isToday = state === "today" || state === "todayWorkout";
    const quiet   = state === "rest" || state === "future";
    return (
      <TouchableOpacity
        key={col}
        style={s.cell}
        activeOpacity={0.6}
        disabled={state === "future"}
        onPress={() => onDayPress(day.date, dateToWorkoutId[day.date])}
        accessibilityRole="button"
        accessibilityLabel={`${day.day} ${MONTH_FULL[viewMonth]}, ${STATE_WORDS[state]}`}
      >
        <View style={[s.disc, state === "future" && s.future]}>
          {/* Today: the accent ring, with a pale halo until it's trained */}
          {state === "today" && <View style={[s.halo, { borderColor: ink.halo }]} />}
          {isToday && <View style={[StyleSheet.absoluteFill, s.todayRing]} />}
          <Text style={[s.dayNum, {
            color: trained ? accentTextColor(isDark) : quiet ? t.ts : t.tp,
            fontFamily: trained || isToday ? FontFamily.bold : FontFamily.semibold,
          }]}>
            {day.day}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <NeuCard dark={isDark} style={s.card}>
      <View style={s.inner}>
        {/* The month, with its workouts under it, and the arrows */}
        <View style={s.header}>
          <View style={s.titleBlock}>
            <Text style={[s.monthTitle, { color: t.tp }]}>
              {MONTH_FULL[viewMonth]}
              <Text style={[s.yearTitle, { color: t.ts }]}>{` ${viewYear}`}</Text>
            </Text>
            <Text style={[s.summary, { color: t.ts }]}>{summary}</Text>
          </View>
          <View style={s.arrows}>
            <MonthArrow back disabled={atMinMonth} onPress={goBack} t={t} />
            <MonthArrow back={false} disabled={atCurrentMonth} onPress={goForward} t={t} />
          </View>
        </View>

        {/* Day-of-week letters (each day says its own date to VoiceOver) */}
        <View style={s.weekdays} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {DAY_LETTERS.map((d, i) => (
            <Text key={i} style={[s.weekday, { color: t.ts }]}>{d}</Text>
          ))}
        </View>

        {/* Calendar grid: a row per week, its bands under its days */}
        <Animated.View style={animatedGridStyle}>
          <View onLayout={onGridLayout}>
            {weeks.map((week, wi) => (
              <View key={wi} style={s.week}>
                {week.runs.length > 0 && <RunLayer runs={week.runs} ink={ink} />}
                {week.days.map(renderDay)}
              </View>
            ))}
          </View>
        </Animated.View>
      </View>
    </NeuCard>
  );
}

const s = StyleSheet.create({
  card:  { borderRadius: 20, marginBottom: 4 },
  inner: { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 14 },

  header:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, paddingLeft: 4 },
  titleBlock: { flex: 1, gap: 3 },
  monthTitle: { fontFamily: FontFamily.bold, fontSize: 21 },
  yearTitle:  { fontFamily: FontFamily.semibold },
  summary:    { fontFamily: FontFamily.semibold, fontSize: 12.5 },
  arrows:     { flexDirection: "row", gap: 8, paddingTop: 2 },
  arrow:      { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  arrowOff:   { opacity: 0.3 },

  weekdays: { flexDirection: "row", marginBottom: 4 },
  weekday:  { flex: 1, textAlign: "center", fontFamily: FontFamily.bold, fontSize: 11 },

  week:      { flexDirection: "row", height: ROW_H },
  runLayer:  { flexDirection: "row", alignItems: "center" },
  run:       { flexBasis: DISC, height: DISC, borderRadius: DISC / 2, marginHorizontal: -DISC / 2 },
  cell:      { flex: 1, alignItems: "center", justifyContent: "center" },
  disc:      { width: DISC, height: DISC, borderRadius: DISC / 2, alignItems: "center", justifyContent: "center" },
  halo:      {
    position: "absolute", top: -HALO, left: -HALO,
    width: DISC + 2 * HALO, height: DISC + 2 * HALO, borderRadius: DISC / 2 + HALO, borderWidth: HALO,
  },
  todayRing: { borderRadius: DISC / 2, borderWidth: 2, borderColor: ACCT },
  future:    { opacity: 0.45 },
  dayNum:    { fontSize: 14 },
});
