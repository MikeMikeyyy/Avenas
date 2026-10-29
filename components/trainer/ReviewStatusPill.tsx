// components/trainer/ReviewStatusPill.tsx
//
// Where a review stands, as the status pill on its card and on its one-line
// summary row: the trainer hub's Programs Received, and a group page's
// Programs Received and Sent to Trainer. One component so they can't disagree.
//
//   Awaiting review  orange: still waiting on a trainer.
//   Returned         green tint: sent back, waiting on the person who asked.
//   Accepted         solid green with a tick: they took the changes. Nothing
//                    is left to do, which is what makes Remove the next step.
//   Not reviewed     red tint, to the person who asked only: a trainer removed
//                    it (archived or deleted) without sending it back (user
//                    request, 2026-10-29: it read "Awaiting review" for good).
//
// "Returned" used to be the last state, so a review read the same whether the
// person had accepted the changes or never looked, and a trainer couldn't tell
// when it was safe to clear it.

import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ACCT, AWAITING_ORANGE, DANGER, dangerTextColor } from "../../constants/theme";
import { CARD_PILL, CARD_PILL_TEXT } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";
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

/** The second sentence of a trainer's "Remove Program" prompt: what removing
 *  it leaves the person who asked with. Shared by the trainer hub and the group
 *  page, since a coach can remove the same review from either. Archive and
 *  Delete alike: either way it reads "Not reviewed" to them (a restore takes
 *  it back to waiting). */
export function removeReviewNote(r: SentProgram): string {
  switch (reviewStage(r)) {
    case "awaiting": return "You haven't sent it back yet, so they'll see it wasn't reviewed.";
    case "returned": return "They keep what you sent back and can still accept it.";
    case "accepted": return "They've already accepted your changes.";
    // Only the person who asked ever reads this stage; no trainer's list holds it.
    case "removed": return "They can already see it wasn't reviewed.";
  }
}

export default function ReviewStatusPill({ review }: { review: SentProgram }) {
  const { isDark } = useTheme();
  const stage = reviewStage(review);
  const removed = stage === "removed";
  const tint = stage === "awaiting" ? AWAITING_ORANGE : removed ? DANGER : ACCT;
  const solid = stage === "accepted";
  // Not reviewed is the one they have to notice: red words, the ink a light
  // card can carry.
  const ink = solid ? "#fff" : removed ? dangerTextColor(isDark) : tint;
  return (
    <View style={[styles.pill, { backgroundColor: solid ? tint : `${tint}22` }]}>
      {solid && <Ionicons name="checkmark" size={12} color="#fff" />}
      <Text style={[styles.text, { color: ink }]}>{REVIEW_STAGE_LABEL[stage]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // CARD_PILL's fixed height, so a tick can't make this pill taller than the
  // title beside it (constants/cards.ts).
  pill: { ...CARD_PILL, flexDirection: "row", alignItems: "center", gap: 3 },
  text: { ...CARD_PILL_TEXT },
});
