// utils/reviewRequest.ts
//
// Asking for a review of one of my programs: of one of my trainers, or of a
// group's trainers. One request, made the same way from every place that asks
// (the Trainer tab's Send for Review, a group's Send a Program for Review, My
// Programs' Send for Review), and the same words once it's gone. The sheets
// used to build the request each their own way, and My Programs' left out
// which trainer it went to (`recipientId`), so Sent for Review couldn't say.
//
// Who My Programs offers is utils/trainerLists.ts reviewTargets. Taking a
// review off a list is utils/reviewRemoval.ts.

import type { SavedProgram } from "../constants/programs";
import type { Group } from "../constants/groups";
import { appendSentProgram, type AssignedPT, type SentProgram } from "./trainerStore";

/** Who a review is asked of. */
export type ReviewTo =
  /** One of my trainers, straight to them. */
  | { kind: "trainer"; trainer: AssignedPT }
  /** A group's trainers: one request to the group, whichever of them picks it
   *  up, addressed to its owner. */
  | { kind: "group"; group: Pick<Group, "id" | "name" | "ownerId"> };

/**
 * Ask for a review of `program`. Returns the request as sent: its id is a
 * local placeholder until the cloud row it became is read back. Throws when it
 * didn't go (offline, or the server refused it), for the caller to say so.
 */
export async function requestReview(program: SavedProgram, to: ReviewTo): Promise<SentProgram> {
  const entry: SentProgram = {
    id: `sent_${Date.now()}`,
    programId: program.id,
    programName: program.name,
    sentAtISO: new Date().toISOString(),
    status: "sent",
    programSnapshot: program,
    // A 1:1 request says which trainer has it; a group's is the group's to
    // review rather than its owner's, though the owner is who it's addressed to.
    ...(to.kind === "trainer" ? { recipientId: to.trainer.id } : { groupId: to.group.id }),
  };
  // Real trainers (uuid id) receive through the cloud; a mock one stays local.
  await appendSentProgram(entry, to.kind === "trainer" ? to.trainer.id : to.group.ownerId);
  return entry;
}

/** What to say once a request has gone. */
export function reviewSentWords(program: SavedProgram, to: ReviewTo): { title: string; body: string } {
  return to.kind === "trainer"
    ? { title: "Sent for Review", body: `"${program.name}" was sent to ${to.trainer.name} for review.` }
    : {
        title: "Sent for Review",
        body: `"${program.name}" was sent to the trainers in ${to.group.name}. It's under Sent for Review on the group's Programs page.`,
      };
}
