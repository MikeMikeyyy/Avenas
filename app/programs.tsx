import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { APP_LIGHT, APP_DARK, FontFamily, Colors } from "../constants/theme";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import { useTheme } from "../contexts/ThemeContext";

const ACCT = "#1deca0";

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function DumbbellIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={color} strokeWidth="1.5" />
      <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
}

interface Program {
  id: string;
  name: string;
  category: "Hypertrophy" | "Strength" | "Cutting" | "General";
  totalWeeks: number;
  currentWeek: number;
  status: "active" | "completed" | "paused" | "created";
  startDate: string;
  trainingDays: number;
  cycleDays: number;
  cyclePattern: string[]; // workout name or "Rest" for each day in the cycle, length must equal cycleDays
}

const PROGRAMS: Program[] = [
  { id: "1", name: "2026 Mesocycle A",     category: "Hypertrophy", totalWeeks: 8,  currentWeek: 3, status: "active",    startDate: "03 Mar 2026", trainingDays: 4, cycleDays: 7, cyclePattern: ["Fullbody A", "Rest", "Fullbody B", "Rest", "Fullbody C", "Rest", "Rest"] },
  { id: "2", name: "Upper/Lower Split",    category: "Hypertrophy", totalWeeks: 6,  currentWeek: 2, status: "paused",    startDate: "17 Feb 2026", trainingDays: 4, cycleDays: 7, cyclePattern: ["Upper A", "Rest", "Lower A", "Rest", "Upper B", "Lower B", "Rest"] },
  { id: "3", name: "Strength Block 5/3/1", category: "Strength",    totalWeeks: 16, currentWeek: 0, status: "created",   startDate: "02 Apr 2026", trainingDays: 3, cycleDays: 5, cyclePattern: ["Squat", "Rest", "Bench", "Rest", "Deadlift"] },
  { id: "4", name: "2025 Mesocycle B",     category: "Hypertrophy", totalWeeks: 8,  currentWeek: 0, status: "completed", startDate: "07 Jul 2025", trainingDays: 4, cycleDays: 7, cyclePattern: ["Push A", "Pull A", "Rest", "Push B", "Pull B", "Rest", "Rest"] },
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
          <DumbbellIcon size={14} color={t.ts} />
          <Text style={[styles.metaText, { color: t.ts }]}>{program.trainingDays} days / {program.cycleDays} day cycle</Text>
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
  const statusColor =
    program.status === "active"    ? ACCT :
    program.status === "paused"    ? Colors.warning : t.ts;
  const statusLabel =
    program.status === "active"    ? "Active" :
    program.status === "paused"    ? "Paused" :
    program.status === "created"   ? "Not Started" : "Completed";
  const weekText =
    program.status === "completed" ? `Completed ${program.totalWeeks} of ${program.totalWeeks} weeks` :
    program.status === "created"   ? `${program.totalWeeks} weeks planned` :
    `Week ${program.currentWeek} of ${program.totalWeeks}`;
  const dateLabel = program.status === "created" ? "Created" : "Started";

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
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={13} color={t.ts} />
          <Text style={[styles.metaText, { color: t.ts }]}>{dateLabel} {program.startDate}</Text>
          <View style={styles.metaDot} />
          <DumbbellIcon size={13} color={t.ts} />
          <Text style={[styles.metaText, { color: t.ts }]}>{program.trainingDays} days / {program.cycleDays} day cycle</Text>
        </View>
        <View style={styles.cycleGrid}>
          {chunk(program.cyclePattern, 5).map((row, rowIdx) => (
            <View key={rowIdx} style={styles.cycleRow}>
              {row.map((day, i) => {
                const isTraining = day !== "Rest";
                return (
                  <View
                    key={i}
                    style={[
                      styles.cycleChip,
                      { backgroundColor: isTraining ? statusColor + "22" : t.div },
                      isTraining && { borderColor: statusColor, borderWidth: 1 },
                    ]}
                  >
                    <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                      {day}
                    </Text>
                  </View>
                );
              })}
              {Array.from({ length: 5 - row.length }).map((_, i) => (
                <View key={`ph-${i}`} style={[styles.cycleChip, { opacity: 0 }]} />
              ))}
            </View>
          ))}
        </View>
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
              { value: String(weeksTrained),  label: "Weeks Logged" },
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
            <Text style={[styles.sectionLabel, { color: t.ts }]}>ACTIVE</Text>
            <ActiveProgramCard program={activeProgram} isDark={isDark} />
          </>
        )}

        {/* All programs */}
        <View style={[styles.rowBetween, { marginBottom: 12 }]}>
          <Text style={[styles.sectionLabel, { color: t.ts, marginBottom: 0 }]}>ALL PROGRAMS</Text>
          <BounceButton accessibilityLabel="Create new program" accessibilityRole="button">
            <View style={styles.newProgramBtn}>
              <Ionicons name="add" size={14} color="#fff" />
              <Text style={styles.newProgramBtnText}>New</Text>
            </View>
          </BounceButton>
        </View>
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
  newProgramBtn:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: ACCT, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  newProgramBtnText:  { fontFamily: FontFamily.semibold, fontSize: 12, color: "#fff" },
  cycleGrid:          { gap: 4 },
  cycleRow:           { flexDirection: "row", gap: 4 },
  cycleChip:          { flex: 1, alignItems: "center", paddingVertical: 6, paddingHorizontal: 2, borderRadius: 8 },
  cycleChipText:      { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
});
