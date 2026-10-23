// Sending a program to a group, in either direction, from either of its pages
// (the group's page and its Programs page, app/trainer/group/[id]): one picker
// sheet, so the two can't send differently.
//
//   "send"    a coach of the group pushes one of their programs out to it: one
//             `shared_programs` row per member (everyone but me), tied to the
//             group by `groupId`, which the batch key collapses into one send.
//   "review"  a member posts one of theirs for whichever coach picks it up: one
//             request to the group rather than one per trainer, so a gym with
//             three trainers doesn't produce three reviews of one program.
//
// One sheet serving both, never two mounted, which keeps a page clear of the
// two-RN-Modals-at-once trap.

import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";

import ProgramPickerSheet from "./ProgramPickerSheet";
import { useUnit } from "../../contexts/UnitContext";
import { fetchPeopleUnits } from "../../lib/clientTraining";
import { unitLabel, unitOf } from "../../utils/units";
import { appendSentProgram, appendSharedPrograms, type SentProgram, type SharedProgram } from "../../utils/trainerStore";
import { alertMessage } from "../../utils/errors";
import type { SavedProgram } from "../../constants/programs";

export type GroupSendMode = "send" | "review";

export default function GroupSendSheet({ mode, onClose, groupId, groupName, ownerId, recipientIds, programs, onSent }: {
  /** Which way, or null while it's closed. */
  mode: GroupSendMode | null;
  onClose: () => void;
  groupId: string;
  groupName: string;
  /** The group's owner: the addressed recipient of a review request. */
  ownerId: string | undefined;
  /** Everyone a send reaches: the group's members, me left out. */
  recipientIds: string[];
  /** My programs to pick from. */
  programs: SavedProgram[];
  /** After a send or request lands: re-read the group's programs so it shows
   *  on this tick, rather than on the next visit. */
  onSent: () => Promise<void> | void;
}) {
  // How many of them log in the other unit, for the send sheet: a program's
  // weights read in the unit they were entered in, so say who'll see yours in
  // a unit they don't use. Looked up when the sheet opens (0036; unknown
  // counts as the same unit, so a missing server only drops the note).
  const { isKg } = useUnit();
  const [otherUnitCount, setOtherUnitCount] = useState(0);
  const recipientKey = recipientIds.join(",");
  useEffect(() => {
    if (mode !== "send") return;
    let cancelled = false;
    fetchPeopleUnits(recipientKey.split(",").filter(Boolean))
      .then(u => { if (!cancelled) setOtherUnitCount(Object.values(u).filter(x => x !== unitOf(isKg)).length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode, recipientKey, isKg]);

  const send = useCallback(async (program: SavedProgram) => {
    onClose();
    if (recipientIds.length === 0) {
      Alert.alert("No one to send to", "This group has no other members yet.");
      return;
    }
    const now = new Date().toISOString();
    const base = `share_${Date.now()}`;
    const entries: SharedProgram[] = recipientIds.map((cid, i) => ({
      id: `${base}_${i}`,
      clientId: cid,
      programId: program.id,
      programName: program.name,
      sentAtISO: now,
      programSnapshot: program,
      // The only thing tying these per-member rows back to the group. Without
      // it the send is indistinguishable from individual sends.
      groupId,
    }));
    try {
      await appendSharedPrograms(entries);
    } catch (e) {
      Alert.alert("Couldn't send program", alertMessage(e, "Check your connection and try again."));
      return;
    }
    await onSent();
    Alert.alert("Program Sent", `"${program.name}" was sent to ${recipientIds.length} member${recipientIds.length === 1 ? "" : "s"} of ${groupName}.`);
  }, [onClose, recipientIds, groupId, groupName, onSent]);

  const askForReview = useCallback(async (program: SavedProgram) => {
    onClose();
    if (!ownerId) {
      Alert.alert("Group unavailable", "Reopen the group and try again.");
      return;
    }
    const entry: SentProgram = {
      id: `sent_${Date.now()}`,
      programId: program.id,
      programName: program.name,
      sentAtISO: new Date().toISOString(),
      status: "sent",
      programSnapshot: program,
      // What makes this the GROUP's to review rather than the owner's, even
      // though the owner is the addressed recipient.
      groupId,
    };
    try {
      await appendSentProgram(entry, ownerId);
    } catch (e) {
      Alert.alert("Couldn't send program", alertMessage(e, "Check your connection and try again."));
      return;
    }
    await onSent();
    Alert.alert("Sent for Review", `"${program.name}" was sent to the trainers in ${groupName}. It's under Sent for Review on the group's Programs page.`);
  }, [onClose, ownerId, groupId, groupName, onSent]);

  return (
    <ProgramPickerSheet
      visible={mode !== null}
      title={mode === "review" ? "Send for Review" : `Send to ${groupName}`}
      subtitle={mode === "review"
        ? `A trainer in ${groupName} will look at it and send it back with their notes.`
        : `Everyone in this group receives it (${recipientIds.length} member${recipientIds.length === 1 ? "" : "s"}).${otherUnitCount > 0
          ? ` ${otherUnitCount === 1 ? "1 member logs" : `${otherUnitCount} members log`} in ${unitLabel(isKg ? "lb" : "kg")}, and will see your weights in the unit you entered them in.`
          : ""}`}
      programs={programs}
      onPick={mode === "review" ? askForReview : send}
      onClose={onClose}
    />
  );
}
