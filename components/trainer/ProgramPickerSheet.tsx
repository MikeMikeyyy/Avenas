// Shared sheet: pick one of the PT's saved programs to share.

import { View, Text, StyleSheet, ScrollView } from "react-native";
import SimpleSheet from "./SimpleSheet";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { SavedProgram } from "../../constants/programs";

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  programs: SavedProgram[];
  onPick: (program: SavedProgram) => void;
  onClose: () => void;
}

export default function ProgramPickerSheet({ visible, title, subtitle, programs, onPick, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: t.ts }]}>{subtitle}</Text> : null}
      </View>
      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {programs.length === 0 ? (
          <Text style={[styles.empty, { color: t.ts }]}>You don't have any programs yet. Create one first.</Text>
        ) : (
          programs.map(p => (
            <BounceButton key={p.id} style={{ marginBottom: 10 }} onPress={() => { onPick(p); onClose(); }}>
              <NeuCard dark={isDark} radius={14}>
                <View style={styles.cardInner}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{p.name}</Text>
                      <Text style={[styles.meta, { color: t.ts }]}>{p.totalWeeks} weeks</Text>
                    </View>
                  </View>
                  <View style={styles.cycleGrid}>
                    {p.cyclePattern.map((day, i) => {
                      const isTraining = day !== "Rest" && day !== "";
                      return (
                        <View
                          key={i}
                          style={[
                            styles.cycleChip,
                            isTraining
                              ? { backgroundColor: ACCT + "22", borderColor: ACCT, borderWidth: 1 }
                              : { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div },
                          ]}
                        >
                          <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                            {day || "Rest"}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </NeuCard>
            </BounceButton>
          ))
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <BounceButton onPress={onClose}>
          <View style={[styles.cancel, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
            <Text style={[styles.cancelText, { color: t.tp }]}>Cancel</Text>
          </View>
        </BounceButton>
      </View>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:     { paddingHorizontal: 24, paddingBottom: 16, gap: 4 },
  title:      { fontFamily: FontFamily.bold, fontSize: 20 },
  subtitle:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  list:       { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  empty:      { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },
  cardInner:  { padding: 14, gap: 10 },
  row:        { flexDirection: "row", alignItems: "center", gap: 12 },
  name:       { fontFamily: FontFamily.semibold, fontSize: 15 },
  meta:       { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  cycleGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:  { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText: { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  cancel:     { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelText: { fontFamily: FontFamily.bold, fontSize: 15 },
});
