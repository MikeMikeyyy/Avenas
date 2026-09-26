// Trainer review screen for a SentProgram (gym user → trainer).
// Shows the trainer's working copy and "Send Back"s it. Edits made in the
// builder are a draft until then (migration 0034): Send Back, and Send Update
// after it, are what hand the client that version with an Accept on it.

import { useCallback, useEffect, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Path } from "react-native-svg";

import BounceButton from "../../../components/BounceButton";
import OfflineBanner from "../../../components/OfflineBanner";
import { alertOffline, useOffline } from "../../../contexts/ConnectivityContext";
import ProgramHeaderCard from "../../../components/ProgramHeaderCard";
import ProgramSnapshotView from "../../../components/ProgramSnapshotView";
import ProgramActionFabs from "../../../components/ProgramActionFabs";
import ProgramSummarySheet from "../../../components/ProgramSummarySheet";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../../constants/theme";
import { PILL_RADIUS } from "../../../constants/buttons";
import { useTheme } from "../../../contexts/ThemeContext";
import { loadGroupReviewPrograms, loadSentPrograms, returnReview, type SentProgram } from "../../../utils/trainerStore";
import { alertMessage } from "../../../utils/errors";
import BackButton, { BACK_TOP, BACK_SIZE } from "../../../components/BackButton";

// Matches the floating dismiss button used in workout.tsx / log-workout.tsx /
// new-program.tsx — single canonical SVG kept local to each screen.
function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4"/>
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

export default function ReviewScreen() {
  const { id, groupId } = useLocalSearchParams<{ id: string; groupId?: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const offline = useOffline();

  const [entry, setEntry] = useState<SentProgram | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      // A GROUP review is a single row addressed to the group's owner, so a
      // trainer who isn't that owner would never find it in their own inbox.
      // The group page passes groupId, which routes the lookup through the
      // group's queue instead — where every coach of the group can see it.
      const list = groupId ? await loadGroupReviewPrograms(groupId) : await loadSentPrograms();
      if (cancelled) return;
      const found = list.find(s => s.id === id) ?? null;
      setEntry(found);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [id, groupId]));

  /** Send Back and Send Update are the same step (returnReview): the client
   *  gets this version and an Accept for it. Only the prompt differs. */
  const confirmReturn = useCallback((title: string, message: string) => {
    if (!entry) return;
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: title,
        onPress: async () => {
          try {
            await returnReview(entry.id);
          } catch (e) {
            Alert.alert("Couldn't send it", alertMessage(e, "Check your connection and try again."));
            return;
          }
          router.back();
        },
      },
    ]);
  }, [entry, router]);

  const handleSendBack = useCallback(() => {
    confirmReturn("Send Back", "Are you sure all changes have been made?");
  }, [confirmReturn]);

  const handleSendUpdate = useCallback(() => {
    if (!entry) return;
    confirmReturn(
      "Send Update",
      `Send the latest edits to the ${entry.groupId ? "member" : "client"}? They'll get a tick to accept the new version into their programs.`,
    );
  }, [entry, confirmReturn]);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  }

  if (!entry) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Text style={{ fontFamily: FontFamily.semibold, fontSize: 16, color: t.tp }}>Review not found</Text>
        <BounceButton style={{ marginTop: 16 }} onPress={() => router.back()}>
          <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: ACCT }}>
            <Text style={{ color: "#fff", fontFamily: FontFamily.bold }}>Back</Text>
          </View>
        </BounceButton>
      </View>
    );
  }

  const snap = entry.programSnapshot;
  const isReturned = entry.status === "returned";
  // Who it goes back to. A group review came from a member of the group, who
  // may be nobody's client — "Send Back to Client" was wrong for them.
  const who = entry.groupId ? "member" : "client";
  const Who = entry.groupId ? "Member" : "Client";
  // Trainer made edits in the program builder AFTER the last Send Back —
  // surface a "Send Update to Client" CTA so they can push the new version.
  // A cloud review knows exactly (it has a draft); a local one compares times.
  const hasUnsentEdits = isReturned && (entry.unsentEdits ?? (
    !!entry.lastEditedAtISO &&
    (!entry.returnedAtISO || entry.lastEditedAtISO > entry.returnedAtISO)
  ));
  // Where the version they were sent stands: still theirs to accept, or taken.
  const returnedLine = entry.appliedAtISO
    ? `Sent back. The ${who} has accepted your changes.`
    : `Sent back. Waiting for the ${who} to accept it.`;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <BackButton />

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

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + BACK_TOP, paddingBottom: insets.bottom + 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.titleRow}>
            <View style={{ width: 66 }} />
            <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>REVIEW PROGRAM</Text>
            <View style={{ width: 66 }} />
          </View>
          <OfflineBanner />
          <ProgramHeaderCard name={snap?.name ?? entry.programName} snapshot={snap} isDark={isDark} />

          {/* Send Back sits UNDER THE TITLE, where you land, not at the foot of
              the page. It used to follow the whole program, and once this
              screen started showing every day in full — sets, reps, weights —
              it ended up a long scroll down, below the floating Builder and
              Summary pills, and read as missing. The decision is "is this ready
              to go back?", and that button belongs next to the name of the
              thing you're deciding about. */}
          {!isReturned ? (
            <BounceButton style={{ marginTop: 14 }} onPress={handleSendBack} needsConnection accessibilityLabel={`Send back to the ${who}`}>
              <View style={[styles.sendBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                <Text style={styles.sendBtnText}>{`Send Back to ${Who}`}</Text>
              </View>
            </BounceButton>
          ) : hasUnsentEdits ? (
            <>
              <View style={[styles.returnedBanner, { backgroundColor: `${ACCT}1a` }]}>
                <Ionicons name="checkmark-circle" size={18} color={ACCT} />
                <Text style={[styles.returnedText, { color: ACCT }]}>{returnedLine}</Text>
              </View>
              <BounceButton style={{ marginTop: 12 }} onPress={handleSendUpdate} needsConnection accessibilityLabel={`Send your latest edits to the ${who}`}>
                <View style={[styles.sendBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                  <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                  <Text style={styles.sendBtnText}>{`Send Update to ${Who}`}</Text>
                </View>
              </BounceButton>
            </>
          ) : (
            <View style={[styles.returnedBanner, { backgroundColor: `${ACCT}1a` }]}>
              <Ionicons name="checkmark-circle" size={18} color={ACCT} />
              <Text style={[styles.returnedText, { color: ACCT }]}>{returnedLine}</Text>
            </View>
          )}

          {/* The program itself, in the same detail as viewing a program that
              was sent: a trainer deciding whether this needs changing is being
              asked about the sets, reps, weights and rest, so those have to be
              on the screen where the decision is made. */}
          {snap && (
            <View style={{ marginTop: 18 }}>
              <ProgramSnapshotView snapshot={snap} isDark={isDark} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Builder + Summary. The builder carries the groupId: a group review is
          addressed to the group's owner and can't be found in a coach's own
          inbox, so without it the builder opens blank and saves into nothing.
          Both hide while the keyboard is up, like every other floating control
          in the app. */}
      {snap && kbHeight === 0 && (
        <ProgramActionFabs
          bottom={insets.bottom + 24}
          isDark={isDark}
          // The builder saves this review to the server as you go, so with no
          // signal it says why rather than opening onto edits it can't keep.
          onOpenBuilder={offline ? alertOffline : () => router.navigate({
            pathname: "/new-program",
            params: groupId ? { reviewId: entry.id, groupId } : { reviewId: entry.id },
          })}
          onOpenSummary={() => setSummaryOpen(true)}
        />
      )}

      {summaryOpen && snap && (
        <ProgramSummarySheet
          visible
          snapshot={snap}
          isDark={isDark}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {kbHeight > 0 && Platform.OS === "ios" && (
        <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, zIndex: 999 }}>
          <TouchableOpacity
            onPress={() => Keyboard.dismiss()}
            activeOpacity={0.75}
            style={[styles.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}
            accessibilityLabel="Dismiss keyboard"
            accessibilityRole="button"
          >
            <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topGradient:    { position: "absolute", left: 0, right: 0, zIndex: 5 },
  iconBtn:        { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  titleRow:       { flexDirection: "row", alignItems: "center", height: BACK_SIZE, marginBottom: 24 },
  screenTitle:    { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1 },
  // The name card is components/ProgramHeaderCard.tsx, and the cycle strip and
  // the day-by-day breakdown are components/ProgramSnapshotView.tsx; each owns
  // its styles, shared with /program-view.
  // Opening the builder moved out of this card and onto the floating pair at
  // the bottom (components/ProgramActionFabs.tsx), beside Summary.
  sendBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: PILL_RADIUS, paddingVertical: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  sendBtnText:    { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  returnedBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, padding: 14, borderRadius: 14 },
  returnedText:   { fontFamily: FontFamily.semibold, fontSize: 13 },
  kbFloatBtn:     { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
});
