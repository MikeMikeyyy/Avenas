import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Animated,
  PanResponder,
  Easing,
  TouchableWithoutFeedback,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import FadeScreen from "../components/FadeScreen";
import TrashIcon from "../components/TrashIcon";
import ActivityCalendar from "../components/ActivityCalendar";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY,
  type SavedProgram, type CompletedWorkout,
} from "../constants/programs";
import { useTheme } from "../contexts/ThemeContext";
import { useUnit } from "../contexts/UnitContext";

const JOURNAL_KEY = "@avenas_journal_entries";

type JournalEntry = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBR    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_FULL    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w ago`;
  return formatEntryDate(iso);
}

function formatWorkoutDate(completedIso: string, durationSeconds: number): string {
  const d = new Date(completedIso);
  const dateStr = `${DAY_FULL[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
  const endTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  if (durationSeconds > 0) {
    const startTime = new Date(d.getTime() - durationSeconds * 1000)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    return `${dateStr}  ·  ${startTime} – ${endTime}  ·  ${fmtDuration(durationSeconds)}`;
  }
  return `${dateStr}  ·  ${endTime}`;
}

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (secs < 3600) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function ordinal(n: number): string {
  if (n === 11 || n === 12 || n === 13) return `${n}th`;
  const mod = n % 10;
  if (mod === 1) return `${n}st`;
  if (mod === 2) return `${n}nd`;
  if (mod === 3) return `${n}rd`;
  return `${n}th`;
}

// Static values for StyleSheet
const TP  = APP_LIGHT.tp;
const TS  = APP_LIGHT.ts;
const DIV = APP_LIGHT.div;

// Custom dumbbell icon (3-path SVG from _layout.tsx)
const WorkoutIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={color} strokeWidth="1.5" />
    <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={color} strokeWidth="1.5" />
    <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={color} strokeWidth="1.5" />
  </Svg>
);

// ─── Session progress track ───────────────────────────────────────────────────

function SessionTrack({ current, total, accent, track }: {
  current: number; total: number; accent: string; track: string;
}) {
  if (total <= 12) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {Array.from({ length: total }).map((_, i) => {
          const isCurrent = i === current - 1;
          const isFuture  = i > current - 1;
          const isDone    = i < current - 1;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <View style={{
                  flex: 1, height: 2,
                  backgroundColor: isFuture ? track : accent,
                  shadowColor: isFuture ? "transparent" : accent,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: isFuture ? 0 : 0.7,
                  shadowRadius: 2,
                }} />
              )}
              <View style={{
                width:  isCurrent ? 9 : 7,
                height: isCurrent ? 9 : 7,
                borderRadius: 999,
                backgroundColor: isFuture ? "transparent" : accent,
                borderWidth: isFuture ? 1.5 : 0,
                borderColor: track,
                shadowColor: isFuture ? "transparent" : accent,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: isCurrent ? 0.95 : isDone ? 0.55 : 0,
                shadowRadius: isCurrent ? 3 : 2,
              }} />
            </Fragment>
          );
        })}
      </View>
    );
  }
  const pct = Math.min(1, current / total);
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: track, overflow: "hidden" }}>
      <View style={{
        width: `${Math.round(pct * 100)}%`, height: "100%", backgroundColor: accent, borderRadius: 2,
        shadowColor: accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6,
      }} />
    </View>
  );
}

// ─── Delete sheet ─────────────────────────────────────────────────────────────

function DeleteSheet({ visible, isDark, entryTitle, onConfirm, onClose, title = "Delete Entry?" }: {
  visible: boolean; isDark: boolean; entryTitle: string;
  onConfirm: () => void; onClose: () => void; title?: string;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 400, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(400); backdropOpacity.setValue(0); onClose(); });
  }, [onClose]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 200)); } },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.8) {
        Animated.parallel([
          Animated.timing(slideY, { toValue: 400, duration: 220, useNativeDriver: true }),
          Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => { slideY.setValue(400); backdropOpacity.setValue(0); onClose(); });
      } else {
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
      <TouchableWithoutFeedback onPress={dismiss}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
      </TouchableWithoutFeedback>
      <Animated.View style={[styles.deleteSheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 12, transform: [{ translateY: slideY }] }]}>
        <View {...panResponder.panHandlers}>
          <View style={styles.handleArea}><View style={styles.handle} /></View>
        </View>
        <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 8 }}>
          <Text style={[styles.deleteTitle, { color: t.tp }]}>{title}</Text>
          <Text style={[styles.deleteSubtitle, { color: t.ts }]} numberOfLines={2}>
            "{entryTitle}" will be permanently removed.
          </Text>
        </View>
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <BounceButton onPress={() => { onConfirm(); dismiss(); }}>
            <View style={styles.deleteBtn}><Text style={styles.deleteBtnText}>Delete</Text></View>
          </BounceButton>
          <BounceButton onPress={dismiss}>
            <View style={[styles.cancelBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
              <Text style={[styles.cancelBtnText, { color: t.tp }]}>Cancel</Text>
            </View>
          </BounceButton>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [workoutHistory, setWorkoutHistory] = useState<CompletedWorkout[]>([]);
  const [workoutDates, setWorkoutDates] = useState<string[]>([]);
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [activeProgram, setActiveProgram] = useState<SavedProgram | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(JOURNAL_KEY)
        .then(raw => { if (raw) setEntries(JSON.parse(raw)); })
        .catch(() => {});
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY)
        .then(raw => { if (raw) setWorkoutHistory(JSON.parse(raw)); })
        .catch(() => {});
      AsyncStorage.getItem(WORKOUT_DATES_KEY)
        .then(raw => { if (raw) setWorkoutDates(JSON.parse(raw)); })
        .catch(() => {});
      AsyncStorage.getItem(PROGRAMS_KEY)
        .then(raw => {
          if (!raw) return;
          const progs: SavedProgram[] = JSON.parse(raw);
          setPrograms(progs);
          setActiveProgram(progs.find(p => p.status === "active") ?? null);
        })
        .catch(() => {});
    }, [])
  );

  const saveEntries = async (updated: JournalEntry[]) => {
    setEntries(updated);
    await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(updated));
  };

  // workoutName → { programName, totalSessions }
  const programLookup = useMemo(() => {
    const map: Record<string, { programName: string; totalSessions: number }> = {};
    const sorted = [...programs].sort((a, b) =>
      a.status === "active" ? -1 : b.status === "active" ? 1 : 0
    );
    for (const prog of sorted) {
      for (const name of prog.cyclePattern) {
        if (!name || name.toLowerCase() === "rest" || map[name]) continue;
        const perCycle = prog.cyclePattern.filter(n => n === name).length;
        const totalCycles = Math.ceil(prog.totalWeeks * 7 / prog.cycleDays);
        map[name] = { programName: prog.name, totalSessions: perCycle * totalCycles };
      }
    }
    return map;
  }, [programs]);

  // workoutId → session number (1-based, ordered by completedAt)
  const sessionNumbers = useMemo(() => {
    const result: Record<string, number> = {};
    const byName: Record<string, CompletedWorkout[]> = {};
    for (const w of workoutHistory) {
      if (!byName[w.workoutName]) byName[w.workoutName] = [];
      byName[w.workoutName].push(w);
    }
    for (const group of Object.values(byName)) {
      group.sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
      group.forEach((w, i) => { result[w.id] = i + 1; });
    }
    return result;
  }, [workoutHistory]);

  // Merge journal entries and workout history newest-first
  const timeline = useMemo(() => {
    type JItem = { kind: "journal"; data: JournalEntry; ts: number };
    type WItem = { kind: "workout"; data: CompletedWorkout; ts: number };
    const items: (JItem | WItem)[] = [
      ...entries.map(e => ({ kind: "journal" as const, data: e, ts: new Date(e.createdAt).getTime() })),
      ...workoutHistory.map(w => ({ kind: "workout" as const, data: w, ts: new Date(w.completedAt).getTime() })),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [entries, workoutHistory]);

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Top gradient blur */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 14, left: 20, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      >
        {/* Page header */}
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>JOURNAL</Text>
          <View style={{ width: 66 }} />
        </View>

        {/* Activity calendar */}
        <ActivityCalendar isDark={isDark} workoutDates={workoutDates} activeProgram={activeProgram} />

        {/* Recent activity heading */}
        {timeline.length > 0 && (
          <Text style={[styles.sectionHeading, { color: t.tp }]}>Recent Activity</Text>
        )}

        {/* Empty state */}
        {timeline.length === 0 && (
          <NeuCard dark={isDark} style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIconWrap, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.12)" }]}>
                <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
                  <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke={ACCT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke={ACCT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <Path d="M9 7h6M9 11h4" stroke={ACCT} strokeWidth="1.5" strokeLinecap="round" />
                </Svg>
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>Nothing here yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>Completed workouts and journal entries will appear here.</Text>
            </View>
          </NeuCard>
        )}

        {/* Unified timeline */}
        {timeline.map(item => {
          if (item.kind === "workout") {
            const w = item.data;
            const progInfo   = programLookup[w.workoutName] ?? null;
            const sessionNum = sessionNumbers[w.id] ?? 1;
            return (
              <BounceButton key={w.id} style={{ marginBottom: 12 }} onPress={() => router.push({ pathname: "/workout-detail", params: { id: w.id } })}>
                <NeuCard dark={isDark} style={[styles.entryCard, { marginBottom: 0 }]}>
                  <View style={styles.workoutCardInner}>
                    <View style={styles.workoutTopRow}>
                        <View style={{ flex: 1 }}>
                        <Text style={[styles.workoutName, { color: t.tp }]}>{w.workoutName}</Text>
                        <Text style={[styles.workoutDate, { color: t.ts }]}>{formatWorkoutDate(w.completedAt, w.durationSeconds)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={t.ts} />
                    </View>
                    {progInfo && (
                      <View style={styles.workoutProgRow}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                          <Text style={[styles.workoutProgName, { color: t.tp }]}>{progInfo.programName.toUpperCase()}</Text>
                          <Text style={[styles.workoutProgSession, { color: t.tp }]}>{ordinal(sessionNum)} session</Text>
                        </View>
                        <SessionTrack
                          current={sessionNum}
                          total={progInfo.totalSessions}
                          accent={ACCT}
                          track={t.div}
                        />
                      </View>
                    )}
                  </View>
                </NeuCard>
              </BounceButton>
            );
          }

          const entry = item.data;
          return (
            <BounceButton key={entry.id} style={{ marginBottom: 12 }}>
              <NeuCard dark={isDark} style={[styles.entryCard, { marginBottom: 0 }]}>
                <View style={styles.entryInner}>
                  <View style={styles.entryMain}>
                    <View style={styles.entryTopRow}>
                      <Text style={[styles.entryTitle, { color: t.tp }]} numberOfLines={1}>{entry.title}</Text>
                      <TouchableOpacity
                        onPress={() => setDeleteTarget(entry)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                      >
                        <TrashIcon size={18} color={t.ts} />
                      </TouchableOpacity>
                    </View>
                    {entry.body.length > 0 && (
                      <Text style={[styles.entryPreview, { color: t.ts }]} numberOfLines={2}>{entry.body}</Text>
                    )}
                    <View style={[styles.entryMeta, { borderTopColor: t.div }]}>
                      <Ionicons name="time-outline" size={13} color={t.ts} />
                      <Text style={[styles.entryMetaText, { color: t.ts }]}>{formatTimeAgo(entry.createdAt)}</Text>
                      <Text style={[styles.entryDot, { color: t.div }]}>·</Text>
                      <Text style={[styles.entryMetaText, { color: t.ts }]}>{formatEntryDate(entry.createdAt)}</Text>
                    </View>
                  </View>
                </View>
              </NeuCard>
            </BounceButton>
          );
        })}
      </ScrollView>

      <DeleteSheet
        visible={deleteTarget !== null}
        isDark={isDark}
        entryTitle={deleteTarget?.title ?? ""}
        onConfirm={() => { if (deleteTarget) saveEntries(entries.filter(e => e.id !== deleteTarget.id)); }}
        onClose={() => setDeleteTarget(null)}
      />

    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scroll: { paddingHorizontal: 20 },

  header:      { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 24 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1, color: TP },

  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18, color: TP, marginTop: 24, marginBottom: 12 },

  emptyCard:    { borderRadius: 24, marginBottom: 20 },
  emptyInner:   { padding: 32, alignItems: "center", gap: 12 },
  emptyIconWrap:{ width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center" },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 14, color: TS, textAlign: "center", lineHeight: 20 },

  // Journal entry card
  entryCard:    { borderRadius: 20 },
  entryInner:   { padding: 18 },
  entryMain:    { gap: 8 },
  entryTopRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  entryTitle:   { fontFamily: FontFamily.semibold, fontSize: 16, color: TP, flex: 1 },
  entryPreview: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, lineHeight: 20 },
  entryMeta:    { flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 10, borderTopWidth: 1, borderTopColor: DIV },
  entryMetaText:{ fontFamily: FontFamily.regular, fontSize: 12, color: TS },
  entryDot:     { fontFamily: FontFamily.regular, fontSize: 12, color: DIV },

  // Workout summary card
  workoutCardInner: { padding: 18, gap: 10 },
  workoutTopRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
  workoutIconBg:    { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  workoutName:      { fontFamily: FontFamily.bold, fontSize: 16, color: TP },
  workoutDate:      { fontFamily: FontFamily.regular, fontSize: 12, color: TS, marginTop: 2 },
  workoutProgRow:    { paddingTop: 10 },
  workoutProgName:   { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.9 },
  workoutProgSession:{ fontFamily: FontFamily.semibold, fontSize: 12 },

  // Bottom sheet shared
  backdrop:    { backgroundColor: "rgba(0,0,0,0.45)" },
  handleArea:  { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },

  // Delete sheet
  deleteSheet:    { position: "absolute", bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  deleteTitle:    { fontFamily: FontFamily.bold, fontSize: 20, color: TP },
  deleteSubtitle: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, lineHeight: 20 },
  deleteBtn:      { borderRadius: 14, paddingVertical: 15, alignItems: "center", backgroundColor: "#FF3B30", shadowColor: "#FF3B30", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
  deleteBtnText:  { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff" },
  cancelBtn:      { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  cancelBtnText:  { fontFamily: FontFamily.bold, fontSize: 16, color: TP },

});
