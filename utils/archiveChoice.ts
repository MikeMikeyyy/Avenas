// utils/archiveChoice.ts
//
// What a Remove on a program opens, everywhere a program can be archived (My
// Programs, and a trainer's cards on the Trainer tab, a group page and the
// program view): Archive, which takes it off the list until it's restored from
// that page's archive, or Delete, which is for good. One prompt so the choice
// reads, and is ordered, the same on every page. The wording of `body` is the
// caller's (utils/removeShare.ts builds it for sends), because what each
// choice reaches differs by page.
//
// Clients never get this: a program sent TO you keeps its plain Remove, a hide
// on your own device.

import { Alert } from "react-native";

export function askArchiveOrDelete({ title, body, onArchive, onDelete }: {
  title: string;
  body: string;
  onArchive: () => void;
  onDelete: () => void;
}): void {
  Alert.alert(title, body, [
    { text: "Archive", onPress: onArchive },
    { text: "Delete", style: "destructive", onPress: onDelete },
    { text: "Cancel", style: "cancel" },
  ]);
}

/** Delete from an archive: the one step left, so it asks once more. */
export function confirmDeleteArchived({ name, note, onDelete }: {
  name: string;
  /** What deleting leaves other people with, or that it can't be undone. */
  note: string;
  onDelete: () => void;
}): void {
  Alert.alert("Delete Program", `Delete "${name}" for good? ${note}`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onDelete },
  ]);
}
