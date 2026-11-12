// The builder's Go to Day (app/new-program.tsx, Workouts): the pinned day
// name at the top of the page opens it (user request, 2026-11-07: on a long
// program the only way to a day was scrolling till you found it). Every
// training day in the page's order, its name over its place in the cycle and
// what's in it. A tap slides the sheet away, then the page scrolls to that
// day, landing where the pinned name docks it. Each day's + (user request,
// 2026-11-12, in place of a tick on the day you're on) adds exercises to it
// instead: the sheet slides away and the builder opens the exercise picker on
// that day, as its floating + does.
//
// Reorder (user requests, 2026-11-07: Upper A and Upper B the other way
// round, which meant renaming both on Setup and left each day's exercises
// where they were): the pill beside the title turns the rows into the
// exercises' own reorder rows (ReorderExerciseList, "like our move exercises"),
// held by their left side and dragged to a new place. The training days take
// the new order in the slots they're in, each with its exercises, the rest
// days staying put (utils/programDays.ts:arrangeTrainingDays). Done ends it.
// The pill sits by the title, clear of the X (it sat right under the X at the
// title row's end), and says Reorder, never Swap (user request). It's glass
// (user request, 2026-11-12), Done the accent's tinted glass.
//
// Rows with lines between them, as ProgramPickerSheet's (user pick,
// 2026-10-30), straight in the sheet so a long cycle scrolls. No Cancel: the
// glass X and a drag down close it, as the Workout Summary's days.
//
// The same days answer the builder's floating + (`purpose` "add"; user
// request, 2026-11-12: adding to a day meant scrolling to the Add Exercise at
// its end): "Add Exercises", the day picked handed on once the sheet has gone,
// where the builder opens the exercise picker on it. No Reorder there, and no
// +: the row itself adds.

import { useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, type AccessibilityActionEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import SimpleSheet from "./trainer/SimpleSheet";
import BounceButton from "./BounceButton";
import GlassButton from "./GlassButton";
import { ReorderExerciseList } from "./ReorderExercisesSheet";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, ON_FILL, accentTextColor } from "../constants/theme";
import { pillGlow, PILL_H_CHIP, PILL_SHADOW } from "../constants/buttons";
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
  /** "go": Go to Day, the page scrolling to the day picked (the default).
   *  "add": the floating +'s first step, the day to add exercises to. */
  purpose?: "go" | "add";
  /** Runs once the sheet has gone, so the page scrolls (or the picker opens)
   *  with nothing over it. */
  onPick: (key: string) => void;
  /** A day's + in Go to Day: exercises for that day. Runs once the sheet has
   *  gone, as `onPick` does. Left out, the rows have no +. */
  onAdd?: (key: string) => void;
  /** The training days' slots in their new order. */
  onReorder: (slots: number[]) => void;
  onClose: () => void;
}

export default function GoToDaySheet({ visible, days, purpose = "go", onPick, onAdd, onReorder, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const adding = purpose === "add";
  // Go to Day's rows each have a + of their own (the "add" sheet's rows add).
  const withAdd = !adding && !!onAdd;
  // The day tapped, and whether by its +, acted on after the sheet's own slide
  // away (a tap outside, the X or a drag leave it empty).
  const picked = useRef<{ key: string; add: boolean } | null>(null);
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
        const pick = picked.current;
        picked.current = null;
        if (pick?.add) onAdd?.(pick.key);
        else if (pick) onPick(pick.key);
      }}
    >
      {close => (
        <>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>
                {adding ? "Add Exercises" : reordering ? "Reorder Days" : "Go to Day"}
              </Text>
              {days.length > 1 && !adding ? (
                // Glass (components/GlassButton.tsx): clear for Reorder, the
                // accent's tinted glass for Done, the sheet's main action then.
                // Below iOS 26 the white pill and the green one they were.
                <GlassButton
                  pill
                  size={PILL_H_CHIP}
                  tint={reordering ? ACCT : undefined}
                  onPress={() => setReordering(r => !r)}
                  contentStyle={styles.titleBtn}
                  solidStyle={reordering ? pillGlow(ACCT, 0.4, isDark) : PILL_SHADOW}
                  accessibilityLabel={reordering ? "Done reordering" : "Reorder days"}
                >
                  {reordering ? null : <Ionicons name="swap-vertical" size={15} color={t.tp} />}
                  <Text style={[styles.titleBtnText, { color: reordering ? ON_FILL : t.tp }]}>{reordering ? "Done" : "Reorder"}</Text>
                </GlassButton>
              ) : null}
            </View>
            {reordering ? (
              <Text style={[styles.subtitle, { color: t.ts }]}>
                Hold a day by its left side and drag it to a new place. Its exercises go with it, and rest days stay where they are.
              </Text>
            ) : adding ? (
              <Text style={[styles.subtitle, { color: t.ts }]}>Pick the day to add them to.</Text>
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
                // A Workout Summary's faded green numbers (user request,
                // 2026-11-12: they were the exercise cards' white ones).
                washNumbers
              />
            </View>
          ) : (
            <View style={styles.list}>
              {days.map((d, i) => {
                const meta = `Day ${d.idx + 1} · ${d.contents}`;
                const addTo = () => { picked.current = { key: d.key, add: true }; close(); };
                return (
                  <TouchableOpacity
                    key={d.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      picked.current = { key: d.key, add: adding };
                      close();
                    }}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={adding ? `Add exercises to ${d.name}, ${meta}` : `${d.name}, ${meta}`}
                    // The row is one element to VoiceOver, so its + is an action on it.
                    {...(withAdd ? {
                      accessibilityActions: [{ name: "add", label: "Add exercises" }],
                      onAccessibilityAction: (e: AccessibilityActionEvent) => { if (e.nativeEvent.actionName === "add") addTo(); },
                    } : {})}
                    style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.sheetLine }]}
                  >
                    <View style={styles.rowText}>
                      <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{d.name}</Text>
                      <Text style={[styles.meta, { color: t.ts }]} numberOfLines={1}>{meta}</Text>
                    </View>
                    {/* The exercise picker's add badge: the inner button takes
                        the tap, so the row's go-to doesn't fire as well. */}
                    {withAdd ? (
                      <BounceButton onPress={addTo} accessibilityRole="button" accessibilityLabel={`Add exercises to ${d.name}`}>
                        <View style={[styles.addBtn, { backgroundColor: `${ACCT}22`, borderColor: ACCT }]}>
                          <Ionicons name="add" size={18} color={accentTextColor(isDark)} />
                        </View>
                      </BounceButton>
                    ) : null}
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
  // What's on the Reorder pill: its icon and word, with room at its ends.
  titleBtn:     { gap: 6, paddingHorizontal: 14 },
  titleBtnText: { fontFamily: FontFamily.bold, fontSize: 14, letterSpacing: 0.2 },
  // The rows' words line up with the title, 24pt in; their lines run 12pt
  // short of the sheet's sides.
  list:         { paddingHorizontal: 12, paddingBottom: 8 },
  // The held rows' lines 24pt in, under the title, as the rows' words.
  reorderList:  { paddingHorizontal: 12, paddingBottom: 8 },
  row:          { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 12 },
  rowText:      { flex: 1, minWidth: 0 },
  // A day's +, the exercise picker's add badge's size and look.
  addBtn:       { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  name:         { ...CARD_TITLE },
  meta:         { ...CARD_META },
});
