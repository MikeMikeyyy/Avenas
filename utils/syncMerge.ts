// utils/syncMerge.ts
//
// Two phones on one account, combined (user decision, 2026-11-07: "Merge both
// phones"). A backup replaces the account's whole copy, and a phone may only
// send one once it has the latest (migration 0057); one that's behind gets
// the backup and combines it with its own here, then backs up the result
// (lib/cloud.ts syncBackup). Pure: no storage, no network, so
// scripts/verify-sync-merge.ts can pin every case.
//
// What the two copies are read against is the BASE: the backup as this phone
// last saw it (saved with the version, utils/syncLocal.ts), a hash per item.
// Against it each side either changed an item or didn't, so:
//   - added on either phone: kept.
//   - changed on one phone: that phone's version.
//   - changed on both: the phone whose last change was later. A program is
//     decided part by part (PROGRAM_PARTS: its name, its plan, where it stands,
//     whether it's archived), so an exercise changed on one phone and a pause
//     on the other both stay.
//   - deleted on either phone: gone. A delete is never inferred from an item
//     being missing: every delete records a TOMBSTONE (utils/syncLocal.ts
//     noteDeleted), which travels with the backup. Missing without one, an item
//     is kept, whichever side lost it: a screen writing back a list it read
//     before the merge, or an older app, can drop an item, and that must never
//     spread as a delete. A tombstone wins over an edit made since.
//   - a backup from an app before 0057 (it never takes the other phone's
//     changes in, so what it holds differently is old, not edited): only what
//     it adds comes in.
//
// An item is known by its id: since 0057 every session and journal entry keeps
// its own through a backup, as programs have since 0044 and custom exercises
// since 0048. A copy that reached the backup under another id (an older app's
// backup re-minted it, or a phone restored before then holds the row's) is
// matched by what it is instead (naturalKey: a session's day, finish and name;
// an entry's time; a live exercise's name), so neither copy turns into two.
//
// Hashes are over each item as the backup stores it (its row, the way
// lib/mappers.ts builds it), with what a trip through the database can't keep
// apart treated as the same: key order, an empty list and none, false and
// none, a timestamp's format. So an item that went up and came back unchanged
// hashes the same, and only real changes count (scripts/verify-db.ts checks it
// against the real database).

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import type { CustomExercise } from "../constants/exercises";
import { customToRow, journalToRow, programToRow, workoutToRow } from "../lib/mappers";
import { exerciseKey } from "./exerciseNames";
import { idleDays } from "./programHolds";

export type SyncKind = "programs" | "workouts" | "journal" | "custom";
export const SYNC_KINDS: readonly SyncKind[] = ["programs", "workouts", "journal", "custom"];

/** The four things a backup holds, as the phone holds them. */
export type SyncSnapshot = {
  programs: SavedProgram[];
  workouts: CompletedWorkout[];
  journal: JournalEntry[];
  custom: CustomExercise[];
};

type Item = SavedProgram | CompletedWorkout | JournalEntry | CustomExercise;

/** A deletion: of what, its id, what it is (naturalKey, for a copy the backup
 *  holds under another id), and when (ISO). */
export type Tombstone = { k: SyncKind; id: string; key?: string; at: string };

/** How long a deletion is kept: a phone left unopened longer than this brings
 *  what was deleted meanwhile back. */
export const TOMBSTONE_DAYS = 400;

/** A program's parts, each decided on its own when both phones changed it. A
 *  part's fields move together (a plan's days and their exercises; a pause and
 *  the week it froze at), so two halves of different versions never meet. */
export type ProgramPart = "name" | "plan" | "schedule" | "archive";
export const PROGRAM_PARTS: Record<ProgramPart, { fields: (keyof SavedProgram)[]; columns: string[] }> = {
  name: { fields: ["name"], columns: ["name"] },
  plan: {
    fields: ["cyclePattern", "dayIds", "workouts", "trainingDays", "cycleDays", "extraWorkouts", "shareOrigin"],
    columns: ["cycle_pattern", "day_ids", "workouts", "training_days", "cycle_days", "extra_workouts", "share_origin"],
  },
  schedule: {
    fields: [
      "status", "currentWeek", "totalWeeks", "startDate", "completedDate", "cycleOffset", "pausedAt", "holds", "runs",
      "skippedDates", "pushedDates", "pulledDates",
    ],
    columns: [
      "status", "current_week", "total_weeks", "start_date", "completed_date", "cycle_offset", "paused_at", "holds", "runs",
      "skipped_dates", "pushed_dates", "pulled_dates",
    ],
  },
  archive: { fields: ["archivedAt"], columns: ["archived_at"] },
};
const PARTS = Object.keys(PROGRAM_PARTS) as ProgramPart[];

/** One item as the backup held it when this phone last saw it. */
export type BaseEntry = { h: string; key?: string; parts?: Partial<Record<ProgramPart, string>> };
export type SyncBase = Record<SyncKind, Record<string, BaseEntry>>;

// ─── Hashing ────────────────────────────────────────────────────────────────

/** What a trip through the database can't keep apart, made the same: keys in
 *  order, and null, undefined, false, "", [] and {} all as nothing (the
 *  backup turns several into one another: `muted ?? false`, `day_ids ?? []`,
 *  `nullif(x, '')`). Inside a list a nothing stays, as null, so positions hold. */
function settle(v: unknown): unknown {
  if (v === null || v === undefined || v === false || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    return v.map(x => {
      const s = settle(x);
      return s === undefined ? null : s;
    });
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      const s = settle(o[k]);
      if (s !== undefined) out[k] = s;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return v;
}

/** cyrb53: a 53-bit string hash, fast and well spread. An edit that happened to
 *  hash like the version before it would go unseen; at 2^-53 a time, never. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const hashValue = (v: unknown) => hashText(JSON.stringify(settle(v) ?? null));

/** A timestamp the way the database hands it back ("+00:00", microseconds)
 *  and the way the phone wrote it ("Z") read as one instant. */
function instant(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : v;
}

/** A program's row, ids aside (an id is what it is, not what it holds). */
function programRow(p: SavedProgram): Record<string, unknown> {
  const { user_id: _u, local_id: _l, ...row } = programToRow(p, "");
  // The backup stores none as 0.
  return { ...row, current_week: row.current_week ?? 0 };
}

/** A session's row, pointing at its program by the program's own id when the
 *  same copy has it, and at none when it doesn't (the backup can only point
 *  at a program it holds, so a session of a deleted program comes back free). */
function workoutRow(w: CompletedWorkout, programIds: ReadonlySet<string>): Record<string, unknown> {
  const { user_id: _u, local_id: _l, program_id: _p, ...row } = workoutToRow(w, "", null);
  return {
    ...row,
    completed_at: instant(row.completed_at),
    duration_seconds: row.duration_seconds ?? 0,
    program: w.programId && programIds.has(w.programId) ? w.programId : null,
  };
}

function journalRow(j: JournalEntry): Record<string, unknown> {
  const { user_id: _u, local_id: _l, ...row } = journalToRow(j, "");
  return { ...row, created_at: instant(row.created_at) };
}

function customRow(c: CustomExercise): Record<string, unknown> {
  const { user_id: _u, local_id: _l, ...row } = customToRow(c, "");
  return row;
}

function pick(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map(c => [c, row[c]]));
}

/** Every column of a program's row in exactly one part (verify-sync-merge
 *  checks, so a new column has to be given one). */
export function programColumns(p: SavedProgram): string[] {
  return Object.keys(programRow(p));
}

function programHashes(p: SavedProgram): { h: string; parts: Record<ProgramPart, string> } {
  const row = programRow(p);
  const parts = Object.fromEntries(PARTS.map(part => [part, hashValue(pick(row, PROGRAM_PARTS[part].columns))])) as Record<ProgramPart, string>;
  return { h: hashValue(row), parts };
}

/** Hashes already worked out this session, by the item as stored: an item a
 *  backup has seen unchanged is a lookup, not a hash, so a long history costs
 *  its full hashing once a launch (2000 sessions: ~70 ms on a computer, a few
 *  times that on a phone) and only its changes after. Kept to MEMO_MAX. */
const memo = new Map<string, string>();
const MEMO_MAX = 30000;

function hashOf(kind: SyncKind, item: Item, programIds: ReadonlySet<string>): string {
  if (kind === "programs") return programHashes(item as SavedProgram).h;
  // A session's hash also says whether the copy holds its program.
  const pointed = kind === "workouts" && !!(item as CompletedWorkout).programId && programIds.has((item as CompletedWorkout).programId as string);
  const key = `${kind}${pointed ? "+" : "-"}${JSON.stringify(item)}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  const h = kind === "workouts" ? hashValue(workoutRow(item as CompletedWorkout, programIds))
    : kind === "journal" ? hashValue(journalRow(item as JournalEntry))
      : hashValue(customRow(item as CustomExercise));
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(key, h);
  return h;
}

// ─── Identity ───────────────────────────────────────────────────────────────

const msOf = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? String(t) : iso;
};

/** What an item is, for a copy held under another id: a session's day, finish
 *  and name; an entry's moment; a live exercise's name (live names are unique,
 *  so two phones' "Band Pull-Apart" are one exercise). Programs have kept their
 *  id since 0044, so they go by it alone. */
export function naturalKey(kind: SyncKind, item: Item): string | undefined {
  switch (kind) {
    case "workouts": {
      const w = item as CompletedWorkout;
      return `${w.date}|${msOf(w.completedAt)}|${w.workoutName}`;
    }
    case "journal": return msOf((item as JournalEntry).createdAt);
    case "custom": {
      const c = item as CustomExercise;
      return c.deletedAt ? undefined : `live|${exerciseKey(c.name)}`;
    }
    default: return undefined;
  }
}

/** An item's id: its own, or for a custom exercise made before ids (or anything
 *  without one) what it is. */
export function itemId(kind: SyncKind, item: Item): string {
  if (kind === "custom") {
    const c = item as CustomExercise;
    return c.id ? c.id : `name|${exerciseKey(c.name)}`;
  }
  const id = (item as { id?: string }).id;
  return id ? id : `key|${naturalKey(kind, item) ?? ""}`;
}

/** Between an id and its count, for a second item of one id: a character no
 *  id or name holds (a "#" can be in a workout's name). */
const DUP = "\u0001";
/** The id an entry key stands for. */
export const idOfKey = (key: string) => key.split(DUP)[0];

/** Each item's place in the merge: its id, or for a second item of one id the
 *  id and its count, so neither is lost to the other. */
function keysOf(kind: SyncKind, items: Item[]): string[] {
  const seen = new Map<string, number>();
  return items.map(item => {
    const id = itemId(kind, item);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}${DUP}${n}`;
  });
}

type Entry = {
  key: string;
  item: Item;
  hash: string;
  nk?: string;
  parts?: Record<ProgramPart, string>;
};

function entriesOf(kind: SyncKind, items: Item[], programIds: ReadonlySet<string>): Entry[] {
  const keys = keysOf(kind, items);
  return items.map((item, i) => {
    const key = keys[i];
    if (kind === "programs") {
      const { h, parts } = programHashes(item as SavedProgram);
      return { key, item, hash: h, parts };
    }
    return { key, item, hash: hashOf(kind, item, programIds), nk: naturalKey(kind, item) };
  });
}

const listOf = (s: SyncSnapshot, kind: SyncKind): Item[] => s[kind] as Item[];
const programIdsOf = (s: SyncSnapshot) => new Set(s.programs.map(p => p.id));

/** The base for a copy: a hash per item (and per program part). Saved after
 *  every backup this phone sends or takes in. */
export function baseOf(s: SyncSnapshot): SyncBase {
  const programIds = programIdsOf(s);
  const out = {} as SyncBase;
  for (const kind of SYNC_KINDS) {
    const entries: Record<string, BaseEntry> = {};
    for (const e of entriesOf(kind, listOf(s, kind), programIds)) entries[e.key] = baseEntry(e);
    out[kind] = entries;
  }
  return out;
}

const baseEntry = (e: Entry): BaseEntry => (e.parts ? { h: e.hash, parts: e.parts } : e.nk ? { h: e.hash, key: e.nk } : { h: e.hash });

/** baseOf, a slice at a time with the phone's other work let in between, so a
 *  long history hashed for a backup never holds a tap or a frame up. */
export async function baseOfInSlices(s: SyncSnapshot, slice = 150): Promise<SyncBase> {
  const programIds = programIdsOf(s);
  const out = {} as SyncBase;
  for (const kind of SYNC_KINDS) {
    const items = listOf(s, kind);
    const keys = keysOf(kind, items);
    const entries: Record<string, BaseEntry> = {};
    for (let i = 0; i < items.length; i += slice) {
      if (i > 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      for (let j = i; j < Math.min(items.length, i + slice); j++) {
        const item = items[j];
        if (kind === "programs") {
          const { h, parts } = programHashes(item as SavedProgram);
          entries[keys[j]] = baseEntry({ key: keys[j], item, hash: h, parts });
        } else {
          entries[keys[j]] = baseEntry({ key: keys[j], item, hash: hashOf(kind, item, programIds), nk: naturalKey(kind, item) });
        }
      }
    }
    out[kind] = entries;
  }
  return out;
}

/** Whether two bases describe the same copy. */
export function sameBase(a: SyncBase, b: SyncBase): boolean {
  for (const kind of SYNC_KINDS) {
    const x = a[kind] ?? {};
    const y = b[kind] ?? {};
    const keys = Object.keys(x);
    if (keys.length !== Object.keys(y).length) return false;
    for (const k of keys) if (!y[k] || y[k].h !== x[k].h) return false;
  }
  return true;
}

/** Items the base has that `s` doesn't, and no deletion explains: what a
 *  screen writing back an old list, or anything else but a delete, dropped. */
export function droppedWithoutDelete(s: SyncSnapshot, base: SyncBase, deleted: Tombstone[]): number {
  const gone = new Set(deleted.map(t => `${t.k}|${t.id}`));
  let n = 0;
  for (const kind of SYNC_KINDS) {
    const present = new Set(keysOf(kind, listOf(s, kind)));
    for (const key of Object.keys(base[kind] ?? {})) {
      if (!present.has(key) && !gone.has(`${kind}|${idOfKey(key)}`)) n++;
    }
  }
  return n;
}

// ─── Deletions ──────────────────────────────────────────────────────────────

/** Both lists of deletions as one: each once, at its first time, none older
 *  than TOMBSTONE_DAYS. */
export function mergeTombstones(a: Tombstone[], b: Tombstone[], now: number = Date.now()): Tombstone[] {
  const cutoff = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  const byId = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    if (!t || typeof t.id !== "string" || !SYNC_KINDS.includes(t.k)) continue;
    const at = Date.parse(t.at);
    if (Number.isFinite(at) && at < cutoff) continue;
    const id = `${t.k}|${t.id}`;
    const had = byId.get(id);
    if (!had) byId.set(id, t);
    else if (Date.parse(t.at) < Date.parse(had.at)) byId.set(id, { ...t, key: t.key ?? had.key });
    else if (!had.key && t.key) byId.set(id, { ...had, key: t.key });
  }
  return [...byId.values()];
}

/** Whether two lists name the same deletions. */
export function sameTombstones(a: Tombstone[], b: Tombstone[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map(t => `${t.k}|${t.id}`));
  return b.every(t => ids.has(`${t.k}|${t.id}`));
}

// ─── The merge ──────────────────────────────────────────────────────────────

export type MergeInput = {
  /** This phone's copy, as read before the backup was fetched. */
  local: SyncSnapshot;
  /** The backup. */
  remote: SyncSnapshot;
  /** The backup as this phone last saw it, or null on its first merge (a phone
   *  new to merging, or one that never backed up): with nothing to tell who
   *  changed what, everything either holds is kept, and an item they hold
   *  differently is this phone's. */
  base: SyncBase | null;
  localDeleted: Tombstone[];
  remoteDeleted: Tombstone[];
  /** When each side's last change was made (epoch ms): which wins an item, or
   *  a program's part, changed on both. A tie is this phone's. */
  localChangedAt: number;
  remoteChangedAt: number;
  /** The backup was sent by an app from before 0057, which never takes the
   *  other phone's changes in: what it holds differently is almost always just
   *  old (a name since changed, a program since finished), so only what it
   *  ADDS comes in; this phone's version of everything else stands. */
  remoteFromOlderApp?: boolean;
  now?: number;
};

/** What writing the merge changes on the phone, item by item (by Entry key),
 *  with each touched item as it was read, so applying it can leave alone an
 *  item changed on the phone in the meantime (applyChanges). */
export type KindChanges = {
  put: Map<string, Item>;
  drop: Set<string>;
  /** JSON of the phone's item as the merge read it, for each one replaced or
   *  dropped. A key in `put` without one is an addition. */
  was: Map<string, string>;
};
export type SyncChanges = Record<SyncKind, KindChanges>;

export type MergeResult = {
  merged: SyncSnapshot;
  deleted: Tombstone[];
  changes: SyncChanges;
  /** Writing the merge changes something on the phone. */
  changedHere: boolean;
  /** Items (or program parts) both phones had changed. */
  conflicts: number;
};

/** Which version an item takes: "merge" is a program both changed, decided
 *  part by part. */
type Pick = "local" | "remote" | "drop" | "merge";

export function mergeSnapshots(input: MergeInput): MergeResult {
  const { local, remote, base } = input;
  const deleted = mergeTombstones(input.localDeleted, input.remoteDeleted, input.now);
  const localWinsTie = input.localChangedAt >= input.remoteChangedAt;
  const olderApp = input.remoteFromOlderApp === true;
  const newer = (): "local" | "remote" => (base === null || olderApp || localWinsTie ? "local" : "remote");
  /** The backup changed it and this phone didn't. */
  const backupsChange = (): "local" | "remote" => (olderApp ? "local" : "remote");
  let conflicts = 0;

  const merged = { programs: [], workouts: [], journal: [], custom: [] } as unknown as SyncSnapshot;
  const changes = {} as SyncChanges;
  const localIds = programIdsOf(local);
  const remoteIds = programIdsOf(remote);

  for (const kind of SYNC_KINDS) {
    const baseOfKind = base?.[kind] ?? {};
    const tombstoned = new Set(deleted.filter(t => t.k === kind).map(t => t.id));
    const tombByKey = new Map(deleted.filter(t => t.k === kind && t.key).map(t => [t.key as string, t.id]));

    const mine = entriesOf(kind, listOf(local, kind), localIds);
    const theirs = entriesOf(kind, listOf(remote, kind), remoteIds);
    const mineByKey = new Map(mine.map(e => [e.key, e]));
    const theirKeys = new Set(theirs.map(e => e.key));

    // A copy of one of mine under another id is matched by what it is, an
    // exact copy first, so neither phone ends up with two.
    const unmatchedMine = new Map<string, Entry[]>();
    for (const e of mine) {
      if (theirKeys.has(e.key) || !e.nk) continue;
      unmatchedMine.set(e.nk, [...(unmatchedMine.get(e.nk) ?? []), e]);
    }
    const baseByNk = new Map<string, string>();
    for (const [key, b] of Object.entries(baseOfKind)) {
      if (b.key && !mineByKey.has(key) && !theirKeys.has(key)) baseByNk.set(b.key, key);
    }
    const remoteEntries: Entry[] = theirs.map(e => {
      if (mineByKey.has(e.key) || baseOfKind[e.key] || !e.nk) return e;
      const candidates = unmatchedMine.get(e.nk);
      if (candidates && candidates.length > 0) {
        const i = Math.max(0, candidates.findIndex(c => c.hash === e.hash));
        const [match] = candidates.splice(i, 1);
        return { ...e, key: match.key };
      }
      const based = baseByNk.get(e.nk);
      if (based) { baseByNk.delete(e.nk); return { ...e, key: based }; }
      const dead = tombByKey.get(e.nk);
      if (dead) return { ...e, key: dead };
      return e;
    });
    const theirsByKey = new Map(remoteEntries.map(e => [e.key, e]));

    const decide = (l: Entry | undefined, r: Entry | undefined, b: BaseEntry | undefined, key: string): Pick => {
      // Deleted on either phone: gone, an edit since included.
      if (tombstoned.has(idOfKey(key))) return "drop";
      if (l && r) {
        if (l.hash === r.hash) return "local";
        if (b && l.hash === b.h) return backupsChange();
        if (b && r.hash === b.h) return "local";
        // Changed on both, or held differently with nothing to say who changed it.
        if (kind === "programs") return "merge";
        conflicts++;
        return newer();
      }
      // On one side only, with no delete: kept, whichever side lost it.
      return l ? "local" : "remote";
    };

    /** Both phones changed a program: part by part. */
    const mergeProgram = (l: Entry, r: Entry, b: BaseEntry | undefined): SavedProgram => {
      let out = l.item as SavedProgram;
      const from = r.item as SavedProgram;
      for (const part of PARTS) {
        const lp = l.parts?.[part];
        const rp = r.parts?.[part];
        if (lp === rp) continue;
        const bp = b?.parts?.[part];
        let take: "local" | "remote";
        if (!bp) { conflicts++; take = newer(); }
        else if (lp === bp) take = backupsChange();
        else if (rp === bp) take = "local";
        else { conflicts++; take = newer(); }
        if (take === "remote") out = withFields(out, from, PROGRAM_PARTS[part].fields);
      }
      return out;
    };

    const kept: Item[] = [];
    const added: Item[] = [];
    const put = new Map<string, Item>();
    const drop = new Set<string>();
    const was = new Map<string, string>();
    /** A copy of theirs taken under my key carries my id. */
    const asMine = (r: Entry, key: string): Item => {
      if (kind === "custom") {
        const mineItem = mineByKey.get(key)?.item as CustomExercise | undefined;
        if (!mineItem) return r.item;
        const { id: _drop, ...rest } = r.item as CustomExercise;
        return (mineItem.id ? { ...rest, id: mineItem.id } : rest) as Item;
      }
      const id = (r.item as { id?: string }).id;
      const own = idOfKey(key);
      return id === own || own.startsWith("key|") ? r.item : ({ ...r.item, id: own } as Item);
    };

    for (const l of mine) {
      const r = theirsByKey.get(l.key);
      const pick = decide(l, r, baseOfKind[l.key], l.key);
      if (pick === "drop") {
        drop.add(l.key);
        was.set(l.key, JSON.stringify(l.item));
        continue;
      }
      let item: Item = l.item;
      if (pick === "remote" && r) item = asMine(r, l.key);
      else if (pick === "merge" && r) item = mergeProgram(l, r, baseOfKind[l.key]);
      if (item !== l.item) {
        put.set(l.key, item);
        was.set(l.key, JSON.stringify(l.item));
      }
      kept.push(item);
    }
    for (const r of remoteEntries) {
      if (mineByKey.has(r.key)) continue;
      const pick = decide(undefined, r, baseOfKind[r.key], r.key);
      if (pick === "drop") continue;
      const item = asMine(r, r.key);
      put.set(r.key, item);
      added.push(item);
    }

    // The newest first, as the phone keeps sessions and entries; programs and
    // exercises after the ones already there, as they're kept in the order made.
    if (kind === "workouts") {
      added.sort((a, b) => Date.parse((b as CompletedWorkout).completedAt) - Date.parse((a as CompletedWorkout).completedAt));
      (merged.workouts as Item[]).push(...added, ...kept);
    } else if (kind === "journal") {
      added.sort((a, b) => Date.parse((b as JournalEntry).createdAt) - Date.parse((a as JournalEntry).createdAt));
      (merged.journal as Item[]).push(...added, ...kept);
    } else {
      (merged[kind] as Item[]).push(...kept, ...added);
    }
    changes[kind] = { put, drop, was };
  }

  const changedHere = SYNC_KINDS.some(k => changes[k].put.size > 0 || changes[k].drop.size > 0);
  return { merged, deleted, changes, changedHere, conflicts };
}

/** `to` with `fields` as `from` has them (absent where `from` has none). */
function withFields(to: SavedProgram, from: SavedProgram, fields: (keyof SavedProgram)[]): SavedProgram {
  const out = { ...to } as Record<string, unknown>;
  const src = from as unknown as Record<string, unknown>;
  for (const f of fields) {
    if (src[f] === undefined) delete out[f];
    else out[f] = src[f];
  }
  return out as unknown as SavedProgram;
}

/** A program with where it stands (its schedule part) taken from another
 *  version of it. */
export function withScheduleOf(program: SavedProgram, from: SavedProgram): SavedProgram {
  return withFields(program, from, PROGRAM_PARTS.schedule.fields);
}

/**
 * Undo a hold the app put on by itself on a phone that was behind. A phone
 * left unopened for a week holds the active program as it opens (a week with
 * nothing logged, utils/programPause.ts autoPauseIfIdle), before it has the
 * other phone's sessions: merged, that hold would reach the phone being
 * trained on. So when the sessions merged in show the program was trained in
 * the week before the hold, the program takes the backup's version of where
 * it stands instead. `marker` is the hold the app last put on (utils/
 * syncLocal.ts AUTO_PAUSE_KEY); a hold the backup has too, or one the merged
 * sessions still bear out, stays. Changes `result` in place; true if it did.
 */
export function undoStaleAutoPause(
  result: MergeResult,
  local: SyncSnapshot,
  remote: SyncSnapshot,
  marker: { programId: string; pausedAt: string } | null,
  afterDays: number,
): boolean {
  if (!marker) return false;
  const i = result.merged.programs.findIndex(p => p.id === marker.programId);
  const theirs = remote.programs.find(p => p.id === marker.programId);
  if (i < 0 || !theirs || theirs.pausedAt) return false;
  const held = result.merged.programs[i];
  if (held.pausedAt !== marker.pausedAt) return false;
  const dates = [...new Set(result.merged.workouts.map(w => w.date))];
  if (idleDays(theirs, dates, marker.pausedAt) >= afterDays) return false;
  const next = withScheduleOf(held, theirs);
  result.merged.programs[i] = next;
  const c = result.changes.programs;
  const mine = local.programs.find(p => p.id === marker.programId);
  if (mine && !c.was.has(marker.programId)) c.was.set(marker.programId, JSON.stringify(mine));
  c.put.set(marker.programId, next);
  result.changedHere = true;
  return true;
}

// ─── Writing it on the phone ────────────────────────────────────────────────

/**
 * `current` (one list as the phone holds it now) with a merge's changes made:
 * what it adds, replaces and drops. An item changed on the phone since the
 * merge read it is left as it is now, and so is one deleted meanwhile: the
 * next backup takes the phone's change up, and the merge after it sorts out
 * anything still apart. Additions go where mergeSnapshots puts them.
 */
export function applyChanges<T extends Item>(kind: SyncKind, current: T[], c: KindChanges): T[] {
  if (c.put.size === 0 && c.drop.size === 0) return current;
  const keys = keysOf(kind, current);
  const present = new Set(keys);
  const out: T[] = [];
  current.forEach((item, i) => {
    const key = keys[i];
    const before = c.was.get(key);
    const untouched = before === undefined || before === JSON.stringify(item);
    if (c.drop.has(key)) {
      if (!untouched) out.push(item);
      return;
    }
    const next = c.put.get(key);
    out.push((next && before !== undefined && untouched ? next : item) as T);
  });
  const additions = [...c.put.entries()]
    .filter(([key]) => !c.was.has(key) && !present.has(key))
    .map(([, item]) => item as T);
  if (additions.length === 0) return out;
  return kind === "workouts" || kind === "journal" ? [...additions, ...out] : [...out, ...additions];
}

/** The days trained after a merge: those of the sessions it added in, and
 *  none left that only a dropped session had. */
export function datesAfter(dates: string[], before: CompletedWorkout[], after: CompletedWorkout[]): string[] {
  const now = new Set(after.map(w => w.date));
  const had = new Set(before.map(w => w.date));
  const kept = dates.filter(d => now.has(d) || !had.has(d));
  const known = new Set(kept);
  for (const d of now) if (!known.has(d)) { kept.push(d); known.add(d); }
  return kept;
}

/** Whether two copies hold the same things (each item, by hash). */
export function sameSnapshot(a: SyncSnapshot, b: SyncSnapshot): boolean {
  return sameBase(baseOf(a), baseOf(b));
}
