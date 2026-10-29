// Shared bottom-sheet shell used by trainer flows. Swipe-to-dismiss,
// fade backdrop, standard drag handle (36×4, rgba 0.4) per the app standard.
//
// Uses KeyboardAvoidingView + flex-end layout (matching the journal
// WorkoutPickerSheet pattern) so the sheet lifts above the keyboard when
// a child TextInput grabs focus.
//
// A sheet never rises past the status bar (user report, 2026-10-29: Send a
// Program's recipient picker grew taller than the screen, its top out of
// reach with nothing to scroll, so Cancel was the only way out). The page
// above it never shows less than the top inset plus SHEET_TOP_GAP; a taller
// sheet shrinks into what's left and its content scrolls. Whatever must stay
// in reach however long the content runs (a picker's Send and Cancel, a
// message box) goes in `footer`, pinned under the scrolling part.
//
// On iOS 26 it's a floating glass sheet with a glass X in its top right
// corner, as every pop-up is (components/SheetChrome.tsx; user request,
// 2026-10-30).

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, ScrollView, StyleSheet, TouchableOpacity, View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_DARK, APP_LIGHT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { SHEET_DIM, SHEET_TOP_ROW, SheetCloseButton, SheetGlass, sheetFootGap, sheetSurface } from "../SheetChrome";

/** The least of the page left showing above a sheet, under the status bar. */
const SHEET_TOP_GAP = 12;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Or a function of the sheet's own close, for content that leaves through
   *  it: the sheet slides away, then `onClose` runs. A button that opens
   *  another sheet can so wait for this one to go first (one RN Modal at a
   *  time), where closing from the parent removes the sheet at once. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Pinned under the content, which scrolls above it once the sheet is as
   *  tall as the screen allows. A function of the sheet's own close, like
   *  `children`, for a button that slides it away (the reorder sheet's Done). */
  footer?: ReactNode | ((close: () => void) => ReactNode);
  /** False while something in the content takes the finger's drags itself
   *  (a row being dragged into a new place), so the content holds still. */
  scrollEnabled?: boolean;
  /** Drawn over the sheet and its dim, in the sheet's own Modal: a first-time
   *  guide to it (components/GuideCard.tsx). A pop-up can't open over a
   *  pop-up any other way, one RN Modal at a time. */
  over?: ReactNode;
}

export default function SimpleSheet({ visible, onClose, children, footer, scrollEnabled = true, over }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // Hidden a whole screen down: a sheet can now be nearly that tall, and 600
  // left the top of a tall one showing before it slid up.
  const { height: screenH } = useWindowDimensions();
  // In state, not a ref's `.current`: `dismiss` reads them and goes to
  // `children` and `footer` in render, which the hooks lint takes for reading
  // a ref during render.
  const [slideY] = useState(() => new Animated.Value(screenH));
  const [backdropOpacity] = useState(() => new Animated.Value(0));

  // The home-indicator inset is dead space behind the keyboard — drop it while
  // the keyboard is up so input rows (e.g. the message composer) sit snug above
  // the keys. Sheets without text inputs never raise the keyboard, so unaffected.
  const [kbVisible, setKbVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, () => setKbVisible(true));
    const hide = Keyboard.addListener(hideEvt, () => setKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: screenH, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(screenH); backdropOpacity.setValue(0); onClose(); });
  }, [onClose, screenH, slideY, backdropOpacity]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300)); } },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.8) dismiss();
      else {
        Animated.parallel([
          Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
          Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      }
    },
  })).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else {
      // Closed by the parent rather than by a swipe or backdrop tap (which
      // reset these at the end of their own animation): the Modal goes at once
      // and leaves the sheet at its open position, so the NEXT open had nothing
      // to slide from and just appeared. Put it back below the screen.
      slideY.setValue(screenH);
      backdropOpacity.setValue(0);
    }
  }, [visible, screenH, slideY, backdropOpacity]);

  // Under the last thing in the sheet. Without a footer it's inside the
  // scrolling part, so the last button's shadow has room before the edge
  // that clips it; with one, it's under the footer.
  const bottomGap = kbVisible ? 12 : sheetFootGap(insets.bottom) + 12;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
          {/* The page behind, a tap away from closing the sheet. Never shorter
              than the status bar and SHEET_TOP_GAP: a taller sheet gives way
              instead (it shrinks, `flexShrink`, and its content scrolls). */}
          <TouchableOpacity style={{ flex: 1, minHeight: insets.top + SHEET_TOP_GAP }} activeOpacity={1} onPress={dismiss} />
          <Animated.View style={[styles.sheet, sheetSurface(t.bg), { paddingBottom: footer ? bottomGap : 0, transform: [{ translateY: slideY }] }]}>
            {/* The glass is the sheet's surface, behind everything on it. It
                slides with the sheet; nothing above it ever fades (glass draws
                wrongly under any opacity), the dim being its own layer. */}
            <SheetGlass />
            <View {...panResponder.panHandlers}>
              <View style={SHEET_TOP_ROW}><View style={styles.handle} /></View>
            </View>
            {/* As tall as its content until the sheet reaches the top, then
                it shrinks and scrolls. Content that fits doesn't bounce. Taps
                land while a keyboard is up (the message box). */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={footer ? undefined : { paddingBottom: bottomGap }}
              alwaysBounceVertical={false}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={scrollEnabled}
            >
              {typeof children === "function" ? children(dismiss) : children}
            </ScrollView>
            {typeof footer === "function" ? footer(dismiss) : footer}
            <SheetCloseButton onPress={dismiss} />
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
      {over}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:    { backgroundColor: SHEET_DIM },
  sheet:       { borderTopLeftRadius: 28, borderTopRightRadius: 28, flexShrink: 1 },
  body:        { flexGrow: 0 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
});
