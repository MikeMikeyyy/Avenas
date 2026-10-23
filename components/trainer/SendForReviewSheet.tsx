// components/trainer/SendForReviewSheet.tsx
//
// A gym user sending one of their programs to their trainer for review: pick
// it, and it goes. One sheet for the two places that send (the trainer card on
// the Trainer tab, and the Sent for Review page), so they can't send
// differently. It reads the person's own programs itself each time its screen
// comes into view, so a program made a moment ago is there to pick.

import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect } from "expo-router";

import ProgramPickerSheet from "./ProgramPickerSheet";
import { PROGRAMS_KEY, type SavedProgram } from "../../constants/programs";
import { getJSON } from "../../utils/storage";
import { appendSentProgram, loadSentPrograms, sentKeyOf, type AssignedPT, type SentProgram } from "../../utils/trainerStore";
import { alertMessage } from "../../utils/errors";

export default function SendForReviewSheet({ visible, trainer, onClose, onSent }: {
  visible: boolean;
  /** Who it goes to: the trainer on the Trainer tab. */
  trainer: AssignedPT | null;
  onClose: () => void;
  /** My sent list as it stands now the program's gone, for the page to show. */
  onSent: (sent: SentProgram[]) => void;
}) {
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void getJSON<SavedProgram[]>(PROGRAMS_KEY, []).then(progs => {
      if (!cancelled) setPrograms(Array.isArray(progs) ? progs : []);
    });
    return () => { cancelled = true; };
  }, []));

  // A second pick while the first is on its way would send it twice.
  const sending = useRef(false);

  const send = useCallback(async (program: SavedProgram) => {
    if (!trainer) {
      Alert.alert("No trainer", "Connect a trainer before sending a program.");
      return;
    }
    if (sending.current) return;
    sending.current = true;
    const entry: SentProgram = {
      id: `sent_${Date.now()}`,
      programId: program.id,
      programName: program.name,
      sentAtISO: new Date().toISOString(),
      status: "sent",
      programSnapshot: program,
      recipientId: trainer.id,
    };
    try {
      // Real trainers (uuid id) receive through the cloud; mock stays local.
      await appendSentProgram(entry, trainer.id);
    } catch (e) {
      Alert.alert("Couldn't send program", alertMessage(e, "Check your connection and try again."));
      return;
    } finally {
      sending.current = false;
    }
    // Re-read rather than prepend `entry`: its `sent_…` id is only a local
    // placeholder, and the cloud row it became has a uuid of its own. A row
    // holding the placeholder can't be removed, because removeSentProgram
    // treats a non-uuid id as a local entry, clears nothing in the cloud, and
    // the program came back on the next load. The prepend is kept only as a
    // fallback for a reload that fails, so a send that worked never looks lost.
    const fresh = await loadSentPrograms();
    const landed = fresh.some(s => sentKeyOf(s) === sentKeyOf(entry));
    onSent(landed ? fresh : [entry, ...fresh]);
    Alert.alert("Sent", `"${program.name}" was sent to ${trainer.name}.`);
  }, [trainer, onSent]);

  return (
    <ProgramPickerSheet
      visible={visible}
      title="Send for Review"
      subtitle={trainer ? `Pick a program to send to ${trainer.name} for review.` : "Connect a trainer first."}
      programs={programs}
      onPick={send}
      onClose={onClose}
    />
  );
}
