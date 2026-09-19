// The card at the top of a program seen read-only: its name, then how many
// weeks it runs, how many of its days train and how long its cycle is.
//
// Shared by the two screens that show a program someone else sent:
// /program-view (every "View" button on the trainer and group pages) and the
// trainer's review screen. The review screen had this card and the viewer
// didn't, so the same program opened to a titled card on one side of the flow
// and to a line of grey text on the page background on the other. See
// components/ProgramSnapshotView.tsx, which draws the rest of both screens.

import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import NeuCard from "./NeuCard";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import type { SavedProgram } from "../constants/programs";

export default function ProgramHeaderCard({ name, snapshot, isDark }: {
  /** The program's name. Callers prefer the snapshot's own over the name the
   *  row was sent under, so a program renamed before sending reads as itself. */
  name: string;
  /** Null for a legacy row that was sent without one; the card says so. */
  snapshot: SavedProgram | null | undefined;
  isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <NeuCard dark={isDark} radius={20}>
      <View style={styles.inner}>
        <View style={styles.nameBlock}>
          <Text style={[styles.label, { color: t.ts }]}>PROGRAM NAME</Text>
          <Text style={[styles.name, { color: t.tp }]} numberOfLines={2}>{name}</Text>
        </View>
        {snapshot ? (
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={13} color={t.ts} />
            <Text style={[styles.metaText, { color: t.ts }]}>
              {snapshot.totalWeeks} week{snapshot.totalWeeks === 1 ? "" : "s"} · {snapshot.trainingDays} training day{snapshot.trainingDays === 1 ? "" : "s"} · {snapshot.cycleDays}-day cycle
            </Text>
          </View>
        ) : (
          <Text style={[styles.noSnap, { color: t.ts }]}>This program was sent without its details.</Text>
        )}
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  inner:     { padding: 18, gap: 10 },
  nameBlock: { gap: 6 },
  label:     { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.9 },
  name:      { fontFamily: FontFamily.bold, fontSize: 18 },
  metaRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText:  { fontFamily: FontFamily.regular, fontSize: 13 },
  noSnap:    { fontFamily: FontFamily.regular, fontSize: 13 },
});
