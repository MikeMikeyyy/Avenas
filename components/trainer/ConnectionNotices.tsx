// Notes at the top of the Trainer tab, left by the server when someone I'm
// connected with switched account type (migration 0041, lib/connectionRoles.ts).
// Each says what changed and offers what makes sense for it:
//
//   my trainer is now a gym user, trainer only → Keep as client / Remove
//   ...and still my client                    → OK / Remove connection
//   ...and we've been disconnected            → OK
//   my client is now a trainer                → Also my trainer / OK
//   someone is now a trainer (in My Trainers)  → OK / Remove connection
//
// Every button needs the server (it re-files, disconnects, or puts the note
// away there), so each dims offline. The hub owns the list: `onResolved` takes
// a note off it at once, `onChanged` reloads the lists a choice moved someone
// between.

import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import { ACCT, APP_DARK, APP_LIGHT, DANGER_BRIGHT, FontFamily } from "../../constants/theme";
import { pill, PILL_H_XS, PILL_SHADOW } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import type { AccountType } from "../../contexts/AccountTypeContext";
import {
  dismissConnectionNotice,
  setConnectionRole,
  type ConnectionNotice,
} from "../../lib/connectionRoles";
import { unaddContact } from "../../utils/moderation";
import { alertMessage } from "../../utils/errors";

type Action = "dismiss" | "keepClient" | "alsoTrainer" | "remove";
type Button = { action: Action; label: string; tone: "primary" | "plain" | "danger" };

function copyFor(n: ConnectionNotice): { title: string; body: string; buttons: Button[] } {
  const withdrawn = n.withdrawnReviews === 0 ? ""
    : n.withdrawnReviews === 1 ? " The program you'd asked them to review was withdrawn."
    : ` The ${n.withdrawnReviews} programs you'd asked them to review were withdrawn.`;
  switch (n.kind) {
    case "ex_trainer_choose":
      return {
        title: `${n.name} is no longer a trainer`,
        body: `They switched to a gym account, so they've left My Trainers. Keep them as one of your clients, or remove the connection.${withdrawn}`,
        buttons: [
          { action: "keepClient", label: "Keep as client", tone: "primary" },
          { action: "remove", label: "Remove", tone: "danger" },
        ],
      };
    case "ex_trainer_client":
      return {
        title: `${n.name} is no longer a trainer`,
        body: `They switched to a gym account, so they've left My Trainers. They're still one of your clients.${withdrawn}`,
        buttons: [
          { action: "dismiss", label: "OK", tone: "plain" },
          { action: "remove", label: "Remove", tone: "danger" },
        ],
      };
    case "ex_trainer_gone":
      return {
        title: `${n.name} is no longer a trainer`,
        body: `They switched to a gym account, so you're no longer connected.${withdrawn}`,
        buttons: [{ action: "dismiss", label: "OK", tone: "plain" }],
      };
    case "new_trainer_client":
      return {
        title: `${n.name} is now a trainer`,
        body: "They switched to a trainer account and are still one of your clients. Add them to My Trainers too if they coach you.",
        buttons: [
          { action: "alsoTrainer", label: "Also my trainer", tone: "primary" },
          { action: "dismiss", label: "OK", tone: "plain" },
        ],
      };
    case "new_trainer":
      return {
        title: `${n.name} is now a trainer`,
        body: "They switched to a trainer account, so they're now in My Trainers.",
        buttons: [
          { action: "dismiss", label: "OK", tone: "plain" },
          { action: "remove", label: "Remove", tone: "danger" },
        ],
      };
  }
}

function NoticeCard({ notice, accountType, onResolved, onChanged }: {
  notice: ConnectionNotice;
  accountType: AccountType;
  onResolved: (id: string) => void;
  onChanged: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [busy, setBusy] = useState(false);
  const { title, body, buttons } = copyFor(notice);

  const run = async (action: Action) => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "keepClient") await setConnectionRole(notice.otherId, "client");
      if (action === "alsoTrainer") await setConnectionRole(notice.otherId, "both");
      if (action === "remove") {
        const { severed } = await unaddContact(notice.otherId, accountType);
        if (!severed) throw new Error("Couldn't reach the server. Check your connection and try again.");
      }
      await dismissConnectionNotice(notice.id);
      onResolved(notice.id);
      if (action !== "dismiss") onChanged();
    } catch (e) {
      Alert.alert("Couldn't do that", alertMessage(e, "Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = () => {
    Alert.alert(
      `Remove ${notice.name}?`,
      "This removes your connection. Programs already shared stay in each library.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void run("remove") },
      ],
    );
  };

  return (
    <NeuCard dark={isDark} radius={16} style={styles.card}>
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <Ionicons name="swap-horizontal" size={16} color={ACCT} />
          <Text style={[styles.title, { color: t.tp }]} numberOfLines={2}>{title}</Text>
        </View>
        <Text style={[styles.body, { color: t.ts }]}>{body}</Text>
        <View style={styles.buttons}>
          {buttons.map(b => (
            <BounceButton
              key={b.action}
              style={{ flex: 1 }}
              onPress={() => (b.action === "remove" ? confirmRemove() : void run(b.action))}
              needsConnection
              accessibilityRole="button"
              accessibilityLabel={b.label}
            >
              <View
                style={[
                  styles.btn,
                  b.tone === "primary"
                    ? { backgroundColor: ACCT, shadowColor: ACCT, shadowOpacity: 0.35 }
                    : { backgroundColor: t.ctrl },
                  busy && styles.busy,
                ]}
              >
                <Text
                  style={[
                    styles.btnText,
                    { color: b.tone === "primary" ? "#fff" : b.tone === "danger" ? DANGER_BRIGHT : t.tp },
                  ]}
                  numberOfLines={1}
                >
                  {b.label}
                </Text>
              </View>
            </BounceButton>
          ))}
        </View>
      </View>
    </NeuCard>
  );
}

export default function ConnectionNotices({ notices, accountType, onResolved, onChanged }: {
  notices: ConnectionNotice[];
  accountType: AccountType;
  onResolved: (id: string) => void;
  onChanged: () => void;
}) {
  if (notices.length === 0) return null;
  return (
    <View style={styles.list}>
      {notices.map(n => (
        <NoticeCard key={n.id} notice={n} accountType={accountType} onResolved={onResolved} onChanged={onChanged} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list:     { gap: 12, marginBottom: 18 },
  card:     {},
  inner:    { padding: 16, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title:    { fontFamily: FontFamily.bold, fontSize: 15, flexShrink: 1 },
  body:     { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  buttons:  { flexDirection: "row", gap: 10, marginTop: 6 },
  btn:      { ...pill(PILL_H_XS), ...PILL_SHADOW },
  btnText:  { fontFamily: FontFamily.bold, fontSize: 14 },
  busy:     { opacity: 0.5 },
});
