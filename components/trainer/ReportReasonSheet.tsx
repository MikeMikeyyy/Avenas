// Reason picker for a report — used for both "report this person" and "report
// this message". Pick a reason → onSubmit(reason); the caller logs it and shows
// the confirmation.
//
// Two shapes of the same thing:
//   ReportReasonList  — just the content, for a screen that already has a sheet
//                       open and shows the reasons as a step inside it. The chat
//                       threads do this: one RN Modal per screen, because two
//                       mounted at once is the bug where the second never
//                       presents again.
//   ReportReasonSheet — the list in its own SimpleSheet, for screens with no
//                       other sheet.

import { View, Text, StyleSheet } from "react-native";

import SimpleSheet from "./SimpleSheet";
import SheetPill from "../SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { REPORT_REASONS, type ReportReason } from "../../constants/chat";

interface ListProps {
  title: string;
  subtitle?: string;
  onSubmit: (reason: ReportReason) => void;
  /** The Cancel row at the foot. */
  onCancel: () => void;
}

export function ReportReasonList({ title, subtitle, onSubmit, onCancel }: ListProps) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  return (
    <>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>{subtitle ?? "Why are you reporting this?"}</Text>
      </View>

      <View style={styles.list}>
        {REPORT_REASONS.map(reason => (
          <SheetPill key={reason} label={reason} onPress={() => onSubmit(reason)} />
        ))}
        <SheetPill label="Cancel" variant="quiet" onPress={onCancel} />
      </View>
    </>
  );
}

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  onSubmit: (reason: ReportReason) => void;
  onClose: () => void;
}

export default function ReportReasonSheet({ visible, title, subtitle, onSubmit, onClose }: Props) {
  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <ReportReasonList title={title} subtitle={subtitle} onSubmit={onSubmit} onCancel={onClose} />
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:     { paddingHorizontal: 24, paddingBottom: 8, gap: 4 },
  title:      { fontFamily: FontFamily.bold, fontSize: 19 },
  subtitle:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  list:       { paddingHorizontal: 20, paddingTop: 10, gap: 12 },
});
