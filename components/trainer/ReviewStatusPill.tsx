// components/trainer/ReviewStatusPill.tsx
//
// Where a review stands, as the status pill on its card and on its one-line
// summary row: the trainer hub's Programs Received, and a group page's
// Programs Received and Sent to Trainer. One component so they can't disagree.
//
//   Awaiting review  orange: still waiting on a trainer.
//   Returned         quiet grey: sent back, waiting on the person who asked,
//                    as a program sent and not yet taken reads Pending.
//   Accepted         faded green: they took the changes. Nothing is left to
//                    do, which is what makes Remove the next step. "Seen" for
//                    one sent back with no changes (only reviewed, maybe with
//                    comments: user request, 2026-11-06), which they took with
//                    Got it, there being nothing to accept.
//   Not reviewed     red tint, to the person who asked only: a trainer removed
//                    it without sending it back (user request, 2026-10-29: it
//                    read "Awaiting review" for good).
//
// "Returned" used to be the last state, so a review read the same whether the
// person had accepted the changes or never looked, and a trainer couldn't tell
// when it was safe to clear it. Accepted was then solid green with a tick,
// which read as a button (user request, 2026-11-06: as every program accepted
// reads instead), so it's the faded green of the Programs pages' StatusPill,
// and Returned went grey to stay apart from it.

import { StyleSheet, Text, View } from "react-native";

import { StatusPill } from "./ProgramRow";
import { AWAITING_ORANGE } from "../../constants/theme";
import { CARD_PILL, CARD_PILL_TEXT } from "../../constants/cards";
import type { SentProgram } from "../../utils/trainerStore";
import { reviewStage, type ReviewStage } from "../../utils/trainerLists";

// Where a review stands is a list rule too (the Programs card counts the ones
// awaiting), so it lives in utils/trainerLists.ts; re-exported for the pill's
// callers.
export { reviewStage, type ReviewStage };

export const REVIEW_STAGE_LABEL: Record<ReviewStage, string> = {
  awaiting: "Awaiting review",
  returned: "Returned",
  accepted: "Accepted",
  removed: "Not reviewed",
};

/** The pill's words for where a review stands (and its row's spoken label). */
export function reviewStatusLabel(r: SentProgram): string {
  const stage = reviewStage(r);
  return stage === "accepted" && r.noChanges ? "Seen" : REVIEW_STAGE_LABEL[stage];
}

/** The second sentence of a trainer's "Remove Program" sheet: what removing
 *  it leaves the person who asked with. One sheet on the trainer hub and the
 *  group page, since a coach can remove the same review from either. */
export function removeReviewNote(r: SentProgram): string {
  switch (reviewStage(r)) {
    case "awaiting": return "You haven't sent it back yet, so they'll see it wasn't reviewed.";
    case "returned": return r.noChanges ? "They keep what you sent back." : "They keep what you sent back and can still accept it.";
    case "accepted": return r.noChanges ? "They've already seen what you sent back." : "They've already accepted your changes.";
    // Only the person who asked ever reads this stage; no trainer's list holds it.
    case "removed": return "They can already see it wasn't reviewed.";
  }
}

export default function ReviewStatusPill({ review }: { review: SentProgram }) {
  const stage = reviewStage(review);
  const label = reviewStatusLabel(review);
  // As a program sent reads on the Programs pages (StatusPill): accepted a
  // faded green, waiting on them grey, Not reviewed red, the one they have to
  // notice.
  if (stage === "accepted") return <StatusPill label={label} done />;
  if (stage === "returned") return <StatusPill label={label} done={false} />;
  if (stage === "removed") return <StatusPill label={label} done={false} alert />;
  // Still waiting on a trainer: the orange of the work to do.
  return (
    <View style={[styles.pill, { backgroundColor: `${AWAITING_ORANGE}22` }]}>
      <Text style={[styles.text, { color: AWAITING_ORANGE }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // CARD_PILL's fixed height, as every status pill on a card (constants/cards.ts).
  pill: { ...CARD_PILL },
  text: { ...CARD_PILL_TEXT },
});
