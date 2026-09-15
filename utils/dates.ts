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
 * Inverse of `toYMD`: "YYYY-MM-DD" to a Date at LOCAL midnight, or null when the
 * string isn't that shape. Strict like `parseStoredDate` — callers must treat
 * null as "no date", never as a fallback epoch.
 *
 * Deliberately not `new Date(ymd)`, which parses a bare date string as UTC and
 * so lands on the previous local day in any positive-UTC timezone.
 */
export function fromYMD(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local calendar days from `a` to `b`, both "YYYY-MM-DD". Null if either is
 *  malformed. Positive when `b` is later. DST-safe (both sides are local
 *  midnights, so the rounding absorbs the 23/25-hour days). */
export function daysBetweenYMD(a: string, b: string): number | null {
  const from = fromYMD(a);
  const to = fromYMD(b);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calendar-day label for chat date separators and similar groupings:
 *   - today    -> "Today"
 *   - yesterday-> "Yesterday"
 *   - this year-> "June 10"
 *   - older    -> "June 10, 2024"
 * Compares on local calendar day (via toYMD), so time-of-day never matters.
 */
export function relativeDayLabel(d: Date): string {
  const today = new Date();
  const ymd = toYMD(d);
  if (ymd === toYMD(today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (ymd === toYMD(yesterday)) return "Yesterday";
  const base = `${MONTH_FULL[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
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
