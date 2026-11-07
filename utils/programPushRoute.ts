// utils/programPushRoute.ts
//
// Where a tapped program notification takes you: the program it's about (user
// request, 2026-11-06: "the exact notification to take you where it should
// take you"). Every program notification links to the Trainer tab, and since
// migration 0056 says which program besides (ProgramPush), so it opens that
// program over the page that lists it, with the tab under that, so Back goes
// where you'd expect. utils/notificationRoute.ts asks it first.
//
// Pure (type imports only), so scripts/verify-notification-routes.ts runs it.

import type { Href } from "expo-router";
import type { AccountType } from "../contexts/AccountTypeContext";

/** Where the database sends every program notification. */
export const PROGRAMS_PUSH_URL = "/trainer-hub";

/** What a program notification says it's about (migration 0056), beside its
 *  link: the shared_programs row, whether it's a program or a review, whether
 *  it was sent to you or (a review you asked for) sent back, and the group it
 *  went through. */
export type ProgramPush = {
  share: string;
  kind: "share" | "review";
  event: "sent" | "returned";
  group: string | null;
};

/** The ProgramPush in a notification's data, or null for any other (or one
 *  sent before 0056). */
export function programPushOf(data: unknown): ProgramPush | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.url !== PROGRAMS_PUSH_URL || typeof d.share !== "string" || !d.share) return null;
  if (d.kind !== "share" && d.kind !== "review") return null;
  if (d.event !== "sent" && d.event !== "returned") return null;
  return { share: d.share, kind: d.kind, event: d.event, group: typeof d.group === "string" && d.group ? d.group : null };
}

/**
 * The screens a program notification opens: the Trainer tab, the page that
 * lists the program, then the program itself, each over the one before.
 *
 * The page: the group's Programs page (over the group's page) for anything
 * that went through a group; otherwise a trainer's Programs page, where all
 * of theirs are, or a gym user's Programs page for a program sent to them and
 * Sent for Review for one of their reviews sent back.
 *
 * The program, opened as that page opens it: a program sent to you, where you
 * Accept it (program-view by `sharedId`); a review asked of you, the review
 * screen; a review of yours sent back, its changes and comments with Accept or
 * Got it (program-view by `sentId`). Anything through a group carries the
 * group (`groupId`): the review screen and one's own request of a group are
 * found through the group's reviews.
 */
export function programSteps(push: ProgramPush, accountType: AccountType): Href[] {
  const trainer = accountType === "pt";
  const page: Href[] = push.group
    ? [
        { pathname: "/trainer/group/[id]", params: { id: push.group } },
        { pathname: "/trainer/group/[id]/programs", params: { id: push.group } },
      ]
    : [trainer ? "/trainer/programs" : push.event === "returned" ? "/trainer/sent-reviews" : "/trainer/received"];
  const item: Href = push.event === "returned"
    ? { pathname: "/program-view", params: push.group ? { sentId: push.share, groupId: push.group } : { sentId: push.share } }
    : push.kind === "review"
      ? { pathname: "/trainer/review/[id]", params: push.group ? { id: push.share, groupId: push.group } : { id: push.share } }
      : { pathname: "/program-view", params: { sharedId: push.share } };
  return [PROGRAMS_PUSH_URL, ...page, item];
}
