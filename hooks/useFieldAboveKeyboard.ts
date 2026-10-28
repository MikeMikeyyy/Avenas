// Keeps the field being typed into above the keyboard and whatever floats on
// it (the keyboard's tools: the down key and a page's ‹ › arrows; on the
// Workout page, a rest timer too), on the logging pages: the Workout tab, the
// Journal's log of a past workout, and a logged workout's own page.
//
// Those pages don't use KeyboardAwareScrollView, which the plain forms do:
// it's a Reanimated.ScrollView, and their content animates its own height (a
// set's row opening or closing, an exercise collapsing), which a
// Reanimated.ScrollView doesn't reflow for. Their list is a plain ScrollView
// in a KeyboardAvoidingView instead, which shrinks it above the keyboard but
// never moves a field that ends up under it: tapping an exercise's notes low
// on the page left them behind the keyboard (user report, 2026-10-13).
//
// A field in the list reports its focus through the returned callback (from
// its onFocus). It's scrolled clear when it's under the keyboard or what
// floats on it, and only that far: as the keyboard opens, when focus moves to
// another field with the keyboard already up (a tap, the ‹ › keys), and when
// what floats there grows (a rest starting). A field outside the list (a
// floating notes card, a sheet's) never reports, so it never moves the list.
//
// The ScrollView must start at the top of the screen (every logging page's
// does): scrollResponderScrollNativeHandleToKeyboard places the field from
// there. iOS only, as the Workout tab's rest-timer version of this was:
// Android's window resizes for the keyboard and keeps a focused field in view.

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Platform, TextInput, useWindowDimensions, type ScrollViewInstance } from "react-native";

type Field = ReturnType<typeof TextInput.State.currentlyFocusedInput>;

export function useFieldAboveKeyboard(
  scrollRef: RefObject<ScrollViewInstance | null>,
  /** The keyboard's height while it's up, 0 while it's down. */
  kbHeight: number,
  /** How far above the keyboard's top the field must end. */
  clearance: number,
): () => void {
  const { height: winH } = useWindowDimensions();
  const fieldRef = useRef<Field | null>(null);
  const coverRef = useRef({ kbHeight: 0, winH, clearance });

  const clearField = useCallback(() => {
    const { kbHeight: kb, winH: screenH, clearance: clear } = coverRef.current;
    const field = TextInput.State.currentlyFocusedInput();
    if (Platform.OS !== "ios" || kb === 0 || !field || field !== fieldRef.current) return;
    field.measureInWindow((_x, y, _w, h) => {
      if (y + h > screenH - kb - clear) {
        scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(field, clear, true);
      }
    });
  }, [scrollRef]);

  useEffect(() => {
    coverRef.current = { kbHeight, winH, clearance };
    clearField();
  }, [kbHeight, winH, clearance, clearField]);

  return useCallback(() => {
    fieldRef.current = TextInput.State.currentlyFocusedInput() ?? null;
    clearField();
  }, [clearField]);
}
