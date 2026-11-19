// utils/programStatus.ts
//
// A program's status badge: colour + wording. Shared by My Programs' cards and
// the archive's, so a program reads the same on both sides of an archive.

import type { SavedProgram } from "../constants/programs";
import { ACCT, PAUSED_ORANGE } from "../constants/theme";

/** Takes the secondary text colour rather than the whole theme: the palettes
 *  are `as const`, so a `typeof APP_LIGHT` parameter would reject APP_DARK on
 *  its literal types.
 *
 *  A HELD program keeps status "active", so pausedAt has to be checked first or
 *  it would show as Active.
 *
 *  `done`: the badge reads Completed, so it wears the finished program's
 *  clipboard (PROGRAM_DONE_ICON) before the word (user request, 2026-11-19). */
export function programStatus(program: SavedProgram, mutedColor: string): { color: string; label: string; done: boolean } {
  if (program.pausedAt)              return { color: PAUSED_ORANGE, label: "Paused",      done: false };
  if (program.status === "active")    return { color: ACCT,          label: "Active",      done: false };
  if (program.status === "paused")    return { color: PAUSED_ORANGE, label: "Paused",      done: false };
  if (program.status === "completed") return { color: ACCT,          label: "Completed",   done: true };
  return { color: mutedColor, label: "Not Started", done: false };
}
