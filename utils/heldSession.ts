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
// is kept only while its workout clock is still going: a late-night session
// carried past midnight, which getEffectiveToday mostly keeps on its own day
// anyway. On the same day it's kept while live or engaged (a set touched, a
// note written, a draft saved), as before.
//
// Pure, so scripts/verify-data-layer.ts covers it.

export type HeldSession = {
  /** The training day (YYYY-MM-DD) the held session was built or restored
   *  for, null when the tab holds none. */
  day: string | null;
  /** Its workout clock is running or paused. */
  live: boolean;
  /** Something has been done in it: a set touched, a note, a saved draft. */
  engaged: boolean;
};

/** Whether the tab keeps the session it holds on `today`, rather than starting
 *  the day again from the program. */
export function keepsHeldSession(held: HeldSession, today: string): boolean {
  if (held.day === null) return false;
  if (held.day !== today) return held.live;
  return held.live || held.engaged;
}
