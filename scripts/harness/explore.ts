// Plays a flow out every way it can go, and checks what everyone sees.
//
// A flow is: a starting point (a program sent, a review asked for), a model of
// what state it's in, what each person should SEE in a given state, how to read
// what they actually see (the app's own loads), and the actions anyone can
// take, each only while its button is on their screen. Then:
//
//   sequences   every sequence of actions up to `depth`, checked at its end
//   at once     from every state within `concurrentDepth`, every pair of
//               available actions: both screens drawn first, then both pressed
//               at the same time, so their awaits interleave like two phones'
//               requests (or a double tap). The result must be what doing them
//               one after the other gives, in one order or the other.
//   stale       the same pairs, but one finishes before the other is pressed
//               on the screen it drew beforehand: the tap on something someone
//               else has just changed, which is the everyday race. The result
//               must be exactly that order's.
//   walks       seeded random runs, checked after every step
//   offline     from the same states, every action pressed with no signal
//               (drawn while online, then the signal drops) and checked once
//               it's back: either the app said it needs a connection and
//               nothing changed, or it only touches the phone (or what it
//               owed the server went once back online) and it's done. Never
//               "looked done and wasn't", never half done.
//
// Anything the app logged as a swallowed error fails too (except offline,
// where the failed requests it logs are the point).

import { warnings } from "./app";
import { EVERYONE } from "./world";
import { alertMessage } from "../../utils/errors";

export type Outcome = "ok" | "refused";
export const OK: Outcome = "ok";
export const REFUSED: Outcome = "refused";
export type Press = () => Promise<Outcome>;

export type Action<M> = {
  label: string;
  /** Which variants of the flow it belongs to ("direct", "group"). */
  kinds: string[];
  /** Its button is on that person's screen in this state. */
  enabled: (m: M) => boolean;
  /** Draw the screen (read whatever the button will act on) and hand back
   *  the press. Separate so two people can both be looking at the state before
   *  either presses. */
  draw: () => Promise<Press>;
  /** What it should do to the state `m`, and whether the app should refuse
   *  it. `drawn` is the state its screen was drawn in: the same as `m` when
   *  pressed straight away, older when someone else acted in between (a card
   *  removed from an out-of-date screen hides the version it showed). */
  apply: (m: M, drawn: M) => Outcome;
  /** Leave out of the at-once pairs with itself (one person can't be in the
   *  same builder twice). */
  notTwiceAtOnce?: boolean;
  /** One person's single screen whose actions each go through a modal prompt
   *  (My Programs' Remove → Archive / Delete), so two of them can't be pressed
   *  in the same instant. Left out of at-once pairs with each other; they're
   *  still played one after the other on out-of-date screens. */
  screen?: string;
};

export type View = Record<string, unknown>;

export type Flow<M> = {
  name: string;
  kind: string;
  /** Reset the world and set up the flow's starting point. */
  start: () => Promise<void>;
  fresh: () => M;
  expected: (m: M) => View;
  observe: () => Promise<View>;
  actions: Action<M>[];
  /** Named sequences (action labels) always played out, checked after every
   *  step: the stories worth pinning, however long, beyond what `depth`
   *  reaches. */
  stories?: string[][];
};

export type Budget = { depth: number; concurrentDepth: number; walks: number; walkLength: number };

export type Report = { checks: number; failures: string[] };

/** "Refused" is the app telling the user it couldn't; anything it throws that
 *  isn't one of those `refusals` is a failure. */
export async function pressed(fn: () => Promise<unknown>, refusals = /no longer available/i): Promise<Outcome> {
  try {
    await fn();
    return OK;
  } catch (e) {
    if (refusals.test((e as Error).message)) return REFUSED;
    throw e;
  }
}

const clone = <M>(m: M): M => JSON.parse(JSON.stringify(m));

function diff(actual: View, want: View): string[] {
  const out: string[] = [];
  for (const k of Object.keys(want)) {
    const a = JSON.stringify(actual[k]);
    const w = JSON.stringify(want[k]);
    if (a !== w) out.push(`      ${k}: expected ${w}\n      ${" ".repeat(k.length)}  actual   ${a}`);
  }
  return out;
}

function takeWarnings(): string[] {
  const w = warnings.map(x => `      ${x.phone}: ${x.text}`);
  warnings.length = 0;
  return w;
}

/** A small seeded PRNG, so a failing walk can be run again. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function explore<M>(flow: Flow<M>, budget: Budget, seedBase = 0): Promise<Report> {
  const report: Report = { checks: 0, failures: [] };
  const seen = new Set<string>();
  const actions = flow.actions.filter(a => a.kinds.includes(flow.kind));

  const fail = (story: string[], what: string) => {
    // One report per distinct problem: the same bug turns up in many sequences.
    const signature = `${story.slice(-1)[0] ?? ""}|${what.replace(/\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)/g, "<time>")}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    report.failures.push(`âœ— [${flow.name}] ${story.join(" â†’ ") || "(start)"}\n${what}`);
  };

  const step = async (a: Action<M>, model: M): Promise<string | null> => {
    const want = a.apply(model, clone(model));
    try {
      const got = await (await a.draw())();
      return got === want ? null : `    "${a.label}" was ${got === "refused" ? "refused" : "done"}, expected ${want === "refused" ? "refused" : "done"}`;
    } catch (e) {
      return `    "${a.label}" threw: ${(e as Error).message}`;
    }
  };

  const replay = async (steps: Action<M>[]): Promise<{ model: M; problem: string | null }> => {
    await flow.start();
    const model = flow.fresh();
    for (const a of steps) {
      const problem = await step(a, model);
      if (problem) return { model, problem };
    }
    return { model, problem: null };
  };

  const check = async (story: string[], model: M) => {
    report.checks += 1;
    const lines = diff(await flow.observe(), flow.expected(model));
    const warned = takeWarnings();
    if (lines.length) fail(story, `    what people see is wrong:\n${lines.join("\n")}`);
    if (warned.length) fail(story, `    the app swallowed an error:\n${warned.join("\n")}`);
  };

  const atOnce = async (steps: Action<M>[], model: M) => {
    const available = actions.filter(a => a.enabled(model));
    for (let i = 0; i < available.length; i++) {
      for (let j = i; j < available.length; j++) {
        const [a, b] = [available[i], available[j]];
        if (a === b && a.notTwiceAtOnce) continue;
        const sameScreen = !!a.screen && a.screen === b.screen;
        if (sameScreen) {
          for (const [first, second] of a === b ? [[a, b]] : [[a, b], [b, a]]) await stale(steps, model, first, second);
          continue;
        }
        const story = [...steps.map(s => s.label), `at once: "${a.label}" + "${b.label}"`];
        const { problem } = await replay(steps);
        if (problem) { fail(story, problem); continue; }
        report.checks += 1;
        let outcomes: Outcome[];
        try {
          const [pa, pb] = [await a.draw(), await b.draw()];
          // allSettled, not all: if one throws, the other must still finish
          // before the next replay resets the phones under it.
          const settled = await Promise.allSettled([pa(), pb()]);
          const thrown = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
          if (thrown) throw thrown.reason;
          outcomes = settled.map(s => (s as PromiseFulfilledResult<Outcome>).value);
        } catch (e) {
          fail(story, `    threw: ${(e as Error).message}`);
          continue;
        }
        const actual = await flow.observe();
        const warned = takeWarnings();
        const tries = ([[a, b, 0, 1], [b, a, 1, 0]] as const).map(([x, y, xi, yi]) => {
          const m = clone(model);
          const ox = x.apply(m, model);
          const oy = y.apply(m, model);
          return {
            ok: outcomes[xi] === ox && outcomes[yi] === oy,
            lines: diff(actual, flow.expected(m)),
            order: `"${x.label}" then "${y.label}"`,
            want: [ox, oy],
          };
        });
        if (!tries.some(t => t.ok && t.lines.length === 0)) {
          fail(story, `    matches neither order (outcomes ${JSON.stringify(outcomes)}):\n${tries.map(t =>
            `    against ${t.order} (outcomes ${JSON.stringify(t.want)}):\n${t.lines.join("\n") || "      (views match)"}`).join("\n")}`);
        }
        if (warned.length) fail(story, `    the app swallowed an error:\n${warned.join("\n")}`);

        for (const [first, second] of a === b ? [[a, b]] : [[a, b], [b, a]]) {
          await stale(steps, model, first, second);
        }
      }
    }
  };

  /** `a` pressed with no signal, then checked with it back. */
  const offlinePress = async (steps: Action<M>[], model: M, a: Action<M>) => {
    const story = [...steps.map(s => s.label), `with no signal: "${a.label}"`];
    const { problem } = await replay(steps);
    if (problem) { fail(story, problem); return; }
    report.checks += 1;
    const after = clone(model);
    a.apply(after, model);
    const press = await a.draw();
    for (const p of EVERYONE) p.offline = true;
    let said: string | null = null;
    try {
      await press();
    } catch (e) {
      said = alertMessage(e, "");
    } finally {
      for (const p of EVERYONE) p.offline = false;
    }
    takeWarnings(); // failed requests, which offline is expected to log
    const seen = await flow.observe();
    takeWarnings();
    if (said !== null) {
      if (!/connection/i.test(said)) fail(story, `    offline it said "${said || "(its generic fallback)"}", not that it needs a connection`);
      const lines = diff(seen, flow.expected(model));
      if (lines.length) fail(story, `    it said it failed, but something changed:\n${lines.join("\n")}`);
      return;
    }
    const lines = diff(seen, flow.expected(after));
    if (lines.length) {
      const nothing = diff(seen, flow.expected(model)).length === 0;
      fail(story, nothing
        ? "    looked done with no signal, but nothing happened"
        : `    half done with no signal:\n${lines.join("\n")}`);
    }
  };

  /** Both screens drawn, `first` pressed and finished, then `second` pressed on
   *  its now out-of-date screen. */
  const stale = async (steps: Action<M>[], model: M, first: Action<M>, second: Action<M>) => {
    const story = [...steps.map(s => s.label), `"${first.label}", then on a screen drawn before it: "${second.label}"`];
    const { problem } = await replay(steps);
    if (problem) { fail(story, problem); return; }
    report.checks += 1;
    const m = clone(model);
    const want = [first.apply(m, model), second.apply(m, model)];
    const got: Outcome[] = [];
    try {
      const [p1, p2] = [await first.draw(), await second.draw()];
      got.push(await p1());
      got.push(await p2());
    } catch (e) {
      fail(story, `    threw: ${(e as Error).message}`);
      return;
    }
    const lines = diff(await flow.observe(), flow.expected(m));
    const warned = takeWarnings();
    if (got[1] !== want[1]) {
      fail(story, `    the second was ${got[1] === "refused" ? "refused" : "done"}, expected ${want[1] === "refused" ? "refused" : "done"}`);
    } else if (lines.length) {
      fail(story, `    what people see is wrong:\n${lines.join("\n")}`);
    }
    if (warned.length) fail(story, `    the app swallowed an error:\n${warned.join("\n")}`);
  };

  // Pinned stories, step by step.
  for (const labels of flow.stories ?? []) {
    await flow.start();
    const model = flow.fresh();
    const story: string[] = [];
    for (const label of labels) {
      const a = actions.find(x => x.label === label);
      if (!a) { fail(story, `    no action "${label}" in this flow`); break; }
      story.push(label);
      if (!a.enabled(model)) { fail(story, `    "${label}" isn't on screen at this point`); break; }
      const problem = await step(a, model);
      if (problem) { fail(story, problem); break; }
      await check(story, model);
    }
  }

  // Sequences, breadth first.
  let frontier: Action<M>[][] = [[]];
  for (let depth = 0; depth <= budget.depth; depth++) {
    const next: Action<M>[][] = [];
    for (const steps of frontier) {
      const { model, problem } = await replay(steps);
      const story = steps.map(s => s.label);
      if (problem) { fail(story, problem); continue; }
      await check(story, model);
      if (depth < budget.depth) for (const a of actions) if (a.enabled(model)) next.push([...steps, a]);
      if (depth <= budget.concurrentDepth) {
        await atOnce(steps, model);
        for (const a of actions) if (a.enabled(model)) await offlinePress(steps, model, a);
      }
    }
    frontier = next;
  }

  // Walks.
  for (let w = 0; w < budget.walks; w++) {
    const rand = rng(seedBase + w);
    await flow.start();
    const model = flow.fresh();
    const story: string[] = [];
    for (let s = 0; s < budget.walkLength; s++) {
      const available = actions.filter(a => a.enabled(model));
      if (available.length === 0) break;
      const a = available[Math.floor(rand() * available.length)];
      story.push(a.label);
      const problem = await step(a, model);
      if (problem) { fail(story, problem); break; }
      await check(story, model);
    }
  }

  return report;
}
