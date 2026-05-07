import React, { useState, useMemo, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, NEU_BG, NEU_BG_DARK } from "../constants/theme";
import NeuCard from "./NeuCard";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";

const MONTH_LABELS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBRS    = ["M","T","W","T","F","S","S"];

// Rest-day colours
const REST_BG_LIGHT     = "#b8bec8";
const REST_BG_DARK      = "#3a3f58";
const REST_SHADOW_LIGHT = "#8a9099";
const REST_SHADOW_DARK  = "#1e2235";
const REST_HI_LIGHT     = "#d0d4da";
const REST_HI_DARK      = "#484e6e";

type CellState = "workout" | "todayWorkout" | "today" | "rest" | "missed" | "future" | null;

interface Props {
  isDark: boolean;
  workoutDates: string[];
  workoutHistory: CompletedWorkout[];
  activeProgram: SavedProgram | null;
  onDayPress: (date: string, workoutId?: string) => void;
}

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseProgDate(s: string): Date {
  const parts = s.split(" ");
  const mi = MONTH_SHORT.indexOf(parts[1]);
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

export default function JournalCalendar({ isDark, workoutDates, workoutHistory, activeProgram, onDayPress }: Props) {
  const today    = useMemo(() => new Date(), []);
  const curYear  = today.getFullYear();
  const curMonth = today.getMonth();
  const todayStr = toYMD(curYear, curMonth, today.getDate());

  const [viewYear, setViewYear]   = useState(curYear);
  const [viewMonth, setViewMonth] = useState(curMonth);

  const t = isDark ? APP_DARK : APP_LIGHT;
  const atCurrentMonth = viewYear === curYear && viewMonth === curMonth;

  const goBack = useCallback(() => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }, [viewMonth]);

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

  const cells = useMemo(() => {
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDow  = new Date(viewYear, viewMonth, 1).getDay();
    const padBefore = (firstDow + 6) % 7; // Monday-first

    const result: Array<{ day: number; state: CellState } | null> = [];
    for (let i = 0; i < padBefore; i++) result.push(null);

    for (let day = 1; day <= totalDays; day++) {
      const ds   = toYMD(viewYear, viewMonth, day);
      const date = new Date(viewYear, viewMonth, day);
      let state: CellState;

      if (ds === todayStr) {
        state = workoutSet.has(ds) ? "todayWorkout" : "today";
      } else if (ds > todayStr) {
        state = "future";
      } else if (workoutSet.has(ds)) {
        state = "workout";
      } else if (activeProgram && isRestDayForDate(date, activeProgram)) {
        state = "rest";
      } else {
        state = "missed";
      }
      result.push({ day, state });
    }

    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [viewYear, viewMonth, todayStr, workoutSet, activeProgram]);

  const rows: Array<Array<{ day: number; state: CellState } | null>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  // Theme-derived shadow colours
  const neutralBg    = isDark ? NEU_BG_DARK : NEU_BG;
  const outerShadow  = isDark ? "#0d0f1e" : "#8896a0";
  const innerShadow  = isDark ? "#2e3555" : "#ffffff";

  function renderCell(cell: { day: number; state: CellState } | null, ci: number) {
    if (!cell) return <View key={ci} style={s.cellWrap} />;

    const { day, state } = cell;
    const ds        = toYMD(viewYear, viewMonth, day);
    const isWorkout = state === "workout" || state === "todayWorkout";
    const isToday   = state === "today";
    const isRest    = state === "rest";
    const isFuture  = state === "future";

    let cellBg: string;
    let cellOuterShadow: string;
    let cellInnerShadow: string;
    let numColor: string;
    let bold = false;

    let cellBorder: string;

    if (isWorkout) {
      cellBg           = ACCT;
      cellOuterShadow  = "#0a9e60";
      cellInnerShadow  = "#4affc0";
      numColor         = "#fff";
      bold             = true;
      cellBorder       = "rgba(255,255,255,0.2)";
    } else if (isRest) {
      cellBg           = isDark ? REST_BG_DARK  : REST_BG_LIGHT;
      cellOuterShadow  = isDark ? REST_SHADOW_DARK : REST_SHADOW_LIGHT;
      cellInnerShadow  = isDark ? REST_HI_DARK  : REST_HI_LIGHT;
      numColor         = isDark ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.85)";
      cellBorder       = isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.7)";
    } else {
      // today / missed / future — all same neutral card
      cellBg           = neutralBg;
      cellOuterShadow  = outerShadow;
      cellInnerShadow  = innerShadow;
      numColor         = t.tp;
      bold             = isToday;
      cellBorder       = isDark ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.85)";
    }

    return (
      <View key={ci} style={s.cellWrap}>
        {/* Outer layer: dark drop-shadow + today border */}
        <View style={[
          s.cellOuter,
          { shadowColor: cellOuterShadow },
          isWorkout && s.workoutGlow,
          isToday && { borderWidth: 2, borderColor: ACCT },
        ]}>
          {/* Inner layer: light highlight shadow + background */}
          <View style={[s.cellInner, { shadowColor: cellInnerShadow, backgroundColor: cellBg, borderWidth: 1, borderColor: cellBorder }, isWorkout && { shadowOpacity: 0 }]}>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => onDayPress(ds, dateToWorkoutId[ds])}
              style={s.cellTouch}
              disabled={isFuture}
            >
              <Text style={[s.dayNum, { color: numColor, fontFamily: bold ? FontFamily.bold : FontFamily.regular }]}>
                {day}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <NeuCard dark={isDark} style={s.card}>
      <View style={s.inner}>
        {/* Month navigation */}
        <View style={s.header}>
          <TouchableOpacity onPress={goBack} style={s.navBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={t.tp} />
          </TouchableOpacity>
          <Text style={[s.monthTitle, { color: t.tp }]}>
            {MONTH_LABELS[viewMonth]} {viewYear}
          </Text>
          <TouchableOpacity
            onPress={goForward}
            style={s.navBtn}
            activeOpacity={atCurrentMonth ? 1 : 0.7}
            disabled={atCurrentMonth}
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              color={atCurrentMonth
                ? (isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)")
                : t.tp}
            />
          </TouchableOpacity>
        </View>

        {/* Day-of-week header */}
        <View style={s.row}>
          {DAY_ABBRS.map((d, i) => (
            <View key={i} style={s.cellWrap}>
              <Text style={[s.dayHdr, { color: t.ts }]}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Calendar grid */}
        {rows.map((row, ri) => (
          <View key={ri} style={[s.row, s.gridRow]}>
            {row.map((cell, ci) => renderCell(cell, ci))}
          </View>
        ))}
      </View>
    </NeuCard>
  );
}

const s = StyleSheet.create({
  card:  { borderRadius: 20, marginBottom: 4 },
  inner: { padding: 14, paddingBottom: 16 },

  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  monthTitle: { fontFamily: FontFamily.bold, fontSize: 16 },
  navBtn:     { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 },

  row:     { flexDirection: "row" },
  gridRow: { marginBottom: 8 },
  cellWrap:{ flex: 1, alignItems: "center" },
  dayHdr:  { fontFamily: FontFamily.semibold, fontSize: 11, marginBottom: 8, textAlign: "center" },

  cellOuter: {
    width: "86%",
    aspectRatio: 1,
    borderRadius: 10,
    shadowOffset: { width: 2.5, height: 2.5 },
    shadowOpacity: 0.32,
    shadowRadius: 5,
    elevation: 4,
  },
  cellInner: {
    flex: 1,
    borderRadius: 10,
    shadowOffset: { width: -2, height: -2 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
  cellTouch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  workoutGlow: {
    shadowColor: ACCT,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 7,
    elevation: 5,
  },
  dayNum: { fontSize: 13, textAlign: "center" },
});
