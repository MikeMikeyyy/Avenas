import { useRef, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, type ScrollViewInstance, type StyleProp, type TextStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { APP_LIGHT, APP_DARK, FontFamily } from "../constants/theme";
import type { TimeVal } from "../utils/sessionTime";

// The time maths is pure and lives in utils/sessionTime.ts, so scripts can
// stamp a session exactly as these sheets do; re-exported for the screens.
export {
  computeDurationMins, fmtDurationMins, fmtTimeVal, stampSession, timeValFromDate, toTotalMins,
  type TimeVal, type WorkoutTime,
} from "../utils/sessionTime";

// ─── Shared 12-hour time wheel ───────────────────────────────────────────────────
// The flat fade-style scroll wheel used by the journal "Workout Time" picker and
// the workout-complete sheet. Single source of truth so both look identical.

export const WHEEL_H = 46;
export const HOURS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
export const PERIODS = ["AM", "PM"];

// ─── WheelPicker ──────────────────────────────────────────────────────────────
// IMPORTANT: Must be a module-level component (not defined inside another
// component). Defining it inside a render function creates a new type on every
// parent re-render, causing React to unmount/remount and losing scroll position.

export function WheelPicker({ items, initialIdx, onSelect, isDark, width, bgColor, rowH = WHEEL_H, textStyle, band = true }: {
  items: string[]; initialIdx: number; onSelect: (idx: number) => void;
  isDark: boolean; width: number; bgColor: string;
  /** A row's height (three show); the journal's and the finish sheet's by default. */
  rowH?: number;
  /** The items' text, over the default semibold 20. */
  textStyle?: StyleProp<TextStyle>;
  /** The hairlines round the middle row; off where the caller draws its own. */
  band?: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const scrollRef = useRef<ScrollViewInstance>(null);
  // Keep latest onSelect in a ref so the commit closure is never stale
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // The wheel opens on its starting item from its first frame. It used to open
  // at the top and scroll there 60ms later, so a timer set to 2 minutes opened
  // on "01" and jumped to "02" (user report, 2026-10-15). The offset is the
  // one it opened with, for good: iOS moves a scroll view to any new
  // contentOffset at once, and a caller whose initialIdx follows the value
  // (the journal's time) would stop a fling the moment a drag let go. The
  // scroll after layout stays, as a fallback for a platform that drops the
  // offset while the content has no size yet.
  const [openedAt] = useState(() => ({ x: 0, y: initialIdx * rowH }));
  useEffect(() => {
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: initialIdx * rowH, animated: false });
    }, 60);
    return () => clearTimeout(id);
  }, []); // intentionally runs only on mount

  const commit = (y: number) => {
    const idx = Math.min(items.length - 1, Math.max(0, Math.round(y / rowH)));
    onSelectRef.current(idx);
  };

  const fadeColor = bgColor;

  return (
    <View style={{ width, height: rowH * 3 }}>
      <ScrollView
        ref={scrollRef}
        contentOffset={openedAt}
        snapToInterval={rowH}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: rowH }}
        onMomentumScrollEnd={e => commit(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={e => commit(e.nativeEvent.contentOffset.y)}
      >
        {items.map((item, i) => (
          <View key={i} style={{ height: rowH, width, alignItems: "center", justifyContent: "center" }}>
            <Text style={[{ fontFamily: FontFamily.semibold, fontSize: 20, color: t.tp }, textStyle]}>
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Top and bottom gradient fades — no overflow:hidden needed */}
      <LinearGradient
        pointerEvents="none"
        colors={[fadeColor, fadeColor + "00"]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: rowH + 6 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[fadeColor + "00", fadeColor]}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: rowH + 6 }}
      />

      {/* Center selection band */}
      {band ? (
        <View pointerEvents="none" style={{
          position: "absolute", top: rowH, left: 0, right: 0, height: rowH,
          borderTopWidth: 1, borderBottomWidth: 1,
          borderColor: isDark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.09)",
        }} />
      ) : null}
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
