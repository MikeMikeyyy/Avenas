// hooks/useTabBar.ts
//
// Where the tab bar is, for whichever bar is drawn (app/(tabs)/_layout.tsx):
// Apple's own on iOS 26 and later, the app's below that and on Android.
// Everything that stands on the bar (the workout bar, the rest pill, the
// Workout page's pinned buttons; constants/floatingBars.ts) is placed from its
// top edge, so it sits the same distance above either bar.
//
// The app's bar is fixed (NAV_BAR_TOP). Apple's is measured: a page inside its
// tabs has the bar inside its safe area, so that safe area's bottom is where
// the bar's top edge is (83 on a Face ID iPhone; components/TabScreen.tsx
// reports it). The app's bar stands in until the first report, a moment after
// launch.

import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { NAV_BAR_TOP, aboveRestOnTab, barHideY, tabBarClearance } from "../constants/floatingBars";

/** Whether the tabs are Apple's own bar: iOS 26 and later, where it's Liquid
 *  Glass that a finger can press, hold and slide across between tabs (user
 *  request, 2026-10-16). Fixed for the life of the app. */
export const NATIVE_TAB_BAR =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

let nativeTop: number | null = null;
const listeners = new Set<() => void>();

/** A tab page's safe-area bottom inside Apple's tabs (`tabInset`) against the
 *  window's (`windowInset`). The page's safe area starts as a copy of the
 *  window's until iOS measures it, and once measured, the bar inside it makes
 *  it the larger of the two, so a copy says nothing about the bar. */
export function reportNativeTabBar(tabInset: number, windowInset: number): void {
  if (tabInset <= windowInset || tabInset === nativeTop) return;
  nativeTop = tabInset;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readNativeTop(): number | null {
  return nativeTop;
}

/** The tab bar's place, in points above the screen's bottom edge. Read as one
 *  hook's numbers, never worked out from `top` on the page: React Compiler
 *  takes what a function returns as possibly mutable, and on the Workout page
 *  that cost the whole screen its optimisation. */
export type TabBarPlace = {
  /** The bar's top edge. */
  top: number;
  /** Where the lowest floating bar sits (tabBarClearance). */
  clearance: number;
  /** Where the Workout page's pinned buttons stand while a rest runs
   *  (aboveRestOnTab). */
  aboveRest: number;
  /** How far the workout bar drops to hide (barHideY). */
  hideY: number;
};

export function useTabBar(): TabBarPlace {
  const measured = useSyncExternalStore(subscribe, readNativeTop);
  const top = NATIVE_TAB_BAR ? (measured ?? NAV_BAR_TOP) : NAV_BAR_TOP;
  return {
    top,
    clearance: tabBarClearance(top),
    aboveRest: aboveRestOnTab(top),
    hideY: barHideY(top),
  };
}
