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

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, ScrollView, StyleSheet, TouchableOpacity, View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_DARK, APP_LIGHT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

/** The least of the page left showing above a sheet, under the status bar. */
const SHEET_TOP_GAP = 12;

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the content, which scrolls above it once the sheet is as
   *  tall as the screen allows. */
  footer?: ReactNode;
}

export default function SimpleSheet({ visible, onClose, children, footer }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // Hidden a whole screen down: a sheet can now be nearly that tall, and 600
  // left the top of a tall one showing before it slid up.
  const { height: screenH } = useWindowDimensions();
  const slideY = useRef(new Animated.Value(screenH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

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
  }, [onClose, screenH]);

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
  }, [visible, screenH]);

  // Under the last thing in the sheet. Without a footer it's inside the
  // scrolling part, so the last button's shadow has room before the edge
  // that clips it; with one, it's under the footer.
  const bottomGap = kbVisible ? 12 : insets.bottom + 12;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
          {/* The page behind, a tap away from closing the sheet. Never shorter
              than the status bar and SHEET_TOP_GAP: a taller sheet gives way
              instead (it shrinks, `flexShrink`, and its content scrolls). */}
          <TouchableOpacity style={{ flex: 1, minHeight: insets.top + SHEET_TOP_GAP }} activeOpacity={1} onPress={dismiss} />
          <Animated.View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: footer ? bottomGap : 0, transform: [{ translateY: slideY }] }]}>
            <View {...panResponder.panHandlers}>
              <View style={styles.handleArea}><View style={styles.handle} /></View>
            </View>
            {/* As tall as its content until the sheet reaches the top, then
                it shrinks and scrolls. Content that fits doesn't bounce. Taps
                land while a keyboard is up (the message box). */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={footer ? undefined : { paddingBottom: bottomGap }}
              alwaysBounceVertical={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {footer}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:    { backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:       { borderTopLeftRadius: 28, borderTopRightRadius: 28, flexShrink: 1 },
  body:        { flexGrow: 0 },
  handleArea:  { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
});
