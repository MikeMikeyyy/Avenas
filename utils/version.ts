// utils/version.ts
//
// Comparing app version strings ("2.2.0"). Used by the force-update gate, where
// getting this wrong in either direction is expensive: too strict locks every
// user out of a working app, too lax lets an unsupported build keep running.
//
// Deliberately tolerant about shape — a version may be "2", "2.2", "2.2.0" or
// carry a suffix like "2.2.0-beta". Missing parts count as 0, so "2.2" and
// "2.2.0" are equal, and anything non-numeric is ignored rather than throwing.

/** Split a version into numeric parts. Returns null when there's nothing usable. */
function parts(version: string): number[] | null {
  const cleaned = version.trim().split(/[-+ ]/)[0]; // drop "-beta", build metadata
  if (!cleaned) return null;
  const nums = cleaned.split(".").map(p => Number.parseInt(p, 10));
  if (nums.length === 0 || Number.isNaN(nums[0])) return null;
  return nums.map(n => (Number.isNaN(n) ? 0 : n));
}

/**
 * -1 when a < b, 0 when equal, 1 when a > b, and null when either side can't be
 * parsed. Callers must treat null as "don't know" — never as a reason to block.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Whether `current` is below `minimum`, i.e. the app must be updated.
 *
 * Fails OPEN: an unparseable version on either side returns false. A user with
 * a working app should never be locked out because a version string was
 * malformed — the cost of missing one stale install is far lower than bricking
 * every install.
 */
export function isBelowMinimum(current: string | null | undefined, minimum: string | null | undefined): boolean {
  if (!current || !minimum) return false;
  return compareVersions(current, minimum) === -1;
}
