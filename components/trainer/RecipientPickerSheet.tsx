// Second step of the "Send a Program" flow. Lists clients with checkboxes
// + a "Send to all" toggle. Confirm sends to the chosen recipients.

import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import SimpleSheet from "./SimpleSheet";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { Client } from "../../utils/trainerStore";

interface Props {
  visible: boolean;
  programName: string;
  clients: Client[];
  /** Called with the chosen recipient IDs, or "all" if every client was selected via the toggle. */
  onConfirm: (recipients: string[] | "all") => void;
  onClose: () => void;
}

export default function RecipientPickerSheet({ visible, programName, clients, onConfirm, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendToAll, setSendToAll] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setSendToAll(false);
    }
  }, [visible]);

  const toggleClient = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSendToAll(false);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSendToAll(prev => {
      const next = !prev;
      if (next) setSelected(new Set());
      return next;
    });
  };

  const canSend = sendToAll || selected.size > 0;

  const ctaLabel = useMemo(() => {
    if (!canSend) return "Choose recipients";
    if (sendToAll) return `Send to all ${clients.length}`;
    return `Send to ${selected.size} client${selected.size === 1 ? "" : "s"}`;
  }, [canSend, sendToAll, selected.size, clients.length]);

  const handleConfirm = () => {
    if (!canSend) return;
    onConfirm(sendToAll ? "all" : Array.from(selected));
  };

  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]}>Send "{programName}"</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>Pick which clients should receive this program.</Text>
      </View>

      <View style={styles.allWrap}>
        <TouchableOpacity activeOpacity={0.85} onPress={toggleAll}>
          <NeuCard dark={isDark} radius={14}>
            <View style={styles.row}>
              <View style={[styles.allIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
                <Ionicons name="people-outline" size={18} color={ACCT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: t.tp }]}>Send to all clients</Text>
                <Text style={[styles.rowMeta, { color: t.ts }]}>
                  {clients.length} {clients.length === 1 ? "client" : "clients"}
                </Text>
              </View>
              <View style={[styles.check, sendToAll
                ? { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }
                : { backgroundColor: "transparent", borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)" },
              ]}>
                {sendToAll && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
            </View>
          </NeuCard>
        </TouchableOpacity>
      </View>

      <Text style={[styles.section, { color: t.ts }]}>OR PICK INDIVIDUALLY</Text>

      <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {clients.length === 0 ? (
          <Text style={[styles.empty, { color: t.ts }]}>You don't have any clients yet.</Text>
        ) : (
          clients.map(c => {
            const checked = !sendToAll && selected.has(c.id);
            return (
              <TouchableOpacity key={c.id} activeOpacity={0.85} style={{ marginBottom: 10 }} onPress={() => toggleClient(c.id)} disabled={sendToAll}>
                <NeuCard dark={isDark} radius={14}>
                  <View style={[styles.row, sendToAll && { opacity: 0.45 }]}>
                    <View style={[styles.avatar, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
                      <Text style={[styles.avatarText, { color: ACCT }]}>{c.initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.rowTitle, { color: t.tp }]} numberOfLines={1}>{c.name}</Text>
                        {c.isTrainer && (
                          <View style={[styles.trainerTag, { backgroundColor: `${ACCT}22` }]}>
                            <Text style={[styles.trainerTagText, { color: ACCT }]}>TRAINER</Text>
                          </View>
                        )}
                      </View>
                      {c.note ? <Text style={[styles.rowMeta, { color: t.ts }]} numberOfLines={1}>{c.note}</Text> : null}
                    </View>
                    <View style={[styles.check, checked
                      ? { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }
                      : { backgroundColor: "transparent", borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)" },
                    ]}>
                      {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </View>
                </NeuCard>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <View style={styles.actions}>
        <BounceButton onPress={canSend ? handleConfirm : undefined}>
          <View style={[styles.send, { opacity: canSend ? 1 : 0.4 }]}>
            <Text style={styles.sendText}>{ctaLabel}</Text>
          </View>
        </BounceButton>
        <BounceButton style={{ marginTop: 8 }} onPress={onClose}>
          <View style={[styles.cancel, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
            <Text style={[styles.cancelText, { color: t.tp }]}>Cancel</Text>
          </View>
        </BounceButton>
      </View>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:     { paddingHorizontal: 24, paddingBottom: 14, gap: 4 },
  title:      { fontFamily: FontFamily.bold, fontSize: 20 },
  subtitle:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  allWrap:    { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14 },
  section:    { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", paddingHorizontal: 24, marginBottom: 10 },
  list:       { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  empty:      { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },
  row:        { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  nameRow:    { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle:   { fontFamily: FontFamily.semibold, fontSize: 15, flexShrink: 1 },
  rowMeta:    { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  trainerTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  trainerTagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
  avatar:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 14 },
  allIcon:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  check:      { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  actions:    { paddingHorizontal: 20, paddingTop: 12 },
  send:       { borderRadius: 14, paddingVertical: 14, alignItems: "center", backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  sendText:   { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  cancel:     { borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  cancelText: { fontFamily: FontFamily.bold, fontSize: 14 },
});
