// utils/niceAxis.ts
//
// Produces a "nice" Y-axis range for charts so the labels are clean round
// numbers instead of the exact data extents.
//
// Algorithm:
//   1. niceCeil(x) = pow10 × {1, 2, 5} × choose smallest at-or-above x.
//      e.g. 7340 → 8000, 420 → 500, 12 → 20.
//   2. stepValue = max / sections.
//   3. Labels are formatted "k" / "M" when large.
//
// When dataMax is 0 / negative / NaN we return a usable empty-axis (max=100,
// step=25) so the chart still renders cleanly with an empty data set.

export type NiceAxis = {
  max: number;
  stepValue: number;
  labels: string[]; // length === sections + 1, ascending from "0"
};

function niceCeil(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  const exp = Math.floor(Math.log10(x));
  const pow = Math.pow(10, exp);
  const frac = x / pow; // in [1, 10)
  let nice: number;
  if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 2.5) nice = 2.5;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

function formatTick(v: number, axisMax: number): string {
  if (v === 0) return "0";
  // Use "k" once the axis cap is in the thousands so labels stay short.
  if (axisMax >= 10000) {
    return `${(v / 1000).toFixed(0)}k`;
  }
  if (axisMax >= 1000) {
    const n = v / 1000;
    // 2k vs 2.5k — keep at most one decimal place.
    return Number.isInteger(n) ? `${n}k` : `${n.toFixed(1)}k`;
  }
  if (axisMax >= 100) return `${Math.round(v)}`;
  if (axisMax >= 10) return `${Math.round(v)}`;
  // For very small ranges, allow one decimal.
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
}

export function niceAxis(dataMax: number, sections: number = 4): NiceAxis {
  const s = Math.max(2, Math.floor(sections));
  if (!Number.isFinite(dataMax) || dataMax <= 0) {
    const max = 100;
    const stepValue = max / s;
    const labels = Array.from({ length: s + 1 }, (_, i) => formatTick(stepValue * i, max));
    return { max, stepValue, labels };
  }

  // Headroom: bump just over the data point so the tallest bar isn't flush
  // with the top gridline. niceCeil already rounds up, but for values that
  // *exactly* hit a tick we still want one more step's headroom-ish: only
  // bump when niceCeil(dataMax) === dataMax.
  let max = niceCeil(dataMax);
  if (max === dataMax) max = niceCeil(dataMax * 1.001);

  // Force max to be divisible by `sections` so step labels are clean integers.
  // niceCeil already gives "nice" numbers, but sections=4 over a max like 25
  // would produce non-integer steps. Recompute to the smallest "nice" value
  // that both >= dataMax AND divides cleanly by `sections`.
  // For the common cases (max ∈ {10, 20, 25, 50, 100, 200, 250, 500, 1000…}),
  // dividing by 4 yields 2.5 / 5 / 6.25 / 12.5 / 25 / 50 / 62.5 / 125 / 250.
  // That's fine — labels can render fractional kilos. We accept 6.25 etc. and
  // format them via formatTick.
  const stepValue = max / s;
  const labels = Array.from({ length: s + 1 }, (_, i) => formatTick(stepValue * i, max));
  return { max, stepValue, labels };
}
