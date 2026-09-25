// utils/removeShare.ts
//
// The confirm a trainer sees when taking back a program they sent.
//
// It's the same decision on four screens (the hub's "Programs You've Sent", a
// group's "Programs Sent", one client's page, and the program view), so the
// wording lives here rather than being re-typed with slightly different stakes
// in each place.
//
// Two shapes, decided by whether anyone still hasn't accepted:
//
//   everyone accepted → an ordinary confirm. Their copies are already theirs
//                       and stay put, so there's nothing to lose.
//   someone pending   → a WARNING, and the way out is labelled "Keep" rather
//                       than "Cancel". Removing now takes the program away from
//                       people who never got the chance to accept it, and that
//                       is the thing the tap is actually about.
//
// Pure string building: no RN imports, so it can be checked by a script.

export type RemoveSharePrompt = {
  title: string;
  body: string;
  /** The way out. "Keep" when there's something to lose by removing. */
  cancel: string;
  confirm: string;
};

export function removeShareConfirm({ programName, recipients, total, accepted }: {
  programName: string;
  /** Who it went to, already worded for the sentence: "5 clients", "Sarah",
   *  "this group". */
  recipients: string;
  /** How many people it was sent to. */
  total: number;
  /** How many of them have accepted. */
  accepted: number;
}): RemoveSharePrompt {
  const pending = Math.max(0, total - accepted);

  if (pending === 0) {
    return {
      title: "Remove Program",
      body: total === 1
        ? `Remove "${programName}" from ${recipients}? They've already accepted it, so their copy stays in their library.`
        : `Remove "${programName}" from ${recipients}? They've all accepted it, so their copies stay in their libraries.`,
      cancel: "Cancel",
      confirm: "Remove",
    };
  }

  // Who hasn't accepted, in the fewest words that stay true for one person, for
  // everyone, and for the partial case. The verb has to agree with `pending`,
  // not with `total`: "1 of 5 hasn't accepted", "3 of 5 haven't".
  const who = pending === total
    ? (total === 1 ? "They haven't accepted" : "Nobody has accepted")
    : `${pending} of ${total} ${pending === 1 ? "hasn't" : "haven't"} accepted`;
  const kept = accepted === 0
    ? ""
    : accepted === 1
      ? " The one who did keeps their copy."
      : ` The ${accepted} who did keep their copies.`;

  return {
    title: total === 1 ? "They haven't accepted yet" : "Not everyone has accepted",
    body: `${who} "${programName}" yet. Removing it now takes it back before they've had the chance.${kept}`,
    cancel: "Keep",
    confirm: "Remove",
  };
}

/**
 * The same decision where Remove also offers Archive (utils/archiveChoice.ts):
 * the hub's Programs Sent, a group's Group Programs, and the program view. The
 * one-client page keeps the plain confirm above, because it removes one
 * person's copy and an archive holds whole sends.
 *
 * Both choices take the program away from anyone who hasn't accepted it
 * (Archive until it's restored), so the pending warning stays in the title, and
 * accepted copies are untouched by either, which the body says once.
 */
export function archiveShareChoice({ programName, recipients, total, accepted }: {
  programName: string;
  /** Who it went to, already worded for the sentence: "5 clients", "this
   *  group", "them". */
  recipients: string;
  total: number;
  accepted: number;
}): { title: string; body: string } {
  const pending = Math.max(0, total - accepted);
  const choice = `Archive "${programName}" to take it off your list and hide it from ${recipients} until you restore it, or delete it for good.`;

  if (pending === 0) {
    return {
      title: "Remove Program",
      body: total === 1
        ? `${choice} They've accepted it, so their copy stays in their library either way.`
        : `${choice} They've all accepted it, so their copies stay in their libraries either way.`,
    };
  }

  const who = pending === total
    ? (total === 1 ? "They haven't accepted it" : "Nobody has accepted it")
    : `${pending} of ${total} ${pending === 1 ? "hasn't" : "haven't"} accepted it`;
  const kept = accepted === 0
    ? ""
    : accepted === 1
      ? " The one who did keeps their copy either way."
      : ` The ${accepted} who did keep their copies either way.`;
  return {
    title: total === 1 ? "They haven't accepted yet" : "Not everyone has accepted",
    body: `${choice} ${who} yet.${kept}`,
  };
}
