import { useState, useCallback, useMemo } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import ProgressView from "../../components/progress/ProgressView";
import { tabScreen } from "../../components/TabScreen";
import { getJSON } from "../../utils/storage";
import { allProgressRequest } from "../../utils/progressSession";
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
  // Exercise History's "See All Progress" opens this tab on one exercise
  // across every program (utils/progressSession.ts).
  const { allProgress, allProgressId, allProgressAt } = useLocalSearchParams<{ allProgress?: string; allProgressId?: string; allProgressAt?: string }>();
  const show = useMemo(
    () => allProgressRequest({ allProgress, allProgressId, allProgressAt }),
    [allProgress, allProgressId, allProgressAt],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [h, p, c] = await Promise.all([
          getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
          getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
          getJSON<CustomExercise[]>(CUSTOM_KEY, []),
        ]);
        if (cancelled) return;
        setHistory(Array.isArray(h) ? h : []);
        setPrograms(Array.isArray(p) ? p : []);
        setCustomExercises(Array.isArray(c) ? c : []);
        setLoaded(true);
      })();
      return () => { cancelled = true; };
    }, []),
  );

  return (
    <ProgressView
      history={history}
      programs={programs}
      customExercises={customExercises}
      loaded={loaded}
      show={show}
    />
  );
}
