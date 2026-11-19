// What the AI function accepts, which model each feature runs on, and what a
// call cost. No imports, so scripts/verify-ai.ts runs it under Node as well as
// the function under Deno.

export type Feature = "chat" | "interview" | "program" | "insight";

/** The features a request can ask for so far (insight is still to come). */
export type AskFeature = "chat" | "interview" | "program";
const ASK_FEATURES: readonly AskFeature[] = ["chat", "interview", "program"];

/** One message of a conversation, as the app sends it. */
export type Turn = { role: "user" | "assistant"; text: string };

export type AiRequest = {
  /** chat: Insights. interview: the program builder asking its questions.
   *  program: the program builder building one (PROGRAM_SCHEMA JSON). */
  feature: AskFeature;
  /** Oldest first, ending with the person's new message. */
  messages: Turn[];
  /** The person's training, summarised on the phone (utils/aiContext.ts). */
  context: string;
  /** Send the reply as it's written (StreamEvent lines), not all at the end. */
  stream: boolean;
};

/**
 * What a streamed reply sends, one per `data:` line (server-sent events), in
 * this order: `status` while the model thinks (maybe never), `text` as the
 * reply is written, `reset` if the words so far are to be thrown away (the
 * model declined part way and its fallback starts again), then `done` or
 * `error`. A `: ping` comment line every few seconds keeps the connection
 * from timing out while the model thinks.
 */
export type StreamEvent =
  | { type: "status"; status: "thinking" }
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "done"; truncated: boolean }
  | { type: "error"; error: ErrorCode };

/** One event, as the server writes it. */
export function sseLine(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * The events complete in `buffer` (what's arrived so far), and what's left of
 * it to wait for the rest of. Pings and anything that isn't an event are
 * skipped.
 */
export function parseSse(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  const text = buffer.replace(/\r\n/g, "\n");
  let start = 0;
  let end: number;
  while ((end = text.indexOf("\n\n", start)) >= 0) {
    for (const line of text.slice(start, end).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event && typeof event.type === "string") events.push(event as StreamEvent);
      } catch {
        // A line that isn't ours: skipped.
      }
    }
    start = end + 2;
  }
  return { events, rest: text.slice(start) };
}

/** How big a request may be. Anything over is refused, never cut short, so
 *  nobody pays for a question that lost its end. */
export const LIMITS = {
  /** The whole body, before it's read. */
  bodyBytes: 120_000,
  /** Messages sent back to the model; the app sends no more than this. */
  turns: 20,
  /** One message the person wrote. */
  userChars: 2_000,
  /** One reply of the assistant's, sent back as history. */
  assistantChars: 8_000,
  /** The training summary. */
  contextChars: 16_000,
} as const;

/** Each feature's model, how long its reply may be and how hard it thinks
 *  (user pick, 2026-11-13: Opus 5.5 for programs, Sonnet 5.5 for the rest).
 *  Chat thinks at "low" (user ask, 2026-11-13: the answer should start
 *  sooner; gym questions don't need long thought). */
export const MODELS: Record<Feature, { model: string; maxTokens: number; effort: "low" | "medium" | "high" }> = {
  chat: { model: "claude-sonnet-5-5", maxTokens: 2_000, effort: "low" },
  interview: { model: "claude-opus-5-5", maxTokens: 1_500, effort: "low" },
  // High: it plans weekly volume per muscle and each day's time (user ask,
  // 2026-11-14: a build at medium gave a 2-hour session).
  program: { model: "claude-opus-5-5", maxTokens: 16_000, effort: "high" },
  insight: { model: "claude-sonnet-5-5", maxTokens: 800, effort: "low" },
};

export type Parsed = { ok: true; req: AiRequest } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks a request body; `error` says what was wrong (for the log, not the person). */
export function parseRequest(body: unknown): Parsed {
  if (!isObj(body)) return { ok: false, error: "body is not an object" };
  if (!ASK_FEATURES.includes(body.feature as AskFeature)) return { ok: false, error: "unknown feature" };
  const feature = body.feature as AskFeature;

  const context = body.context ?? "";
  if (typeof context !== "string") return { ok: false, error: "context is not text" };
  if (context.length > LIMITS.contextChars) return { ok: false, error: "context too long" };

  if (!Array.isArray(body.messages) || body.messages.length === 0) return { ok: false, error: "no messages" };
  if (body.messages.length > LIMITS.turns) return { ok: false, error: "too many messages" };
  const messages: Turn[] = [];
  for (const m of body.messages) {
    if (!isObj(m) || (m.role !== "user" && m.role !== "assistant") || typeof m.text !== "string") {
      return { ok: false, error: "bad message" };
    }
    const text = m.text.trim();
    if (!text) return { ok: false, error: "empty message" };
    const max = m.role === "user" ? LIMITS.userChars : LIMITS.assistantChars;
    if (text.length > max) return { ok: false, error: "message too long" };
    messages.push({ role: m.role, text });
  }
  // The model's conversation starts with the person and ends with their question.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return { ok: false, error: "must end with the person's message" };
  }
  return { ok: true, req: { feature, messages, context, stream: body.stream === true } };
}

/** US dollars per million tokens, input and output. A model not listed (a
 *  fallback we didn't expect) is priced at the dearest, so the budget errs
 *  towards stopping early. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
};
const DEAREST = { input: 10, output: 50 };

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** What a call cost, in millionths of a dollar, priced at the dearer of the
 *  model asked for and the one that answered (a fallback). Writing to the
 *  cache costs 1.25x input; reading from it 0.1x. */
export function costMicros(requested: string, served: string, usage: Usage): number {
  const a = PRICES[requested] ?? DEAREST;
  const b = PRICES[served] ?? DEAREST;
  const p = { input: Math.max(a.input, b.input), output: Math.max(a.output, b.output) };
  // $ per million tokens = micro-dollars per token.
  const micros =
    usage.input_tokens * p.input +
    (usage.cache_creation_input_tokens ?? 0) * p.input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * p.input * 0.1 +
    usage.output_tokens * p.output;
  return Math.ceil(micros);
}

/** The errors the app is told, each with its HTTP status. */
export const ERRORS = {
  bad_request: 400,
  unauthorized: 401,
  ai_blocked: 403,
  ai_consent: 403,
  ai_disabled: 503,
  ai_budget: 503,
  ai_rate_limit: 429,
  ai_daily_limit: 429,
  ai_monthly_limit: 429,
  ai_unavailable: 502,
} as const;
export type ErrorCode = keyof typeof ERRORS;

/** The limit code a database error carries, if it's one of ai_begin()'s. */
export function limitCode(message: string | undefined): ErrorCode | null {
  const m = /\b(ai_disabled|ai_blocked|ai_consent|ai_budget|ai_rate_limit|ai_daily_limit|ai_monthly_limit)\b/.exec(message ?? "");
  return m ? (m[1] as ErrorCode) : null;
}

/** Anthropic refusing because OUR account is out of credit or at the spend
 *  limit set in the Console (not a fault, and not the person's doing): the
 *  app says the AI is taking a break, as for everyone's daily budget. */
export function isOutOfCredit(status: number | undefined, message: string | undefined): boolean {
  if (status !== 400 && status !== 429) return false;
  return /credit balance is too low|reached your (specified )?(workspace )?api usage limits/i.test(message ?? "");
}

// ── The program builder ──────────────────────────────────────────────────────

/** The interview's last line once it knows enough to build: the app takes it
 *  off the words shown and offers "Build my program" instead. */
export const READY_MARK = "[[READY]]";

/** A reply with the ready mark taken off, and whether it had one. */
export function splitReady(text: string): { text: string; ready: boolean } {
  const ready = text.includes(READY_MARK);
  return { text: ready ? text.split(READY_MARK).join("").trim() : text, ready };
}

/** One exercise of a built program, as the model writes it. */
export type GeneratedExercise = {
  /** A name from AI_EXERCISES, exactly. */
  name: string;
  warmup_sets: number;
  sets: number;
  /** "8", or a range "8-12"; seconds for a hold. */
  reps: string;
  /** A timed hold (a plank): reps are seconds. */
  hold: boolean;
  rest_seconds: number;
  /** A short cue, or "". */
  note: string;
};

/** The app's muscle groups, all a custom exercise can be given (constants/exercises.ts
 *  MUSCLE_GROUPS without "All"; scripts/verify-ai.ts checks they match). */
export const AI_MUSCLES = ["Chest", "Back", "Shoulders", "Legs", "Arms", "Core"] as const;

/** A custom exercise the person agreed in the interview to have made, as the
 *  model defines it for the app to create (utils/aiProgram.ts newExercisesIn). */
export type GeneratedNewExercise = {
  name: string;
  /** From AI_MUSCLES. */
  muscles: string[];
  /** Short how-to steps, in order. */
  steps: string[];
  /** Its weight is help, not load (a machine-assisted exercise). */
  assisted: boolean;
};

/** A day of the cycle: a workout, or a rest day (no exercises). */
export type GeneratedDay = { name: string; rest: boolean; exercises: GeneratedExercise[] };

/** A built program, as the model writes it (PROGRAM_SCHEMA). */
export type GeneratedProgram = {
  name: string;
  weeks: number;
  days: GeneratedDay[];
  /** New custom exercises its days use (always sent; may be missing from an
   *  older reply, so read as none). */
  new_exercises?: GeneratedNewExercise[];
  /** The session length the person gave, in minutes (60 if they didn't): the
   *  app holds every day to it (utils/aiProgram.ts). */
  session_minutes?: number;
  /** 2 to 4 plain lines on running it (effort, progressing, lighter weeks),
   *  given with the program in the chat. */
  how_to_run?: string[];
};

/** The JSON a built program must be (structured outputs: every object closed,
 *  every field required, no number ranges; the app checks those). */
export const PROGRAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "weeks", "session_minutes", "how_to_run", "days", "new_exercises"],
  properties: {
    name: { type: "string", description: "Short program name, a few words." },
    new_exercises: {
      type: "array",
      description: "Only the new custom exercises the person agreed in the interview to create, each used in the days. Usually none.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "muscles", "steps", "assisted"],
        properties: {
          name: { type: "string", description: "Its name, as agreed with the person." },
          muscles: { type: "array", items: { type: "string", enum: AI_MUSCLES } },
          steps: { type: "array", description: "2 to 6 short how-to steps, in order.", items: { type: "string" } },
          assisted: { type: "boolean", description: "True only for a machine-assisted exercise, whose weight is help." },
        },
      },
    },
    weeks: { type: "integer", description: "How many weeks it runs, 4 to 16." },
    session_minutes: { type: "integer", description: "The session length the person gave, in minutes; 60 if they didn't. Every day must fit it." },
    how_to_run: { type: "array", description: "2 to 4 short plain lines on running it: effort, progressing, lighter weeks.", items: { type: "string" } },
    days: {
      type: "array",
      description: "One cycle of days in order, rest days included (usually 7).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "rest", "exercises"],
        properties: {
          name: { type: "string", description: "The workout's name, e.g. Upper or Push. \"Rest\" for a rest day." },
          rest: { type: "boolean" },
          exercises: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "warmup_sets", "sets", "reps", "hold", "rest_seconds", "note"],
              properties: {
                name: { type: "string", description: "Exactly as in the exercise list." },
                warmup_sets: { type: "integer" },
                sets: { type: "integer", description: "Working sets." },
                reps: { type: "string", description: "Reps per working set, \"8\" or \"8-12\"; seconds when hold is true." },
                hold: { type: "boolean", description: "True for a timed hold such as a plank." },
                rest_seconds: { type: "integer" },
                note: { type: "string", description: "A short coaching cue, or empty." },
              },
            },
          },
        },
      },
    },
  },
} as const;
