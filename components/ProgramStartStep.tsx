// When a program made active starts (utils/programStart.ts; user request,
// 2026-11-16): a step of the sheet it's made active from (My Programs' actions,
// and the builder's own sheet after Set as Active), and Change Start Date's
// while it hasn't begun. Today (never once a workout's logged today), Tomorrow,
// the coming Monday and the Monday after, each with its date, or Pick a Date:
// iOS's calendar, from the earliest it can start to START_WITHIN_DAYS ahead.
// The days before the start are rest days, which it says.

import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Reanimated, { FadeIn } from "react-native-reanimated";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import SheetPill from "./SheetPill";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import type { CompletedWorkout } from "../constants/programs";
import { useTheme } from "../contexts/ThemeContext";
import { fromYMD, toYMD } from "../utils/dates";
import { earliestStart, latestStart, startDay, startOptions } from "../utils/programStart";

export default function ProgramStartStep({ programName, today, history, current, onPick, onCancel }: {
  programName: string;
  /** "YYYY-MM-DD": the day it's made active. */
  today: string;
  /** What's logged: a workout today keeps it from starting today. */
  history: readonly Pick<CompletedWorkout, "date">[];
  /** Its start now, when it's being moved (Change Start Date). */
  current?: string | null;
  onPick: (ymd: string) => void;
  onCancel: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const options = startOptions(today, history);
  const earliest = earliestStart(today, history);
  const trainedToday = earliest !== today;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Date>(() => fromYMD(current && current >= earliest ? current : earliest) ?? new Date());

  if (picking) {
    const onChange = (e: DateTimePickerEvent, d?: Date) => {
      // Android's is a dialog: picked or dismissed, it's done.
      if (Platform.OS === "android") {
        if (e.type === "set" && d) onPick(toYMD(d));
        else setPicking(false);
        return;
      }
      if (d) setPicked(d);
    };
    return (
      <Reanimated.View entering={FadeIn.duration(160)} style={styles.body}>
        <Text style={[styles.title, { color: t.tp }]}>Pick a Date</Text>
        <DateTimePicker
          value={picked}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          minimumDate={fromYMD(earliest) ?? undefined}
          maximumDate={fromYMD(latestStart(today)) ?? undefined}
          onChange={onChange}
          themeVariant={isDark ? "dark" : "light"}
          accentColor={ACCT}
        />
        {Platform.OS === "ios" ? (
          <SheetPill label={`Start ${startDay(toYMD(picked))}`} variant="primary" onPress={() => onPick(toYMD(picked))} />
        ) : null}
        <SheetPill label="Cancel" variant="cancel" onPress={() => setPicking(false)} />
      </Reanimated.View>
    );
  }

  return (
    <Reanimated.View entering={FadeIn.duration(160)} style={styles.body}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: t.tp }]}>{current ? "Change Start Date" : "When Do You Start?"}</Text>
        <Text style={[styles.message, { color: t.ts }]}>
          {`The days before "${programName}" starts are rest days.`}
          {trainedToday ? " You've trained today, so it starts tomorrow at the earliest." : ""}
        </Text>
      </View>
      {options.map(o => (
        <SheetPill
          key={o.key}
          label={o.label}
          sub={startDay(o.ymd)}
          selected={o.ymd === current}
          icon={c => <Ionicons name={o.key === "today" ? "play-outline" : "calendar-outline"} size={18} color={c} />}
          onPress={() => onPick(o.ymd)}
        />
      ))}
      <SheetPill
        label="Pick a Date"
        sub={current && !options.some(o => o.ymd === current) ? `Now ${startDay(current)}` : undefined}
        selected={!!current && !options.some(o => o.ymd === current)}
        icon={c => <Ionicons name="calendar-number-outline" size={18} color={c} />}
        onPress={() => setPicking(true)}
      />
      <SheetPill label="Cancel" variant="cancel" onPress={onCancel} />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  // As the exercise sheets' steps (components/SupersetPickStep.tsx).
  body:    { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  head:    { alignItems: "center", gap: 6, paddingHorizontal: 4, paddingBottom: 4 },
  title:   { fontFamily: FontFamily.bold, fontSize: 20, textAlign: "center" },
  message: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21, textAlign: "center", paddingHorizontal: 8 },
});
