// utils/reviewRemoval.ts
//
// Taking a review off a list. For its trainer, removeReviewForTrainer below.
//
// For me, the person who asked, one that's come back to me, from a gym user's
// "From [trainer]" page (changes not added yet) or Sent for Review page
// (changes added). A hide on this phone, in the same dismissed list as a
// program a trainer sent me (DISMISSED_SHARES_KEY), keyed by returnedKeyOf: it
// hides THIS version, so if the trainer sends an update it's back with Accept.
// It never undoes changes I've added, and if I hadn't added them my program
// just stays as it was. The prompt says which, since that's the worry a red
// button raises.

import { Alert } from "react-native";
import {
  dismissReceivedReview,
  dismissSharedBatch,
  returnedKeyOf,
  saveReviewRemovalNote,
  setGroupReviewDone,
  type SentProgram,
} from "./trainerStore";
import { alertMessage } from "./errors";

/**
 * A review's trainer taking it off their list for good: RemoveReviewSheet's
 * Remove, on their Programs page and a group's. There's no archive for a
 * review (user decision, 2026-11-05): it's reviewed or removed. A group review
 * leaves the group's queue for every trainer of it (set_group_review_completed),
 * a 1:1 one leaves my list (dismissReceivedReview). Their message to the
 * person who asked is saved first, so it's there as "Not reviewed" reaches
 * them, and it's written even when there isn't one, so nothing written before
 * can stand in for it. It never holds the removal up: a message that couldn't
 * be saved (a server without 0053) is said once it's done. Resolves true once
 * it's removed; a failed removal is said, and false.
 */
export async function removeReviewForTrainer(entry: SentProgram, note: string | null): Promise<boolean> {
  // Once sent back there's nothing to explain, and the server refuses it.
  const noteSaved = entry.status === "returned"
    ? true
    : await saveReviewRemovalNote(entry.id, note).then(() => true, () => false);
  try {
    if (entry.groupId) await setGroupReviewDone(entry.id, true);
    else await dismissReceivedReview(entry.id);
  } catch (e) {
    Alert.alert("Couldn't remove it", alertMessage(e, "Check your connection and try again."));
    return false;
  }
  if (note && !noteSaved) {
    Alert.alert("Message not sent", "It's removed, but your message couldn't be saved, so they'll see it wasn't reviewed without a reason.");
  }
  return true;
}

export function askRemoveReturned(entry: SentProgram, onRemoved: (key: string) => void): void {
  const applied = !!entry.appliedAtISO;
  Alert.alert(
    "Remove Program",
    applied
      ? `Remove "${entry.programName}" from this list? The changes stay in your programs.`
      : `Remove "${entry.programName}" without accepting the changes? Your program stays as it was.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const key = returnedKeyOf(entry);
          await dismissSharedBatch(key);
          onRemoved(key);
        },
      },
    ],
  );
}
