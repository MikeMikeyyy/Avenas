import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, NEU_BG, NEU_BG_DARK } from "../constants/theme";
import NeuCard from "./NeuCard";
import type { SavedProgram } from "../constants/programs";

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBRS    = ["M","T","W","T","F","S","S"];

type CellState = "workout" | "todayWorkout" | "rest" | "missed" | "future" | "today" | null;

interface Props {
  isDark: boolean;
  workoutDates: string[];   // YYYY-MM-DD strings
  activeProgram: SavedProgram | null;
}

function toYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function parseProgDate(s: string): Date {
  const parts = s.split(" ");
  const mi = MONTH_LABELS.indexOf(parts[1]);
  return new Date(+parts[2], mi < 0 ? 0 : mi, +parts[0]);
}

function isRestDayForDate(d: Date, prog: SavedProgram): boolean {
  const start = parseProgDate(prog.startDate);
  start.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.floor((target.getTime() - start.getTime()) / 86400000);
  if (days < 0) return false;
  const idx = (((days + (prog.cycleOffset ?? 0)) % prog.cycleDays) + prog.cycleDays) % prog.cycleDays;
  return prog.cyclePattern[idx] === "Rest";
}

function buildMonthCells(
  year: number,
  month: number,
  todayStr: string,
  workoutSet: Set<string>,
  prog: SavedProgram | null,
): CellState[] {
  const totalDays = new Date(year, month + 1, 0).getDate();
  const firstDow  = new Date(year, month, 1).getDay(); // 0=Sun
  const padBefore = (firstDow + 6) % 7; // convert to Monday-first

  const cells: CellState[] = Array(padBefore).fill(null);

  for (let day = 1; day <= totalDays; day++) {
    const ds   = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const date = new Date(year, month, day);

    if (ds === todayStr) {
      cells.push(workoutSet.has(ds) ? "todayWorkout" : "today");
    } else if (ds > todayStr) {
      cells.push("future");
    } else {
      if (workoutSet.has(ds)) {
        cells.push("workout");
      } else if (prog && isRestDayForDate(date, prog)) {
        cells.push("rest");
      } else {
        cells.push("missed");
      }
    }
  }

  // Pad to complete the last row
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

function MonthSection({
  year, month, cells, isDark,
}: {
  year: number; month: number; cells: CellState[]; isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;

  const rows: CellState[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const darkCell  = isDark ? "#474C6D" : "#babeccff";
  const lightCell = isDark ? "rgba(255,255,255,0.05)" : "#DDE0EA";

  const cellBg = (state: CellState): object => {
    if (!state) return {};
    if (state === "workout") return { backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 4, elevation: 3 };
    if (state === "future")  return { backgroundColor: lightCell };
    // rest / missed / todayWorkout — all use dark fill
    return { backgroundColor: darkCell };
  };

  return (
    <View style={s.monthCol}>
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
                    <View pointerEvents="none" style={[s.todayRing, { borderColor: ACCT, backgroundColor: isDark ? NEU_BG_DARK : NEU_BG, shadowColor: ACCT }]} />
                    <View style={[s.todayBadgeRing, { backgroundColor: isDark ? NEU_BG_DARK : NEU_BG }]}>
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

export default function ActivityCalendar({ isDark, workoutDates, activeProgram }: Props) {
  const today    = new Date();
  const todayStr = toYMD(today);

  const workoutSet = useMemo(() => new Set(workoutDates), [workoutDates]);

  const curYear  = today.getFullYear();
  const curMonth = today.getMonth();
  const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
  const prevYear  = curMonth === 0 ? curYear - 1 : curYear;

  const prevCells = useMemo(
    () => buildMonthCells(prevYear, prevMonth, todayStr, workoutSet, activeProgram),
    [prevYear, prevMonth, todayStr, workoutSet, activeProgram],
  );
  const curCells = useMemo(
    () => buildMonthCells(curYear, curMonth, todayStr, workoutSet, activeProgram),
    [curYear, curMonth, todayStr, workoutSet, activeProgram],
  );

  return (
    <NeuCard dark={isDark} style={s.card}>
      <View style={s.inner}>
        <View style={s.months}>
          <MonthSection year={prevYear} month={prevMonth} cells={prevCells} isDark={isDark} />
          <MonthSection year={curYear}  month={curMonth}  cells={curCells}  isDark={isDark} />
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
