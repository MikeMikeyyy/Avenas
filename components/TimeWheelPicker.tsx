import { useRef, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { APP_LIGHT, APP_DARK, FontFamily } from "../constants/theme";

// ─── Shared 12-hour time wheel ───────────────────────────────────────────────────
// The flat fade-style scroll wheel used by the journal "Workout Time" picker and
// the workout-complete sheet. Single source of truth so both look identical.

export const WHEEL_H = 46;
export const HOURS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
export const PERIODS = ["AM", "PM"];

export type TimeVal = { hour: number; minute: number; period: "AM" | "PM" };
export type WorkoutTime = { start: TimeVal; end: TimeVal };

export function toTotalMins(tv: TimeVal): number {
  const h24 = (tv.hour % 12) + (tv.period === "PM" ? 12 : 0);
  return h24 * 60 + tv.minute;
}

export function computeDurationMins(start: TimeVal, end: TimeVal): number {
  const s = toTotalMins(start);
  const e = toTotalMins(end);
  return e >= s ? e - s : 24 * 60 - s + e;
}

export function fmtTimeVal(tv: TimeVal): string {
  return `${tv.hour}:${String(tv.minute).padStart(2, "0")} ${tv.period}`;
}

export function fmtDurationMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function timeValFromDate(d: Date): TimeVal {
  const h = d.getHours();
  return { hour: h % 12 || 12, minute: d.getMinutes(), period: h < 12 ? "AM" : "PM" };
}

// completedAt ISO on the given calendar date (YYYY-MM-DD), stamped at `end`.
export function completedAtISO(ymd: string, end: TimeVal): string {
  const endH24 = (end.hour % 12) + (end.period === "PM" ? 12 : 0);
  return new Date(`${ymd}T${String(endH24).padStart(2, "0")}:${String(end.minute).padStart(2, "0")}:00`).toISOString();
}

// ─── WheelPicker ──────────────────────────────────────────────────────────────
// IMPORTANT: Must be a module-level component (not defined inside another
// component). Defining it inside a render function creates a new type on every
// parent re-render, causing React to unmount/remount and losing scroll position.

export function WheelPicker({ items, initialIdx, onSelect, isDark, width, bgColor }: {
  items: string[]; initialIdx: number; onSelect: (idx: number) => void;
  isDark: boolean; width: number; bgColor: string;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const scrollRef = useRef<ScrollView>(null);
  // Keep latest onSelect in a ref so the commit closure is never stale
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Scroll to initial position after layout settles
  useEffect(() => {
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: initialIdx * WHEEL_H, animated: false });
    }, 60);
    return () => clearTimeout(id);
  }, []); // intentionally runs only on mount

  const commit = (y: number) => {
    const idx = Math.min(items.length - 1, Math.max(0, Math.round(y / WHEEL_H)));
    onSelectRef.current(idx);
  };

  const fadeColor = bgColor;

  return (
    <View style={{ width, height: WHEEL_H * 3 }}>
      <ScrollView
        ref={scrollRef}
        snapToInterval={WHEEL_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: WHEEL_H }}
        onMomentumScrollEnd={e => commit(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={e => commit(e.nativeEvent.contentOffset.y)}
      >
        {items.map((item, i) => (
          <View key={i} style={{ height: WHEEL_H, width, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: FontFamily.semibold, fontSize: 20, color: t.tp }}>
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Top and bottom gradient fades — no overflow:hidden needed */}
      <LinearGradient
        pointerEvents="none"
        colors={[fadeColor, fadeColor + "00"]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: WHEEL_H + 6 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[fadeColor + "00", fadeColor]}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: WHEEL_H + 6 }}
      />

      {/* Center selection band */}
      <View pointerEvents="none" style={{
        position: "absolute", top: WHEEL_H, left: 0, right: 0, height: WHEEL_H,
        borderTopWidth: 1, borderBottomWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.09)",
      }} />
    </View>
  );
}

// ─── TimeRow ───────────────────────────────────────────────────────────────────
// Also module-level — must not be defined inside a sheet component.
// `minuteStep` controls the minute wheel granularity (5 = journal default,
// 1 = per-minute precision for the workout-complete sheet).

export function TimeRow({ label, val, onChange, isDark, bgColor, minuteStep = 5 }: {
  label: string; val: TimeVal; onChange: (v: TimeVal) => void;
  isDark: boolean; bgColor: string; minuteStep?: number;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const minutes = Array.from({ length: Math.round(60 / minuteStep) }, (_, i) =>
    String(i * minuteStep).padStart(2, "0"),
  );
  const minuteIdx = Math.min(minutes.length - 1, Math.round(val.minute / minuteStep));
  return (
    <View style={styles.timeRow}>
      <Text style={[styles.timeRowLabel, { color: t.ts }]}>{label}</Text>
      <View style={styles.wheelGroup}>
        <WheelPicker
          items={HOURS} isDark={isDark} width={52} bgColor={bgColor}
          initialIdx={val.hour - 1}
          onSelect={idx => onChange({ ...val, hour: idx + 1 })}
        />
        <Text style={[styles.wheelColon, { color: t.tp }]}>:</Text>
        <WheelPicker
          items={minutes} isDark={isDark} width={52} bgColor={bgColor}
          initialIdx={minuteIdx}
          onSelect={idx => onChange({ ...val, minute: idx * minuteStep })}
        />
        <WheelPicker
          items={PERIODS} isDark={isDark} width={52} bgColor={bgColor}
          initialIdx={val.period === "AM" ? 0 : 1}
          onSelect={idx => onChange({ ...val, period: idx === 0 ? "AM" : "PM" })}
        />
      </View>
      {/* phantom matches label width so wheels land at true center */}
      <View style={{ width: 48 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  timeRow:      { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 6, gap: 8 },
  timeRowLabel: { fontFamily: FontFamily.semibold, fontSize: 13, width: 40, textAlign: "right", letterSpacing: 0.4 },
  wheelGroup:   { flexDirection: "row", alignItems: "center", gap: 2 },
  wheelColon:   { fontFamily: FontFamily.bold, fontSize: 22, paddingHorizontal: 2 },
});
