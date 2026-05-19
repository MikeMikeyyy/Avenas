// Shared bottom-sheet shell used by trainer flows. Swipe-to-dismiss,
// fade backdrop, standard drag handle (36×4, rgba 0.4) per the app standard.
//
// Uses KeyboardAvoidingView + flex-end layout (matching the journal
// WorkoutPickerSheet pattern) so the sheet lifts above the keyboard when
// a child TextInput grabs focus.

import { ReactNode, useCallback, useEffect, useRef } from "react";
import { Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, StyleSheet, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_DARK, APP_LIGHT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function SimpleSheet({ visible, onClose, children }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(); });
  }, [onClose]);

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
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismiss} />
          <Animated.View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 12, transform: [{ translateY: slideY }] }]}>
            <View {...panResponder.panHandlers}>
              <View style={styles.handleArea}><View style={styles.handle} /></View>
            </View>
            {children}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:    { backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:       { borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handleArea:  { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
});
