// utils/reviewRemoval.ts
//
// Taking a review that's come back to me off my lists, from a gym user's
// "From [trainer]" page (changes not added yet) or Sent for Review page
// (changes added). A hide on this phone, in the same dismissed list as a
// program a trainer sent me (DISMISSED_SHARES_KEY), keyed by returnedKeyOf: it
// hides THIS version, so if the trainer sends an update it's back with Accept.
// It never undoes changes I've added, and if I hadn't added them my program
// just stays as it was. The prompt says which, since that's the worry a red
// button raises.

import { Alert } from "react-native";
import { dismissSharedBatch, returnedKeyOf, type SentProgram } from "./trainerStore";

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
