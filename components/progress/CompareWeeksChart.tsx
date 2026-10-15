// components/progress/CompareWeeksChart.tsx
//
// The Volume card comparing two programs: a pair of bars for each program
// week, green's on the left (utils/programCompare.ts weeklyTotals), with the
// same Volume / Reps / Duration tabs as the card it stands in for. Week 1 is
// the week each run began, held days left out, so the two line up however far
// apart they ran. Every week of both is drawn, so blue's bars carry on past
// where green is up to; green's week under way is paler, and says "so far"
// when tapped (never in the caption, which would put "week" twice in a row:
// user request, 2026-10-14). A tap on a week puts its two totals in the
// header; the header otherwise has each program's
// average a week (over the span At a glance reads). Scrolls sideways when the
// weeks don't fit. The bars rise from the baseline as it comes in and on every
// metric, as the Volume card's do (chartEntrance.ts).

import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions } from "react-native";
import Reanimated, { useAnimatedProps } from "react-native-reanimated";
import Svg, { Line, Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import NeuCard from "../NeuCard";
import SegmentedControl from "../SegmentedControl";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, compareBlue, compareBlueText } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { METRIC_OPTIONS, type MetricKey } from "../../constants/progress";
import { niceAxis } from "../../utils/niceAxis";
import { fmtDuration } from "../../utils/dates";
import { fmtTons } from "./CompareGlanceCard";
import { useChartEntrance } from "./chartEntrance";

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

const TITLES: Record<MetricKey, string> = { volume: "Volume", reps: "Reps", duration: "Duration" };

const Y_W = 32;
const PLOT_H = 180;
const TOP = 10;
const LABELS_H = 24;
const BAR_W = 12;
const BAR_GAP = 2;
const MIN_PITCH = 36;

function fmtValue(n: number, metric: MetricKey, unit: string): string {
  if (metric === "volume") return fmtTons(n, unit);
  if (metric === "reps") return `${Math.round(n).toLocaleString()} reps`;
  return fmtDuration(Math.round(n) * 60);
}

/** One set of bars as one path, standing on `base`, rounded at the top, each
 *  risen `grow` (0 to 1) of its height `hs` as the chart comes in. */
function weekBarsD(xs: number[], hs: number[], base: number, grow: number): string {
  "worklet";
  if (grow <= 0) return "";
  let d = "";
  for (let i = 0; i < xs.length; i++) {
    const h = hs[i] * grow;
    const top = base - h;
    const k = Math.min(3, BAR_W / 2, h);
    const x = xs[i];
    const r = x + BAR_W;
    d += `M${x},${base}V${top + k}Q${x},${top} ${x + k},${top}H${r - k}Q${r},${top} ${r},${top + k}V${base}Z`;
  }
  return d;
}

type Bars = { xs: number[]; hs: number[] };

interface Props {
  /** Each program's totals per program week, week 1 first, in the unit shown. */
  green: number[];
  blue: number[];
  /** Each program's average a week over the span At a glance reads. */
  averages: { green: number; blue: number };
  /** Green's week under way (1-based), drawn paler; null when it's finished. */
  greenCurrentWeek: number | null;
  names: { green: string; blue: string };
  metric: MetricKey;
  onMetricChange: (m: MetricKey) => void;
  unit: string;
}

export default function CompareWeeksChart({ green, blue, averages, greenCurrentWeek, names, metric, onMetricChange, unit }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { width: screenWidth } = useWindowDimensions();
  const [focus, setFocus] = useState<number | null>(null);
  const blueMark = compareBlue(isDark);

  const weeks = Math.max(green.length, blue.length, 1);
  const inner = Math.min(screenWidth - 40, 420) - 32;
  const viewport = inner - Y_W;
  const pitch = Math.max(MIN_PITCH, viewport / weeks);
  const content = Math.max(viewport, pitch * weeks);
  const axis = useMemo(() => niceAxis(Math.max(0, ...green, ...blue), 4), [green, blue]);
  const base = TOP + PLOT_H;

  const shownG = focus !== null ? green[focus] ?? 0 : averages.green;
  const shownB = focus !== null ? blue[focus] ?? 0 : averages.blue;
  const hasData = green.some(v => v > 0) || blue.some(v => v > 0);

  // The bars, in sets by how they're drawn: green, green's week under way
  // (paler), blue, each full or stepped back while another week is tapped.
  const bars = useMemo(() => {
    const set = (): Bars => ({ xs: [], hs: [] });
    const out = { g: set(), gDim: set(), gNow: set(), gNowDim: set(), b: set(), bDim: set() };
    const height = (v: number) => (axis.max > 0 ? (Math.max(0, v) / axis.max) * PLOT_H : 0);
    for (let i = 0; i < weeks; i++) {
      const c = (i + 0.5) * pitch;
      const dim = focus !== null && focus !== i;
      const gh = height(green[i] ?? 0);
      const bh = height(blue[i] ?? 0);
      if (gh > 0) {
        const into = greenCurrentWeek === i + 1 ? (dim ? out.gNowDim : out.gNow) : (dim ? out.gDim : out.g);
        into.xs.push(c - BAR_GAP / 2 - BAR_W);
        into.hs.push(gh);
      }
      if (bh > 0) {
        const into = dim ? out.bDim : out.b;
        into.xs.push(c + BAR_GAP / 2);
        into.hs.push(bh);
      }
    }
    return out;
  }, [weeks, pitch, focus, green, blue, greenCurrentWeek, axis.max]);
  // They rise as the chart comes in, and again for another metric or other
  // weeks; a tap on a week doesn't.
  const grow = useChartEntrance("rise", `${metric}|${green.join(",")}|${blue.join(",")}`);
  const gProps = useAnimatedProps(() => ({ d: weekBarsD(bars.g.xs, bars.g.hs, base, grow.value) }), [bars, base]);
  const gDimProps = useAnimatedProps(() => ({ d: weekBarsD(bars.gDim.xs, bars.gDim.hs, base, grow.value) }), [bars, base]);
  const gNowProps = useAnimatedProps(() => ({ d: weekBarsD(bars.gNow.xs, bars.gNow.hs, base, grow.value) }), [bars, base]);
  const gNowDimProps = useAnimatedProps(() => ({ d: weekBarsD(bars.gNowDim.xs, bars.gNowDim.hs, base, grow.value) }), [bars, base]);
  const bProps = useAnimatedProps(() => ({ d: weekBarsD(bars.b.xs, bars.b.hs, base, grow.value) }), [bars, base]);
  const bDimProps = useAnimatedProps(() => ({ d: weekBarsD(bars.bDim.xs, bars.bDim.hs, base, grow.value) }), [bars, base]);

  return (
    <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.tp }]}>{TITLES[metric]}</Text>
            <Text style={[styles.sub, { color: t.ts }]}>
              {focus === null ? "Average per week" : `Week ${focus + 1}${greenCurrentWeek === focus + 1 ? " so far" : ""}`}
            </Text>
          </View>
          <View style={styles.values} accessible accessibilityLabel={`${names.green} ${fmtValue(shownG, metric, unit)}, ${names.blue} ${fmtValue(shownB, metric, unit)}`}>
            <View style={styles.valueRow}>
              <View style={[styles.dot, { backgroundColor: ACCT }]} />
              <Text style={[styles.value, { color: ACCT }]}>{fmtValue(shownG, metric, unit)}</Text>
            </View>
            <View style={styles.valueRow}>
              <View style={[styles.ring, { borderColor: blueMark }]} />
              <Text style={[styles.value, { color: compareBlueText(isDark) }]}>{fmtValue(shownB, metric, unit)}</Text>
            </View>
          </View>
        </View>

        {hasData ? (
          <View style={{ flexDirection: "row", marginTop: 14, height: base + LABELS_H }}>
            <View style={{ width: Y_W }}>
              {axis.labels.map((label, k) => (
                <Text
                  key={k}
                  style={[styles.yLabel, { color: t.ts, top: base - (k / (axis.labels.length - 1)) * PLOT_H - 7 }]}
                >
                  {label}
                </Text>
              ))}
              <View style={{ position: "absolute", right: 0, top: TOP, width: 1, height: PLOT_H, backgroundColor: t.div }} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={content > viewport} style={{ width: viewport }}>
              <View style={{ width: content, height: base + LABELS_H }}>
                <Svg width={content} height={base + LABELS_H} style={StyleSheet.absoluteFill}>
                  {axis.labels.slice(1).map((_, k) => {
                    const y = base - ((k + 1) / (axis.labels.length - 1)) * PLOT_H;
                    return <Line key={k} x1={0} x2={content} y1={y} y2={y} stroke={t.div} strokeWidth={1} strokeDasharray={[3, 4]} />;
                  })}
                  <Line x1={0} x2={content} y1={base + 0.5} y2={base + 0.5} stroke={t.div} strokeWidth={1} />
                  <AnimatedPath animatedProps={gProps} fill={ACCT} />
                  <AnimatedPath animatedProps={gDimProps} fill={ACCT} fillOpacity={0.45} />
                  <AnimatedPath animatedProps={gNowProps} fill={ACCT} fillOpacity={0.45} />
                  <AnimatedPath animatedProps={gNowDimProps} fill={ACCT} fillOpacity={0.45 * 0.45} />
                  <AnimatedPath animatedProps={bProps} fill={blueMark} />
                  <AnimatedPath animatedProps={bDimProps} fill={blueMark} fillOpacity={0.45} />
                </Svg>
                {Array.from({ length: weeks }, (_, i) => (
                  <Text
                    key={i}
                    style={[styles.week, { left: i * pitch, width: pitch, top: base + 5, color: focus === i ? t.tp : t.ts }]}
                  >
                    {i + 1}
                  </Text>
                ))}
                {Array.from({ length: weeks }, (_, i) => (
                  <TouchableOpacity
                    key={`t${i}`}
                    activeOpacity={1}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setFocus(prev => (prev === i ? null : i));
                    }}
                    style={{ position: "absolute", left: i * pitch, width: pitch, top: 0, height: base + LABELS_H }}
                    accessibilityRole="button"
                    accessibilityLabel={`Week ${i + 1}${greenCurrentWeek === i + 1 ? " so far" : ""}: ${names.green} ${fmtValue(green[i] ?? 0, metric, unit)}, ${names.blue} ${fmtValue(blue[i] ?? 0, metric, unit)}`}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : (
          <Text style={[styles.empty, { color: t.ts }]}>Nothing logged in either program yet.</Text>
        )}
        {/* What the numbers under the bars are. The week still going is the
            paler green bar, and says "so far" when tapped. */}
        <Text style={[styles.caption, { color: t.ts }]}>Program week</Text>

        <SegmentedControl<MetricKey> options={METRIC_OPTIONS} value={metric} onChange={m => { setFocus(null); onMetricChange(m); }} style={{ marginTop: 14 }} />
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 16 },
  header: { flexDirection: "row", alignItems: "flex-start" },
  title: { fontFamily: FontFamily.bold, fontSize: 18 },
  sub: { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 2 },
  values: { alignItems: "flex-end", gap: 1 },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  value: { fontFamily: FontFamily.bold, fontSize: 15, lineHeight: 20 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  yLabel: { position: "absolute", left: 0, width: Y_W - 6, height: 14, lineHeight: 14, textAlign: "right", fontFamily: FontFamily.regular, fontSize: 10 },
  week: { position: "absolute", height: 14, lineHeight: 14, textAlign: "center", fontFamily: FontFamily.regular, fontSize: 10 },
  caption: { fontFamily: FontFamily.regular, fontSize: 11, textAlign: "center", marginTop: 2 },
  empty: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", paddingVertical: 36 },
});
