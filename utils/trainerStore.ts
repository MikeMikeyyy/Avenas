// Mock data layer for the Trainer feature. Local-only (AsyncStorage).
//
// Real backend will replace this — keep the shapes minimal and the API
// async-only so swapping to fetch() later is a contained change.

import { getJSON, setJSON } from "./storage";
import { PROGRAMS_KEY, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";

export const CLIENTS_KEY = "@avenas/pt/clients";
export const CLIENT_DATA_PREFIX = "@avenas/pt/client_data/";
export const SHARED_PROGRAMS_KEY = "@avenas/pt/shared_programs";
export const PT_SEEDED_KEY = "@avenas/pt/seeded_v2";

export const ASSIGNED_PT_KEY = "@avenas/gym/assigned_pt";
export const SENT_PROGRAMS_KEY = "@avenas/gym/sent_programs";

export type Client = {
  id: string;
  name: string;
  initials: string;
  note?: string;
  lastActiveISO?: string;
  streak?: number;
};

export type ClientData = {
  workoutHistory: CompletedWorkout[];
  programs: SavedProgram[];
  journal: JournalEntry[];
};

export type SharedProgram = {
  id: string;
  clientId: string | "all";
  programId: string;
  programName: string;
  sentAtISO: string;
  /** Full program snapshot at send time so the gym user can materialise it on accept. */
  programSnapshot?: SavedProgram;
  /** Set when the gym user accepts the program — also signals the trainer that it landed. */
  acceptedAtISO?: string;
  /** Local @avenas/programs id created when the snapshot is materialised on accept. */
  acceptedProgramId?: string;
  /** Set whenever the trainer edits the shared snapshot after the initial send. */
  lastEditedAtISO?: string;
  /** Set when the gym user deletes their accepted copy from /programs. Hides the share from the trainer's per-client view; the entry survives so the gym user can re-accept. */
  deletedByRecipientAtISO?: string;
};

export type AssignedPT = {
  id: string;
  name: string;
  initials: string;
};

export type SentProgramStatus = "sent" | "returned";

export type SentProgram = {
  id: string;
  programId: string;
  programName: string;
  sentAtISO: string;
  status: SentProgramStatus;
  /** Full program snapshot the gym user sent — the trainer reviews this copy. */
  programSnapshot?: SavedProgram;
  returnedAtISO?: string;
  trainerComments?: string;
  /** Stamped when the gym user accepts the trainer's edits — the local program in @avenas/programs has been overwritten. */
  appliedAtISO?: string;
  /** Stamped whenever the trainer saves edits in the program builder during review. Used to detect unsent updates after a Send Back. */
  lastEditedAtISO?: string;
};

export const clientDataKey = (clientId: string) => `${CLIENT_DATA_PREFIX}${clientId}`;

export async function loadClients(): Promise<Client[]> {
  return getJSON<Client[]>(CLIENTS_KEY, []);
}
export async function saveClients(list: Client[]): Promise<void> {
  await setJSON(CLIENTS_KEY, list);
}

export async function loadClientData(clientId: string): Promise<ClientData> {
  return getJSON<ClientData>(clientDataKey(clientId), { workoutHistory: [], programs: [], journal: [] });
}
export async function saveClientData(clientId: string, data: ClientData): Promise<void> {
  await setJSON(clientDataKey(clientId), data);
}

export async function loadSharedPrograms(): Promise<SharedProgram[]> {
  return getJSON<SharedProgram[]>(SHARED_PROGRAMS_KEY, []);
}
export async function appendSharedPrograms(entries: SharedProgram[]): Promise<void> {
  const existing = await loadSharedPrograms();
  await setJSON(SHARED_PROGRAMS_KEY, [...entries, ...existing]);
}

/** Accept a shared program. On first accept the snapshot is appended to @avenas/programs.
 *  On a re-accept (trainer edited after the user previously accepted) the existing local program is updated in place. */
export async function acceptSharedProgram(shareId: string): Promise<string | null> {
  const list = await loadSharedPrograms();
  const target = list.find(s => s.id === shareId);
  if (!target) return null;
  if (!target.programSnapshot) {
    // Nothing to materialise — just stamp acceptedAtISO.
    const next = list.map(s => s.id === shareId ? { ...s, acceptedAtISO: new Date().toISOString() } : s);
    await setJSON(SHARED_PROGRAMS_KEY, next);
    return null;
  }

  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  const snap = target.programSnapshot;
  let importedId: string;

  const existing = target.acceptedProgramId
    ? programs.find(p => p.id === target.acceptedProgramId)
    : undefined;

  if (existing) {
    // Re-accept after a trainer edit — overwrite the existing local program in place.
    importedId = existing.id;
    const updated = programs.map(p => p.id === importedId ? {
      ...p,
      name: snap.name,
      totalWeeks: snap.totalWeeks,
      trainingDays: snap.trainingDays,
      cycleDays: snap.cycleDays,
      cyclePattern: snap.cyclePattern,
      workouts: snap.workouts,
    } : p);
    await setJSON(PROGRAMS_KEY, updated);
  } else {
    // First accept (or the local program was deleted) — insert a fresh one.
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2, "0")} ${months[now.getMonth()]} ${now.getFullYear()}`;
    importedId = `program_${Date.now()}`;
    const imported: SavedProgram = {
      ...snap,
      id: importedId,
      status: "created",
      currentWeek: 0,
      startDate: todayStr,
      cycleOffset: undefined,
      completedDate: undefined,
    };
    await setJSON(PROGRAMS_KEY, [...programs, imported]);
  }

  const next = list.map(s => s.id === shareId
    ? { ...s, acceptedAtISO: new Date().toISOString(), acceptedProgramId: importedId, deletedByRecipientAtISO: undefined }
    : s
  );
  await setJSON(SHARED_PROGRAMS_KEY, next);
  return importedId;
}

export async function loadAssignedPT(): Promise<AssignedPT | null> {
  return getJSON<AssignedPT | null>(ASSIGNED_PT_KEY, null);
}
export async function saveAssignedPT(pt: AssignedPT | null): Promise<void> {
  await setJSON(ASSIGNED_PT_KEY, pt);
}

export async function loadSentPrograms(): Promise<SentProgram[]> {
  return getJSON<SentProgram[]>(SENT_PROGRAMS_KEY, []);
}
export async function appendSentProgram(entry: SentProgram): Promise<void> {
  const existing = await loadSentPrograms();
  await setJSON(SENT_PROGRAMS_KEY, [entry, ...existing]);
}

/** When the gym user deletes a program in /programs, mark the matching SharedProgram(s)
 *  as withdrawn rather than removing them — the trainer's per-client view filters them out,
 *  but the gym user can still re-accept from their My Trainer page if they want it back. */
export async function removeSharedProgramByLocalId(localProgramId: string): Promise<void> {
  const list = await loadSharedPrograms();
  let mutated = false;
  const now = new Date().toISOString();
  const next = list.map(s => {
    if (s.acceptedProgramId !== localProgramId) return s;
    mutated = true;
    return { ...s, deletedByRecipientAtISO: now, acceptedAtISO: undefined, acceptedProgramId: undefined };
  });
  if (mutated) await setJSON(SHARED_PROGRAMS_KEY, next);
}

/** Migration: pre-acceptedProgramId entries are linked back to a local program by name + snapshot match. */
export async function backfillAcceptedProgramIds(): Promise<void> {
  const shares = await loadSharedPrograms();
  const orphan = shares.filter(s => s.acceptedAtISO && !s.acceptedProgramId);
  if (orphan.length === 0) return;

  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  let mutated = false;
  const next = shares.map(s => {
    if (!s.acceptedAtISO || s.acceptedProgramId) return s;
    const snapName = s.programSnapshot?.name ?? s.programName;
    const match = programs.find(p => p.name === snapName);
    if (!match) return s;
    mutated = true;
    return { ...s, acceptedProgramId: match.id };
  });
  if (mutated) await setJSON(SHARED_PROGRAMS_KEY, next);
}

export async function updateSentProgram(id: string, patch: Partial<SentProgram>): Promise<void> {
  const existing = await loadSentPrograms();
  const next = existing.map(s => s.id === id ? { ...s, ...patch } : s);
  await setJSON(SENT_PROGRAMS_KEY, next);
}

/** Gym user accepts a returned program: overwrite the original entry in @avenas/programs with the trainer's edited snapshot. */
export async function applyReturnedProgram(id: string): Promise<void> {
  const list = await loadSentPrograms();
  const target = list.find(s => s.id === id);
  if (!target || target.status !== "returned" || target.appliedAtISO) return;
  if (!target.programSnapshot) return;

  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  const original = programs.find(p => p.id === target.programId);
  const snap = target.programSnapshot;

  let nextPrograms: SavedProgram[];
  if (original) {
    // Replace the original program in place — preserve id, status, currentWeek, startDate.
    nextPrograms = programs.map(p => p.id === target.programId ? {
      ...p,
      name: snap.name,
      totalWeeks: snap.totalWeeks,
      trainingDays: snap.trainingDays,
      cycleDays: snap.cycleDays,
      cyclePattern: snap.cyclePattern,
      workouts: snap.workouts,
    } : p);
  } else {
    // Original was deleted — import as a fresh "created" program so the user doesn't lose the edits.
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const today = new Date();
    const startDate = `${String(today.getDate()).padStart(2, "0")} ${months[today.getMonth()]} ${today.getFullYear()}`;
    const imported: SavedProgram = {
      ...snap,
      id: `program_${Date.now()}`,
      status: "created",
      currentWeek: 0,
      startDate,
      cycleOffset: undefined,
      completedDate: undefined,
    };
    nextPrograms = [...programs, imported];
  }
  await setJSON(PROGRAMS_KEY, nextPrograms);

  const nextList = list.map(s => s.id === id ? { ...s, appliedAtISO: new Date().toISOString() } : s);
  await setJSON(SENT_PROGRAMS_KEY, nextList);
}

/** Gym user unsends a program they sent to the trainer. */
export async function removeSentProgram(id: string): Promise<void> {
  const existing = await loadSentPrograms();
  await setJSON(SENT_PROGRAMS_KEY, existing.filter(s => s.id !== id));
}

/** Trainer unsends a program they shared with a client.
 *  If the client already accepted, the imported copy in `@avenas/programs` stays — they own it. */
export async function removeSharedProgram(id: string): Promise<void> {
  const existing = await loadSharedPrograms();
  await setJSON(SHARED_PROGRAMS_KEY, existing.filter(s => s.id !== id));
}

/** Generic patch update for a SharedProgram entry. */
export async function updateSharedProgram(id: string, patch: Partial<SharedProgram>): Promise<void> {
  const existing = await loadSharedPrograms();
  const next = existing.map(s => s.id === id ? { ...s, ...patch } : s);
  await setJSON(SHARED_PROGRAMS_KEY, next);
}

export function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
