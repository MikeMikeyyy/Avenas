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
  // The Strength radar's legend: this range's window, and the same-length
  // window before it (previousComparableWindow) that the muted polygon plots.
  currentLegend: string;
  previousLegend: string;
};

export const RANGE_OPTIONS: RangeOption[] = [
  { key: "thisWeek",    label: "This Week",     shortLabel: "Week",    bucket: "day",          currentLegend: "This Week",     previousLegend: "Last Week"       },
  { key: "lastWeek",    label: "Last Week",     shortLabel: "Last Wk", bucket: "day",          currentLegend: "Last Week",     previousLegend: "Week Before"     },
  { key: "thisMonth",   label: "Last Month",    shortLabel: "Month",   bucket: "rollingWeeks", currentLegend: "Last Month",    previousLegend: "Month Before"    },
  { key: "last3Months", label: "Last 3 Months", shortLabel: "3M",      bucket: "month",        currentLegend: "Last 3 Months", previousLegend: "3 Months Before" },
  { key: "year",        label: "Last Year",     shortLabel: "Year",    bucket: "month",        currentLegend: "Last Year",     previousLegend: "Year Before"     },
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

// ─── Strength radar (muscle-group breakdown) ─────────────────────────────────
//
// The Strength card plots one value per muscle group on a 6-axis radar. Which
// value depends on the active metric:
//   - load:      # of completed working sets attributed to the group. Sets
//                are comparable across muscle groups where tonnage is not (a
//                leg set moves several times the weight of an arm set), so
//                this is the skew-free "training balance" view — the default.
//   - frequency: # of sessions that trained the group
//   - volume:    Σ tonnage (weight×reps) attributed to the group. Raw work
//                done; naturally dominated by the big lower-body lifts.
export type StrengthMetricKey = "volume" | "frequency" | "load";

export type StrengthMetricOption = {
  key: StrengthMetricKey;
  label: string;
};

// The leading icon for each metric is chosen in StrengthRadarChart (it mixes
// the canonical DumbbellIcon with MaterialCommunityIcons), so it isn't carried
// here as a plain icon-font name. Load leads: it's the default metric (see
// ProgressView's strengthMetric initial state).
export const STRENGTH_METRIC_OPTIONS: StrengthMetricOption[] = [
  { key: "load",      label: "Muscular Load"     },
  { key: "frequency", label: "Workout Frequency" },
  { key: "volume",    label: "Total Volume"      },
];

// Per-muscle-group aggregate feeding the radar. `sessions` may be fractional
// when a multi-muscle custom exercise splits its session credit across groups;
// callers round for display.
export type MuscleGroupStat = {
  volume: number;   // Σ tonnage attributed to this group
  sessions: number; // # of sessions that trained this group (even-split aware)
  sets: number;     // # of working sets attributed to this group
};

// One stacked bar / point of the progress chart. Metric-agnostic: `total` holds
// whatever aggregate the chart is currently plotting (tonnage / reps / minutes).
export type VolumeBucket = {
  label: string;        // axis label: e.g. "Mon" / "3 Mar"
  startYMD: string;     // inclusive
  endYMD: string;       // inclusive
  total: number;        // aggregate value for this bucket (units depend on active metric)
  workoutIds: string[]; // ids of workouts that contributed
};

/** One working set of a session, in the order it was done: a block on the
 *  exercise chart's Sets tab. `weight` is 0 at bodyweight; a timed hold's
 *  `reps` are seconds. */
export type ExerciseSetPoint = { weight: number; reps: number };

// One session on the per-exercise chart. Carries what every tab draws (the
// tab is chosen at render time via ExerciseMetricKey).
export type ExerciseDataPoint = {
  workoutId: string;
  date: string;          // YYYY-MM-DD
  completedAt: string;   // ISO timestamp
  topWeight: number;     // heaviest single working set in that session
  topReps: number;       // reps on the top set
  bestSetVolume: number; // max(weight × reps) for any single working set in the session
  bestSetWeight: number; // weight of the set that produced bestSetVolume
  bestSetReps: number;   // reps of the set that produced bestSetVolume
  /** The session's estimated one-rep max: the best Epley estimate, weight ×
   *  (1 + reps / 30), over its working sets (the "Estimated 1RM" record's
   *  formula).
   *  0 for a session with no weight on the bar, and for a hold. */
  e1rm: number;
  e1rmWeight: number;    // weight of the set that produced e1rm
  e1rmReps: number;      // reps of the set that produced e1rm
  sessionVolume: number; // total tonnage of this exercise in the session
  /** The working sets with weight on the bar (not a hold), and their reps:
   *  what sessionVolume adds up, for the Most Volume record ("4 sets · 38
   *  reps"). */
  weightedSets: number;
  weightedReps: number;
  totalReps: number;     // Σ reps across working+done sets in the session
  /** The working sets totalReps adds up, in the order they were done: the
   *  Sets tab's blocks. */
  sets: ExerciseSetPoint[];
  /** A timed hold (CompletedExercise.isIsometric): `totalReps` and `topReps`
   *  are seconds held, and it moves no volume. */
  isHold?: true;
};

// Which tab the per-exercise chart is showing.
export type ExerciseMetricKey = "strength" | "sets" | "volume";

export type ExerciseMetricOption = { key: ExerciseMetricKey; label: string };

// One kind of chart per tab, each telling its own story (user decision,
// 2026-10-12). They were four lines, Heaviest, Est. 1RM, Volume and Reps, and
// for anyone doing about the same sets and reps every week the first three are
// the weight times a near-fixed number: one shape on three scales. Strength is
// a line of each session's top set with its reps on the dot (more reps at a
// weight shows there; the Est. 1RM is in its pop-up and the records); Sets
// stacks each session's working sets by their reps, so a set that fell short
// or a lighter back-off set shows; Volume is a bar per session.
export const EXERCISE_METRIC_OPTIONS: ExerciseMetricOption[] = [
  { key: "strength", label: "Strength" },
  { key: "sets",     label: "Sets"     },
  { key: "volume",   label: "Volume"   },
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
  /** The set a record is (Heaviest, Best Set) or comes from (Estimated 1RM):
   *  shown as "90 kg × 8". */
  weight?: number;
  /** That set's reps; for Most Volume, the session's reps in all. */
  reps?: number;
  /** Most Volume only: the session's working sets with weight on the bar,
   *  which together lifted `value` ("4 sets · 38 reps"). */
  sets?: number;
  /** Most Reps only: which of its session's sets it was
   *  (ExerciseDataPoint.sets), the block drawn gold on the Sets tab. */
  setIndex?: number;
  /** Most Reps only: a timed hold's record, in seconds ("Longest hold"). */
  hold?: true;
};

export type PRs = {
  heaviest: PRSet | null;          // max weight in a single working set
  bestSetVolume: PRSet | null;     // max(weight × reps) in a single working set (the post-workout summary's "Best Set")
  bestSessionVolume: PRSet | null; // max total exercise tonnage across all sessions ("Most volume")
  oneRepMax: PRSet | null;         // Epley: weight × (1 + reps/30), reps >= 1 ("Estimated 1RM")
  mostReps: PRSet | null;          // most reps in one working set, bodyweight included; a hold's longest ("Most reps")
};

// Synthetic sentinel — never used as a real program id, currently reserved for
// future "Custom" grouping if we ever surface it as a scope choice. The Progress
// page itself only uses kind: "current" | "all" | "program".
export const CUSTOM_PROGRAM_ID = "__custom__";

// The Progress drill-down's selection: a (workout day, exercise) pair. The day
// is part of the identity because the same exercise can be programmed on two
// different days (e.g. lateral raises on both Push and Arms) and each day's
// progress is tracked separately — see collectExerciseHistory / computePRs.
//
// The day is held as a ProgramDayRef.key, not a name: a cycle can schedule two
// days called "Upper", and selecting one of them must not pull in the other's
// sessions. Storing the key (rather than the ref) keeps the selection valid
// across a refresh — the live ref is looked up from the day list at render, so
// a renamed day keeps its chart and a deleted one clears it, with no syncing.
export type ExerciseSelection = {
  dayKey: string;
  name: string; // exercise name, matched case-insensitively (trim + lowercase)
};

// Exercise row data used by the day drill-down.
export type LoggedExerciseRow = {
  name: string;
  lastWeight: string;   // raw stored string ("80", "BW", "")
  lastReps: string;     // raw stored string
  lastDate: string;     // YYYY-MM-DD
  sessionCount: number; // # of sessions in scope that included this exercise
  /**
   * Whether the day still programs this exercise. False means it was logged
   * here but has since been swapped out of the program — its history stays on
   * the page (it happened), flagged so the drop-off in the trend reads as an
   * edit rather than missed sessions.
   *
   * Always true for a day with no prescription to compare against (a free
   * workout, or a historical day) — see ProgramDayRef.programExercises.
   */
  inProgram: boolean;
};
