// utils/heldSession.ts
//
// Whether the Workout tab keeps the session it's holding when it resolves the
// training day again (on focus, on coming back to the front, at the day's
// rollover), or starts that day afresh from the program.
//
// A session belongs to the day it was built for. Its exercises' order, and any
// swap or add made in it, were for that day (a machine was taken, so the user
// did it another way round), and the next time that program day comes round it
// starts again in the program's own order. Notes and previous numbers don't
// depend on this: they follow each exercise by its place in the program
// (utils/workout.ts), whatever order a session ran in.
//
// The tab used to keep any session it judged in progress, whatever day it was
// built for, so a session left held in the app carried its swapped order into
// the same day a week later (user report, 2026-10-05). Now one from another day
// is kept only while it's still going: its clock running (or paused) AND
// something ticked or typed in it within the hour (stillGoing): a late-night
// session carried past midnight, which getEffectiveToday mostly keeps on its
// own day anyway. A clock alone used to be enough, so a workout forgotten with
// the app left open stayed open all night, its clock counting, and was filed
// under the next day when finished (user decision, 2026-10-15). One that isn't
// still going goes to the Journal (utils/unfinishedSession.ts). On the same day
// it's kept while live or started, as before.
//
// A session SHAPED before it started is kept as well: exercises moved, swapped,
// added or removed, sets added or removed, a Hold switched, an exercise note
// written, all before the first set. None of that counted, so it went the
// moment the tab looked at the day again (user report, 2026-10-07). Unstarted,
// it stays only while the day still schedules the workout it was shaped from:
// change the day under it (Change Workout Day, Set Workout Date, Make Rest Day,
// Move to Tomorrow) and the new day starts in the program's own order. A
// program edit to that same day leaves it be, and shows the next time the day
// comes round, as it does for a started session (user decision, 2026-10-07).
//
// Pure, so scripts/verify-data-layer.ts covers it.

/** How long a workout can go with nothing ticked or typed in it before it
 *  counts as forgotten: rest between sets is minutes, so an hour of nothing
 *  almost always means the person has left (user decision, 2026-10-15). */
export const FORGOTTEN_AFTER_MS = 60 * 60 * 1000;

/** Whether a workout is still being done: its clock is going (or paused) and
 *  something was ticked or typed in it within FORGOTTEN_AFTER_MS of `now`. */
export function stillGoing(live: boolean, lastActivityAt: number | null, now: number): boolean {
  return live && lastActivityAt !== null && now - lastActivityAt < FORGOTTEN_AFTER_MS;
}

/** Which workout a session is: its program and day, by the day's id where it
 *  has one. */
export type SessionWorkout = { name: string; programId?: string; dayId?: string };

export type HeldSession = {
  /** The training day (YYYY-MM-DD) the held session was built or restored
   *  for, null when the tab holds none. */
  day: string | null;
  /** Its workout clock is running or paused. */
  live: boolean;
  /** When something was last ticked or typed in it (epoch ms), null if never. */
  lastActivityAt: number | null;
  /** It has started: a set touched, a session note, a custom workout begun. */
  started: boolean;
  /** It was shaped before it started (see above). */
  shaped: boolean;
  /** The workout it is, null when the tab shows none. */
  workout: SessionWorkout | null;
};

/** Whether the tab keeps the session it holds on `today`, rather than starting
 *  the day again from the program. `scheduled` is the workout the day resolves
 *  to now, null for a rest day. */
export function keepsHeldSession(
  held: HeldSession,
  today: string,
  scheduled: SessionWorkout | null,
  now: number = Date.now(),
): boolean {
  if (held.day === null) return false;
  if (held.day !== today) return stillGoing(held.live, held.lastActivityAt, now);
  if (held.live || held.started) return true;
  return held.shaped && held.workout !== null && scheduled !== null && sameWorkout(held.workout, scheduled);
}

/** The same workout: the same program's day, by id when both carry one (so a
 *  rename keeps it), else by name. */
export function sameWorkout(a: SessionWorkout, b: SessionWorkout): boolean {
  if ((a.programId ?? "") !== (b.programId ?? "")) return false;
  if (a.dayId && b.dayId) return a.dayId === b.dayId;
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}
