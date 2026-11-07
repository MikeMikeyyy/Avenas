// The builder's Go to Day (app/new-program.tsx, Workouts): the pinned day
// name at the top of the page opens it (user request, 2026-11-07: on a long
// program the only way to a day was scrolling till you found it). Every
// training day in the page's order, its name over its place in the cycle and
// what's in it, the day you're on ticked. A tap slides the sheet away, then
// the page scrolls to that day, landing where the pinned name docks it.
//
// Reorder (user requests, 2026-11-07: Upper A and Upper B the other way
// round, which meant renaming both on Setup and left each day's exercises
// where they were): the pill beside the title turns the rows into the
// exercises' own reorder rows (ReorderExerciseList, "like our move exercises"),
// held by their left side and dragged to a new place. The training days take
// the new order in the slots they're in, each with its exercises, the rest
// days staying put (utils/programDays.ts:arrangeTrainingDays). Done ends it.
// The pill sits by the title, clear of the X (it sat right under the X at the
// title row's end), and says Reorder, never Swap (user request).
//
// Rows with lines between them, as ProgramPickerSheet's (user pick,
// 2026-10-30), straight in the sheet so a long cycle scrolls. No Cancel: the
// glass X and a drag down close it, as the Workout Summary's days.

import { useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import SimpleSheet from "./trainer/SimpleSheet";
import BounceButton from "./BounceButton";
import { ReorderExerciseList } from "./ReorderExercisesSheet";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, ON_FILL } from "../constants/theme";
import { pill, pillGlow, PILL_H_CHIP, PILL_SHADOW } from "../constants/buttons";
import { CARD_META, CARD_TITLE } from "../constants/cards";
import { useTheme } from "../contexts/ThemeContext";

export interface GoToDayRow {
  /** The day's key in the builder's WorkoutMap. */
  key: string;
  /** Its cycle slot. */
  idx: number;
  /** Its stable id, which travels with it: the row's identity as it moves. */
  id: string;
  name: string;
  /** "5 exercises · 18 sets". */
  contents: string;
}

interface Props {
  visible: boolean;
  days: GoToDayRow[];
  /** The slot the page was on when the sheet opened. */
  current: number | null;
  /** Runs once the sheet has gone, so the page scrolls with nothing over it. */
  onPick: (key: string) => void;
  /** The training days' slots in their new order. */
  onReorder: (slots: number[]) => void;
  onClose: () => void;
}

export default function GoToDaySheet({ visible, days, current, onPick, onReorder, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The day tapped, gone to after the sheet's own slide away (a tap outside,
  // the X or a drag leave it empty).
  const picked = useRef<string | null>(null);
  const [reordering, setReordering] = useState(false);
  // A row held: the sheet's list holds still under it.
  const [dragging, setDragging] = useState(false);

  return (
    <SimpleSheet
      visible={visible}
      scrollEnabled={!dragging}
      onClose={() => {
        onClose();
        setReordering(false);
        setDragging(false);
        const key = picked.current;
        picked.current = null;
        if (key) onPick(key);
      }}
    >
      {close => (
        <>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>{reordering ? "Reorder Days" : "Go to Day"}</Text>
              {days.length > 1 ? (
                <BounceButton
                  onPress={() => setReordering(r => !r)}
                  accessibilityRole="button"
                  accessibilityLabel={reordering ? "Done reordering" : "Reorder days"}
                >
                  <View style={[styles.titleBtn, reordering
                    ? { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }
                    : { backgroundColor: t.ctrl, ...PILL_SHADOW }]}
                  >
                    {reordering ? null : <Ionicons name="swap-vertical" size={15} color={t.tp} />}
                    <Text style={[styles.titleBtnText, { color: reordering ? ON_FILL : t.tp }]}>{reordering ? "Done" : "Reorder"}</Text>
                  </View>
                </BounceButton>
              ) : null}
            </View>
            {reordering ? (
              <Text style={[styles.subtitle, { color: t.ts }]}>
                Hold a day by its left side and drag it to a new place. Its exercises go with it, and rest days stay where they are.
              </Text>
            ) : null}
          </View>
          {reordering ? (
            <View style={styles.reorderList}>
              <ReorderExerciseList
                items={days}
                keyOf={d => d.id}
                nameOf={d => d.name}
                metaOf={d => d.contents}
                onReorder={next => onReorder(next.map(d => d.idx))}
                onDragStateChange={setDragging}
              />
            </View>
          ) : (
            <View style={styles.list}>
              {days.map((d, i) => {
                const here = d.idx === current;
                const meta = `Day ${d.idx + 1} · ${d.contents}`;
                return (
                  <TouchableOpacity
                    key={d.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      picked.current = d.key;
                      close();
                    }}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={`${d.name}, ${meta}`}
                    accessibilityState={{ selected: here }}
                    style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.sheetLine }]}
                  >
                    <View style={styles.rowText}>
                      <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{d.name}</Text>
                      <Text style={[styles.meta, { color: t.ts }]} numberOfLines={1}>{meta}</Text>
                    </View>
                    {here ? <Ionicons name="checkmark" size={20} color={ACCT} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      )}
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:       { paddingHorizontal: 24, paddingBottom: 12, gap: 6 },
  // The title, and its pill right after it: out of the X's corner.
  titleRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  title:        { fontFamily: FontFamily.bold, fontSize: 20, flexShrink: 1 },
  subtitle:     { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  // The sheet's small pill (constants/buttons.ts), white with its shadow;
  // green while reordering, as the sheet's main action then.
  titleBtn:     { ...pill(PILL_H_CHIP), gap: 6, paddingHorizontal: 14 },
  titleBtnText: { fontFamily: FontFamily.bold, fontSize: 14, letterSpacing: 0.2 },
  // The rows' words line up with the title, 24pt in; their lines run 12pt
  // short of the sheet's sides.
  list:         { paddingHorizontal: 12, paddingBottom: 8 },
  // The held rows' lines 24pt in, under the title, as the rows' words.
  reorderList:  { paddingHorizontal: 12, paddingBottom: 8 },
  row:          { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 12 },
  rowText:      { flex: 1, minWidth: 0 },
  name:         { ...CARD_TITLE },
  meta:         { ...CARD_META },
});
