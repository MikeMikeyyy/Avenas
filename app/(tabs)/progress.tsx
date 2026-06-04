import { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import ProgressView from "../../components/progress/ProgressView";
import { getJSON } from "../../utils/storage";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  type CompletedWorkout,
  type SavedProgram,
} from "../../constants/programs";
import { CUSTOM_KEY, type CustomExercise } from "../../constants/exercises";

export default function ProgressScreen() {
  const [history, setHistory] = useState<CompletedWorkout[]>([]);
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [customExercises, setCustomExercises] = useState<CustomExercise[]>([]);
  const [loaded, setLoaded] = useState(false);

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
    />
  );
}
