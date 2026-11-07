// components/progress/ChartScrollFade.tsx
//
// An exercise chart's scrolling row, faded out at an edge it runs on past: the
// Progress page's (components/progress/ExerciseChartPlot.tsx) and the compare
// page's (components/progress/CompareChartPlot.tsx), one component so the two
// can't differ.
//
// Masked, not painted over (user report, 2026-11-06: "a clipping issue", the
// axis faded, and the green showing in full past the fade). The fade was a
// strip in the card's colour laid over the row: it began a point in from the
// row's edge, so a sliver of the chart showed in full colour past its solid
// end; it covered the axis under the plot as well; and a layer painted in the
// card's colour is what CLAUDE.md rules out (mask instead). Here the plot goes
// transparent toward the edge, as strongly as there's chart past it, and the
// axis row under the plot, the sessions' numbers, never fades. The axis lines
// are the chart's own, drawn over this.

import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import MaskedView from "../MaskedView";

/** How far in from an edge the fade reaches, and how much scroll brings it on. */
export const CHART_FADE_W = 18;

export default function ChartScrollFade({ sx, maxScroll, width, height, plotBottom, style, children }: {
  /** The row's scroll position (its contentOffset.x), on the UI thread. */
  sx: SharedValue<number>;
  maxScroll: number;
  /** The row's own frame. */
  width: number;
  height: number;
  /** Where the plot ends and the axis row under it begins: below it nothing
   *  fades. */
  plotBottom: number;
  /** Where the row sits in the chart. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  // How solid each edge stays: wholly while nothing runs on past it, giving
  // way to the fade over the first stretch of scroll toward it.
  const leftSolid = useAnimatedStyle(() => ({
    opacity: interpolate(sx.value, [0, CHART_FADE_W], [1, 0], Extrapolation.CLAMP),
  }));
  const rightSolid = useAnimatedStyle(() => ({
    opacity: interpolate(maxScroll - sx.value, [0, CHART_FADE_W], [1, 0], Extrapolation.CLAMP),
  }));

  // Only the mask's alpha counts: where it's solid the row shows as it is.
  const mask = (
    <View style={{ width, height }}>
      {/* The plot between its edges, and the axis row the whole way across. */}
      <View style={[styles.solid, { left: CHART_FADE_W, right: CHART_FADE_W, top: 0, height: plotBottom }]} />
      <View style={[styles.solid, { left: 0, right: 0, top: plotBottom, bottom: 0 }]} />
      {/* Each edge of the plot: clear at the very edge, solid a fade's width
          in, under a solid layer that gives way as the row runs on past it. */}
      <View style={[styles.edge, { left: 0, height: plotBottom }]}>
        <LinearGradient colors={["transparent", "black"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        <Reanimated.View style={[styles.cover, leftSolid]} />
      </View>
      <View style={[styles.edge, { right: 0, height: plotBottom }]}>
        <LinearGradient colors={["black", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        <Reanimated.View style={[styles.cover, rightSolid]} />
      </View>
    </View>
  );

  return (
    <MaskedView style={[style, { width, height }]} maskElement={mask}>
      {children}
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  solid: { position: "absolute", backgroundColor: "black" },
  edge: { position: "absolute", top: 0, width: CHART_FADE_W },
  cover: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "black" },
});
