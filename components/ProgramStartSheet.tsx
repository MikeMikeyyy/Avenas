// When a program made active starts, as a sheet of its own
// (components/ProgramStartStep.tsx in a SimpleSheet): the builder's Set as
// Active, where there's no actions sheet for it to be a step of (user request,
// 2026-11-16, utils/programStart.ts). The pick runs once the sheet has slid
// away, so a prompt after it (Replace your active program?) comes up over the
// page.

import { useCallback, useRef } from "react";

import SimpleSheet from "./trainer/SimpleSheet";
import ProgramStartStep from "./ProgramStartStep";
import type { CompletedWorkout } from "../constants/programs";
import { todayYMD } from "../utils/dates";

export default function ProgramStartSheet({ visible, programName, history, onPick, onClose }: {
  visible: boolean;
  programName: string;
  history: readonly Pick<CompletedWorkout, "date">[];
  onPick: (ymd: string) => void;
  onClose: () => void;
}) {
  const picked = useRef<string | null>(null);
  const handleClose = useCallback(() => {
    const ymd = picked.current;
    picked.current = null;
    onClose();
    if (ymd) onPick(ymd);
  }, [onClose, onPick]);

  return (
    <SimpleSheet visible={visible} onClose={handleClose}>
      {close => (
        <ProgramStartStep
          programName={programName}
          today={todayYMD()}
          history={history}
          onPick={ymd => { picked.current = ymd; close(); }}
          onCancel={close}
        />
      )}
    </SimpleSheet>
  );
}
