// components/progress/CompareGlanceCard.tsx
//
// At a glance, comparing two programs: a green column and a blue one, each
// row a number both programs have (utils/programCompare.ts glanceStats). The
// switch under the title picks what they're read over: the first weeks of
// each, as far as the shorter has gone ("Same point"), or each start to finish.

import { View, Text, StyleSheet } from "react-native";
import NeuCard from "../NeuCard";
import SegmentedControl from "../SegmentedControl";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, compareBlue, compareBlueText } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { fmtDuration } from "../../utils/dates";
import { fmtChange } from "../../utils/exerciseChartLayout";
import type { CompareSpan, GlanceStats } from "../../utils/programCompare";

const SPAN_OPTIONS = [
  { key: "same" as const, label: "Same point" },
  { key: "whole" as const, label: "Whole program" },
];

/** "11.1k kg", "940 kg". */
export function fmtTons(n: number, unit: string): string {
  if (!Number.isFinite(n) || n <= 0) return `0 ${unit}`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k ${unit}`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k ${unit}`;
  return `${Math.round(n).toLocaleString()} ${unit}`;
}

/** "▲ 8.9%", "▼ 2%", "0%", or a dash with nothing to measure. */
export function fmtGain(pct: number | null): string {
  if (pct === null) return "—";
  const c = fmtChange(pct);
  return `${c.dir === "up" ? "▲ " : c.dir === "down" ? "▼ " : ""}${c.text}`;
}

interface Props {
  names: { green: string; blue: string };
  /** Volume already in the unit shown. */
  green: GlanceStats;
  blue: GlanceStats;
  strength: { green: number | null; blue: number | null };
  span: CompareSpan;
  onSpanChange: (s: CompareSpan) => void;
  /** What the numbers cover, under the title. */
  caption: string;
  unit: string;
}

export default function CompareGlanceCard({ names, green, blue, strength, span, onSpanChange, caption, unit }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // Green's numbers in its dot's own green (user decision, 2026-10-14).
  const gInk = ACCT;
  const bInk = compareBlueText(isDark);

  const rows: { label: string; g: string; b: string }[] = [
    { label: "Workouts", g: `${green.workoutsDone} of ${green.workoutsPlanned}`, b: `${blue.workoutsDone} of ${blue.workoutsPlanned}` },
    {
      label: "Average session",
      g: green.avgSessionSeconds !== null ? fmtDuration(green.avgSessionSeconds) : "—",
      b: blue.avgSessionSeconds !== null ? fmtDuration(blue.avgSessionSeconds) : "—",
    },
    { label: "Volume per week", g: fmtTons(green.volumePerWeekKg, unit), b: fmtTons(blue.volumePerWeekKg, unit) },
    { label: "Sets per week", g: String(Math.round(green.setsPerWeek)), b: String(Math.round(blue.setsPerWeek)) },
    { label: "PRs set", g: String(green.prs), b: String(blue.prs) },
    { label: "Strength, shared lifts", g: fmtGain(strength.green), b: fmtGain(strength.blue) },
  ];

  return (
    <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
      <View style={styles.inner}>
        <Text style={[styles.title, { color: t.tp }]}>At a glance</Text>
        <Text style={[styles.caption, { color: t.ts }]}>{caption}</Text>
        <SegmentedControl<CompareSpan> options={SPAN_OPTIONS} value={span} onChange={onSpanChange} style={{ marginTop: 14 }} />

        {/* Each program's whole name over its column, wrapping rather than
            cut short, with a gap between the two. */}
        <View style={styles.heads}>
          <View style={{ flex: 1 }} />
          <View style={styles.head}>
            <View style={[styles.dot, { backgroundColor: ACCT }]} />
            <Text style={[styles.headText, { color: t.tp }]}>{names.green}</Text>
          </View>
          <View style={styles.head}>
            <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />
            <Text style={[styles.headText, { color: t.tp }]}>{names.blue}</Text>
          </View>
        </View>
        {rows.map(r => (
          <View
            key={r.label}
            style={[styles.row, { borderTopColor: t.div }]}
            accessible
            accessibilityLabel={`${r.label}: ${names.green} ${r.g}, ${names.blue} ${r.b}`}
          >
            <Text style={[styles.label, { color: t.tp }]} numberOfLines={2}>{r.label}</Text>
            <Text style={[styles.value, { color: gInk }]} numberOfLines={1}>{r.g}</Text>
            <Text style={[styles.value, { color: bInk }]} numberOfLines={1}>{r.b}</Text>
          </View>
        ))}
      </View>
    </NeuCard>
  );
}

/** A program's column, and the space between the two (and the labels). */
const COL = 88;
const GAP = 10;

const styles = StyleSheet.create({
  inner: { padding: 16 },
  title: { fontFamily: FontFamily.bold, fontSize: 18 },
  caption: { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 2 },
  // Each dot centred on its name, and a shorter name centred on a longer one
  // that wraps, so the two dots always sit level (user request, 2026-10-14).
  heads: { flexDirection: "row", alignItems: "center", marginTop: 14, paddingVertical: 7 },
  head: { width: COL, marginLeft: GAP, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  headText: { flexShrink: 1, fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 46, paddingVertical: 6, borderTopWidth: 1 },
  label: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14, lineHeight: 18 },
  value: { width: COL, marginLeft: GAP, textAlign: "right", fontFamily: FontFamily.bold, fontSize: 15 },
});
