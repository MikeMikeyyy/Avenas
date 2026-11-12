// utils/communityRoutes.ts
//
// Which screens show other people (their names and photos, messages, programs
// they sent, a client's training), and so wait for the community guidelines
// (components/CommunityGate.tsx; user request, 2026-11-12: "make sure they have
// to agree and can't bypass it"). The gate stands in front of every screen in
// the root Stack (its screenLayout, app/_layout.tsx), so this decides for every
// way in: a link inside the app, a QR code's link, a notification.
//
// Three kinds of screen:
//   - nothing but other people: Connect, My Trainers, everything under
//     trainer/, and any screen added there later;
//   - mine, unless it's opened on someone else's (a client's session, a
//     program a trainer sent): the params that make it someone else's;
//   - mine alone (OWN_SCREENS).
// A screen that's in none of them waits too: one added without being placed
// can't show other people to someone who hasn't agreed. Every screen in app/
// is in one of the three, which scripts/verify-community-gate.ts checks, so a
// new one is placed before the checks pass.
//
// The Trainer tab isn't here: it's a tab, not a screen in the root Stack, and
// asks for the guidelines itself (app/(tabs)/trainer-hub.tsx).
//
// Pure, so the verify script runs it.

type Params = Readonly<Record<string, unknown>> | undefined;

const given = (v: unknown): boolean =>
  (typeof v === "string" && v.length > 0) || (Array.isArray(v) && v.length > 0);

/** Screens that are nothing but other people. */
export const COMMUNITY_SCREENS: readonly string[] = ["connect", "my-trainers"];

/** Every screen under these folders is too, including any added later. */
export const COMMUNITY_FOLDERS: readonly string[] = ["trainer/"];

/** Screens that are mine unless these params open them on someone else's. */
export const COMMUNITY_WHEN: Readonly<Record<string, (p: Readonly<Record<string, unknown>>) => boolean>> = {
  // A program sent to me or by me (sharedId), a review I asked for (sentId),
  // one through a group, a client's.
  "program-view": p => given(p.sharedId) || given(p.sentId) || given(p.groupId) || given(p.clientId),
  // A trainer reading a client's training, from the client's page.
  "workout-detail": p => given(p.clientId),
  "exercise-history": p => given(p.clientId),
  "exercise-summary": p => given(p.clientId),
  "program-history": p => given(p.clientId),
  "program-history-detail": p => given(p.clientId),
  // What a trainer sent and archived, a group's archive.
  "program-archive": p => p.scope === "trainer" || p.scope === "group",
  // Changing a program sent for review, or one someone sent.
  "new-program": p => given(p.reviewId) || given(p.sharedId) || given(p.groupId),
};

/** Screens with nobody else in them, whatever they're opened with. Blocked
 *  Accounts lists people, but blocking is a safety tool and stays reachable,
 *  as do the guidelines themselves. `_sitemap` and `+not-found` are the
 *  router's own. */
export const OWN_SCREENS: readonly string[] = [
  "(tabs)",
  "index",
  "_sitemap",
  "+not-found",
  "accept-terms",
  "account-created",
  "blocked-accounts",
  "cloud-test",
  "community-guidelines",
  "complete-profile",
  "create-custom-exercise",
  "data-sync",
  "forgot-password",
  "help-faq",
  "import-export",
  "import-review",
  "insights",
  "journal",
  "log-workout",
  "login",
  "notifications",
  "onboarding",
  "privacy-policy",
  "privacy-security",
  "profile",
  "programs",
  "report-bug",
  "request-feature",
  "settings",
  "signup",
  "streak",
  "terms-of-service",
];

/** Whether a screen, opened with these params, needs the guidelines agreed
 *  first. `name` is the route's name in the root Stack, its file's path under
 *  app/ ("trainer/chat/[id]", "trainer/group/[id]/index", "program-view"). */
export function needsCommunityAgreement(name: string, params: Params): boolean {
  const when = COMMUNITY_WHEN[name];
  if (when) return when(params ?? {});
  return !OWN_SCREENS.includes(name);
}

/** Which kind a screen is, for the verify script: null when it's in none. */
export function screenKind(name: string): "community" | "when" | "own" | null {
  if (COMMUNITY_SCREENS.includes(name) || COMMUNITY_FOLDERS.some(folder => name.startsWith(folder))) return "community";
  if (name in COMMUNITY_WHEN) return "when";
  if (OWN_SCREENS.includes(name)) return "own";
  return null;
}
