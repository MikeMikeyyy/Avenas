import { useState, useCallback, useMemo } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import ProgressView from "../../components/progress/ProgressView";
import { tabScreen } from "../../components/TabScreen";
import { getJSON } from "../../utils/storage";
import { useSyncedDataReload } from "../../hooks/useSyncedDataReload";
import { allProgressRequest, programProgressRequest } from "../../utils/progressSession";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  type CompletedWorkout,
  type SavedProgram,
} from "../../constants/programs";
import { CUSTOM_KEY, type CustomExercise } from "../../constants/exercises";

export default tabScreen(ProgressScreen);

function ProgressScreen() {
  const [history, setHistory] = useState<CompletedWorkout[]>([]);
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [loaded, setLoaded] = useState(false);
  // When the read behind what's held began (Date.now()).
  const [readAt, setReadAt] = useState(0);
  // Exercise History's "See All Progress" opens this tab on one exercise
  // across every program, and a My Programs card's View Progress on one
  // program (utils/progressSession.ts).
  const { allProgress, allProgressId, allProgressAt, programProgress, programProgressAt } = useLocalSearchParams<{
    allProgress?: string; allProgressId?: string; allProgressAt?: string; programProgress?: string; programProgressAt?: string;
  }>();
  const show = useMemo(
    () => allProgressRequest({ allProgress, allProgressId, allProgressAt }),
    [allProgress, allProgressId, allProgressAt],
  );
  const programAsked = useMemo(
    () => programProgressRequest({ programProgress, programProgressAt }),
    [programProgress, programProgressAt],
  );
  // Only once what's held was read after the tap: the tab keeps the last
  // visit's programs until this focus's read lands, and a program made active
  // on My Programs just before would still read as not running there.
  const showProgram = programAsked && readAt >= Number(programAsked.at) ? programAsked : null;

  const load = useCallback(async (isCancelled: () => boolean) => {
    const began = Date.now();
    const [h, p, c] = await Promise.all([
      getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
      getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
      getJSON<CustomExercise[]>(CUSTOM_KEY, []),
    ]);
    if (isCancelled()) return;
    setHistory(Array.isArray(h) ? h : []);
    setPrograms(Array.isArray(p) ? p : []);
    setCustomExercises(Array.isArray(c) ? c : []);
    setReadAt(began);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load(() => cancelled);
      return () => { cancelled = true; };
    }, [load]),
  );
  // And when the account's other phone's sessions merge in while it's up.
  useSyncedDataReload(() => { void load(() => false); });

  return (
    <ProgressView
      history={history}
      programs={programs}
      customExercises={customExercises}
      loaded={loaded}
      show={show}
      showProgram={showProgram}
    />
  );
}
