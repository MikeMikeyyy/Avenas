// constants/progress.ts
//
// Shared types and constants for the Progress page.
// All progress derivations live in utils/progressStats.ts; this file is purely
// type and literal-data declarations.

export type ProgramScope =
  | { kind: "current" }
  | { kind: "all" }
  | { kind: "program"; programId: string };

export type RangeKey = "thisWeek" | "lastWeek" | "thisMonth" | "last3Months" | "year";

export type RangeOption = {
  key: RangeKey;
  label: string;       // shown in the dropdown sheet
  shortLabel: string;  // shown on the trigger button
  // Bucketing strategy that determines bar count, x-axis labels, and window math.
  //   - "day"           → one bar per day. Used by week-level ranges.
  //   - "rollingWeeks"  → 4 bars: the last 3 Monday–Sunday weeks plus the
  //                       current (possibly partial) week. Labels are date
  //                       ranges, e.g. "May 11-17" or "Apr 27-May 3".
  //   - "month"         → one bar per calendar month, labelled "Mar"…
  bucket: "day" | "rollingWeeks" | "month";
};

export const RANGE_OPTIONS: RangeOption[] = [
  { key: "thisWeek",    label: "This Week",   shortLabel: "Week",    bucket: "day"          },
  { key: "lastWeek",    label: "Last Week",   shortLabel: "Last Wk", bucket: "day"          },
  { key: "thisMonth",   label: "Last Month",  shortLabel: "Month",   bucket: "rollingWeeks" },
  { key: "last3Months", label: "3 Months",    shortLabel: "3M",      bucket: "month"        },
  { key: "year",        label: "Last Year",   shortLabel: "Year",    bucket: "month"        },
];

// Which metric the progress chart's bars represent. The bucketing template
// (day / rolling weeks / month) is shared across all three — only the
// per-workout aggregator function differs.
export type MetricKey = "volume" | "reps" | "duration";

export type MetricOption = { key: MetricKey; label: string };

export const METRIC_OPTIONS: MetricOption[] = [
  { key: "volume",   label: "Volume"   },
  { key: "reps",     label: "Reps"     },
  { key: "duration", label: "Duration" },
];

// One stacked bar / point of the progress chart. Metric-agnostic: `total` holds
// whatever aggregate the chart is currently plotting (tonnage / reps / minutes).
export type VolumeBucket = {
  label: string;        // axis label: e.g. "Mon" / "3 Mar"
  startYMD: string;     // inclusive
  endYMD: string;       // inclusive
  total: number;        // aggregate value for this bucket (units depend on active metric)
  workoutIds: string[]; // ids of workouts that contributed
};

// One point on the per-exercise line chart. Carries every metric the chart
// can plot (the active metric is chosen at render time via ExerciseMetricKey).
export type ExerciseDataPoint = {
  workoutId: string;
  date: string;          // YYYY-MM-DD
  completedAt: string;   // ISO timestamp
  topWeight: number;     // heaviest single working set in that session
  topReps: number;       // reps on the top set
  bestSetVolume: number; // max(weight × reps) for any single working set in the session
  bestSetWeight: number; // weight of the set that produced bestSetVolume
  bestSetReps: number;   // reps of the set that produced bestSetVolume
  sessionVolume: number; // total tonnage of this exercise in the session
  totalReps: number;     // Σ reps across working+done sets in the session
};

// Which metric the per-exercise line chart is currently plotting.
export type ExerciseMetricKey =
  | "topWeight"
  | "bestSetVolume"
  | "sessionVolume"
  | "totalReps";

export type ExerciseMetricOption = { key: ExerciseMetricKey; label: string };

export const EXERCISE_METRIC_OPTIONS: ExerciseMetricOption[] = [
  { key: "topWeight",     label: "Heaviest" },
  { key: "bestSetVolume", label: "Best Set" },
  { key: "sessionVolume", label: "Volume"   },
  { key: "totalReps",     label: "Reps"     },
];

// Sliding-window time range shared between the per-exercise progression chart
// and the per-exercise history page. `days` is the cutoff = today − N days.
export type ExerciseRangeKey = "month" | "3months" | "year";

export type ExerciseRangeOption = {
  key: ExerciseRangeKey;
  label: string;       // shown in the dropdown sheet
  shortLabel: string;  // shown on the trigger button
  days: number;        // cutoff window length
};

export const EXERCISE_RANGE_OPTIONS: ExerciseRangeOption[] = [
  { key: "month",   label: "Last Month",    shortLabel: "Month", days: 30  },
  { key: "3months", label: "Last 3 Months", shortLabel: "3M",    days: 90  },
  { key: "year",    label: "Last Year",     shortLabel: "Year",  days: 365 },
];

export type PRSet = {
  value: number;
  workoutId: string;
  date: string;          // YYYY-MM-DD
  // For 1RM PRs we also need reps to display "80 × 8 → 101 kg" if we ever want to.
  weight?: number;
  reps?: number;
};

export type PRs = {
  heaviest: PRSet | null;          // max weight in a single working set
  bestSetVolume: PRSet | null;     // max(weight × reps) in a single working set
  bestSessionVolume: PRSet | null; // max total exercise tonnage across all sessions
  oneRepMax: PRSet | null;         // Epley: weight × (1 + reps/30), reps >= 1
};

// Synthetic sentinel — never used as a real program id, currently reserved for
// future "Custom" grouping if we ever surface it as a scope choice. The Progress
// page itself only uses kind: "current" | "all" | "program".
export const CUSTOM_PROGRAM_ID = "__custom__";

// Exercise row data used by the day drill-down.
export type LoggedExerciseRow = {
  name: string;
  lastWeight: string;   // raw stored string ("80", "BW", "")
  lastReps: string;     // raw stored string
  lastDate: string;     // YYYY-MM-DD
  sessionCount: number; // # of sessions in scope that included this exercise
};
