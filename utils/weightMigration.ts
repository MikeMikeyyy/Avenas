// utils/weightMigration.ts
//
// One-shot lb → kg migration. Before the kg-canonical unit feature, every weight
// was stored as the bare number the user typed in whatever unit they had
// selected, with NO unit tag. For users who were in lb mode those stored numbers
// are lb values mislabeled as kg. This rewrites them to canonical kg, ONCE, so
// the new display lens (utils/units.ts) renders them correctly — an lb user's
// numbers look identical before and after.
//
// Gated on the saved unit pref: only "lbs" users have lb-numbers to convert. kg
// users (including the default) are already canonical, so we just set the flag.
//
// Safety: the converted history + programs + the done-flag are written together
// via a single AsyncStorage.multiSet (batched), so a crash can't leave one key
// converted and the flag unset → no double-conversion on the next launch.
//
// Scope: the two persistent canonical stores (history, programs). The live
// workout_draft holds DISPLAY-unit values the user typed and is left as-is (the
// new live log is display units too). A program being built in @avenas/new_program_draft
// at the instant of upgrade is the one rare untouched case (noted, not handled).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { PROGRAMS_KEY, WORKOUT_HISTORY_KEY, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import { migrateWeightLbToKg } from "./units";

const UNIT_KEY = "@avenas/unit";
export const WEIGHT_KG_MIGRATION_KEY = "@avenas/weight_kg_migration_done";

/** Convert every stored set weight in completed history from lb to kg. Pure. */
export function migrateHistoryWeights(history: CompletedWorkout[]): CompletedWorkout[] {
  return history.map((w) => ({
    ...w,
    exercises: w.exercises.map((ex) => ({
      ...ex,
      sets: ex.sets.map((s) => ({ ...s, weight: migrateWeightLbToKg(s.weight) })),
    })),
  }));
}

/** Convert every program's prescribed weightKg from lb to kg. Pure. */
export function migrateProgramWeights(programs: SavedProgram[]): SavedProgram[] {
  return programs.map((p) => ({
    ...p,
    workouts: Object.fromEntries(
      Object.entries(p.workouts).map(([key, exs]) => [
        key,
        exs.map((ex) => ({
          ...ex,
          sets: ex.sets
            ? ex.sets.map((st) =>
                st.weightKg != null ? { ...st, weightKg: migrateWeightLbToKg(st.weightKg) } : st,
              )
            : ex.sets,
        })),
      ]),
    ),
  }));
}

/**
 * Run the migration once. No-op after the first successful run (flag set), and
 * for kg users (nothing to convert — flag set immediately). Safe to await at
 * startup before any screen reads weight data.
 */
export async function runWeightUnitMigrationIfNeeded(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(WEIGHT_KG_MIGRATION_KEY);
    if (done === "1") return;

    const unit = await AsyncStorage.getItem(UNIT_KEY);
    if (unit !== "lbs") {
      // kg / default — already canonical. Just record that we've handled it.
      await AsyncStorage.setItem(WEIGHT_KG_MIGRATION_KEY, "1");
      return;
    }

    const [histRaw, progRaw] = await Promise.all([
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY),
      AsyncStorage.getItem(PROGRAMS_KEY),
    ]);

    const pairs: [string, string][] = [];
    if (histRaw) {
      const history: CompletedWorkout[] = JSON.parse(histRaw);
      pairs.push([WORKOUT_HISTORY_KEY, JSON.stringify(migrateHistoryWeights(history))]);
    }
    if (progRaw) {
      const programs: SavedProgram[] = JSON.parse(progRaw);
      pairs.push([PROGRAMS_KEY, JSON.stringify(migrateProgramWeights(programs))]);
    }
    pairs.push([WEIGHT_KG_MIGRATION_KEY, "1"]);

    // Single batched write: converted data + flag commit together.
    await AsyncStorage.multiSet(pairs);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] weight unit migration", e);
  }
}
