import { useState, useRef, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Modal, Animated, PanResponder, Easing, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import BounceButton from "./BounceButton";
import { TimeRow, computeDurationMins, fmtDurationMins, timeValFromDate, type TimeVal } from "./TimeWheelPicker";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";

// ─── TimeEditSheet ───────────────────────────────────────────────────────────────
// Shared bottom sheet for editing a workout's start/end time. Uses the same wheel
// picker as the journal "Workout Time" sheet (per-minute precision). Returns the
// chosen start/end as TimeVal; the caller maps those back to its own data model.
// Used by the workout-complete popup and the journal workout-detail editor.

export default function TimeEditSheet({
  visible, isDark, title, subtitle, confirmLabel = "Save", withCheck = false,
  startDate, endDate, onConfirm, onClose,
}: {
  visible: boolean;
  isDark: boolean;
  title: string;
  subtitle?: string;
  confirmLabel?: string;
  withCheck?: boolean;
  startDate: Date;
  endDate: Date;
  onConfirm: (start: TimeVal, end: TimeVal) => void;
  onClose: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [start, setStart] = useState<TimeVal>(() => timeValFromDate(startDate));
  const [end, setEnd] = useState<TimeVal>(() => timeValFromDate(endDate));

  useEffect(() => {
    if (visible) {
      setStart(timeValFromDate(startDate));
      setEnd(timeValFromDate(endDate));
      slideY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]); // startDate/endDate are stable for a given open

  const animateClose = useCallback((cb: () => void) => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); cb(); });
  }, [slideY, backdropOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 300)); }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.parallel([
            Animated.timing(slideY, { toValue: 600, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => { slideY.setValue(600); backdropOpacity.setValue(0); onClose(); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  const durationMins = computeDurationMins(start, end);
  const divider = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)";

  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent animationType="none" onRequestClose={() => animateClose(onClose)}>
      <View style={styles.backdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => animateClose(onClose)} />
        <Animated.View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 16, transform: [{ translateY: slideY }] }]}>
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
          </View>

          <View style={[styles.header, { borderBottomColor: divider }]}>
            {withCheck && (
              <View style={styles.checkCircle}>
                <Ionicons name="checkmark" size={20} color="#fff" />
              </View>
            )}
            <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>

          <View style={[styles.body, { borderBottomColor: divider }]}>
            <TimeRow label="Start" val={start} isDark={isDark} bgColor={t.bg} minuteStep={1} onChange={setStart} />
            <View style={[styles.rowDivider, { backgroundColor: divider }]} />
            <TimeRow label="End" val={end} isDark={isDark} bgColor={t.bg} minuteStep={1} onChange={setEnd} />
          </View>

          <Text style={[styles.duration, { color: t.ts }]}>Duration: {fmtDurationMins(durationMins)}</Text>

          <View style={styles.doneRow}>
            <BounceButton
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); animateClose(() => onConfirm(start, end)); }}
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
            >
              <View style={styles.doneWrap}>
                <View style={styles.doneBtn}>
                  <Text style={styles.doneText}>{confirmLabel}</Text>
                </View>
              </View>
            </BounceButton>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:    { flex: 1, justifyContent: "flex-end" },
  overlay:     { backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:       { borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handleArea:  { paddingVertical: 12, alignItems: "center" },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  header:      { alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, paddingTop: 2, borderBottomWidth: 1, gap: 4 },
  checkCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: ACCT, alignItems: "center", justifyContent: "center", marginBottom: 6, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 8 },
  title:       { fontFamily: FontFamily.bold, fontSize: 20, maxWidth: "85%", textAlign: "center" },
  subtitle:    { fontFamily: FontFamily.semibold, fontSize: 14, color: ACCT, letterSpacing: 0.5 },
  body:        { paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1 },
  rowDivider:  { height: 1, marginVertical: 4 },
  duration:    { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 14 },
  doneRow:     { alignItems: "center", paddingTop: 16, paddingBottom: 4 },
  doneWrap:    { alignSelf: "center", borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10 },
  doneBtn:     { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 13, paddingHorizontal: 40 },
  doneText:    { fontFamily: FontFamily.semibold, fontSize: 16, color: "#FFFFFF" },
});
