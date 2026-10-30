// Shared sheet: pick one of the PT's saved programs to share.
//
// Each program is a row on the sheet, its name over its weeks and days, with a
// line between rows as on Reorder Exercises (user pick, 2026-10-30, option A
// of the Send Picker canvas: each was a card with a chip per cycle day, big
// and mostly empty). The list goes straight in the sheet, which scrolls it
// once it's as tall as the screen allows; it was a box of a fixed 380pt.

import { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import SimpleSheet from "./SimpleSheet";
import SheetPill from "../SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { CARD_META, CARD_TITLE } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";
import type { SavedProgram } from "../../constants/programs";
import { unarchivedPrograms } from "../../utils/programArchive";

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  programs: SavedProgram[];
  onPick: (program: SavedProgram) => void;
  onClose: () => void;
}

/** "8 weeks · 6 days a week", or "8 weeks · 5 days in a 9-day cycle" for a
 *  cycle that isn't a week. */
function scheduleLine(p: SavedProgram): string {
  const weeks = `${p.totalWeeks} week${p.totalWeeks === 1 ? "" : "s"}`;
  const days = `${p.trainingDays} day${p.trainingDays === 1 ? "" : "s"}`;
  return p.cycleDays === 7 ? `${weeks} · ${days} a week` : `${weeks} · ${days} in a ${p.cycleDays}-day cycle`;
}

export default function ProgramPickerSheet({ visible, title, subtitle, programs: all, onPick, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // Archived programs are out of the way everywhere a program is picked, not
  // just on My Programs (utils/programArchive.ts). Here rather than at each of
  // the five callers, so none of them can forget.
  const programs = useMemo(() => unarchivedPrograms(all), [all]);

  // Cancel is the sheet's footer, so it stays in reach should the sheet ever
  // be as tall as the screen allows (components/trainer/SimpleSheet.tsx).
  return (
    <SimpleSheet
      visible={visible}
      onClose={onClose}
      footer={
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <SheetPill label="Cancel" variant="cancel" onPress={onClose} />
        </View>
      }
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: t.ts }]}>{subtitle}</Text> : null}
      </View>
      <View style={styles.list}>
        {programs.length === 0 ? (
          <Text style={[styles.empty, { color: t.ts }]}>{"You don't have any programs yet. Create one first."}</Text>
        ) : (
          programs.map((p, i) => {
            const line = scheduleLine(p);
            return (
              <TouchableOpacity
                key={p.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPick(p); onClose(); }}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={`${p.name}, ${line}`}
                style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.sheetLine }]}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{p.name}</Text>
                  <Text style={[styles.meta, { color: t.ts }]} numberOfLines={1}>{line}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={t.ts} />
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:     { paddingHorizontal: 24, paddingBottom: 12, gap: 4 },
  title:      { fontFamily: FontFamily.bold, fontSize: 20 },
  subtitle:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  // The rows' words line up with the header's, 24pt in; their lines run 12pt
  // short of the sheet's sides.
  list:       { paddingHorizontal: 12, paddingBottom: 8 },
  empty:      { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },
  row:        { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 12 },
  rowText:    { flex: 1, minWidth: 0 },
  name:       { ...CARD_TITLE },
  meta:       { ...CARD_META },
});
