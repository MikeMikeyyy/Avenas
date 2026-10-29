// The sheet ··· on a Workout tab exercise card opens: everything that changes
// an exercise rather than logs it (user request and canvas pick, 2026-10-29).
// Its sets come first, each with its own Warm-up / Working switch and its own
// delete; a warm-up set is added after the warm-ups and a working set after
// the working sets. Then the exercise's own actions: Move, Change, Timed Hold,
// Exercise History and Remove.
//
// It replaced the card's edit mode, which opened a panel of chips under the
// sets and turned their numbers into toggles: a set changed type only by a tap
// on its number, which nothing said, and only the last set could be removed.
// The card now only logs, so its ticks never rest dimmed while it's edited.
//
// A set's row is what's logged on it and no tick (user request, the same day:
// beside the tick the numbers were cut short). A pair too long for the row
// wraps between the weight and the reps rather than ending in "...".
//
// The screen binds the exercise into the handlers, so the sheet knows nothing
// of where the exercise is kept: Log Workout and the Journal's workout page
// can open it too.

import { memo, useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Reanimated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import SimpleSheet from "./trainer/SimpleSheet";
import NeuCard from "./NeuCard";
import CollapsibleCard from "./CollapsibleCard";
import SheetPill, { SheetToggle } from "./SheetPill";
import SegmentedControl, { type SegmentOption } from "./SegmentedControl";
import DeleteCircleButton from "./DeleteCircleButton";
import TrashIcon from "./TrashIcon";
import HistoryIcon from "./HistoryIcon";
import { APP_DARK, APP_LIGHT, ACCT, DANGER_BRIGHT, FontFamily, WARMUP_ORANGE } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";
import { unitLabel, unitOf } from "../utils/units";
import { firstRows, nextRows, rowsChanged, setRowKey, type SetType } from "../utils/setRows";

/** What the sheet reads of a set: its row key and what's logged on it. */
export type SheetSet = { id?: string; weight: string; reps: string };

const TYPE_OPTIONS: readonly SegmentOption<SetType>[] = [
  { key: "warmup", label: "Warm-up" },
  { key: "working", label: "Working" },
];
/** An exercise keeps one working set, so its last can't become a warm-up. */
const LAST_WORKING: readonly SetType[] = ["warmup"];

/** What's logged on a set in words ("60 kg × 8", "45 s"), null for nothing.
 *  Non-breaking inside the weight and inside the reps, so a pair too long for
 *  its row wraps between the two. */
function loggedText(set: SheetSet, isHold: boolean, unit: string): string | null {
  const weight = set.weight.trim();
  const reps = set.reps.trim();
  const repsAlone = isHold ? `${reps} s` : `${reps} ${reps === "1" ? "rep" : "reps"}`;
  if (weight && reps) return `${weight} ${unit} × ${isHold ? repsAlone : reps}`;
  if (reps) return repsAlone;
  if (weight) return `${weight} ${unit}`;
  return null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  name: string;
  /** "EXERCISE 2 OF 6", over the name. */
  position?: string;
  warmup: readonly SheetSet[];
  working: readonly SheetSet[];
  /** A timed hold: its reps are seconds. */
  isHold: boolean;
  /** Flips a set between warm-up and working; `type` is what it is now. */
  onToggleSetType: (type: SetType, localIdx: number) => void;
  /** A warm-up set goes after the warm-ups, a working set after the working sets. */
  onAddSet: (type: SetType) => void;
  /** The set by its row key (utils/setRows.ts setRowKey), once its row has closed. */
  onRemoveSet: (rowKey: string) => void;
  onToggleHold: () => void;
  /** These four run once the sheet has slid away and closed, so a sheet one
   *  of them opens never goes up over this one (one RN Modal at a time). */
  onMove: () => void;
  onChange: () => void;
  onHistory: () => void;
  onRemove: () => void;
}

function ExerciseSheet({
  visible, onClose, name, position, warmup, working, isHold,
  onToggleSetType, onAddSet, onRemoveSet, onToggleHold, onMove, onChange, onHistory, onRemove,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { isKg } = useUnit();
  const unit = unitLabel(unitOf(isKg));

  // Remove asks first, as the sheet's next step rather than an alert over it.
  const [step, setStep] = useState<"sets" | "remove">("sets");

  // What runs once the sheet has slid away (`leave` below): after its close,
  // in the same update.
  const after = useRef<(() => void) | null>(null);
  const handleClose = useCallback(() => {
    const next = after.current;
    after.current = null;
    onClose();
    next?.();
  }, [onClose]);

  const rows = [
    ...warmup.map((set, localIdx) => ({ set, type: "warmup" as const, localIdx })),
    ...working.map((set, localIdx) => ({ set, type: "working" as const, localIdx })),
  ];

  // Rows by their set's own key, as on the card (utils/setRows.ts): a row
  // opens when its set is added, and closes before its set is removed, one at
  // a time. Each opening of the sheet starts from the rows it shows, so none
  // of them open as it comes up.
  const rowKeys = rows.map(r => setRowKey(r.set, r.type, r.localIdx));
  const [drawn, setDrawn] = useState(() => firstRows(rowKeys));
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const [shownFor, setShownFor] = useState(visible);
  if (visible !== shownFor) {
    setShownFor(visible);
    setDrawn(firstRows(rowKeys));
    if (!visible) { setStep("sets"); setClosingKey(null); }
  } else if (rowsChanged(drawn, rowKeys)) {
    setDrawn(nextRows(drawn, rowKeys));
  }

  return (
    <SimpleSheet visible={visible} onClose={handleClose}>
      {close => {
        const leave = (then: () => void) => { after.current = then; close(); };

        if (step === "remove") {
          return (
            <Reanimated.View entering={FadeIn.duration(160)} style={styles.body}>
              <Text style={[styles.title, { color: t.tp }]}>Remove {name}?</Text>
              <Text style={[styles.message, { color: t.ts }]}>
                {"It comes out of today's workout, with anything you've logged on it."}
              </Text>
              <SheetPill label="Remove" variant="danger" icon={c => <TrashIcon size={17} color={c} />} onPress={() => leave(onRemove)} />
              <SheetPill label="Cancel" variant="cancel" onPress={() => setStep("sets")} />
            </Reanimated.View>
          );
        }

        return (
          <View style={styles.body}>
            <View style={styles.head}>
              {position ? <Text style={[styles.position, { color: t.ts }]}>{position}</Text> : null}
              <Text style={[styles.title, { color: t.tp }]} numberOfLines={2}>{name}</Text>
            </View>

            <Text style={[styles.section, { color: t.ts }]}>SETS</Text>
            <NeuCard dark={isDark} radius={16}>
              <View style={styles.sets}>
                {rows.map((row, i) => {
                  const key = rowKeys[i];
                  const warm = row.type === "warmup";
                  const text = loggedText(row.set, isHold, unit);
                  const lastWorking = !warm && working.length <= 1;
                  const isNew = !!drawn.added?.has(key) && rowHeight > 0;
                  const isClosing = key === closingKey;
                  const spoken = `${warm ? "Warm-up set" : "Set"} ${row.localIdx + 1}`;
                  return (
                    <CollapsibleCard
                      key={key}
                      isCollapsing={isClosing}
                      onCollapsed={() => { setClosingKey(null); onRemoveSet(key); }}
                      expanding={isNew}
                      naturalHeight={isNew ? rowHeight : undefined}
                    >
                      <View
                        style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.div }]}
                        onLayout={!isNew && !isClosing ? e => { const h = e.nativeEvent.layout.height; if (h > 0) setRowHeight(h); } : undefined}
                      >
                        <View style={[styles.badge, { backgroundColor: warm ? `${WARMUP_ORANGE}2E` : t.field }]}>
                          <Text style={[styles.badgeText, { color: warm ? WARMUP_ORANGE : t.tp }]}>
                            {warm ? "W" : row.localIdx + 1}
                          </Text>
                        </View>
                        <Text style={[styles.logged, { color: text ? t.tp : t.ts }]} numberOfLines={2}>
                          {text ?? "Empty"}
                        </Text>
                        <SegmentedControl
                          options={TYPE_OPTIONS}
                          value={row.type}
                          onChange={() => onToggleSetType(row.type, row.localIdx)}
                          disabled={lastWorking ? LAST_WORKING : undefined}
                          segmentLabel={label => `${spoken}, ${label}`}
                          style={styles.typeSwitch}
                        />
                        <DeleteCircleButton
                          minus
                          onPress={() => { if (closingKey === null) setClosingKey(key); }}
                          disabled={rows.length <= 1 || lastWorking}
                          accessibilityLabel={`Remove ${spoken.toLowerCase()}`}
                        />
                      </View>
                    </CollapsibleCard>
                  );
                })}
              </View>
            </NeuCard>
            <View style={styles.addRow}>
              <SheetPill
                label="Warm-up"
                icon={() => <Ionicons name="add" size={20} color={WARMUP_ORANGE} />}
                onPress={() => onAddSet("warmup")}
                accessibilityLabel="Add a warm-up set"
                style={styles.addPill}
              />
              <SheetPill
                label="Working"
                icon={() => <Ionicons name="add" size={20} color={ACCT} />}
                onPress={() => onAddSet("working")}
                accessibilityLabel="Add a working set"
                style={styles.addPill}
              />
            </View>

            <Text style={[styles.section, styles.sectionAfter, { color: t.ts }]}>EXERCISE</Text>
            <SheetPill
              label="Move Exercise"
              icon={c => <Ionicons name="reorder-three-outline" size={20} color={c} />}
              onPress={() => leave(onMove)}
            />
            <SheetPill
              label="Change Exercise"
              icon={c => <Ionicons name="swap-horizontal-outline" size={18} color={c} />}
              onPress={() => leave(onChange)}
            />
            <SheetToggle
              label="Timed Hold"
              icon={c => <Ionicons name="timer-outline" size={18} color={c} />}
              value={isHold}
              onChange={onToggleHold}
              outline={false}
            />
            <SheetPill
              label="Exercise History"
              icon={c => <HistoryIcon size={18} color={c} />}
              onPress={() => leave(onHistory)}
            />
            <SheetPill
              label="Remove Exercise"
              tint={DANGER_BRIGHT}
              icon={c => <TrashIcon size={17} color={c} />}
              onPress={() => setStep("remove")}
            />
          </View>
        );
      }}
    </SimpleSheet>
  );
}

export default memo(ExerciseSheet);

const styles = StyleSheet.create({
  body:         { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  head:         { alignItems: "center", gap: 2, paddingHorizontal: 4, paddingBottom: 4 },
  position:     { fontFamily: FontFamily.semibold, fontSize: 13 },
  title:        { fontFamily: FontFamily.bold, fontSize: 20, textAlign: "center" },
  message:      { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21, textAlign: "center", paddingHorizontal: 8, paddingBottom: 4 },
  section:      { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1, paddingHorizontal: 4, marginBottom: -4 },
  sectionAfter: { marginTop: 8 },
  sets:         { paddingHorizontal: 12 },
  row:          { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, paddingVertical: 8 },
  badge:        { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  badgeText:    { fontFamily: FontFamily.bold, fontSize: 12 },
  // Wraps to a second line rather than ending in "..." (see the top).
  logged:       { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14, lineHeight: 18 },
  typeSwitch:   { width: 144 },
  addRow:       { flexDirection: "row", gap: 12 },
  addPill:      { flex: 1 },
});
