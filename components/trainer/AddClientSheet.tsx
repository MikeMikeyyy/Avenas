// Mock add-client form (no real invite; local-only).

import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import SimpleSheet from "./SimpleSheet";
import BounceButton from "../BounceButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string, note: string) => void;
}

export default function AddClientSheet({ visible, onClose, onSubmit }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (visible) { setName(""); setNote(""); }
  }, [visible]);

  const canSubmit = name.trim().length > 0;

  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <View>
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.tp }]}>Add Client</Text>
          <Text style={[styles.subtitle, { color: t.ts }]}>Create a new client. They'll appear in your roster.</Text>
        </View>
        <View style={styles.body}>
          <Text style={[styles.label, { color: t.ts }]}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Client name"
            placeholderTextColor={t.ts}
            style={[styles.input, { color: t.tp, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]}
            autoFocus
          />
          <Text style={[styles.label, { color: t.ts, marginTop: 14 }]}>Note (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Hypertrophy block"
            placeholderTextColor={t.ts}
            style={[styles.input, { color: t.tp, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]}
          />
        </View>
        <View style={styles.actions}>
          <BounceButton onPress={canSubmit ? () => { onSubmit(name.trim(), note.trim()); onClose(); } : undefined}>
            <View style={[styles.submit, { opacity: canSubmit ? 1 : 0.4 }]}>
              <Text style={styles.submitText}>Add Client</Text>
            </View>
          </BounceButton>
        </View>
      </View>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:     { paddingHorizontal: 24, paddingBottom: 12, gap: 4 },
  title:      { fontFamily: FontFamily.bold, fontSize: 20 },
  subtitle:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  body:       { paddingHorizontal: 20, paddingTop: 8 },
  label:      { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.8, marginBottom: 6, textTransform: "uppercase" },
  input:      { fontFamily: FontFamily.regular, fontSize: 15, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  actions:    { paddingHorizontal: 20, paddingTop: 18 },
  submit:     { borderRadius: 14, paddingVertical: 14, alignItems: "center", backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  submitText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
});
