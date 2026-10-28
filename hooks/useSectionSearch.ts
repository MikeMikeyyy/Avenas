// The search a section partway down a scrolling page opens from a button on
// its heading: the Progress page's search over every exercise under All
// programs (user request, 2026-10-26).
//
// As on a group's member search: closing clears it and drops the keyboard in
// the same step, and the keyboard's down key closes it while it's being typed
// in. Typed in, the heading is lifted to the top of the screen so the field
// and as many matches as fit show above the keyboard, with the keyboard's
// height added under the page so a short one can scroll that far; the page
// goes back to where it was when the keyboard drops or the search closes. A
// match picked goes on to wherever the page takes it next instead (the chart).
//
// The page's ScrollView must take taps with the keyboard up
// (keyboardShouldPersistTaps="handled") and float a KeyboardDismissButton with
// `onKeyboardDown`. iOS only, as the keyboard events are.

import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { Keyboard, type TextInputInstance, type ViewInstance } from "react-native";

/** How far under the top of the screen's safe area the heading is lifted to:
 *  its round button clear of the blur there. */
const LIFT_GAP = 16;

export function useSectionSearch({ scrollRef, headingRef, topInset, shown }: {
  /** The page's ScrollView. */
  scrollRef: RefObject<any>;
  /** The section's heading, lifted to the top while typing. */
  headingRef: RefObject<ViewInstance | null>;
  /** The safe area over the page's top (0 for a page under another header). */
  topInset: number;
  /** Whether the section is on the page now. */
  shown: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInputInstance>(null);
  const [kbHeight, setKbHeight] = useState(0);
  // Where the page was before the search lifted it, to go back to.
  const before = useRef<number | null>(null);
  const searching = shown && open;

  const close = useCallback(() => {
    setQuery("");
    Keyboard.dismiss();
    setOpen(false);
  }, []);
  const toggle = useCallback(() => {
    if (open) close();
    else setOpen(true);
  }, [open, close]);
  // Asked before anything is dismissed: once the keyboard drops, nothing is
  // focused any more.
  const onKeyboardDown = useCallback(() => {
    if (inputRef.current?.isFocused()) close();
    else Keyboard.dismiss();
  }, [close]);
  /** A match picked: the keyboard goes, and the page stays where it's taken. */
  const picked = useCallback(() => {
    before.current = null;
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  /** Lifts the heading to the top of the screen, keeping where the page was.
   *  How far it's scrolled now is read off the layout: the heading's place in
   *  the content against where it and the page sit on screen. */
  const lift = useEffectEvent(() => {
    const heading = headingRef.current;
    const page = scrollRef.current;
    const content = page?.getInnerViewRef?.();
    const frame = page?.getNativeScrollRef?.();
    if (!heading || !content || !frame) return;
    heading.measureLayout(content, (_x, y) => {
      heading.measureInWindow((_hx, headingTop) => {
        frame.measureInWindow((_px: number, pageTop: number) => {
          const now = y - (headingTop - pageTop);
          const target = Math.max(0, y - topInset - LIFT_GAP);
          if (Math.abs(target - now) < 2) return;
          if (before.current === null) before.current = now;
          page.scrollTo({ y: target, animated: true });
        });
      });
    }, () => {});
  });
  useEffect(() => {
    if (searching && kbHeight > 0) {
      // A frame after the taller page has laid out, so the scroll can reach it.
      const id = requestAnimationFrame(() => lift());
      return () => cancelAnimationFrame(id);
    }
    if (before.current !== null) {
      scrollRef.current?.scrollTo({ y: before.current, animated: true });
      before.current = null;
    }
  }, [searching, kbHeight, scrollRef]);

  return {
    open,
    query,
    setQuery,
    toggle,
    close,
    onKeyboardDown,
    picked,
    inputRef,
    /** What to add under the page while it's typed in. */
    extraPadding: searching ? kbHeight : 0,
  };
}
