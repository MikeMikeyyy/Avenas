import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, NEU_BG, NEU_BG_DARK } from "../constants/theme";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import { toYMD } from "../utils/dates";
import { homeMonthCells as buildMonthCells, pastPlanFrom, type HomeCellState as CellState } from "../utils/journalCalendar";

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_NAMES  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_ABBRS    = ["M","T","W","T","F","S","S"];

interface Props {
  isDark: boolean;
  workoutDates: string[];   // YYYY-MM-DD strings
  activeProgram: SavedProgram | null;
  /** Every program, ended or not, and the history: a day gone by reads as the
   *  run going on it planned it, as on the Journal's calendar
   *  (utils/journalCalendar.ts pastPlanFrom). */
  programs: SavedProgram[];
  workoutHistory: CompletedWorkout[];
}

// Each cell's state is utils/journalCalendar.ts homeMonthCells (pure, so the
// solo flows check it).

function MonthSection({
  year, month, cells, isDark,
}: {
  year: number; month: number; cells: CellState[]; isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;

  const rows: CellState[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  // A rest day, and an empty one, set against the card (white, or charcoal).
  const darkCell  = isDark ? "#3B3D44" : "#BCC4D2";
  const lightCell = isDark ? "rgba(255,255,255,0.06)" : "#E4E8EF";
  const cardBg    = isDark ? NEU_BG_DARK : NEU_BG;

  const cellBg = (state: CellState): object => {
    if (!state) return {};
    if (state === "workout") return { backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 4, elevation: 3 };
    // The faded fill is a day still to come, and nothing else.
    if (state === "future") return { backgroundColor: lightCell };
    // Every day gone by with nothing logged, missed or rest, takes the dark
    // fill (user request, 2026-11-19: "If I'm not logging workout days ...
    // those days missed should show as the dark grey not the faded grey. Faded
    // grey should be for future days we haven't passed"). A missed day had the
    // faded fill from 2.10.0 to tell it from rest, which made it read as a day
    // to come. The Journal's calendar still marks missed days apart (dashed).
    return { backgroundColor: darkCell };
  };

  return (
    <View>
      <Text style={[s.monthLabel, { color: t.tp }]}>{MONTH_LABELS[month]} {year}</Text>
      <View style={s.row}>
        {DAY_ABBRS.map((d, i) => (
          <View key={i} style={s.cellWrap}>
            <Text style={[s.dayHdr, { color: t.ts }]}>{d}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={s.row}>
          {row.map((state, ci) => {
            const isToday = state === "today" || state === "todayWorkout";
            return (
              <View key={ci} style={s.cellWrap}>
                {isToday ? (
                  <>
                    <View style={[s.cell, { backgroundColor: state === "todayWorkout" ? ACCT : darkCell }]} />
                    <View pointerEvents="none" style={[s.todayRing, { borderColor: ACCT, backgroundColor: cardBg, shadowColor: ACCT }]} />
                    <View style={[s.todayBadgeRing, { backgroundColor: cardBg }]}>
                      <View style={s.todayBadgeDot} />
                    </View>
                  </>
                ) : (
                  <View style={[s.cell, cellBg(state)]} />
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function ActivityCalendar({ isDark, workoutDates, activeProgram, programs, workoutHistory }: Props) {
  const router   = useRouter();
  const today    = new Date();
  const todayStr = toYMD(today);

  const workoutSet = useMemo(() => new Set(workoutDates), [workoutDates]);
  const pastPlan = useMemo(() => pastPlanFrom(programs, workoutHistory), [programs, workoutHistory]);

  const curYear  = today.getFullYear();
  const curMonth = today.getMonth();
  const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
  const prevYear  = curMonth === 0 ? curYear - 1 : curYear;

  const prevCells = useMemo(
    () => buildMonthCells(prevYear, prevMonth, todayStr, workoutSet, activeProgram, pastPlan),
    [prevYear, prevMonth, todayStr, workoutSet, activeProgram, pastPlan],
  );
  const curCells = useMemo(
    () => buildMonthCells(curYear, curMonth, todayStr, workoutSet, activeProgram, pastPlan),
    [curYear, curMonth, todayStr, workoutSet, activeProgram, pastPlan],
  );

  return (
    <NeuCard dark={isDark} style={s.card}>
      <View style={s.inner}>
        {/* Each month opens the Journal: the month before on its own month,
            this month the Journal as it always opens (user request,
            2026-10-28). */}
        <View style={s.months}>
          <BounceButton
            style={s.monthCol}
            onPress={() => router.navigate({ pathname: "/journal", params: { month: `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}` } })}
            accessibilityRole="button"
            accessibilityLabel={`${MONTH_NAMES[prevMonth]} ${prevYear}. Open it in the Journal`}
          >
            <MonthSection year={prevYear} month={prevMonth} cells={prevCells} isDark={isDark} />
          </BounceButton>
          <BounceButton
            style={s.monthCol}
            onPress={() => router.navigate("/journal")}
            accessibilityRole="button"
            accessibilityLabel={`${MONTH_NAMES[curMonth]} ${curYear}. Open the Journal`}
          >
            <MonthSection year={curYear}  month={curMonth}  cells={curCells}  isDark={isDark} />
          </BounceButton>
        </View>
      </View>
    </NeuCard>
  );
}

const s = StyleSheet.create({
  card:        { borderRadius: 20, marginBottom: 20 },
  inner:       { padding: 16 },
  months:      { flexDirection: "row", gap: 10 },
  monthCol:    { flex: 1 },
  monthLabel:  { fontFamily: FontFamily.bold, fontSize: 16, marginBottom: 7 },
  row:         { flexDirection: "row", marginBottom: 9, alignItems: "center" },
  cellWrap:    { flex: 1, alignItems: "center", paddingHorizontal: 2.5 },
  dayHdr:      { fontFamily: FontFamily.semibold, fontSize: 11, marginBottom: 3 },
  cell:        { alignSelf: "stretch", height: 9.5, borderRadius: 3.25 },
  // today: outer expands beyond cell bounds via negative margin so inner fill == regular cell size
  todayRing:   { position: "absolute", top: -2, left: 0.5, right: 0.5, bottom: -2, borderWidth: 1, borderRadius: 5, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 3, elevation: 2 },
  todayBadgeRing: { position: "absolute", top: -4, right: -4, width: 9, height: 9, borderRadius: 4.5, alignItems: "center", justifyContent: "center" },
  todayBadgeDot:  { width: 7, height: 7, borderRadius: 3.5, backgroundColor: ACCT },
  legend:      { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch:{ width: 10, height: 10, borderRadius: 3 },
  legendLbl:   { fontFamily: FontFamily.regular, fontSize: 11 },
});
