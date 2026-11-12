import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { useAccountType } from "../../contexts/AccountTypeContext";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { APP_DARK, APP_LIGHT } from "../../constants/theme";
import { acceptCommunityTerms } from "../../utils/agreements";
import { useCommunityTermsAccepted } from "../../hooks/useCommunityTerms";
import { hubKindFor, hydrateTrainerHub } from "../../utils/trainerHub";
import PTHome from "../../components/trainer/PTHome";
import MyPTHome from "../../components/trainer/MyPTHome";
import CommunityGuidelinesGate from "../../components/trainer/CommunityGuidelinesGate";
import { tabScreen } from "../../components/TabScreen";

export default tabScreen(TrainerHubScreen);

function TrainerHubScreen() {
  const { accountType } = useAccountType();
  const { userId } = useAuth();
  const owner = userId ?? "";
  const kind = hubKindFor(accountType);
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // This account's agreement to the community guidelines (1.2), on this phone:
  // the hub is behind it, as every screen with other people in it is
  // (components/CommunityGate.tsx). Agreeing on one of those opens this too.
  const accepted = useCommunityTermsAccepted(owner);

  // The page's saved copy (utils/pageSnapshot.ts), read before the hub mounts,
  // so its first frame is the whole page rather than an empty one that fills
  // in as the network answers. A no-op once the startup prefetch has read it.
  const [hydrated, setHydrated] = useState<string | null>(null);
  const hubKey = `${kind}|${owner}`;
  useEffect(() => {
    let cancelled = false;
    void hydrateTrainerHub(kind, owner).then(() => { if (!cancelled) setHydrated(hubKey); });
    return () => { cancelled = true; };
  }, [kind, owner, hubKey]);

  const onAccept = useCallback(() => { void acceptCommunityTerms(owner); }, [owner]);

  // Hold on a plain background until we know — avoids flashing the hub then the gate.
  if (accepted === null || hydrated !== hubKey) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!accepted) return <CommunityGuidelinesGate onAccept={onAccept} />;

  // Keyed by account: a hub's state belongs to the account it was loaded for,
  // so a different account starts over from its own saved copy instead of
  // inheriting (and re-saving) the last one's.
  return accountType === "pt" ? <PTHome key={owner} /> : <MyPTHome key={owner} />;
}
