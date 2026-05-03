import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import FadeScreen from "../components/FadeScreen";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import {
  PROGRAMS_KEY,
  getCurrentWeek,
  type SavedProgram,
} from "../constants/programs";
import { useTheme } from "../contexts/ThemeContext";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseStoredDate(dateStr: string): Date {
  const parts = dateStr.split(" ");
  const day = parseInt(parts[0], 10);
  const month = MONTH_NAMES.indexOf(parts[1]);
  const year = parseInt(parts[2], 10);
  return new Date(year, month < 0 ? 0 : month, day);
}


function statusLabel(status: SavedProgram["status"]): string {
  if (status === "active") return "Active";
  if (status === "completed") return "Completed";
  if (status === "paused") return "Paused";
  return "Not Started";
}

function statusColor(status: SavedProgram["status"]): string {
  if (status === "active" || status === "completed") return ACCT;
  if (status === "paused") return "#FF9500";
  return "#8896A7";
}

const TP  = APP_LIGHT.tp;
const TS  = APP_LIGHT.ts;

export default function ProgramHistoryScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const [programs, setPrograms] = useState<SavedProgram[]>([]);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(PROGRAMS_KEY)
        .then(raw => { if (raw) setPrograms(JSON.parse(raw)); })
        .catch(() => {});
    }, [])
  );

  const sorted = [...programs].sort((a, b) => {
    if (a.status === "active") return -1;
    if (b.status === "active") return 1;
    try {
      return parseStoredDate(b.startDate).getTime() - parseStoredDate(a.startDate).getTime();
    } catch {
      return 0;
    }
  });

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
          <Text style={[styles.screenTitle, { color: t.tp }]}>PROGRAMS</Text>
          <View style={{ width: 66 }} />
        </View>

        {/* Empty state */}
        {sorted.length === 0 && (
          <NeuCard dark={isDark} style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No programs yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                Create a program to start tracking workouts here.
              </Text>
            </View>
          </NeuCard>
        )}

        {/* Program cards */}
        {sorted.map(prog => {
          const week = getCurrentWeek(prog);
          const sColor = statusColor(prog.status);

          return (
            <BounceButton
              key={prog.id}
              style={styles.cardWrap}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/program-history-detail", params: { programId: prog.id } });
              }}
            >
              <NeuCard dark={isDark} style={styles.card}>
                <View style={styles.cardInner}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.cardNameRow}>
                        <Text style={[styles.progName, { color: t.tp, flex: 1 }]} numberOfLines={1}>{prog.name}</Text>
                        <View style={[styles.badge, { backgroundColor: isDark ? `${sColor}22` : `${sColor}18` }]}>
                          <Text style={[styles.badgeText, { color: sColor }]}>{statusLabel(prog.status)}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={t.ts} style={{ marginLeft: 6 }} />
                      </View>
                      <Text style={[styles.progSub, { color: t.ts }]}>
                        Week {week} of {prog.totalWeeks}
                      </Text>
                      <View style={{ gap: 4, marginTop: 4 }}>
                        <View style={styles.progDatesRow}>
                          <Ionicons name="calendar-outline" size={13} color={t.ts} />
                          <Text style={[styles.progDates, { color: t.ts }]}>Started {prog.startDate}</Text>
                        </View>
                        {prog.status === "completed" && prog.completedDate && (
                          <View style={styles.progDatesRow}>
                            <Ionicons name="flag-outline" size={13} color={ACCT} />
                            <Text style={[styles.progDates, { color: ACCT }]}>Completed {prog.completedDate}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                  <View style={styles.progressRow}>
                    {Array.from({ length: prog.totalWeeks }).map((_, i) => (
                      <View
                        key={i}
                        style={[
                          styles.progressSeg,
                          { backgroundColor: i < week ? ACCT : isDark ? "rgba(255,255,255,0.1)" : t.div },
                          i < week && { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 },
                        ]}
                      />
                    ))}
                  </View>
                </View>
              </NeuCard>
            </BounceButton>
          );
        })}
      </ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scroll: { paddingHorizontal: 20 },

  header: { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 24 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textAlign: "center", flex: 1, color: TP },

  emptyCard: { borderRadius: 24, marginBottom: 20 },
  emptyInner: { padding: 32, alignItems: "center", gap: 12 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center" },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, textAlign: "center", lineHeight: 20 },

  cardWrap: { marginBottom: 12 },
  card: { borderRadius: 20 },
  cardInner: { padding: 18, gap: 12 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  progName: { fontFamily: FontFamily.bold, fontSize: 16, color: TP },
  progSub: { fontFamily: FontFamily.regular, fontSize: 13, color: TS, marginTop: 2 },
  progDatesRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  progDates: { fontFamily: FontFamily.regular, fontSize: 13, color: TS },

  badge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontFamily: FontFamily.semibold, fontSize: 12 },

  progressRow: { flexDirection: "row", gap: 4 },
  progressSeg: { flex: 1, height: 6, borderRadius: 3 },
});
