// Date helpers shared across pages.
// Centralises:
//   - parseStoredDate: parse the "DD Mon YYYY" startDate used by SavedProgram
//   - toYMD: format a Date as "YYYY-MM-DD" (the format used by workout_dates,
//            CompletedWorkout.date, and today_workout_override.date)
//   - fmtDuration: format seconds as "Hh Mm" / "Mm" / "Ss"
//   - todayYMD: current local date in "YYYY-MM-DD"
//
// Strict-parse rule: parseStoredDate returns null on invalid input rather than
// silently falling back to January-year-0 / NaN-laden Date objects. Callers
// must treat null the same as "no active program / no workout today".

export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Parse a SavedProgram.startDate string like "09 Apr 2026".
 * Returns null when any of day/month/year are missing or unparseable.
 */
export function parseStoredDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const month = MONTH_NAMES.indexOf(parts[1]);
  const year = parseInt(parts[2], 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  if (month < 0) return null;
  if (!Number.isFinite(year) || year < 1900) return null;
  return new Date(year, month, day);
}

/**
 * Format a Date as a SavedProgram.startDate string ("DD Mon YYYY", e.g.
 * "09 Apr 2026") — the inverse of parseStoredDate. Use whenever code needs to
 * write a program start/completed date so the stored format stays consistent.
 */
export function formatStoredDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  return `${day} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Format a Date as "YYYY-MM-DD" using local components (no UTC shift).
 */
export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Current local date as "YYYY-MM-DD".
 */
export function todayYMD(): string {
  return toYMD(new Date());
}

/**
 * Format an elapsed duration in seconds.
 * Matches the shipped semantics shared by home / workout / journal / workout-detail:
 *   45    -> "45s"
 *   125   -> "2m"        (sub-hour: minutes only, no seconds)
 *   3725  -> "1h 2m"
 *   3600  -> "1h"        (no trailing " 0m")
 * Negative / NaN inputs are clamped to 0.
 */
export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(secs) ? secs : 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (s < 3600) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}
