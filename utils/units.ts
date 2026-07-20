// utils/units.ts
//
// Weight unit conversion. Storage is ALWAYS canonical kilograms (the program
// field is literally `weightKg`; tonnage is `totalVolumeKg`). The kg/lb toggle
// (`isKg` in UnitContext) is a *display lens*: values are converted kg→display
// when shown and display→kg when a typed value is committed. Stored numbers
// never change meaning when the user flips the toggle.
//
// Non-numeric weights ("BW", "", "—") are passed through untouched — they're not
// loads, so there's nothing to convert.
//
// Pure + RN-free so it can be unit-tested (see scripts/verify-data-layer.ts).

/** 1 lb in kg (exact, international avoirdupois pound). */
export const KG_PER_LB = 0.45359237;
/** 1 kg in lb. */
export const LB_PER_KG = 1 / KG_PER_LB;

/** Round to at most `maxDecimals` and drop trailing zeros / point. 100 → "100",
 *  100.5 → "100.5", 99.99999 → "100". */
export function trimNumber(n: number, maxDecimals = 1): string {
  if (!Number.isFinite(n)) return "";
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(n * factor) / factor;
  // toFixed then strip trailing zeros and a dangling decimal point.
  return rounded
    .toFixed(maxDecimals)
    .replace(/\.?0+$/, "")
    || "0";
}

/** True when a stored weight is a real numeric load (not "", "BW", etc.). */
function numericOrNull(weight: string): number | null {
  const s = weight.trim();
  if (s === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * A canonical-kg stored value → the string to SHOW in the user's unit.
 *   - kg mode: shown as-is (no rounding surprises for kg loggers).
 *   - lb mode: kg × LB_PER_KG, rounded to 1 dp.
 * Non-numeric / empty inputs are returned unchanged.
 */
export function formatWeightForDisplay(storedKg: string, isKg: boolean): string {
  const n = numericOrNull(storedKg);
  if (n === null) return storedKg;
  if (isKg) return trimNumber(n, 2);
  return trimNumber(n * LB_PER_KG, 1);
}

/**
 * A value the user TYPED in their unit → the canonical-kg string to store.
 * Never feed the result back into the display of the field being edited —
 * round-tripping mid-edit would eat a trailing "." and break decimal entry.
 * Committing per keystroke is fine as long as the edited field keeps its own
 * text buffer (see WeightSetInput in new-program.tsx).
 *   - kg mode: stored as typed.
 *   - lb mode: lb × KG_PER_LB, kept to 3 dp so it round-trips back to the typed
 *     lb value for display.
 * Non-numeric / empty inputs are returned unchanged ("BW" stays "BW").
 */
export function parseWeightToKg(typed: string, isKg: boolean): string {
  const n = numericOrNull(typed);
  if (n === null) return typed;
  if (isKg) return trimNumber(n, 3);
  return trimNumber(n * KG_PER_LB, 3);
}

/** Numeric kg → the number to show in the active unit. For derived values
 *  (tonnage, PRs, 1RM, chart points) where the caller does its own formatting. */
export function toDisplayWeight(kg: number, isKg: boolean): number {
  return isKg ? kg : kg * LB_PER_KG;
}

/** Numeric value in the active unit → kg. Inverse of toDisplayWeight. */
export function toKgWeight(display: number, isKg: boolean): number {
  return isKg ? display : display * KG_PER_LB;
}

/**
 * Reinterpret a DISPLAY-unit weight string from one unit into another, keeping
 * the underlying load constant (via canonical kg). Used when the unit toggle
 * changes while an in-progress log/edit buffer holds display-unit strings:
 * without this, finishing would parse those strings in the NEW unit and
 * silently rewrite the stored kg. No-op when the unit is unchanged; non-numeric
 * inputs ("BW"/"") pass through. See [[unit-toggle-should-convert]].
 */
export function reinterpretWeightUnit(displayWeight: string, fromIsKg: boolean, toIsKg: boolean): string {
  if (fromIsKg === toIsKg) return displayWeight;
  const kg = parseWeightToKg(displayWeight, fromIsKg);
  return formatWeightForDisplay(kg, toIsKg);
}

/**
 * Convert the weight part of a "weight×reps" previous-set hint for display.
 * Only the "w×r" form is converted (the weight is unambiguously before the ×);
 * a bare token ("10" — could be a weight or bodyweight reps) is left as-is to
 * avoid mis-converting reps. Non-numeric weights ("BW") pass through.
 */
export function formatPrevHint(token: string, isKg: boolean): string {
  const i = token.indexOf("×");
  if (i < 0) return token;
  return `${formatWeightForDisplay(token.slice(0, i), isKg)}×${token.slice(i + 1)}`;
}

// ── one-time lb → kg data migration ───────────────────────────────────────────
//
// Pre-conversion builds stored every weight as the bare number the user typed
// in whatever unit they had selected, with no unit tag. For users who were in
// lb mode, those stored numbers are lb values mislabeled as kg. This converts a
// single stored weight string from lb to kg; "BW"/"" pass through. The runner
// (wired separately, gated by a one-shot flag) applies it across history,
// programs, and the in-progress draft — once — only when the saved unit pref is
// lbs. See [[unit-toggle-should-convert]].

/** Convert one stored weight string from lb to canonical kg. */
export function migrateWeightLbToKg(storedLb: string): string {
  const n = numericOrNull(storedLb);
  if (n === null) return storedLb;
  return trimNumber(n * KG_PER_LB, 3);
}
