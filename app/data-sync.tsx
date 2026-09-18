// Data & Sync: whether this account's data is actually backed up, and a way to
// retry when it isn't. Reached from Settings > App.
//
// Backups are automatic (lib/syncManager.ts pushes a few seconds after every
// change and again on backgrounding), so the point of this page is the STATUS.
// A failed push used to be invisible: nothing said so and nothing retried until
// the next change. "Back Up Now" is that retry, through the same push path.
//
// Deliberately no "Restore from backup". Pushes are full snapshots moments after
// each change, so the cloud copy normally equals the device; when the two do
// differ it's because a push failed, which makes the cloud copy OLDER, and
// restoring it would delete the newest workouts. Signing in on a new phone
// already restores.
//
// Export is shown in development builds only until it works: Apple rejects apps
// for visible placeholder features (Guideline 2.1).

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../contexts/AuthContext";
import { APP_LIGHT, APP_DARK, FontFamily, ACCT, DANGER } from "../constants/theme";
import { pill, pillGlow } from "../constants/buttons";
import { MONTH_NAMES } from "../utils/dates";
import { cloudCounts, type SyncCounts } from "../lib/cloud";
import { backUpNow, getBackupStatus, subscribeBackupStatus, type BackupStatus } from "../lib/syncManager";

const TP = APP_LIGHT.tp;

/** "just now", "5 minutes ago", "3 hours ago", then "12 Sep, 4:05 pm". */
function fmtLastBackup(at: number, now: number): string {
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return `on ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}, ${time}`;
}

const COUNT_ROWS: { key: keyof SyncCounts; label: string }[] = [
  { key: "programs",        label: "Programs" },
  { key: "workouts",        label: "Workouts" },
  { key: "journal",         label: "Journal entries" },
  { key: "customExercises", label: "Custom exercises" },
];

export default function DataSyncScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { userId } = useAuth();

  const [status, setStatus] = useState<BackupStatus>({ state: "idle", lastBackupAt: null });
  const [counts, setCounts] = useState<SyncCounts | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);
  // Re-renders the relative time ("5 minutes ago") while the page is open.
  const [now, setNow] = useState(Date.now());
  const prevState = useRef<BackupStatus["state"]>("idle");

  const loadCounts = useCallback(async () => {
    if (!userId) return;
    try {
      const c = await cloudCounts(userId);
      setCounts(c);
      setCountsFailed(false);
    } catch {
      setCountsFailed(true);
    }
  }, [userId]);

  const refreshStatus = useCallback(async () => {
    if (!userId) return;
    const next = await getBackupStatus(userId);
    // An automatic backup finishing while the page is open changes what's in
    // the account, so the counts follow it.
    if (prevState.current === "backing_up" && next.state === "idle") void loadCounts();
    prevState.current = next.state;
    setStatus(next);
    setNow(Date.now());
  }, [userId, loadCounts]);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
      void loadCounts();
      const unsubscribe = subscribeBackupStatus(() => { void refreshStatus(); });
      const tick = setInterval(() => setNow(Date.now()), 30000);
      return () => { unsubscribe(); clearInterval(tick); };
    }, [refreshStatus, loadCounts]),
  );

  // Signing out from elsewhere while this page is open.
  useEffect(() => { if (!userId) setCounts(null); }, [userId]);

  const onBackUpNow = async () => {
    if (status.state === "backing_up") return;
    // BounceButton already plays the tap haptic; this adds the result.
    const outcome = await backUpNow();
    if (outcome === "pushed") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void loadCounts();
    } else if (outcome === "failed") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const neutralTint = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  const statusView = (() => {
    if (status.state === "backing_up") {
      return { icon: null, tint: neutralTint, color: t.ts, title: "Backing up…", body: "Saving your latest changes to your account." };
    }
    if (status.state === "failed") {
      return { icon: "cloud-offline-outline" as const, tint: `${DANGER}1F`, color: DANGER, title: "Couldn't back up", body: "Your changes are still safe on this phone. Check your connection, then tap Back Up Now." };
    }
    if (status.lastBackupAt !== null) {
      return { icon: "cloud-done-outline" as const, tint: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.16)", color: ACCT, title: "Backed up", body: `Last backed up ${fmtLastBackup(status.lastBackupAt, now)}.` };
    }
    return { icon: "cloud-upload-outline" as const, tint: neutralTint, color: t.ts, title: "Not backed up from this phone yet", body: "Tap Back Up Now to save your data to your account." };
  })();
  const busy = status.state === "backing_up";

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ position: "absolute", top: insets.top + 16, left: 26, zIndex: 10 }}
        activeOpacity={0.8}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
          <Ionicons name="chevron-back" size={22} color={t.tp} />
        </View>
      </TouchableOpacity>

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Data & Sync</Text>
          <View style={{ width: 40 }} />
        </View>

        {!userId ? (
          <NeuCard dark={isDark} radius={18} style={{ marginTop: 8 }}>
            <View style={styles.emptyInner}>
              <Ionicons name="cloud-offline-outline" size={26} color={t.ts} />
              <Text style={[styles.emptyTitle, { color: t.tp }]}>Not backed up</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                Sign in to back up your programs, workouts and journal to your account.
              </Text>
            </View>
          </NeuCard>
        ) : (
          <>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>Backup</Text>
            <NeuCard dark={isDark} style={styles.card}>
              <View style={styles.statusInner}>
                <View style={styles.statusRow} accessible accessibilityLabel={`${statusView.title}. ${statusView.body}`}>
                  <View style={[styles.statusBadge, { backgroundColor: statusView.tint }]}>
                    {statusView.icon
                      ? <Ionicons name={statusView.icon} size={22} color={statusView.color} />
                      : <ActivityIndicator color={t.ts} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.statusTitle, { color: t.tp }]}>{statusView.title}</Text>
                    <Text style={[styles.statusBody, { color: t.ts }]}>{statusView.body}</Text>
                  </View>
                </View>

                <BounceButton onPress={onBackUpNow} accessibilityLabel="Back up now" accessibilityRole="button">
                  <View style={[styles.primaryBtn, { backgroundColor: ACCT }, busy && styles.disabled]}>
                    {busy
                      ? <ActivityIndicator color="#fff" />
                      : <>
                          <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                          <Text style={styles.primaryText}>Back Up Now</Text>
                        </>}
                  </View>
                </BounceButton>
              </View>
            </NeuCard>

            <Text style={[styles.sectionLabel, { color: t.ts }]}>In Your Account</Text>
            <NeuCard dark={isDark} style={styles.card}>
              {COUNT_ROWS.map((row, i) => (
                <View key={row.key}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: t.div }]} />}
                  <View style={styles.countRow}>
                    <Text style={[styles.countLabel, { color: t.tp }]}>{row.label}</Text>
                    {counts
                      ? <Text style={[styles.countValue, { color: t.tp }]}>{counts[row.key].toLocaleString()}</Text>
                      : countsFailed
                        ? <Ionicons name="cloud-offline-outline" size={16} color={t.ts} accessibilityLabel="Unavailable" />
                        : <ActivityIndicator size="small" color={t.ts} />}
                  </View>
                </View>
              ))}
            </NeuCard>
            {countsFailed && !counts && (
              <Text style={[styles.note, { color: t.ts, marginTop: -14, marginBottom: 18 }]}>
                Couldn't check your account. Check your connection and try again.
              </Text>
            )}

            <Text style={[styles.note, { color: t.ts }]}>
              Avenas backs up automatically a few seconds after every change, and again when you leave the app. Favourite exercises, notification settings and unfinished workouts stay on this phone.
            </Text>

            {__DEV__ && (
              <>
                <Text style={[styles.sectionLabel, { color: t.ts, marginTop: 24 }]}>Export</Text>
                <NeuCard dark={isDark} style={styles.card}>
                  <View style={styles.exportRow} accessibilityState={{ disabled: true }}>
                    <Ionicons name="document-text-outline" size={20} color={t.icon} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.exportTitle, { color: t.tp }]}>Export Workouts</Text>
                      <Text style={[styles.exportBody, { color: t.ts }]}>Save your training history as a spreadsheet or PDF.</Text>
                    </View>
                    <View style={[styles.soonPill, { backgroundColor: neutralTint }]}>
                      <Text style={[styles.soonText, { color: t.ts }]}>SOON</Text>
                    </View>
                  </View>
                </NeuCard>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1 },
  topGradient:  { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:       { paddingHorizontal: 20 },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, height: 40 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  title:        { fontFamily: FontFamily.bold, fontSize: 18, color: TP, textAlign: "center", flex: 1 },
  // Same section label as Settings.
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginLeft: 4 },
  card:         { borderRadius: 18, marginBottom: 24 },
  statusInner:  { padding: 18, gap: 18 },
  statusRow:    { flexDirection: "row", alignItems: "center", gap: 14 },
  statusBadge:  { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  statusTitle:  { fontFamily: FontFamily.bold, fontSize: 16 },
  statusBody:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, marginTop: 2 },
  primaryBtn:   { ...pill(), gap: 8, ...pillGlow(ACCT) },
  primaryText:  { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  disabled:     { opacity: 0.6 },
  divider:      { height: 1, marginHorizontal: 16 },
  countRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, minHeight: 50 },
  countLabel:   { fontFamily: FontFamily.semibold, fontSize: 15 },
  countValue:   { fontFamily: FontFamily.bold, fontSize: 15 },
  note:         { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, paddingHorizontal: 6 },
  exportRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 16 },
  exportTitle:  { fontFamily: FontFamily.semibold, fontSize: 15 },
  exportBody:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18, marginTop: 2 },
  soonPill:     { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  soonText:     { fontFamily: FontFamily.bold, fontSize: 11, letterSpacing: 0.8 },
  emptyInner:   { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
