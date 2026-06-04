import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";

import { useAccountType } from "../../contexts/AccountTypeContext";
import { useTheme } from "../../contexts/ThemeContext";
import { APP_DARK, APP_LIGHT } from "../../constants/theme";
import { hasAcceptedCommunityTerms, acceptCommunityTerms } from "../../utils/moderation";
import PTHome from "../../components/trainer/PTHome";
import MyPTHome from "../../components/trainer/MyPTHome";
import CommunityGuidelinesGate from "../../components/trainer/CommunityGuidelinesGate";

export default function TrainerHubScreen() {
  const { accountType } = useAccountType();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // null = still checking; gates the hub behind the community agreement (1.2).
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const ok = await hasAcceptedCommunityTerms();
        if (!cancelled) setAccepted(ok);
      })();
      return () => { cancelled = true; };
    }, []),
  );

  const onAccept = useCallback(async () => {
    await acceptCommunityTerms();
    setAccepted(true);
  }, []);

  // Hold on a plain background until we know — avoids flashing the hub then the gate.
  if (accepted === null) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!accepted) return <CommunityGuidelinesGate onAccept={onAccept} />;

  return accountType === "pt" ? <PTHome /> : <MyPTHome />;
}
