// useState for one of the Progress page's selections, remembered for the rest
// of the app's run (utils/progressSession.ts): it starts from what the page
// last had and writes every change back, so coming back to the page after it
// unmounted picks up where it was left.
//
// The key is read once, on mount. ProgressView remounts its body per key, so
// one component never switches whose selections it's writing.

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  getProgressSelections,
  setProgressSelection,
  type ProgressSelections,
} from "../utils/progressSession";

export function useProgressSelection<K extends keyof ProgressSelections>(
  sessionKey: string,
  field: K,
): [ProgressSelections[K], Dispatch<SetStateAction<ProgressSelections[K]>>] {
  const [value, setValue] = useState<ProgressSelections[K]>(
    () => getProgressSelections(sessionKey)[field],
  );
  useEffect(() => {
    setProgressSelection(sessionKey, field, value);
  }, [sessionKey, field, value]);
  return [value, setValue];
}
