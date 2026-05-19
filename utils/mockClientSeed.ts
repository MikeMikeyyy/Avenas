// Seeds 3 mock clients with plausible workout history + programs + journal.
// Runs once, guarded by PT_SEEDED_KEY, so flipping role on/off won't re-seed.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CLIENTS_KEY,
  PT_SEEDED_KEY,
  clientDataKey,
  makeInitials,
  type Client,
  type ClientData,
} from "./trainerStore";
import type { CompletedExercise, CompletedSet, CompletedWorkout, SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import { setJSON } from "./storage";
import { toYMD } from "./dates";

const MOCK_NAMES = ["Alex Carter", "Priya Shah", "Jordan Reyes"];
const MOCK_NOTES = ["Hypertrophy block, 8 weeks", "Cutting phase, mobility focus", "Powerbuilding, deadlift weakpoint"];

const WORKOUT_TEMPLATES: { name: string; exercises: { name: string; baseWeight: number; reps: number; sets: number }[] }[] = [
  {
    name: "Push",
    exercises: [
      { name: "Bench Press",       baseWeight: 80, reps: 8,  sets: 4 },
      { name: "Overhead Press",    baseWeight: 45, reps: 10, sets: 3 },
      { name: "Incline DB Press",  baseWeight: 25, reps: 10, sets: 3 },
      { name: "Tricep Pushdown",   baseWeight: 30, reps: 12, sets: 3 },
    ],
  },
  {
    name: "Pull",
    exercises: [
      { name: "Deadlift",          baseWeight: 130, reps: 5,  sets: 3 },
      { name: "Barbell Row",       baseWeight: 70,  reps: 8,  sets: 4 },
      { name: "Lat Pulldown",      baseWeight: 55,  reps: 10, sets: 3 },
      { name: "Bicep Curl",        baseWeight: 14,  reps: 12, sets: 3 },
    ],
  },
  {
    name: "Legs",
    exercises: [
      { name: "Back Squat",        baseWeight: 100, reps: 6,  sets: 4 },
      { name: "Romanian Deadlift", baseWeight: 85,  reps: 8,  sets: 3 },
      { name: "Leg Press",         baseWeight: 150, reps: 10, sets: 3 },
      { name: "Calf Raise",        baseWeight: 40,  reps: 15, sets: 3 },
    ],
  },
];

function buildSets(working: number, weight: number, reps: number): CompletedSet[] {
  const warm: CompletedSet[] = [
    { type: "warmup",  weight: String(Math.round(weight * 0.5)), reps: "8", done: true },
    { type: "warmup",  weight: String(Math.round(weight * 0.75)), reps: "5", done: true },
  ];
  const work: CompletedSet[] = Array.from({ length: working }, () => ({
    type: "working",
    weight: String(weight),
    reps: String(reps),
    done: true,
  }));
  return [...warm, ...work];
}

function buildWorkout(template: typeof WORKOUT_TEMPLATES[number], clientId: string, daysAgo: number, idx: number, progress: number): CompletedWorkout {
  const completedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  completedAt.setHours(17, 30, 0, 0);
  const exercises: CompletedExercise[] = template.exercises.map(ex => ({
    name: ex.name,
    notes: "",
    sets: buildSets(ex.sets, ex.baseWeight + Math.round(progress * 5), ex.reps),
  }));
  return {
    id: `mock_w_${clientId}_${daysAgo}_${idx}`,
    date: toYMD(completedAt),
    completedAt: completedAt.toISOString(),
    workoutName: template.name,
    durationSeconds: 55 * 60 + Math.floor(Math.random() * 15 * 60),
    exercises,
    sessionNotes: "",
  };
}

function buildProgram(clientId: string): SavedProgram {
  const start = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const startDate = `${String(start.getDate()).padStart(2, "0")} ${months[start.getMonth()]} ${start.getFullYear()}`;

  const cyclePattern = ["Push", "Pull", "Legs", "Rest", "Push", "Pull", "Rest"];
  const workouts: Record<string, any> = {};
  WORKOUT_TEMPLATES.forEach((tpl, i) => {
    const dayIdx = cyclePattern.indexOf(tpl.name);
    if (dayIdx < 0) return;
    workouts[`${dayIdx}:${tpl.name}`] = tpl.exercises.map((ex, j) => ({
      id: `mock_ex_${clientId}_${i}_${j}`,
      name: ex.name,
      sets: Array.from({ length: ex.sets }, () => ({ type: "working", reps: String(ex.reps), weightKg: String(ex.baseWeight) })),
    }));
  });

  return {
    id: `mock_prog_${clientId}`,
    name: "PPL Hypertrophy",
    totalWeeks: 8,
    currentWeek: 5,
    status: "active",
    startDate,
    trainingDays: 5,
    cycleDays: 7,
    cyclePattern,
    workouts,
  };
}

function buildJournal(clientId: string): JournalEntry[] {
  const now = Date.now();
  return [
    { id: `mock_j_${clientId}_1`, title: "Felt strong today", body: "Bench moved well, hit a clean 80kg x 8.", createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() },
    { id: `mock_j_${clientId}_2`, title: "Sleep was rough",   body: "Energy low — kept volume but dropped intensity 10%.", createdAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString() },
    { id: `mock_j_${clientId}_3`, title: "Deload week recap", body: "Felt fresh coming back, ready to push next block.", createdAt: new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString() },
  ];
}

function buildHistory(clientId: string): CompletedWorkout[] {
  const sequence = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25, 28, 30, 32];
  const out: CompletedWorkout[] = [];
  sequence.forEach((daysAgo, i) => {
    const tpl = WORKOUT_TEMPLATES[i % WORKOUT_TEMPLATES.length];
    const progress = i / sequence.length;
    out.push(buildWorkout(tpl, clientId, daysAgo, i, progress));
  });
  return out;
}

export async function seedMockClientsIfNeeded(): Promise<Client[]> {
  const seeded = await AsyncStorage.getItem(PT_SEEDED_KEY);
  if (seeded === "1") {
    const raw = await AsyncStorage.getItem(CLIENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  const clients: Client[] = MOCK_NAMES.map((name, i) => {
    const id = `mock_client_${i + 1}`;
    return {
      id,
      name,
      initials: makeInitials(name),
      note: MOCK_NOTES[i],
      lastActiveISO: new Date(Date.now() - (i * 24 + 5) * 60 * 60 * 1000).toISOString(),
      streak: 3 + i * 2,
    };
  });

  await setJSON(CLIENTS_KEY, clients);
  for (const c of clients) {
    const data: ClientData = {
      workoutHistory: buildHistory(c.id),
      programs: [buildProgram(c.id)],
      journal: buildJournal(c.id),
    };
    await setJSON(clientDataKey(c.id), data);
  }
  await AsyncStorage.setItem(PT_SEEDED_KEY, "1");
  return clients;
}
