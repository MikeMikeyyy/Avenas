import { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Animated,
  PanResponder,
  Easing,
  TouchableWithoutFeedback,
} from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import FadeScreen from "../components/FadeScreen";
import TrashIcon from "../components/TrashIcon";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

const JOURNAL_KEY = "@avenas_journal_entries";

type JournalEntry = {
  id: string;
  title: string;
  body: string;
  createdAt: string; // ISO string
};

const FULL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBR    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w ago`;
  return formatEntryDate(iso);
}

// Static values for StyleSheet
const TP   = APP_LIGHT.tp;
const TS   = APP_LIGHT.ts;
const DIV  = APP_LIGHT.div;

// ─── Delete confirmation sheet ─────────────────────────────────────────────────

interface DeleteSheetProps {
  visible: boolean;
  isDark: boolean;
  entryTitle: string;
  onConfirm: () => void;
  onClose: () => void;
}

function DeleteSheet({ visible, isDark, entryTitle, onConfirm, onClose }: DeleteSheetProps) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 400, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => { slideY.setValue(400); backdropOpacity.setValue(0); onClose(); });
  }, [onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) { slideY.setValue(g.dy); backdropOpacity.setValue(Math.max(0, 1 - g.dy / 200)); } },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8) {
          Animated.parallel([
            Animated.timing(slideY, { toValue: 400, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => { slideY.setValue(400); backdropOpacity.setValue(0); onClose(); });
        } else {
          Animated.parallel([
            Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <TouchableWithoutFeedback onPress={dismiss}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
      </TouchableWithoutFeedback>
      <Animated.View style={[styles.deleteSheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 12, transform: [{ translateY: slideY }] }]}>
        <View {...panResponder.panHandlers}>
          <View style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
        </View>
        <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 8 }}>
          <Text style={[styles.deleteTitle, { color: t.tp }]}>Delete Entry?</Text>
          <Text style={[styles.deleteSubtitle, { color: t.ts }]} numberOfLines={2}>
            "{entryTitle}" will be permanently removed.
          </Text>
        </View>
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <BounceButton onPress={() => { onConfirm(); dismiss(); }}>
            <View style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>Delete</Text>
            </View>
          </BounceButton>
          <BounceButton onPress={dismiss}>
            <View style={[styles.cancelBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
              <Text style={[styles.cancelBtnText, { color: t.tp }]}>Cancel</Text>
            </View>
          </BounceButton>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(JOURNAL_KEY)
        .then((raw) => {
          if (raw) setEntries(JSON.parse(raw));
        })
        .catch(() => {});
    }, [])
  );

  const saveEntries = async (updated: JournalEntry[]) => {
    setEntries(updated);
    await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(updated));
  };

  const handleDelete = (id: string) => {
    saveEntries(entries.filter((e) => e.id !== id));
  };

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      {/* Top gradient blur */}
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView
          style={StyleSheet.absoluteFillObject}
          maskElement={
            <LinearGradient
              colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)", "transparent"]}
              locations={[0, 0.45, 0.65, 0.8, 0.9, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          }
        >
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 14, left: 20, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        {isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </GlassView>
        ) : (
          <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#ffffff" }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        )}
      </TouchableOpacity>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      >
        {/* Page header */}
        <View style={styles.header}>
          <View style={{ width: 66 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>JOURNAL</Text>
          <View style={{ width: 66 }} />
        </View>

        {/* Empty state */}
        {entries.length === 0 && (
          <NeuCard dark={isDark} style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIconWrap, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.12)" }]}>
                <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
                  <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke={ACCT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke={ACCT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <Path d="M9 7h6M9 11h4" stroke={ACCT} strokeWidth="1.5" strokeLinecap="round" />
                </Svg>
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>Nothing here yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>Your journal entries will appear here.</Text>
            </View>
          </NeuCard>
        )}

        {/* Entry list */}
        {entries.map((entry) => (
          <BounceButton key={entry.id} style={{ marginBottom: 12 }}>
            <NeuCard dark={isDark} style={[styles.entryCard, { marginBottom: 0 }]}>
              <View style={styles.entryInner}>
                <View style={styles.entryMain}>
                  <View style={styles.entryTopRow}>
                    <Text style={[styles.entryTitle, { color: t.tp }]} numberOfLines={1}>{entry.title}</Text>
                    <TouchableOpacity
                      onPress={() => setDeleteTarget(entry)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      activeOpacity={0.7}
                    >
                      <TrashIcon size={18} color={t.ts} />
                    </TouchableOpacity>
                  </View>
                  {entry.body.length > 0 && (
                    <Text style={[styles.entryPreview, { color: t.ts }]} numberOfLines={2}>{entry.body}</Text>
                  )}
                  <View style={[styles.entryMeta, { borderTopColor: t.div }]}>
                    <Ionicons name="time-outline" size={13} color={t.ts} />
                    <Text style={[styles.entryMetaText, { color: t.ts }]}>{formatTimeAgo(entry.createdAt)}</Text>
                    <Text style={[styles.entryDot, { color: t.div }]}>·</Text>
                    <Text style={[styles.entryMetaText, { color: t.ts }]}>{formatEntryDate(entry.createdAt)}</Text>
                  </View>
                </View>
              </View>
            </NeuCard>
          </BounceButton>
        ))}
      </ScrollView>

      <DeleteSheet
        visible={deleteTarget !== null}
        isDark={isDark}
        entryTitle={deleteTarget?.title ?? ""}
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget.id); }}
        onClose={() => setDeleteTarget(null)}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scroll: { paddingHorizontal: 20 },

  header:      { flexDirection: "row", alignItems: "center", height: 40, marginBottom: 24 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1, color: TP },

  emptyCard: { borderRadius: 24, marginBottom: 20 },
  emptyInner: { padding: 32, alignItems: "center", gap: 12 },
  emptyIconWrap: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center" },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, textAlign: "center", lineHeight: 20 },

  entryCard: { borderRadius: 20 },
  entryInner: { padding: 18 },
  entryMain: { gap: 8 },
  entryTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  entryTitle: { fontFamily: FontFamily.semibold, fontSize: 16, color: TP, flex: 1 },
  entryPreview: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, lineHeight: 20 },
  entryMeta: { flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 10, borderTopWidth: 1, borderTopColor: DIV },
  entryMetaText: { fontFamily: FontFamily.regular, fontSize: 12, color: TS },
  entryDot: { fontFamily: FontFamily.regular, fontSize: 12, color: DIV },

  // Bottom sheet shared
  backdrop: { backgroundColor: "rgba(0,0,0,0.45)" },
  handleArea: { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },

  // Delete sheet
  deleteSheet: { position: "absolute", bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  deleteTitle: { fontFamily: FontFamily.bold, fontSize: 20, color: TP },
  deleteSubtitle: { fontFamily: FontFamily.regular, fontSize: 14, color: TS, lineHeight: 20 },
  deleteBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", backgroundColor: "#FF3B30", shadowColor: "#FF3B30", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
  deleteBtnText: { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff" },
  cancelBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  cancelBtnText: { fontFamily: FontFamily.bold, fontSize: 16, color: TP },
});
