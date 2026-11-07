// utils/reviewAccept.ts
//
// Taking a trainer's changes to a program I sent for review (user request,
// 2026-11-06: accepting put them over the program I'd sent, my active one,
// with no say in it). Accept asks: into the program I sent, its run and
// history kept, or saved as a new program, leaving mine as it was
// (utils/trainerStore.ts applyReturnedProgram). With the program I sent gone,
// there's nothing to choose between: it's made again from the changes without
// asking, as it always was, standing in for the one I sent, so the next accept
// of this review updates it rather than adding another. Every place that
// offers Accept on a review sent back asks through here (a gym user's Programs
// page, a trainer's, a group's, and See Changes), so none of them can take the
// changes differently.
//
// One sent back with no changes (the trainer only reviewed it, maybe with
// comments: user request, 2026-11-06) has Got it in Accept's place, which
// leaves every program alone (acknowledgeReview). takeReturnedReview is what
// all those buttons do, either way.

import { Alert } from "react-native";
import type { SavedProgram } from "../constants/programs";
import {
  acknowledgeReview,
  applyReturnedProgram,
  returnedUpdateTarget,
  type SentProgram,
  type TakeChanges,
} from "./trainerStore";

/** How the changes are taken, and the program an update goes into (null when
 *  the program I sent is gone, and the update makes it again). */
export type ChangesChoice = { how: TakeChanges; into: SavedProgram | null };

/** Ask how to take the changes in `entry`; null on Cancel. */
export async function askHowToTakeChanges(entry: SentProgram): Promise<ChangesChoice | null> {
  const into = await returnedUpdateTarget(entry);
  if (!into) return { how: "update", into: null };
  // The worry when it's the one being run: its days change from today.
  const active = into.status === "active" ? ", your active program," : "";
  return new Promise(resolve => {
    Alert.alert(
      "Accept Changes",
      `Put the changes into "${into.name}"${active} or save them as a new program and leave "${into.name}" as it is?`,
      [
        { text: "Update My Program", onPress: () => resolve({ how: "update", into }) },
        { text: "Save as New Program", onPress: () => resolve({ how: "new", into }) },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/** What taking a review sent back did: what to say (nothing for Got it: the
 *  card moving on says it), and whether my programs changed (to back up). */
export type TakenReview = { words: { title: string; body: string } | null; programsChanged: boolean };

/**
 * Accept, or Got it, on a review sent back, from wherever it's pressed: the
 * trainer's changes go where I say (askHowToTakeChanges, applyReturnedProgram);
 * one with no changes is only marked seen. Null when I cancel. THROWS when it
 * couldn't be done (takeFailedTitle heads the alert), a ReviewChangedError when
 * Got it met changes sent meanwhile, which the page should load and show.
 */
export async function takeReturnedReview(entry: SentProgram): Promise<TakenReview | null> {
  if (entry.noChanges) {
    await acknowledgeReview(entry.id);
    return { words: null, programsChanged: false };
  }
  const choice = await askHowToTakeChanges(entry);
  if (!choice) return null;
  await applyReturnedProgram(entry.id, choice.how);
  return { words: changesTakenWords(entry, choice), programsChanged: true };
}

/** The alert's title when takeReturnedReview couldn't. */
export const takeFailedTitle = (entry: SentProgram) => (entry.noChanges ? "Couldn't mark it seen" : "Couldn't accept the changes");

/** What to say once they're taken. */
export function changesTakenWords(entry: SentProgram, choice: ChangesChoice): { title: string; body: string } {
  if (!choice.into) {
    return { title: "Program Added", body: `"${entry.programName}" was added to your programs.` };
  }
  if (choice.how === "update") {
    return { title: "Program Updated", body: `"${entry.programName}" in your programs was updated with the trainer's changes.` };
  }
  return {
    title: "Saved as a New Program",
    body: `"${entry.programName}" is in your programs as a new program, ready to start. "${choice.into.name}" is as it was.`,
  };
}
