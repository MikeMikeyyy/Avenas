// Connect screen — the entry point for linking two real accounts.
//   • My Code: a QR + short text code other people scan/enter to connect with you.
//   • Add: scan someone's QR (expo-camera) or type their code → sends a request.
//   • Requests: incoming requests to accept/decline + your outgoing pending ones.
//
// Connecting is a request → accept handshake (lib/connections.ts → migration 0006
// RPCs). Once accepted, both sides see each other's real name + photo in the
// trainer hub. Cross-account sharing of training data/programs is a later slice.

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Share, View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";

import { useTheme } from "../contexts/ThemeContext";
import { useAccountType } from "../contexts/AccountTypeContext";
import { initialsFromName } from "../contexts/UserProfileContext";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import Avatar from "../components/Avatar";
import Scanner from "../components/connect/Scanner";
import SimpleSheet from "../components/trainer/SimpleSheet";
import ReportReasonSheet from "../components/trainer/ReportReasonSheet";
import KeyboardDismissButton from "../components/KeyboardDismissButton";
import { ACCT, APP_DARK, APP_LIGHT, DANGER, FontFamily } from "../constants/theme";
import { blockContact, reportUser, loadBlockedIds, unblockUser } from "../utils/moderation";
import type { ReportReason } from "../constants/chat";
import {
  getMyCode,
  getMyConnections,
  requestConnection,
  respondConnection,
  disconnect,
  type Connection,
  type RequestResult,
} from "../lib/connections";

/** Build the deep link encoded in the QR (also works from the system camera). */
const linkForCode = (code: string) => `avenas://connect?code=${code}`;

/** Pull a connect code out of a scanned string (a deep link or a bare code). */
function extractCode(raw: string): string {
  const s = raw.trim();
  const m = /[?&]code=([^&\s]+)/i.exec(s);
  return (m ? decodeURIComponent(m[1]) : s).toUpperCase();
}

export default function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { accountType } = useAccountType();
  const tint = isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)";
  const params = useLocalSearchParams<{ code?: string }>();

  const [myCode, setMyCode] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  // The connection whose 3-dot menu / report sheet is open (null = closed).
  const [menuFor, setMenuFor] = useState<Connection | null>(null);
  const [reportFor, setReportFor] = useState<Connection | null>(null);
  // Raw (unfiltered) connections from the last refresh — used to tell which row a
  // connect request just touched, so re-adding a blocked person can be caught.
  const rawConnections = useRef<Connection[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await getMyConnections();
      rawConnections.current = list;
      const blocked = await loadBlockedIds();
      // Hide blocked people entirely — their lingering connections and any new
      // requests they send never surface, so we can't be re-connected to them.
      setConnections(list.filter(c => !blocked.has(c.otherId)));
    } catch {
      /* leave the last good list in place */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const code = await getMyCode();
        if (!cancelled) setMyCode(code);
      } catch { /* code stays null → show a dash */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const describe = (res: RequestResult): { title: string; body: string } => {
    switch (res) {
      case "connected": return { title: "Connected", body: "You're now connected." };
      case "requested": return { title: "Request sent", body: "They'll see your request and can accept it." };
      case "already":   return { title: "Already connected", body: "You're already connected with this person." };
      case "self":      return { title: "That's your code", body: "You can't connect with yourself." };
      default:          return { title: "No match", body: "No account found for that code. Double-check it and try again." };
    }
  };

  const submitCode = useCallback(async (rawCode: string) => {
    const code = extractCode(rawCode);
    if (!code || busy) return;
    setBusy(true);
    try {
      const before = rawConnections.current;
      const res = await requestConnection(code);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Did this request just (re)connect us to someone we've blocked? Find the
      // connection it created or changed (vs the pre-request snapshot) and, if its
      // account is blocked, undo it and offer to unblock instead of silently linking.
      if (res === "requested" || res === "connected" || res === "already") {
        const after = await getMyConnections();
        rawConnections.current = after;
        const blockedIds = await loadBlockedIds();
        const beforeStatus = new Map(before.map(c => [c.connectionId, c.status]));
        const touched = after.find(c =>
          blockedIds.has(c.otherId) &&
          (!beforeStatus.has(c.connectionId) || beforeStatus.get(c.connectionId) !== c.status),
        );
        if (touched) {
          try { await disconnect(touched.connectionId); } catch { /* still blocked locally */ }
          const who = touched.name || "This person";
          Alert.alert(
            `${who} is blocked`,
            `You blocked ${who}. Unblock them to connect again.`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Unblock", onPress: async () => { await unblockUser(touched.otherId); await submitCode(code); } },
            ],
          );
          await refresh();
          return;
        }
      }

      const { title, body } = describe(res);
      Alert.alert(title, body);
      if (res === "connected" || res === "requested") setManual("");
      await refresh();
    } catch (e) {
      Alert.alert("Couldn't connect", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  // Opened via a QR deep link → confirm, then send the request (once).
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    const code = typeof params.code === "string" ? params.code : undefined;
    if (!code || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    Alert.alert("Connect", `Send a connection request to code ${extractCode(code)}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Connect", onPress: () => void submitCode(code) },
    ]);
  }, [params.code, submitCode]);

  const onScanned = (raw: string) => {
    setScannerOpen(false);
    void submitCode(raw);
  };

  const respond = async (c: Connection, accept: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await respondConnection(c.connectionId, accept);
      await refresh();
    } catch (e) {
      Alert.alert("Something went wrong", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const cancelOutgoing = (c: Connection) => {
    Alert.alert("Cancel request", `Withdraw your connection request to ${c.name || "this person"}?`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Withdraw", style: "destructive",
        onPress: async () => {
          try { await disconnect(c.connectionId); await refresh(); }
          catch (e) { Alert.alert("Something went wrong", e instanceof Error ? e.message : "Please try again."); }
        },
      },
    ]);
  };

  const onCopy = async () => {
    if (!myCode) return;
    await Clipboard.setStringAsync(myCode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Copied", "Your connect code is on the clipboard.");
  };

  const onShare = async () => {
    if (!myCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({ message: `Connect with me on Avenas — use code ${myCode} or open ${linkForCode(myCode)}` });
  };

  const removeAccepted = (c: Connection) => {
    Alert.alert("Remove Connection", `Remove ${c.name || "this person"} from your connections?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          try { await disconnect(c.connectionId); await refresh(); }
          catch (e) { Alert.alert("Something went wrong", e instanceof Error ? e.message : "Please try again."); }
        },
      },
    ]);
  };

  // Moderation menu (Report / Block / Remove) for an accepted connection — the
  // same actions as the chat thread's 3-dot menu.
  const contactOf = (c: Connection) => ({ id: c.otherId, name: c.name || "User", initials: renderInitials(c.name) });

  const onReportConn = () => {
    const c = menuFor;
    setMenuFor(null);
    if (c) setReportFor(c);
  };

  const onBlockConn = () => {
    const c = menuFor;
    setMenuFor(null);
    if (!c) return;
    const who = c.name || "this person";
    Alert.alert(
      `Block ${who}?`,
      "They'll be removed from your connections and can no longer connect with you. You can unblock them later in Settings.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Block", style: "destructive", onPress: async () => {
          const { severed } = await blockContact(contactOf(c), accountType);
          await refresh();
          if (!severed) Alert.alert(`${c.name || "This person"} is blocked`, "We couldn't reach the server to sever the connection. It will finish when you're back online.");
        } },
      ],
    );
  };

  const onRemoveConn = () => {
    const c = menuFor;
    setMenuFor(null);
    if (c) removeAccepted(c);
  };

  const submitConnReport = async (reason: ReportReason) => {
    const c = reportFor;
    setReportFor(null);
    if (!c) return;
    await reportUser({ id: c.otherId, name: c.name || "User" }, reason);
    const who = c.name || "this person";
    Alert.alert(
      "Report received",
      `Thanks, we review reports within 24 hours. Would you also like to block ${who}?`,
      [
        { text: "Not now", style: "cancel" },
        { text: "Block", style: "destructive", onPress: async () => {
          const { severed } = await blockContact(contactOf(c), accountType);
          await refresh();
          if (!severed) Alert.alert(`${who} is blocked`, "We couldn't reach the server to sever the connection. It will finish when you're back online.");
        } },
      ],
    );
  };

  const incoming = connections.filter(c => c.status === "pending" && c.direction === "incoming");
  const outgoing = connections.filter(c => c.status === "pending" && c.direction === "outgoing");
  const accepted = connections.filter(c => c.status === "accepted");

  const renderInitials = (name: string) => initialsFromName(name) || "?";

  if (scannerOpen) {
    return <Scanner onScanned={onScanned} onClose={() => setScannerOpen(false)} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={[styles.backBtn, { top: insets.top + 12, backgroundColor: isDark ? t.div : "#ffffff" }]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={t.tp} />
      </TouchableOpacity>

      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Connect</Text>
          <View style={{ width: 40 }} />
        </View>
        <Text style={[styles.subtitle, { color: t.ts }]}>
          Share your code or scan someone else's to connect. They confirm the request before you're linked.
        </Text>

        {/* My code */}
        <Text style={[styles.label, { color: t.ts }]}>YOUR CODE</Text>
        <NeuCard dark={isDark} radius={20} style={styles.card}>
          <View style={styles.codeInner}>
            <View style={styles.qrWrap}>
              {myCode
                ? <QRCode value={linkForCode(myCode)} size={168} color={isDark ? "#0b0f14" : "#0b0f14"} backgroundColor="#ffffff" />
                : <ActivityIndicator color={ACCT} />}
            </View>
            <Text style={[styles.codeText, { color: t.tp }]}>{myCode ?? "—"}</Text>
            <View style={styles.codeActions}>
              <BounceButton style={{ flex: 1 }} onPress={onCopy} accessibilityLabel="Copy code">
                <View style={[styles.smallBtn, { borderColor: t.div }]}>
                  <Ionicons name="copy-outline" size={16} color={t.tp} />
                  <Text style={[styles.smallBtnText, { color: t.tp }]}>Copy</Text>
                </View>
              </BounceButton>
              <BounceButton style={{ flex: 1 }} onPress={onShare} accessibilityLabel="Share code">
                <View style={[styles.smallBtn, { borderColor: t.div }]}>
                  <Ionicons name="share-outline" size={16} color={t.tp} />
                  <Text style={[styles.smallBtnText, { color: t.tp }]}>Share</Text>
                </View>
              </BounceButton>
            </View>
          </View>
        </NeuCard>

        {/* Add a connection */}
        <Text style={[styles.label, { color: t.ts }]}>ADD A CONNECTION</Text>
        <BounceButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setScannerOpen(true); }} accessibilityLabel="Scan a QR code">
          <View style={[styles.scanWrap, { backgroundColor: ACCT }]}>
            <Ionicons name="qr-code-outline" size={20} color="#fff" />
            <Text style={styles.scanText}>Scan QR Code</Text>
          </View>
        </BounceButton>

        <View style={styles.manualRow}>
          <NeuCard dark={isDark} radius={14} style={styles.manualField}>
            <TextInput
              style={[styles.input, { color: t.tp }]}
              placeholder="Enter a code"
              placeholderTextColor={t.ts}
              value={manual}
              onChangeText={(v) => setManual(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => void submitCode(manual)}
            />
          </NeuCard>
          <BounceButton onPress={() => void submitCode(manual)} accessibilityLabel="Send connection request">
            <View style={[styles.connectBtn, { backgroundColor: ACCT }, (busy || !manual.trim()) && styles.disabled]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.connectBtnText}>Connect</Text>}
            </View>
          </BounceButton>
        </View>

        {/* Incoming requests */}
        {incoming.length > 0 && (
          <>
            <Text style={[styles.label, { color: t.ts }]}>REQUESTS</Text>
            {incoming.map((c) => (
              <NeuCard key={c.connectionId} dark={isDark} radius={16} style={styles.reqCard}>
                <View style={styles.reqInner}>
                  <Avatar uri={c.photoUri} initials={renderInitials(c.name)} size={44} backgroundColor={tint} textColor={ACCT} textStyle={[styles.avatarText, { color: ACCT }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reqName, { color: t.tp }]} numberOfLines={1}>{c.name || "New user"}</Text>
                    <Text style={[styles.reqSub, { color: t.ts }]}>{c.accountType === "pt" ? "Trainer" : "Member"} wants to connect</Text>
                  </View>
                  <TouchableOpacity onPress={() => void respond(c, false)} style={[styles.iconBtn, { borderColor: t.div }]} accessibilityLabel={`Decline ${c.name}`}>
                    <Ionicons name="close" size={18} color={t.ts} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void respond(c, true)} style={[styles.iconBtn, { backgroundColor: ACCT, borderColor: ACCT }]} accessibilityLabel={`Accept ${c.name}`}>
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </NeuCard>
            ))}
          </>
        )}

        {/* Outgoing pending */}
        {outgoing.length > 0 && (
          <>
            <Text style={[styles.label, { color: t.ts }]}>PENDING</Text>
            {outgoing.map((c) => (
              <NeuCard key={c.connectionId} dark={isDark} radius={16} style={styles.reqCard}>
                <View style={styles.reqInner}>
                  <Avatar uri={c.photoUri} initials={renderInitials(c.name)} size={44} backgroundColor={tint} textColor={ACCT} textStyle={[styles.avatarText, { color: ACCT }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reqName, { color: t.tp }]} numberOfLines={1}>{c.name || "New user"}</Text>
                    <Text style={[styles.reqSub, { color: t.ts }]}>Request sent</Text>
                  </View>
                  <TouchableOpacity onPress={() => cancelOutgoing(c)} style={[styles.iconBtn, { borderColor: t.div }]} accessibilityLabel={`Withdraw request to ${c.name}`}>
                    <Ionicons name="close" size={18} color={t.ts} />
                  </TouchableOpacity>
                </View>
              </NeuCard>
            ))}
          </>
        )}

        {/* Connected */}
        {accepted.length > 0 && (
          <>
            <Text style={[styles.label, { color: t.ts }]}>CONNECTED</Text>
            {accepted.map((c) => (
              <NeuCard key={c.connectionId} dark={isDark} radius={16} style={styles.reqCard}>
                <View style={styles.reqInner}>
                  <Avatar uri={c.photoUri} initials={renderInitials(c.name)} size={44} backgroundColor={tint} textColor={ACCT} textStyle={[styles.avatarText, { color: ACCT }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reqName, { color: t.tp }]} numberOfLines={1}>{c.name || "User"}</Text>
                    <Text style={[styles.reqSub, { color: t.ts }]}>{c.accountType === "pt" ? "Trainer" : "Member"}</Text>
                  </View>
                  <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMenuFor(c); }} style={[styles.iconBtn, { borderColor: t.div }]} accessibilityLabel={`Options for ${c.name || "this person"}`}>
                    <Ionicons name="ellipsis-horizontal" size={18} color={t.ts} />
                  </TouchableOpacity>
                </View>
              </NeuCard>
            ))}
          </>
        )}
      </KeyboardAwareScrollView>

      <KeyboardDismissButton />

      {/* Connection options — Report / Block / Remove (mirrors the chat 3-dot menu) */}
      <SimpleSheet visible={menuFor !== null} onClose={() => setMenuFor(null)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{menuFor?.name || "User"}</Text>
        <View style={styles.menu}>
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onReportConn} accessibilityRole="button" accessibilityLabel={`Report ${menuFor?.name || "user"}`}>
            <Ionicons name="flag-outline" size={20} color={t.tp} />
            <Text style={[styles.menuText, { color: t.tp }]}>Report</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onBlockConn} accessibilityRole="button" accessibilityLabel={`Block ${menuFor?.name || "user"}`}>
            <Ionicons name="ban-outline" size={20} color={DANGER} />
            <Text style={[styles.menuText, { color: DANGER }]}>Block</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: t.div }]} />
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.8} onPress={onRemoveConn} accessibilityRole="button" accessibilityLabel={`Remove ${menuFor?.name || "user"}`}>
            <Ionicons name="person-remove-outline" size={20} color={t.tp} />
            <Text style={[styles.menuText, { color: t.tp }]}>Remove connection</Text>
          </TouchableOpacity>
        </View>
      </SimpleSheet>

      <ReportReasonSheet
        visible={reportFor !== null}
        title={`Report ${reportFor?.name || "user"}`}
        onSubmit={submitConnReport}
        onClose={() => setReportFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  backBtn:     { position: "absolute", left: 22, zIndex: 10, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scroll:      { paddingHorizontal: 24 },
  header:      { flexDirection: "row", alignItems: "center", height: 40 },
  title:       { flex: 1, fontFamily: FontFamily.bold, fontSize: 26, textAlign: "center" },
  subtitle:    { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", marginTop: 24, lineHeight: 20, paddingHorizontal: 8 },
  label:       { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4, marginTop: 24 },
  card:        { borderRadius: 20 },
  codeInner:   { alignItems: "center", paddingVertical: 22, paddingHorizontal: 18, gap: 14 },
  qrWrap:      { width: 200, height: 200, borderRadius: 16, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  codeText:    { fontFamily: FontFamily.bold, fontSize: 24, letterSpacing: 4 },
  codeActions: { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  smallBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: 12, paddingVertical: 11 },
  smallBtnText:{ fontFamily: FontFamily.semibold, fontSize: 14 },
  scanWrap:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 16, paddingVertical: 15, shadowColor: ACCT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  scanText:    { fontFamily: FontFamily.bold, fontSize: 16, color: "#fff" },
  manualRow:   { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  manualField: { flex: 1, borderRadius: 14 },
  input:       { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 14, paddingHorizontal: 16, letterSpacing: 2 },
  connectBtn:  { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 22, alignItems: "center", justifyContent: "center", minWidth: 110 },
  connectBtnText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  disabled:    { opacity: 0.4 },
  reqCard:     { borderRadius: 16, marginBottom: 10 },
  reqInner:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  avatarText:  { fontFamily: FontFamily.bold, fontSize: 16 },
  reqName:     { fontFamily: FontFamily.bold, fontSize: 16 },
  reqSub:      { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 1 },
  iconBtn:     { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  menuName:    { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu:        { paddingHorizontal: 16, paddingTop: 4 },
  menuRow:     { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 8 },
  menuDivider: { height: 1, marginHorizontal: 8 },
  menuText:    { fontFamily: FontFamily.semibold, fontSize: 16 },
});
