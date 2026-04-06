import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { APP_LIGHT, APP_DARK, FontFamily, Colors } from "../constants/theme";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import { useTheme } from "../contexts/ThemeContext";

const ACCT = "#1deca0";

interface Program {
  id: string;
  name: string;
  category: "Hypertrophy" | "Strength" | "Cutting" | "General";
  totalWeeks: number;
  currentWeek: number;
  status: "active" | "completed" | "paused";
  startDate: string;
  sessionsPerWeek: number;
}

const PROGRAMS: Program[] = [
  { id: "1", name: "2026 Mesocycle A",    category: "Hypertrophy", totalWeeks: 8,  currentWeek: 3, status: "active",    startDate: "03 Mar 2026", sessionsPerWeek: 4 },
  { id: "2", name: "Upper/Lower Split",   category: "Hypertrophy", totalWeeks: 6,  currentWeek: 2, status: "paused",    startDate: "17 Feb 2026", sessionsPerWeek: 4 },
  { id: "3", name: "Strength Block 5/3/1",category: "Strength",    totalWeeks: 16, currentWeek: 0, status: "completed", startDate: "01 Sep 2025", sessionsPerWeek: 3 },
  { id: "4", name: "2025 Mesocycle B",    category: "Hypertrophy", totalWeeks: 8,  currentWeek: 0, status: "completed", startDate: "07 Jul 2025", sessionsPerWeek: 4 },
];

// ─── Active Program Card ───────────────────────────────────────────────────────

interface ActiveProgramCardProps {
  program: Program;
  isDark: boolean;
}

const ActiveProgramCard = React.memo(function ActiveProgramCard({ program, isDark }: ActiveProgramCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <NeuCard dark={isDark} style={styles.activeProgramCard}>
      <View style={styles.activeProgramInner}>
        <View style={styles.rowBetween}>
          <Text style={[styles.activeProgramName, { color: t.tp }]} numberOfLines={1}>
            {program.name}
          </Text>
          <View style={[styles.categoryBadge, { backgroundColor: t.div }]}>
            <Text style={[styles.categoryBadgeText, { color: t.ts }]}>{program.category}</Text>
          </View>
        </View>

        <View style={styles.progressRow}>
          {Array.from({ length: program.totalWeeks }).map((_, i) => (
            <View key={i} style={[styles.progressSeg, { backgroundColor: i < program.currentWeek ? ACCT : t.div }]} />
          ))}
        </View>
        <Text style={[styles.weekLabel, { color: t.ts }]}>Week {program.currentWeek} of {program.totalWeeks}</Text>

        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={t.ts} />
          <Text style={[styles.metaText, { color: t.ts }]}>Started {program.startDate}</Text>
          <View style={styles.metaDot} />
          <Ionicons name="flash-outline" size={14} color={t.ts} />
          <Text style={[styles.metaText, { color: t.ts }]}>{program.sessionsPerWeek}x / week</Text>
        </View>

        <BounceButton accessibilityLabel={`Continue ${program.name}`} accessibilityRole="button">
          <View style={styles.continueBtnWrap}>
            <View style={styles.continueBtn}>
              <Text style={styles.continueBtnText}>Continue</Text>
            </View>
          </View>
        </BounceButton>
      </View>
    </NeuCard>
  );
});

// ─── Program Card ──────────────────────────────────────────────────────────────

interface ProgramCardProps {
  program: Program;
  isDark: boolean;
}

const ProgramCard = React.memo(function ProgramCard({ program, isDark }: ProgramCardProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;

  const filledWeeks = program.status === "completed" ? program.totalWeeks : program.currentWeek;
  const statusColor = program.status === "active" ? ACCT : program.status === "paused" ? Colors.warning : t.ts;
  const statusLabel = program.status === "active" ? "Active" : program.status === "paused" ? "Paused" : "Completed";
  const weekText = program.status === "completed"
    ? `Completed ${program.totalWeeks} of ${program.totalWeeks} weeks`
    : `Week ${program.currentWeek} of ${program.totalWeeks}`;

  return (
    <NeuCard dark={isDark} style={styles.programCard}>
      <View style={styles.programCardInner}>
        <View style={styles.rowBetween}>
          <Text style={[styles.programName, { color: t.tp }]} numberOfLines={1}>{program.name}</Text>
          <View style={[styles.statusBadge, { borderColor: statusColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={[styles.categoryBadge, { backgroundColor: t.div, alignSelf: "flex-start" }]}>
          <Text style={[styles.categoryBadgeText, { color: t.ts }]}>{program.category}</Text>
        </View>

        <View style={styles.progressRow}>
          {Array.from({ length: program.totalWeeks }).map((_, i) => (
            <View key={i} style={[styles.progressSeg, { backgroundColor: i < filledWeeks ? statusColor : t.div }]} />
          ))}
        </View>
        <Text style={[styles.weekLabel, { color: t.ts }]}>{weekText}</Text>
        <Text style={[styles.metaText, { color: t.ts }]}>Started {program.startDate}</Text>
      </View>
    </NeuCard>
  );
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProgramsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const activeProgram = PROGRAMS.find((p) => p.status === "active") ?? null;
  const totalCount = PROGRAMS.length;
  const weeksTrained = PROGRAMS.reduce((sum, p) =>
    sum + (p.status === "completed" ? p.totalWeeks : p.currentWeek), 0);
  const completedCount = PROGRAMS.filter((p) => p.status === "completed").length;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.icon} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: isDark ? "#2a2f3e" : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.icon} />
          </View>
        )}
      </TouchableOpacity>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
      >
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>MY PROGRAMS</Text>
          <View style={{ width: 66 }} />
        </View>

        {/* Stats */}
        <NeuCard dark={isDark} style={styles.statsCard}>
          <View style={styles.statsRow}>
            {([
              { value: String(totalCount),    label: "Total"     },
              { value: String(weeksTrained),  label: "Weeks"     },
              { value: String(completedCount), label: "Completed" },
            ] as const).map((s, i) => (
              <View key={s.label} style={styles.statCell}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
                <View style={styles.statContent}>
                  <Text style={[styles.statValue, { color: t.tp }]}>{s.value}</Text>
                  <Text style={[styles.statLabel, { color: t.ts }]}>{s.label}</Text>
                </View>
              </View>
            ))}
          </View>
        </NeuCard>

        {/* Active program */}
        {activeProgram !== null && (
          <>
            <Text style={[styles.sectionLabel, { color: t.tp }]}>ACTIVE</Text>
            <ActiveProgramCard program={activeProgram} isDark={isDark} />
          </>
        )}

        {/* All programs */}
        <Text style={[styles.sectionLabel, { color: t.tp }]}>ALL PROGRAMS</Text>
        {PROGRAMS.map((p) => (
          <ProgramCard key={p.id} program={p} isDark={isDark} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:               { flex: 1 },
  backBtn:            { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  header:             { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 24 },
  screenTitle:        { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1 },

  statsCard:          { marginBottom: 24, borderRadius: 20 },
  statsRow:           { flexDirection: "row" },
  statCell:           { flex: 1, flexDirection: "row" },
  divider:            { width: 1, height: 40, alignSelf: "center" },
  statContent:        { flex: 1, alignItems: "center", paddingVertical: 20, gap: 4 },
  statValue:          { fontFamily: FontFamily.bold, fontSize: 22 },
  statLabel:          { fontFamily: FontFamily.regular, fontSize: 14 },

  sectionLabel:       { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 },

  activeProgramCard:  { marginBottom: 20, borderRadius: 20 },
  activeProgramInner: { padding: 20, gap: 14 },
  activeProgramName:  { fontFamily: FontFamily.bold, fontSize: 18, flex: 1, marginRight: 8 },
  continueBtnWrap:    { borderRadius: 16, backgroundColor: ACCT, shadowColor: "#1a9e68", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  continueBtn:        { borderRadius: 16, backgroundColor: ACCT, paddingVertical: 14, alignItems: "center" },
  continueBtnText:    { fontFamily: FontFamily.bold, fontSize: 16, color: "#FFFFFF", letterSpacing: 0.3 },

  programCard:        { marginBottom: 12, borderRadius: 20 },
  programCardInner:   { padding: 16, gap: 10 },
  programName:        { fontFamily: FontFamily.semibold, fontSize: 15, flex: 1, marginRight: 8 },
  statusBadge:        { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText:    { fontFamily: FontFamily.semibold, fontSize: 12 },

  rowBetween:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  categoryBadge:      { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  categoryBadgeText:  { fontFamily: FontFamily.semibold, fontSize: 12 },
  progressRow:        { flexDirection: "row", gap: 4 },
  progressSeg:        { flex: 1, height: 6, borderRadius: 3 },
  weekLabel:          { fontFamily: FontFamily.regular, fontSize: 13 },
  metaRow:            { flexDirection: "row", alignItems: "center", gap: 6 },
  metaDot:            { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#8896A7" },
  metaText:           { fontFamily: FontFamily.regular, fontSize: 13 },
});
