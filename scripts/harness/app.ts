// The app's code, run against the real database, one simulated phone per
// person. IMPORT THIS FIRST: it swaps out the modules that only exist on a
// phone before anything from the app loads them.
//
//   AsyncStorage   an in-memory store per phone
//   lib/supabase   a client that runs each query AS that phone's account, with
//                  Supabase's API role and the real Row Level Security, against
//                  the in-memory Postgres from ./db.ts
//   expo-file-system, the account-type context   inert stand-ins
//
// Which phone an action runs on travels with it (AsyncLocalStorage), so two
// people acting AT THE SAME TIME (Promise.all) each read and write their own
// storage and query as themselves, and their awaits interleave the way two
// phones' network calls do. Every storage and network call yields first, so
// an action that reads, awaits, and writes back can be overtaken exactly as it
// can on a phone.

import type { PGlite } from "@electric-sql/pglite";

type NodeModule = {
  _load(request: string, parent: { filename?: string } | null, isMain: boolean): unknown;
};
/* eslint-disable @typescript-eslint/no-require-imports -- Node built-ins, no @types/node (see ./db.ts) */
const Module = require("node:module") as NodeModule;
const { AsyncLocalStorage } = require("node:async_hooks") as {
  AsyncLocalStorage: new <T>() => { run<R>(store: T, fn: () => R): R; getStore(): T | undefined };
};
const path = require("node:path") as {
  resolve(...parts: string[]): string;
  dirname(p: string): string;
  join(...parts: string[]): string;
};
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;
declare const setImmediate: (fn: () => void) => void;

(globalThis as { __DEV__?: boolean }).__DEV__ = true;

// â”€â”€â”€ Phones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type Phone = {
  uid: string;
  name: string;
  store: Map<string, string>;
  /** Network calls fail, as with no signal. */
  offline: boolean;
};

const current = new AsyncLocalStorage<Phone>();

/** Run `fn` on `phone`: its storage, its account. */
export function on<T>(phone: Phone, fn: () => Promise<T>): Promise<T> {
  return current.run(phone, fn);
}

function phone(): Phone {
  const p = current.getStore();
  if (!p) throw new Error("harness: app code ran outside on(phone, ...)");
  return p;
}

/** One trip round the event loop: what a native call or a request costs. */
const yieldNow = () => new Promise<void>(resolve => setImmediate(resolve));

// â”€â”€â”€ What the app logged â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Swallowed errors surface as `if (__DEV__) console.warn("[avenas] â€¦")`, so
// these are how a scenario finds a failure the app hid from the user.

export const warnings: { phone: string; text: string }[] = [];
const realWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const text = args.map(a => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  if (text.startsWith("[avenas]")) {
    warnings.push({ phone: current.getStore()?.name ?? "?", text });
    return;
  }
  realWarn(...args);
};

// â”€â”€â”€ AsyncStorage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const asyncStorage = {
  async getItem(key: string) { const p = phone(); await yieldNow(); return p.store.get(key) ?? null; },
  async setItem(key: string, value: string) { const p = phone(); await yieldNow(); p.store.set(key, String(value)); },
  async removeItem(key: string) { const p = phone(); await yieldNow(); p.store.delete(key); },
  async getAllKeys() { const p = phone(); await yieldNow(); return [...p.store.keys()]; },
  async multiGet(keys: string[]) { const p = phone(); await yieldNow(); return keys.map(k => [k, p.store.get(k) ?? null]); },
  async multiSet(pairs: [string, string][]) { const p = phone(); await yieldNow(); for (const [k, v] of pairs) p.store.set(k, v); },
  async multiRemove(keys: string[]) { const p = phone(); await yieldNow(); for (const k of keys) p.store.delete(k); },
  async clear() { const p = phone(); await yieldNow(); p.store.clear(); },
};

// â”€â”€â”€ Supabase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let db: PGlite | null = null;
export function connectDb(next: PGlite) { db = next; }

type Result = { data: unknown; error: { message: string } | null };

/** PostgREST hands timestamps back as ISO strings, and so does this. */
function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}
function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]));
}

/** Timestamps come back as text at the database's own precision, the way
 *  PostgREST sends them ("2026-09-26T10:00:00.123456+00:00"), not as a JS Date
 *  cut to milliseconds: the app compares them back against the database
 *  (a guarded update's `.eq("returned_at", â€¦)`), and a rounded one never
 *  matches. */
const isoTime = (v: string) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
const TIME_AS_TEXT = { 1184: isoTime, 1114: isoTime, 1082: (v: string) => v };

/** One request, as the phone's account: the API role, its uid for auth.uid(),
 *  and Row Level Security deciding, as on Supabase. */
async function request(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const p = phone();
  if (!db) throw new Error("harness: no database (connectDb)");
  await yieldNow();
  if (p.offline) throw new Error("Network request failed");
  const res = await db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [p.uid]);
    await tx.exec("set local role authenticated");
    return tx.query<Record<string, unknown>>(sql, params, { parsers: TIME_AS_TEXT });
  });
  await yieldNow();
  return res.rows.map(plainRow);
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`harness: unexpected column "${name}"`);
  return name;
};

type Filter = { sql: (next: (v: unknown) => string) => string };

/** The part of supabase-js's query builder the app uses, turned into SQL. */
class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private cols = "*";
  private returning = false;
  private filters: Filter[] = [];
  private orderBy: string | null = null;
  private limitN: number | null = null;
  private single: "maybe" | "one" | null = null;
  private payload: Record<string, unknown>[] | Record<string, unknown> | null = null;

  constructor(private table: string) {}

  select(cols = "*") {
    if (this.op === "select") this.cols = cols;
    else { this.returning = true; this.cols = cols; }
    return this;
  }
  insert(rows: Record<string, unknown> | Record<string, unknown>[]) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Record<string, unknown>) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, v: unknown) { this.filters.push({ sql: n => `${ident(col)} = ${n(v)}` }); return this; }
  neq(col: string, v: unknown) { this.filters.push({ sql: n => `${ident(col)} <> ${n(v)}` }); return this; }
  in(col: string, vs: unknown[]) { this.filters.push({ sql: n => `${ident(col)} = any(${n(vs)})` }); return this; }
  is(col: string, v: null) {
    if (v !== null) throw new Error("harness: is() only takes null");
    this.filters.push({ sql: () => `${ident(col)} is null` });
    return this;
  }
  not(col: string, op: string, v: null) {
    if (op !== "is" || v !== null) throw new Error(`harness: not(${op}) unsupported`);
    this.filters.push({ sql: () => `${ident(col)} is not null` });
    return this;
  }
  /** "a.eq.X,b.eq.Y" */
  or(expr: string) {
    const parts = expr.split(",").map(s => {
      const [col, op, ...rest] = s.split(".");
      if (op !== "eq") throw new Error(`harness: or(${s}) unsupported`);
      return { col, v: rest.join(".") };
    });
    this.filters.push({ sql: n => `(${parts.map(p => `${ident(p.col)} = ${n(p.v)}`).join(" or ")})` });
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) { this.orderBy = `${ident(col)} ${opts.ascending === false ? "desc" : "asc"}`; return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.single = "maybe"; return this; }

  then<A, B>(ok?: ((r: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, fail);
  }

  private async run(): Promise<Result> {
    const params: unknown[] = [];
    const n = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = this.filters.length ? ` where ${this.filters.map(f => f.sql(n)).join(" and ")}` : "";
    const table = `public.${ident(this.table)}`;
    const cols = this.cols === "*" ? "*" : this.cols.split(",").map(c => ident(c.trim())).join(", ");
    let sql: string;
    if (this.op === "select") {
      sql = `select ${cols} from ${table}${where}${this.orderBy ? ` order by ${this.orderBy}` : ""}${this.limitN ? ` limit ${this.limitN}` : ""}`;
    } else if (this.op === "insert") {
      const rows = this.payload as Record<string, unknown>[];
      const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
      sql = `insert into ${table} (${keys.map(ident).join(", ")}) values ${rows.map(r => `(${keys.map(k => (k in r ? n(r[k]) : "default")).join(", ")})`).join(", ")}${this.returning ? ` returning ${cols}` : ""}`;
    } else if (this.op === "update") {
      const patch = this.payload as Record<string, unknown>;
      sql = `update ${table} set ${Object.keys(patch).map(k => `${ident(k)} = ${n(patch[k])}`).join(", ")}${where}${this.returning ? ` returning ${cols}` : ""}`;
    } else {
      sql = `delete from ${table}${where}${this.returning ? ` returning ${cols}` : ""}`;
    }
    try {
      const rows = await request(sql, params);
      if (this.single) {
        if (rows.length > 1) return { data: null, error: { message: "multiple rows" } };
        return { data: rows[0] ?? null, error: null };
      }
      return { data: this.op === "select" || this.returning ? rows : null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }
}

const supabase = {
  from: (table: string) => new Query(table),
  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
    const params: unknown[] = [];
    const named = Object.entries(args).map(([k, v]) => { params.push(v); return `${ident(k)} => $${params.length}`; });
    try {
      const rows = await request(`select public.${ident(fn)}(${named.join(", ")}) as result`, params);
      return { data: rows[0]?.result ?? null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  },
  auth: {
    async getSession() {
      const p = current.getStore();
      return { data: { session: p ? { user: { id: p.uid }, access_token: "test" } : null }, error: null };
    },
    async getUser() {
      const p = current.getStore();
      return { data: { user: p ? { id: p.uid } : null }, error: null };
    },
    startAutoRefresh() {},
    stopAutoRefresh() {},
  },
  storage: {
    from: () => ({
      getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.test/${p}` } }),
      async list() { return { data: [], error: null }; },
      async remove() { return { data: [], error: null }; },
      async upload() { return { data: null, error: null }; },
    }),
  },
  channel() { throw new Error("harness: realtime isn't simulated"); },
};

// â”€â”€â”€ Swapping the phone-only modules in â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const APP_ROOT = path.resolve(__dirname, "../..");
const norm = (p: string) => p.toLowerCase();

const byRequest: Record<string, unknown> = {
  "@react-native-async-storage/async-storage": { __esModule: true, default: asyncStorage },
  "expo-file-system/legacy": {
    __esModule: true,
    getInfoAsync: async () => ({ exists: false }),
    uploadAsync: async () => ({ status: 500, body: "harness: no uploads" }),
    FileSystemUploadType: { BINARY_CONTENT: 0 },
  },
};
const byFile: Record<string, unknown> = {
  [norm(path.join(APP_ROOT, "lib", "supabase.ts"))]: {
    __esModule: true, supabase, SUPABASE_URL: "http://localhost", SUPABASE_ANON_KEY: "anon",
  },
  // A React context: only its storage key is needed, and its JSX isn't
  // something this runner compiles.
  [norm(path.join(APP_ROOT, "contexts", "AccountTypeContext.tsx"))]: {
    __esModule: true, ACCOUNT_TYPE_KEY: "@avenas/account_type",
  },
};

/**
 * A copy of the app's modules of its own, as each phone has: whatever `load`
 * requires comes back as fresh instances, with fresh module state (the
 * trainer store's one-at-a-time queue, cached pages). Sharing one copy would
 * make every simulated phone wait in the same queue, which no two real phones
 * do.
 */
export function freshApp<T>(load: () => T): T {
  const cache = (require as unknown as { cache: Record<string, unknown> }).cache;
  const root = norm(APP_ROOT);
  const skip = [norm(path.join(APP_ROOT, "node_modules")), norm(path.join(APP_ROOT, "scripts"))];
  for (const file of Object.keys(cache)) {
    const n = norm(file);
    if (n.startsWith(root) && !skip.some(s => n.startsWith(s))) delete cache[file];
  }
  return load();
}

const originalLoad = Module._load;
Module._load = function (this: unknown, request, parent, isMain) {
  if (request in byRequest) return byRequest[request];
  if (request.startsWith(".") && parent?.filename) {
    const base = path.resolve(path.dirname(parent.filename), request);
    for (const ext of ["", ".ts", ".tsx"]) {
      const hit = byFile[norm(base + ext)];
      if (hit) return hit;
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

/** The stand-in client, for a check that talks to the database the way a
 *  modified app could, bypassing the app's own column rules. */
export const fakeSupabase = supabase;
