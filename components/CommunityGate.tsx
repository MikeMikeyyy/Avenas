// components/CommunityGate.tsx
//
// The community guidelines, in front of every screen with other people in it
// (user request, 2026-11-12: "make sure they have to agree and can't bypass
// it"). The root Stack lays out every screen through this (its screenLayout,
// app/_layout.tsx), so a screen reached any way at all, a link inside the app,
// a QR code's link, a notification, meets the agreement first.
//
// A screen that shows other people (utils/communityRoutes.ts) isn't mounted
// until this account has agreed on this phone, so nothing on it runs before
// then: a QR code's connection request isn't sent, a chat isn't read, nothing
// is asked of the server. Agreeing opens it where it was, with what it was
// opened with, and every other screen waiting with it (the pages a
// notification opened under it, the Trainer tab) opens too.

import { useCallback, type ReactElement } from "react";
import { View } from "react-native";

import CommunityGuidelinesGate from "./trainer/CommunityGuidelinesGate";
import { APP_DARK, APP_LIGHT } from "../constants/theme";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useCommunityTermsAccepted } from "../hooks/useCommunityTerms";
import { needsCommunityAgreement } from "../utils/communityRoutes";
import { acceptCommunityTerms } from "../utils/agreements";

export default function CommunityGate({ route, children }: {
  /** The screen's route in the root Stack: its name and what it was opened with. */
  route: { name: string; params?: object };
  /** The screen itself. */
  children: ReactElement;
}): ReactElement {
  const { userId } = useAuth();
  const owner = userId ?? "";
  const { isDark } = useTheme();
  const needed = needsCommunityAgreement(route.name, route.params as Readonly<Record<string, unknown>> | undefined);
  const accepted = useCommunityTermsAccepted(owner, needed);
  const onAccept = useCallback(() => { void acceptCommunityTerms(owner); }, [owner]);

  if (!needed || accepted === true) return children;
  // This account's answer is still being read off the phone: a moment, on the
  // page's own colour.
  if (accepted === null) return <View style={{ flex: 1, backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg }} />;
  return <CommunityGuidelinesGate pushed onAccept={onAccept} />;
}
