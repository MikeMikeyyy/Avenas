// utils/programArchive.ts
//
// Archiving one of MY programs: My Programs' Remove offers Archive beside
// Delete, and the page's archive button lists what's been archived with
// Restore and Delete on each.
//
// Archived is a flag beside the program's status, never a status of its own:
// status says where the program's run stands (Not Started, Paused, Completed)
// and a restore has to put it back exactly there. So `archivedAt` is the only
// thing archiving touches, and every list that should look past archived
// programs filters on it: My Programs, the send / review pickers, and Change
// Workout Day's other programs. Everything that reads history (the Journal,
// program history, Progress) keeps them: an archived program's sessions still
// happened.
//
// Pure: the screens do the storage write and the cloud push, as for every other
// program action (app/programs.tsx).

import type { SavedProgram } from "../constants/programs";
import { todayYMD } from "./dates";

/** The active program is never archived: it's the one the Workout tab and Home
 *  are running. Make it inactive or complete it first, which is also the only
 *  way My Programs offers Remove on it. */
export function canArchive(p: SavedProgram): boolean {
  return p.status !== "active";
}

/** Archive `id` as of `onYMD`. A no-op for the active program. */
export function archiveProgram(programs: SavedProgram[], id: string, onYMD: string = todayYMD()): SavedProgram[] {
  return programs.map(p => (p.id === id && canArchive(p) ? { ...p, archivedAt: onYMD } : p));
}

/** Put `id` back in My Programs, as it was. */
export function restoreProgram(programs: SavedProgram[], id: string): SavedProgram[] {
  return programs.map(p => {
    if (p.id !== id) return p;
    const { archivedAt: _archived, ...rest } = p;
    return rest;
  });
}

/** The programs My Programs and the pickers list. */
export function unarchivedPrograms(programs: SavedProgram[]): SavedProgram[] {
  return programs.filter(p => !p.archivedAt);
}

/** The archive, most recently archived first (then by name, for a stable
 *  order within a day). */
export function archivedPrograms(programs: SavedProgram[]): SavedProgram[] {
  return programs
    .filter(p => !!p.archivedAt)
    .sort((a, b) => (a.archivedAt! < b.archivedAt! ? 1 : a.archivedAt! > b.archivedAt! ? -1 : a.name.localeCompare(b.name)));
}
