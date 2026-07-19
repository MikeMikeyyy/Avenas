// "New message" composer — broadcast one message to several people at once.
// Mirrors RecipientPickerSheet's multi-select UX (Set<string> + "Send to all"
// toggle + checkmark rows), with a message field. Sending delivers the same
// text to each chosen contact's own 1:1 thread (not a group), matching the
// "send a program to multiple people" pattern.

import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import SimpleSheet from "./SimpleSheet";
import NeuCard from "../NeuCard";
import Avatar from "../Avatar";
import SendIcon from "../icons/SendIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { ChatContact } from "../../constants/chat";

// Message box max height (~4 rows) before the input scrolls internally.
const MSG_INPUT_MAX_H = 80;

interface Props {
  visible: boolean;
  contacts: ChatContact[];
  /** Called with the chosen recipient ids + the message text. */
  onSend: (contactIds: string[], text: string) => void;
  onClose: () => void;
}

export default function MessageComposeSheet({ visible, contacts, onSend, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendToAll, setSendToAll] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setSendToAll(false);
      setText("");
    }
  }, [visible]);

  const toggleContact = (id: string) => {
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

  const recipientCount = sendToAll ? contacts.length : selected.size;
  const canSend = recipientCount > 0 && text.trim().length > 0;

  const ctaLabel = useMemo(() => {
    if (recipientCount === 0) return "Choose recipients";
    if (!text.trim()) return "Write a message";
    return `Send to ${recipientCount} ${recipientCount === 1 ? "person" : "people"}`;
  }, [recipientCount, text]);

  const handleSend = () => {
    if (!canSend) return;
    const ids = sendToAll ? contacts.map(c => c.id) : Array.from(selected);
    onSend(ids, text.trim());
  };

  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]}>New message</Text>
      </View>

      <View style={styles.allWrap}>
        <TouchableOpacity activeOpacity={0.85} onPress={toggleAll}>
          <NeuCard dark={isDark} radius={14}>
            <View style={styles.row}>
              <View style={[styles.allIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
                <Ionicons name="people-outline" size={18} color={ACCT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: t.tp }]}>Send to everyone</Text>
                <Text style={[styles.rowMeta, { color: t.ts }]}>
                  {contacts.length} {contacts.length === 1 ? "person" : "people"}
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

      <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {contacts.length === 0 ? (
          <Text style={[styles.empty, { color: t.ts }]}>You haven’t added anyone yet.</Text>
        ) : (
          contacts.map(c => {
            const checked = !sendToAll && selected.has(c.id);
            return (
              <TouchableOpacity key={c.id} activeOpacity={0.85} style={{ marginBottom: 10 }} onPress={() => toggleContact(c.id)} disabled={sendToAll}>
                <NeuCard dark={isDark} radius={14}>
                  <View style={[styles.row, sendToAll && { opacity: 0.45 }]}>
                    <Avatar
                      uri={c.photoUri}
                      initials={c.initials}
                      size={40}
                      backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                      textStyle={[styles.avatarText, { color: ACCT }]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: t.tp }]} numberOfLines={1}>{c.name}</Text>
                      {c.subtitle ? <Text style={[styles.rowMeta, { color: t.ts }]} numberOfLines={1}>{c.subtitle}</Text> : null}
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

      {/* Input bar — send sits inline so it stays just above the keyboard and the
          sheet's drag handle remains visible (slide-down to dismiss still works). */}
      <View style={styles.inputBar}>
        <View style={[styles.composeBox, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#ffffff", borderColor: t.div }]}>
          <TextInput
            style={[styles.composeInput, { color: t.tp }]}
            value={text}
            onChangeText={setText}
            placeholder="Write a message…"
            placeholderTextColor={t.ts}
            multiline
          />
        </View>
        <TouchableOpacity onPress={handleSend} disabled={!canSend} activeOpacity={0.8} accessibilityLabel={ctaLabel} accessibilityRole="button">
          <View style={[styles.sendBtn, { backgroundColor: ACCT, opacity: canSend ? 1 : 0.4 }]}>
            <SendIcon size={18} color="#fff" />
          </View>
        </TouchableOpacity>
      </View>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:       { paddingHorizontal: 24, paddingBottom: 14 },
  title:        { fontFamily: FontFamily.bold, fontSize: 20 },
  allWrap:      { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14 },
  section:      { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", paddingHorizontal: 24, marginBottom: 10 },
  list:         { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  empty:        { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },
  row:          { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rowTitle:     { fontFamily: FontFamily.semibold, fontSize: 15 },
  rowMeta:      { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 14 },
  allIcon:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  check:        { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  inputBar:     { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 20, paddingTop: 10 },
  composeBox:   { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, minHeight: 48, maxHeight: MSG_INPUT_MAX_H + 20, justifyContent: "center" },
  composeInput: { fontFamily: FontFamily.regular, fontSize: 15, maxHeight: MSG_INPUT_MAX_H },
  sendBtn:      { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
});
