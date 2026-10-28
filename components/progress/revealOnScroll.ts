// components/progress/revealOnScroll.ts
//
// Something on the Progress page that comes in the first time it's scrolled
// into sight (user request, 2026-10-14: the comparison's exercise list draws
// all its little charts out once the first of them is seen). The page (ProgressView)
// watches its own scroll and calls a watched view's onReveal once it's on
// screen; with no page watching, a view comes in as soon as it's laid out.

import { createContext, useContext, useEffect, useRef } from "react";
import type { ViewInstance } from "react-native";

export type RevealWatcher = {
  /** Watches `view` until it's on screen, then calls `onReveal`, once.
   *  Returns a function that stops watching it. */
  watch: (view: ViewInstance, onReveal: () => void) => () => void;
};

export const RevealOnScrollContext = createContext<RevealWatcher | null>(null);

/** The ref and onLayout to put on a view that comes in when it's first seen:
 *  `onReveal` runs once, then never again for that view. */
export function useRevealOnScroll(onReveal: () => void) {
  const watcher = useContext(RevealOnScrollContext);
  const ref = useRef<ViewInstance>(null);
  const state = useRef<{ done: boolean; stop: (() => void) | null }>({ done: false, stop: null });
  useEffect(() => () => state.current.stop?.(), []);
  const onLayout = () => {
    const s = state.current;
    if (s.done || s.stop) return;
    const reveal = () => {
      s.done = true;
      s.stop = null;
      onReveal();
    };
    if (!watcher || !ref.current) {
      reveal();
      return;
    }
    s.stop = watcher.watch(ref.current, reveal);
  };
  return { ref, onLayout };
}
