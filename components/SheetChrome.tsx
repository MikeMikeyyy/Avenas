// What every pop-up is drawn in (user request and pick, 2026-10-30, after
// trying it on the Workout tab's exercise sheet; the builder's two first-time
// guides too): on iOS 26, Liquid Glass as its surface, set in from the
// screen's sides and foot with all four corners round, as iOS 26's own
// floating sheets are, over a lighter dim so the page shows through; and a
// glass X in its top right corner that closes it, as well as its Done or
// Cancel, a drag down or a tap outside. Below iOS 26, and on Android, a sheet
// is the solid one it always was and the X a solid round button.
//
// Whatever the page has under a pop-up, its glass shows the page's plain colour
// under the dim (SheetGlass's backing; user request, 2026-11-12), as it does
// over an empty stretch of page: no photo or chart blurred through it.
//
// A sheet spreads `sheetSurface(fill)` into its own style in place of its fill,
// draws <SheetGlass /> as its first child, starts with a SHEET_TOP_ROW (the
// grabber, and room for the X beside it, so nothing it shows can run under
// the X), and puts <SheetCloseButton /> last, which places itself. Its dim is
// SHEET_DIM. components/trainer/SimpleSheet.tsx does all of that for the
// sheets built on it.

import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import GlassButton, { GLASS, GlassSurface } from "./GlassButton";
import { APP_DARK, APP_LIGHT } from "../constants/theme";
import { PILL_SHADOW } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";

/** The glass sheet's gap to the screen's sides and foot. */
export const GLASS_SHEET_INSET = 8;
/** Its corners: concentric with a recent iPhone's (about 48pt round), as iOS
 *  26's own floating sheets are. */
export const GLASS_SHEET_RADIUS = 40;
/** The X's diameter. */
export const SHEET_CLOSE_SIZE = 36;
/** The X's gap to the sheet's top and right edges: in from the corner, close
 *  to concentric with the sheet's round corner, as iOS 26 sits a corner button
 *  (user request, 2026-10-30: at 10 and 12 it was jammed up in the corner). */
const SHEET_CLOSE_INSET = 18;

/** The least of the page left showing above a sheet, under the status bar: a
 *  taller sheet shrinks and its content scrolls (SimpleSheet, and the hand-built
 *  ones whose lists can run long). */
export const SHEET_TOP_GAP = 12;

/** The dim behind a pop-up: lighter under glass, so the page shows through. */
export const SHEET_DIM = GLASS ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.45)";

/** A sheet's first row: the grabber at its top, and room for the X (its inset
 *  and height, and a little under it), so what the sheet shows starts below
 *  the X and never under it. Its drag handlers go on this row, as on the
 *  grabber area it replaces. */
export const SHEET_TOP_ROW_H = 56;
export const SHEET_TOP_ROW: ViewStyle = { height: SHEET_TOP_ROW_H, paddingTop: 12, alignItems: "center" };

/** A sheet's surface: on glass, its inset from the sides and foot (the glass
 *  itself is SheetGlass), and no clip, so nothing cuts the glass's own shadow
 *  and edge off (a sheet that clipped its content to its corners clipped the
 *  glass with it); otherwise its own fill. Laid over the sheet's style in
 *  place of its backgroundColor. */
export function sheetSurface(fill: string): ViewStyle {
  return GLASS
    ? { marginHorizontal: GLASS_SHEET_INSET, marginBottom: GLASS_SHEET_INSET, overflow: "visible" }
    : { backgroundColor: fill };
}

/** The space under a sheet's last row, for the home indicator: the glass sheet
 *  already stands GLASS_SHEET_INSET off the foot, so that much less. */
export function sheetFootGap(insetBottom: number): number {
  return GLASS ? Math.max(insetBottom - GLASS_SHEET_INSET, 0) : insetBottom;
}

/** The glass behind everything on a sheet (or a pop-up card, `radius`): its
 *  first child. Nothing below iOS 26, where the sheet has its fill.
 *
 *  The glass stands on a backing in the sheet's exact shape: the page's own
 *  colour under the pop-up's dim (SHEET_DIM, which every pop-up dims with), so
 *  it only ever sees that and reads as it does over an empty stretch of page,
 *  whatever the page has under it (user request, 2026-11-12: an exercise's
 *  black photo showed through as a dark blurred square, and Progress's charts
 *  as a green one). The backing is behind the glass, never on it: nothing is
 *  painted over the glass, which stays iOS's own. */
export function SheetGlass({ radius = GLASS_SHEET_RADIUS }: { radius?: number }) {
  const { isDark } = useTheme();
  if (!GLASS) return null;
  const t = isDark ? APP_DARK : APP_LIGHT;
  const shape = [StyleSheet.absoluteFill, { borderRadius: radius }];
  return (
    <>
      <View pointerEvents="none" style={[shape, { backgroundColor: t.bg }]}>
        <View style={[shape, { backgroundColor: SHEET_DIM }]} />
      </View>
      <GlassSurface style={shape}>{null}</GlassSurface>
    </>
  );
}

/** The back chevron in a sheet's top left corner, facing the X, on a sheet
 *  that's a step after another (Send a Program's people, after its program;
 *  user request, 2026-10-30): pass the sheet's own animated close, then the
 *  step before's open. It places itself. */
export function SheetBackButton({ onPress }: { onPress: () => void }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <GlassButton
      onPress={onPress}
      size={SHEET_CLOSE_SIZE}
      style={styles.back}
      solidStyle={PILL_SHADOW}
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={20} color={t.tp} />
    </GlassButton>
  );
}

/** The X in a sheet's top right corner, which closes it the way its other
 *  ways do (pass the sheet's own animated close). It places itself. */
export function SheetCloseButton({ onPress, style }: { onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <GlassButton
      onPress={onPress}
      size={SHEET_CLOSE_SIZE}
      style={[styles.close, style]}
      solidStyle={PILL_SHADOW}
      accessibilityLabel="Close"
    >
      <Ionicons name="close" size={20} color={t.tp} />
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  close: { position: "absolute", top: SHEET_CLOSE_INSET, right: SHEET_CLOSE_INSET, zIndex: 5 },
  back:  { position: "absolute", top: SHEET_CLOSE_INSET, left: SHEET_CLOSE_INSET, zIndex: 5 },
});
