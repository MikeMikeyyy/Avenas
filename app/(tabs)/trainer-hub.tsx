import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";

import { useAccountType } from "../../contexts/AccountTypeContext";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { APP_DARK, APP_LIGHT } from "../../constants/theme";
import { hasAcceptedCommunityTerms, acceptCommunityTerms } from "../../utils/moderation";
import { hubKindFor, hydrateTrainerHub } from "../../utils/trainerHub";
import PTHome from "../../components/trainer/PTHome";
import MyPTHome from "../../components/trainer/MyPTHome";
import CommunityGuidelinesGate from "../../components/trainer/CommunityGuidelinesGate";

export default function TrainerHubScreen() {
  const { accountType } = useAccountType();
  const { userId } = useAuth();
  const owner = userId ?? "";
  const kind = hubKindFor(accountType);
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // null = still checking; gates the hub behind the community agreement (1.2).
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // The page's saved copy (utils/pageSnapshot.ts) is read alongside the
        // terms, so the hub mounts already holding it: its first frame is the
        // whole page rather than an empty one that fills in as the network
        // answers. A no-op once the startup prefetch has read it.
        const [ok] = await Promise.all([hasAcceptedCommunityTerms(), hydrateTrainerHub(kind, owner)]);
        if (!cancelled) setAccepted(ok);
      })();
      return () => { cancelled = true; };
    }, [kind, owner]),
  );

  const onAccept = useCallback(async () => {
    await acceptCommunityTerms();
    setAccepted(true);
  }, []);

  // Hold on a plain background until we know — avoids flashing the hub then the gate.
  if (accepted === null) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!accepted) return <CommunityGuidelinesGate onAccept={onAccept} />;

  // Keyed by account: a hub's state belongs to the account it was loaded for,
  // so a different account starts over from its own saved copy instead of
  // inheriting (and re-saving) the last one's.
  return accountType === "pt" ? <PTHome key={owner} /> : <MyPTHome key={owner} />;
}
