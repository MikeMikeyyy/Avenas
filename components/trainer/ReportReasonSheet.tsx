// Reason picker for a report — used for both "report this person" and "report
// this message". Pick a reason → onSubmit(reason); the caller logs it and shows
// the confirmation. Built on the shared SimpleSheet.

import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import SimpleSheet from "./SimpleSheet";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { REPORT_REASONS, type ReportReason } from "../../constants/chat";

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  onSubmit: (reason: ReportReason) => void;
  onClose: () => void;
}

export default function ReportReasonSheet({ visible, title, subtitle, onSubmit, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const pick = (reason: ReportReason) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSubmit(reason);
  };

  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>{subtitle ?? "Why are you reporting this?"}</Text>
      </View>

      <View style={styles.list}>
        {REPORT_REASONS.map((reason, i) => (
          <TouchableOpacity
            key={reason}
            activeOpacity={0.8}
            onPress={() => pick(reason)}
            style={[styles.row, { borderTopColor: t.div, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}
            accessibilityRole="button"
            accessibilityLabel={`Report reason: ${reason}`}
          >
            <Text style={[styles.rowText, { color: t.tp }]}>{reason}</Text>
            <Ionicons name="chevron-forward" size={16} color={t.ts} />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity onPress={onClose} activeOpacity={0.8} style={styles.cancel} accessibilityRole="button" accessibilityLabel="Cancel report">
        <Text style={[styles.cancelText, { color: t.ts }]}>Cancel</Text>
      </TouchableOpacity>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:     { paddingHorizontal: 24, paddingBottom: 8, gap: 4 },
  title:      { fontFamily: FontFamily.bold, fontSize: 19 },
  subtitle:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  list:       { paddingHorizontal: 24, paddingTop: 8 },
  row:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16 },
  rowText:    { fontFamily: FontFamily.semibold, fontSize: 15 },
  cancel:     { alignItems: "center", paddingTop: 14, paddingBottom: 4 },
  cancelText: { fontFamily: FontFamily.bold, fontSize: 15 },
});
