// The rest / interval Timer + Stopwatch modal opened from the workout screen's
// top-right timer button. Extracted from app/(tabs)/workout.tsx so it can be
// rendered from both the active-workout view and the rest-day view (which is a
// separate early-return) without duplicating the JSX or its self-contained
// countdown/stopwatch state. All timer/stopwatch state lives here — the host
// screen only owns `visible`.

import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, Keyboard, AppState,
} from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, interpolateColor } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import BounceButton from "./BounceButton";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../constants/theme";

function fmtTime(secs: number): string {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

interface IntervalTimerModalProps {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  t: typeof APP_LIGHT | typeof APP_DARK;
}

export default function IntervalTimerModal({ visible, onClose, isDark, t }: IntervalTimerModalProps) {
  const [timerMode, setTimerMode] = useState<"timer" | "stopwatch">("timer");
  const tabOffset = useSharedValue(0); // 0 = timer, 1 = stopwatch
  const tabTrackWidth = useSharedValue(0);
  const pillAnimStyle = useAnimatedStyle(() => ({
    width: tabTrackWidth.value / 2,
    transform: [{ translateX: tabOffset.value * (tabTrackWidth.value / 2) }],
  }));
  const timerLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(tabOffset.value, [0, 1], ["#ffffff", isDark ? "#8896A7" : "#8896A7"]),
  }));
  const stopwatchLabelColor = useAnimatedStyle(() => ({
    color: interpolateColor(tabOffset.value, [0, 1], [isDark ? "#8896A7" : "#8896A7", "#ffffff"]),
  }));
  // Countdown
  const [countdownDuration, setCountdownDuration] = useState(60);
  const [countdownRemaining, setCountdownRemaining] = useState(60);
  const [countdownActive, setCountdownActive] = useState(false);
  const [editingDuration, setEditingDuration] = useState(false);
  const [editMins, setEditMins] = useState("01");
  const [editSecs, setEditSecs] = useState("00");
  const countdownEndRef = useRef<number | null>(null);
  // Stopwatch
  const [swElapsed, setSwElapsed] = useState(0);
  const [swRunning, setSwRunning] = useState(false);
  const swStartRef = useRef<number | null>(null);
  const swOffsetRef = useRef(0);

  // Countdown — wall-clock based to avoid drift
  useEffect(() => {
    if (!countdownActive) return;
    countdownEndRef.current = Date.now() + countdownRemaining * 1000;
    const tick = () => {
      if (!countdownEndRef.current) return;
      const remaining = Math.ceil((countdownEndRef.current - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdownActive(false);
        setCountdownRemaining(0);
      } else {
        setCountdownRemaining(remaining);
      }
    };
    const id = setInterval(tick, 500);
    const sub = AppState.addEventListener("change", s => { if (s === "active") tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [countdownActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stopwatch
  useEffect(() => {
    if (!swRunning) return;
    swStartRef.current = Date.now();
    const tick = () => {
      if (swStartRef.current)
        setSwElapsed(swOffsetRef.current + Math.floor((Date.now() - swStartRef.current) / 1000));
    };
    const id = setInterval(tick, 500);
    const sub = AppState.addEventListener("change", s => { if (s === "active") tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [swRunning]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.timerBackdrop} activeOpacity={1} onPress={() => { Keyboard.dismiss(); onClose(); }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: "100%" }}>
          <View style={[styles.timerCard, {
            backgroundColor: isDark ? "#1B1E2C" : "#e8ecf3",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: isDark ? 0.35 : 0.1,
            shadowRadius: 8,
            elevation: 4,
          }]}>

            {/* Header */}
            <View style={[styles.timerCardHeader, { justifyContent: "flex-end" }]}>
              <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onClose(); }}>
                <View style={{ padding: 10 }}>
                  <Ionicons name="close" size={22} color={t.ts} />
                </View>
              </BounceButton>
            </View>

            {/* Tabs */}
            <View
              style={[styles.timerTabs, { backgroundColor: t.div }]}
              onLayout={e => { const w = e.nativeEvent?.layout?.width; if (w != null) tabTrackWidth.value = w - 6; }}
            >
              {/* Sliding pill */}
              <Reanimated.View style={[styles.timerPill, pillAnimStyle]} />
              {/* Timer label */}
              <TouchableOpacity
                style={styles.timerTab}
                activeOpacity={0.8}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setTimerMode("timer");
                  tabOffset.value = withSpring(0, { damping: 22, stiffness: 300, mass: 0.9 });
                }}
              >
                <Reanimated.Text style={[styles.timerTabText, timerLabelColor]}>Timer</Reanimated.Text>
              </TouchableOpacity>
              {/* Stopwatch label */}
              <TouchableOpacity
                style={styles.timerTab}
                activeOpacity={0.8}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setTimerMode("stopwatch");
                  tabOffset.value = withSpring(1, { damping: 22, stiffness: 300, mass: 0.9 });
                }}
              >
                <Reanimated.Text style={[styles.timerTabText, stopwatchLabelColor]}>Stopwatch</Reanimated.Text>
              </TouchableOpacity>
            </View>

            {/* Display */}
            <View style={styles.timerDisplay}>
              {/* Single persistent wrapper — prevents layout shift when toggling edit mode */}
              <View style={{ alignItems: "center", alignSelf: "stretch" }}>
              {timerMode === "timer" && editingDuration && !countdownActive ? (
                <>
                  <View style={styles.timerEditRow}>
                    <View style={{ width: 36 }} />
                    <TextInput
                      style={[styles.timerEditInput, { color: t.tp, backgroundColor: t.div }]}
                      value={editMins}
                      onChangeText={v => setEditMins(v.replace(/[^0-9]/g, "").slice(0, 2))}
                      keyboardType="number-pad" maxLength={2} selectTextOnFocus
                    />
                    <Text style={[styles.timerTime, { color: t.tp, fontSize: 36 }]}>:</Text>
                    <TextInput
                      style={[styles.timerEditInput, { color: t.tp, backgroundColor: t.div }]}
                      value={editSecs}
                      onChangeText={v => setEditSecs(v.replace(/[^0-9]/g, "").slice(0, 2))}
                      keyboardType="number-pad" maxLength={2} selectTextOnFocus
                    />
                    <TouchableOpacity
                      style={styles.timerEditConfirm}
                      activeOpacity={0.8}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        const m = Math.min(99, Math.max(0, parseInt(editMins) || 0));
                        const s = Math.min(59, Math.max(0, parseInt(editSecs) || 0));
                        const total = Math.max(5, m * 60 + s);
                        setCountdownDuration(total); setCountdownRemaining(total);
                        setEditMins(String(Math.floor(total / 60)).padStart(2, "0"));
                        setEditSecs(String(total % 60).padStart(2, "0"));
                        setEditingDuration(false); Keyboard.dismiss();
                      }}
                    >
                      <Ionicons name="checkmark" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  <View style={{ height: 24 }} />
                </>
              ) : (
                <>
                  {/* Time row — buttons always rendered (opacity 0 when hidden) so time never shifts */}
                  {(() => {
                    const showAdj = timerMode === "timer" && !countdownActive && countdownRemaining === countdownDuration;
                    return (
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 }}>
                        <BounceButton
                          style={[styles.timerAdjust, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div, opacity: showAdj ? 1 : 0 }]}
                          onPress={showAdj ? () => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            const v = Math.max(5, countdownDuration - 15);
                            setCountdownDuration(v); setCountdownRemaining(v);
                            setEditMins(String(Math.floor(v / 60)).padStart(2, "0"));
                            setEditSecs(String(v % 60).padStart(2, "0"));
                          } : () => {}}
                        >
                          <Text style={[styles.timerAdjustText, { color: t.ts }]}>-15s</Text>
                        </BounceButton>

                        <BounceButton
                          onPress={() => {
                            if (showAdj) {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setEditMins(String(Math.floor(countdownRemaining / 60)).padStart(2, "0"));
                              setEditSecs(String(countdownRemaining % 60).padStart(2, "0"));
                              setEditingDuration(true);
                            }
                          }}
                        >
                          <Text style={[styles.timerTime, { color: isDark ? "#FFFFFF" : "#1C2030" }]}>
                            {timerMode === "timer" ? fmtTime(countdownRemaining) : fmtTime(swElapsed)}
                          </Text>
                        </BounceButton>

                        <BounceButton
                          style={[styles.timerAdjust, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div, opacity: showAdj ? 1 : 0 }]}
                          onPress={showAdj ? () => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            const v = countdownDuration + 15;
                            setCountdownDuration(v); setCountdownRemaining(v);
                            setEditMins(String(Math.floor(v / 60)).padStart(2, "0"));
                            setEditSecs(String(v % 60).padStart(2, "0"));
                          } : () => {}}
                        >
                          <Text style={[styles.timerAdjustText, { color: t.ts }]}>+15s</Text>
                        </BounceButton>
                      </View>
                    );
                  })()}

                  {/* Hint row — always rendered, fades with same condition as ±15s buttons */}
                  <View style={{ height: 20, justifyContent: "center", alignItems: "center", marginTop: 4 }}>
                    <View style={[styles.timerEditHint, { opacity: timerMode === "timer" && !countdownActive && countdownRemaining === countdownDuration ? 1 : 0 }]}>
                      <Ionicons name="create-outline" size={11} color={t.ts} />
                      <Text style={[styles.timerEditHintText, { color: t.ts }]}>tap to edit</Text>
                    </View>
                  </View>
                </>
              )}
              </View>
            </View>

            {/* Action buttons */}
            {timerMode === "timer" ? (
              countdownRemaining === 0 ? (
                <View style={[styles.timerActionGlow, { marginHorizontal: 20, marginBottom: 20 }]}>
                  <BounceButton style={[styles.timerAction, { backgroundColor: ACCT }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setCountdownRemaining(countdownDuration); }}>
                    <View style={styles.timerActionInner}>
                      <Ionicons name="refresh" size={20} color="#fff" />
                      <Text style={[styles.timerActionText, { color: "#fff" }]}>Reset</Text>
                    </View>
                  </BounceButton>
                </View>
              ) : countdownActive ? (
                <BounceButton style={[styles.timerAction, { backgroundColor: t.div, marginHorizontal: 20, marginBottom: 20 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCountdownActive(false); }}>
                  <View style={styles.timerActionInner}>
                    <Ionicons name="pause" size={20} color={t.tp} />
                    <Text style={[styles.timerActionText, { color: t.tp }]}>Pause</Text>
                  </View>
                </BounceButton>
              ) : countdownRemaining < countdownDuration ? (
                <View style={styles.timerButtonRow}>
                  <BounceButton style={[styles.timerAction, { backgroundColor: t.div, flex: 1 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCountdownRemaining(countdownDuration); }}>
                    <View style={styles.timerActionInner}>
                      <Ionicons name="refresh" size={20} color={t.tp} />
                      <Text style={[styles.timerActionText, { color: t.tp }]}>Reset</Text>
                    </View>
                  </BounceButton>
                  <View style={[styles.timerActionGlow, { flex: 1, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
                    <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setCountdownActive(true); setEditingDuration(false); Keyboard.dismiss(); }}>
                      <View style={styles.timerActionInner}>
                        <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                        <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Continue</Text>
                      </View>
                    </BounceButton>
                  </View>
                </View>
              ) : (
                <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE, marginHorizontal: 20, marginBottom: 20, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 8 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setCountdownActive(true); setEditingDuration(false); Keyboard.dismiss(); }}>
                  <View style={styles.timerActionInner}>
                    <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                    <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Start</Text>
                  </View>
                </BounceButton>
              )
            ) : (
              swRunning ? (
                <BounceButton style={[styles.timerAction, { backgroundColor: t.div, marginHorizontal: 20, marginBottom: 20 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); swOffsetRef.current = swElapsed; setSwRunning(false); }}>
                  <View style={styles.timerActionInner}>
                    <Ionicons name="stop" size={20} color={t.tp} />
                    <Text style={[styles.timerActionText, { color: t.tp }]}>Stop</Text>
                  </View>
                </BounceButton>
              ) : swElapsed === 0 ? (
                <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE, marginHorizontal: 20, marginBottom: 20, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 8 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSwRunning(true); }}>
                  <View style={styles.timerActionInner}>
                    <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                    <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Start</Text>
                  </View>
                </BounceButton>
              ) : (
                <View style={styles.timerButtonRow}>
                  <BounceButton style={[styles.timerAction, { backgroundColor: t.div, flex: 1 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSwElapsed(0); swOffsetRef.current = 0; swStartRef.current = null; }}>
                    <View style={styles.timerActionInner}>
                      <Ionicons name="refresh" size={20} color={t.tp} />
                      <Text style={[styles.timerActionText, { color: t.tp }]}>Reset</Text>
                    </View>
                  </BounceButton>
                  <View style={[styles.timerActionGlow, { flex: 1, shadowColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)" }]}>
                    <BounceButton style={[styles.timerAction, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSwRunning(true); }}>
                      <View style={styles.timerActionInner}>
                        <Ionicons name="play" size={20} color={isDark ? APP_DARK.bg : "#fff"} />
                        <Text style={[styles.timerActionText, { color: isDark ? APP_DARK.bg : "#fff" }]}>Continue</Text>
                      </View>
                    </BounceButton>
                  </View>
                </View>
              )
            )}

          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  timerBackdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 24 },
  timerCard:        { borderRadius: 24, width: "100%" },
  timerCardHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 },
  timerTabs:        { flexDirection: "row", borderRadius: 12, marginHorizontal: 20, marginBottom: 20, padding: 3, alignSelf: "stretch" },
  timerPill:        { position: "absolute", top: 3, left: 3, bottom: 3, borderRadius: 10, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6 },
  timerTab:         { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  timerTabText:     { fontFamily: FontFamily.semibold, fontSize: 14 },
  timerDisplay:     { alignItems: "center", justifyContent: "center", minHeight: 120 },
  timerAdjust:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  timerAdjustText:  { fontFamily: FontFamily.semibold, fontSize: 14 },
  timerTime:        { fontFamily: FontFamily.bold, fontSize: 56, letterSpacing: 2 },
  timerEditRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  timerEditInput:   { fontFamily: FontFamily.bold, fontSize: 40, width: 72, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8, textAlign: "center" },
  timerEditConfirm: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 8 },
  timerEditHint:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  timerEditHintText:{ fontFamily: FontFamily.regular, fontSize: 11 },
  timerAction:      { borderRadius: 14, paddingVertical: 14 },
  timerActionInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  timerActionGlow:  { borderRadius: 14, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 8 },
  timerActionText:  { fontFamily: FontFamily.semibold, fontSize: 16 },
  timerButtonRow:   { flexDirection: "row", gap: 10, marginHorizontal: 20, marginBottom: 20 },
});
