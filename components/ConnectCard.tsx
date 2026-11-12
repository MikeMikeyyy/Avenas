// components/ConnectCard.tsx
//
// Home's Connect card (user request and picks, 2026-11-12: "something on the
// main page to connect to users rather than having to click through stuff to
// find it"; a card with a button under the quick actions, picked over a fourth
// quick-action bubble and a slim row, with an X that hides it). For an account
// connected with nobody, gym user or trainer: what connecting is for, and a
// green button that opens the Connect page. What it says is
// utils/connectPrompt.ts; whether there's anyone is the copy on the phone
// (utils/connectionSummary.ts), so Home never waits on the server for it.
//
// The community guidelines come first: the Connect page waits for this
// account to agree to them, as every screen with other people in it does
// (components/CommunityGate.tsx), so agreeing there carries straight on to it.
//
// The X hides it for this account on this phone, for good: connecting is
// always on the Trainer tab.

import { useCallback, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import UnreadBadge from "./UnreadBadge";
import UserRoundPlusIcon from "./icons/UserRoundPlusIcon";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, ON_FILL } from "../constants/theme";
import { pill, pillGlow, PILL_H_SM } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../contexts/AuthContext";
import { useAccountType } from "../contexts/AccountTypeContext";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { connectPrompt } from "../utils/connectPrompt";
import {
  hideConnectCard,
  hydrateConnectionSummary,
  isConnectCardHidden,
  peekConnectionSummary,
  refreshConnectionSummary,
} from "../utils/connectionSummary";

export default function ConnectCard() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();
  const { userId } = useAuth();
  const owner = userId ?? "";
  const { accountType, loaded: accountTypeLoaded } = useAccountType();
  const summary = useConnectionSummary(owner);
  // Null until read off the device, so a card that was hidden never flashes up.
  const [hidden, setHidden] = useState<boolean | null>(null);

  // Each visit to Home: what the phone knows, then the server's answer behind
  // it while the card could show (nothing known yet, or still nobody).
  useFocusEffect(useCallback(() => {
    if (!owner) return;
    let cancelled = false;
    void (async () => {
      const [isHidden] = await Promise.all([isConnectCardHidden(owner), hydrateConnectionSummary(owner)]);
      if (cancelled) return;
      setHidden(isHidden);
      const known = peekConnectionSummary(owner);
      if (!isHidden && (!known || known.connected === 0)) void refreshConnectionSummary(owner);
    })();
    return () => { cancelled = true; };
  }, [owner]));

  const onConnect = useCallback(() => { router.navigate("/connect"); }, [router]);

  const onHide = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHidden(true);
    void hideConnectCard(owner);
  }, [owner]);

  // Nothing until the account type is in, so a trainer never sees a gym
  // user's words first.
  if (!owner || !accountTypeLoaded || hidden !== false || !summary) return null;
  const prompt = connectPrompt(accountType, summary);
  if (!prompt) return null;

  return (
    <NeuCard dark={isDark} radius={20} style={styles.card}>
      <View style={styles.inner}>
        <View style={styles.top}>
          <View style={[styles.icon, { backgroundColor: isDark ? `${ACCT}1F` : `${ACCT}2E` }]}>
            <UserRoundPlusIcon size={22} color={ACCT} />
          </View>
          <View style={styles.words}>
            <Text style={[styles.title, { color: t.tp }]}>{prompt.title}</Text>
            <Text style={[styles.body, { color: t.ts }]}>{prompt.body}</Text>
          </View>
          <TouchableOpacity
            onPress={onHide}
            hitSlop={12}
            style={styles.hide}
            accessibilityRole="button"
            accessibilityLabel="Hide this card"
          >
            <Ionicons name="close" size={18} color={t.ts} />
          </TouchableOpacity>
        </View>
        {/* Connecting is the server's, so offline it dims and says so. */}
        <BounceButton
          onPress={onConnect}
          needsConnection
          accessibilityRole="button"
          accessibilityLabel={prompt.waiting > 0 ? `${prompt.button}, ${prompt.waiting} waiting` : prompt.button}
        >
          <View>
            <View style={[styles.button, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }]}>
              <Text style={[styles.buttonText, { color: ON_FILL }]}>{prompt.button}</Text>
            </View>
            {/* Requests waiting on me, the count the Trainer tab's connect
                button wears. */}
            <UnreadBadge count={prompt.waiting} style={styles.badge} />
          </View>
        </BounceButton>
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  // The quick actions' gap below it too, so the calendar keeps its distance
  // from whatever's above it.
  card: { marginBottom: 28 },
  inner: { padding: 20, gap: 16 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  words: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 21 },
  body: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 19 },
  // In the corner: the glyph's own box tucked into the card's padding.
  hide: { marginTop: -2, marginRight: -4 },
  button: { ...pill(PILL_H_SM), paddingHorizontal: 24 },
  buttonText: { fontFamily: FontFamily.bold, fontSize: 15 },
  badge: { position: "absolute", top: -5, right: -3 },
});
