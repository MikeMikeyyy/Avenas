// The sheet ··· on a program builder exercise card opens (app/new-program.tsx;
// user request, 2026-11-07: Reps / Hold was rarely used, and the card had a
// bin, a rest chip, a move handle and that switch across it). Everything that
// sets the exercise up rather than its sets' targets: under SETS its rest
// timer, Rep Range (also the card's Reps header, which stays) and Timed Hold;
// under EXERCISE Move, Change and Remove. Laid out as the Workout tab's
// exercise sheet (components/ExerciseSheet.tsx), so the two read as one.
//
// The rest timer is a step of this sheet, its wheel as the card's own picker
// had it (it saves as the wheel settles; Apply to All gives every exercise on
// every day the same, once the sheet has gone). Remove asks first, as another
// step. Move, Change and Remove run once the sheet has slid away, so what
// they open never goes up over it (one RN Modal at a time).
//
// The screen binds the exercise into the handlers and owns the sheet, as it
// does every sheet on the builder.

import { memo, useCallback, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Reanimated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import SimpleSheet from "./trainer/SimpleSheet";
import SheetPill, { SheetToggle } from "./SheetPill";
import MaskedView from "./MaskedView";
import TrashIcon from "./TrashIcon";
import { APP_DARK, APP_LIGHT, DANGER_BRIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

// ─── Rest timer ───────────────────────────────────────────────────────────────

const REST_ITEM_H = 38;
/** Off, then every 5 seconds to 5 minutes. */
const REST_OPTIONS = [0, ...Array.from({ length: 60 }, (_, i) => (i + 1) * 5)];

/** "Off", "45s", "1m 30s", "2m". */
export function formatRest(secs: number): string {
  if (!secs) return "Off";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const restAt = (offset: number) =>
  REST_OPTIONS[Math.max(0, Math.min(Math.round(offset / REST_ITEM_H), REST_OPTIONS.length - 1))] ?? 0;

/** The rest wheel: five rows, the middle one picked. Built only while its step
 *  is open (61 rows of animated text is a lot to mount for every card). */
function RestWheel({ seconds, onSettle, onOffset }: {
  seconds: number;
  /** The value the wheel came to rest on. */
  onSettle: (secs: number) => void;
  /** Where it is now, for Done and Apply to All mid-spin. */
  onOffset: (y: number) => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const start = Math.max(0, REST_OPTIONS.indexOf(seconds)) * REST_ITEM_H;
  const [scrollAnim] = useState(() => new Animated.Value(start));

  return (
    <View style={styles.wheelWrap}>
      <View pointerEvents="none" style={[styles.selTop, { borderColor: t.sheetLine }]} />
      <View pointerEvents="none" style={[styles.selBottom, { borderColor: t.sheetLine }]} />
      {/* The wheel shows everywhere but the middle row, where the bold copy
          below shows instead. A mask, not a strip painted in the sheet's
          colour over it: the glass sheet has no one colour. */}
      <MaskedView
        style={styles.wheel}
        maskElement={
          <View style={styles.wheel}>
            <View style={styles.maskShown} />
            <View style={styles.maskBand} />
            <View style={styles.maskShown} />
          </View>
        }
      >
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          snapToInterval={REST_ITEM_H}
          decelerationRate="fast"
          contentContainerStyle={{ paddingVertical: REST_ITEM_H * 2 }}
          contentOffset={{ x: 0, y: start }}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollAnim } } }],
            {
              useNativeDriver: true,
              listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => onOffset(e.nativeEvent.contentOffset.y),
            },
          )}
          onMomentumScrollEnd={e => onSettle(restAt(e.nativeEvent.contentOffset.y))}
        >
          {REST_OPTIONS.map((item, i) => {
            const range = [
              (i - 2.5) * REST_ITEM_H, (i - 2) * REST_ITEM_H, (i - 1) * REST_ITEM_H,
              i * REST_ITEM_H, (i + 1) * REST_ITEM_H, (i + 2) * REST_ITEM_H, (i + 2.5) * REST_ITEM_H,
            ];
            const rotateX = scrollAnim.interpolate({
              inputRange: range,
              outputRange: ["-85deg", "-55deg", "-28deg", "0deg", "28deg", "55deg", "85deg"],
              extrapolate: "clamp",
            });
            const opacity = scrollAnim.interpolate({
              inputRange: range,
              outputRange: [0, 0.5, 0.75, 1, 0.75, 0.5, 0],
              extrapolate: "clamp",
            });
            return (
              <Animated.View key={item} style={[styles.item, { opacity, transform: [{ perspective: 280 }, { rotateX }] }]}>
                <Text style={[styles.itemText, { color: t.ts }]}>{formatRest(item)}</Text>
              </Animated.View>
            );
          })}
        </Animated.ScrollView>
      </MaskedView>
      <View pointerEvents="none" style={styles.pickedBand}>
        <Animated.View style={{ transform: [{ translateY: Animated.multiply(scrollAnim, -1) }] }}>
          {REST_OPTIONS.map(item => (
            <View key={item} style={styles.item}>
              <Text style={[styles.itemText, styles.itemPicked, { color: t.tp }]}>{formatRest(item)}</Text>
            </View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

// ─── The sheet ────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  name: string;
  /** "EXERCISE 2 OF 6", over the name. */
  position?: string;
  restSeconds: number;
  isHold: boolean;
  /** Its sets' targets are ranges (8 to 12) rather than one number. */
  isRange: boolean;
  onSetRest: (secs: number) => void;
  onToggleRange: () => void;
  onToggleHold: () => void;
  /** These run once the sheet has slid away and closed. */
  onApplyRestToAll: (secs: number) => void;
  onMove: () => void;
  onChange: () => void;
  onRemove: () => void;
}

function ProgramExerciseSheet({
  visible, onClose, name, position, restSeconds, isHold, isRange,
  onSetRest, onToggleRange, onToggleHold, onApplyRestToAll, onMove, onChange, onRemove,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [step, setStep] = useState<"actions" | "rest" | "remove">("actions");
  // Each opening starts on its actions.
  const [shownFor, setShownFor] = useState(visible);
  if (visible !== shownFor) {
    setShownFor(visible);
    if (!visible) setStep("actions");
  }

  // What runs once the sheet has slid away (`leave` below): after its close,
  // in the same update.
  const after = useRef<(() => void) | null>(null);
  const handleClose = useCallback(() => {
    const next = after.current;
    after.current = null;
    onClose();
    next?.();
  }, [onClose]);

  // Where the rest wheel is, read by Apply to All.
  const restOffset = useRef(0);

  return (
    <SimpleSheet visible={visible} onClose={handleClose}>
      {close => {
        const leave = (then: () => void) => { after.current = then; close(); };

        if (step === "remove") {
          return (
            <Reanimated.View entering={FadeIn.duration(160)} style={styles.body}>
              <Text style={[styles.title, { color: t.tp }]}>Remove {name}?</Text>
              <Text style={[styles.message, { color: t.ts }]}>It comes out of this day, with its sets.</Text>
              <SheetPill label="Remove" variant="danger" icon={c => <TrashIcon size={17} color={c} />} onPress={() => leave(onRemove)} />
              <SheetPill label="Cancel" variant="cancel" onPress={() => setStep("actions")} />
            </Reanimated.View>
          );
        }

        if (step === "rest") {
          return (
            <Reanimated.View entering={FadeIn.duration(160)} style={styles.body}>
              <View style={styles.head}>
                <Text style={[styles.title, { color: t.tp }]}>Rest Timer</Text>
                <Text style={[styles.subtitle, { color: t.ts }]} numberOfLines={1}>{name}</Text>
              </View>
              <RestWheel seconds={restSeconds} onSettle={onSetRest} onOffset={y => { restOffset.current = y; }} />
              <View style={styles.pair}>
                <SheetPill
                  label="Apply to All"
                  onPress={() => {
                    const secs = restAt(restOffset.current);
                    leave(() => onApplyRestToAll(secs));
                  }}
                  accessibilityLabel="Apply this rest to every exercise"
                  style={styles.pairPill}
                />
                <SheetPill
                  label="Done"
                  variant="primary"
                  onPress={() => { onSetRest(restAt(restOffset.current)); close(); }}
                  style={styles.pairPill}
                />
              </View>
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
            <SheetPill
              label="Rest Timer"
              icon={c => <Ionicons name="timer-outline" size={18} color={c} />}
              badge={<Text style={[styles.pillValue, { color: t.ts }]}>{formatRest(restSeconds)}</Text>}
              onPress={() => {
                restOffset.current = Math.max(0, REST_OPTIONS.indexOf(restSeconds)) * REST_ITEM_H;
                setStep("rest");
              }}
              accessibilityLabel={`Rest timer, ${formatRest(restSeconds)}`}
            />
            <SheetToggle
              label="Rep Range"
              icon={c => <Ionicons name="code-working-outline" size={18} color={c} />}
              value={isRange}
              onChange={onToggleRange}
              outline={false}
            />
            <SheetToggle
              label="Timed Hold"
              icon={c => <Ionicons name="hourglass-outline" size={17} color={c} />}
              value={isHold}
              onChange={onToggleHold}
              outline={false}
            />

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

export default memo(ProgramExerciseSheet);

const styles = StyleSheet.create({
  // As the Workout tab's exercise sheet.
  body:         { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  head:         { alignItems: "center", gap: 2, paddingHorizontal: 4, paddingBottom: 4 },
  position:     { fontFamily: FontFamily.semibold, fontSize: 13 },
  title:        { fontFamily: FontFamily.bold, fontSize: 20, textAlign: "center" },
  subtitle:     { fontFamily: FontFamily.regular, fontSize: 14 },
  message:      { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21, textAlign: "center", paddingHorizontal: 8, paddingBottom: 4 },
  section:      { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1, paddingHorizontal: 4, marginBottom: -4 },
  sectionAfter: { marginTop: 8 },
  pillValue:    { fontFamily: FontFamily.semibold, fontSize: 15 },
  pair:         { flexDirection: "row", gap: 12, paddingTop: 4 },
  pairPill:     { flex: 1 },
  // The wheel, as the card's own picker drew it.
  wheelWrap:    { height: REST_ITEM_H * 5, overflow: "hidden" },
  wheel:        { flex: 1 },
  maskShown:    { height: REST_ITEM_H * 2, backgroundColor: "black" },
  maskBand:     { height: REST_ITEM_H },
  selTop:       { position: "absolute", top: REST_ITEM_H * 2, left: 24, right: 24, borderTopWidth: 1, zIndex: 1 },
  selBottom:    { position: "absolute", top: REST_ITEM_H * 3, left: 24, right: 24, borderTopWidth: 1, zIndex: 1 },
  pickedBand:   { position: "absolute", top: REST_ITEM_H * 2, left: 0, right: 0, height: REST_ITEM_H, overflow: "hidden" },
  item:         { height: REST_ITEM_H, alignItems: "center", justifyContent: "center" },
  itemText:     { fontSize: 20 },
  itemPicked:   { fontFamily: FontFamily.bold },
});
