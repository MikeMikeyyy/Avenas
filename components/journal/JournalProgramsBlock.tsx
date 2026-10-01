// The Journal's programs section: the active program as a card (its weeks as a
// bar) that opens its week-by-week page (app/program-history-detail.tsx), and
// "All Programs" for every other one's (app/program-history.tsx).
//
// Shared by the user's own Journal and a trainer's view of a client's
// (ClientJournalView), so a trainer reaches the client's program page from the
// same card the client does and the two can't drift apart. The caller owns
// where a tap goes, since the trainer's routes carry the client's id.

import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import ActiveBadge from "../ActiveBadge";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { getCurrentWeek, type SavedProgram } from "../../constants/programs";

export default function JournalProgramsBlock({ activeProgram, isDark, onOpenProgram, onOpenAllPrograms }: {
  activeProgram: SavedProgram | null;
  isDark: boolean;
  onOpenProgram: (programId: string) => void;
  onOpenAllPrograms: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const week = activeProgram ? getCurrentWeek(activeProgram) : 0;
  return (
    <View style={styles.programsBlock}>
      <View style={styles.programsHeadingRow}>
        {activeProgram && (
          <Text style={[styles.sectionHeading, { color: t.tp }]}>Active Program</Text>
        )}
        <BounceButton onPress={onOpenAllPrograms} accessibilityLabel="View all programs" accessibilityRole="button">
          <View style={[styles.allProgramsBtn, { backgroundColor: t.ctrl }]}>
            <Text style={[styles.allProgramsText, { color: t.tp }]}>All Programs</Text>
            <Ionicons name="chevron-forward" size={14} color={t.tp} />
          </View>
        </BounceButton>
      </View>
      {activeProgram && (
        <BounceButton
          style={{ marginBottom: 10 }}
          onPress={() => onOpenProgram(activeProgram.id)}
          accessibilityRole="button"
          accessibilityLabel={`${activeProgram.name}, week ${week} of ${activeProgram.totalWeeks}. Open its history`}
        >
          <NeuCard dark={isDark} style={styles.activeProgramCard}>
            <View style={styles.apCardInner}>
              <View style={styles.apNameRow}>
                <Text style={[styles.apName, { color: t.tp, flex: 1 }]} numberOfLines={1}>{activeProgram.name}</Text>
                <ActiveBadge />
                <Ionicons name="chevron-forward" size={16} color={t.ts} style={{ marginLeft: 6 }} />
              </View>
              <Text style={[styles.apSub, { color: t.ts }]}>
                Week {week} of {activeProgram.totalWeeks}
              </Text>
              <View style={styles.apDateRow}>
                <Ionicons name="calendar-outline" size={13} color={t.ts} />
                <Text style={[styles.apDate, { color: t.ts }]}>Started {activeProgram.startDate}</Text>
              </View>
              <View style={styles.apProgressRow}>
                {Array.from({ length: activeProgram.totalWeeks }).map((_, i) => {
                  const filled = i < week;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.apProgressSeg,
                        { backgroundColor: filled ? ACCT : t.div },
                        filled && { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 },
                      ]}
                    />
                  );
                })}
              </View>
            </View>
          </NeuCard>
        </BounceButton>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeading:     { fontFamily: FontFamily.bold, fontSize: 18 },
  programsBlock:      { marginTop: 20, marginBottom: 4 },
  programsHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  activeProgramCard:  { borderRadius: 20 },
  apCardInner:        { padding: 18, gap: 8 },
  apNameRow:          { flexDirection: "row", alignItems: "center", gap: 8 },
  apName:             { fontFamily: FontFamily.bold, fontSize: 16 },
  apSub:              { fontFamily: FontFamily.regular, fontSize: 13 },
  apDateRow:          { flexDirection: "row", alignItems: "center", gap: 6 },
  apDate:             { fontFamily: FontFamily.regular, fontSize: 13 },
  apProgressRow:      { flexDirection: "row", gap: 4, marginTop: 4 },
  apProgressSeg:      { flex: 1, height: 6, borderRadius: 3 },
  // Flat chrome pill (background from t.ctrl inline), matching the "+ New"
  // button on My Programs rather than the neumorphic card it used to be.
  allProgramsBtn:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 50, paddingVertical: 7, paddingHorizontal: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  allProgramsText:    { fontFamily: FontFamily.bold, fontSize: 14, letterSpacing: 0.2 },
});
