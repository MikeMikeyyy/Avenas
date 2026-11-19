// The AI, on the server (migrations 0060, 0061; docs/ARCHITECTURE.md "AI").
//
// The app calls this with the person's sign-in; it is the only thing that
// holds the Anthropic API key (a Supabase secret, ANTHROPIC_API_KEY), so the
// key never reaches a phone where it could be pulled out and used.
//
// Every call, in order:
//   1. Who: the sign-in must be a real account (not anonymous).
//   2. What: the body is checked against request.ts's limits; anything too
//      big is refused before it costs anything.
//   3. May they: ai_begin() counts the call against the account's limits, the
//      minute's rate and everyone's daily budget, or says which one is spent.
//   4. The model is called. Its answer goes back to the app: all at once, or
//      as it's written when the app asks for a stream (request.ts StreamEvent).
//   5. ai_finish() records the tokens and cost, or takes the call back when it
//      failed on our side or Anthropic's.
//
// Deploy: `npx supabase functions deploy ai`. Secret: ANTHROPIC_API_KEY (in
// the dashboard's Edge Functions > Secrets). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { CHAT_SYSTEM, INTERVIEW_SYSTEM, PROGRAM_SYSTEM, trainingBlock } from "./prompts.ts";
import {
  costMicros, ERRORS, isOutOfCredit, LIMITS, limitCode, MODELS, parseRequest, PROGRAM_SCHEMA, sseLine,
  type AskFeature, type ErrorCode, type StreamEvent, type Usage,
} from "./request.ts";

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
  timeout: 120_000,
  maxRetries: 1,
});

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (code: ErrorCode) => json(ERRORS[code], { error: code });

/** Each feature's instructions. */
const SYSTEMS: Record<AskFeature, string> = { chat: CHAT_SYSTEM, interview: INTERVIEW_SYSTEM, program: PROGRAM_SYSTEM };

/** What the person is told when the model (and its fallback) declines. */
const DECLINED = "I can't help with that one. Ask me anything about your training.";

/** What a failed model call means for the person. */
function codeFor(e: unknown): ErrorCode {
  if (e instanceof Anthropic.APIError && isOutOfCredit(e.status, e.message)) {
    console.error("[ai] out of credit or at the Console spend limit", e.status, e.message);
    return "ai_budget";
  }
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.OverloadedError) {
    console.warn("[ai] anthropic busy", e.status);
  } else if (e instanceof Anthropic.APIError) {
    console.error("[ai] anthropic error", e.status, e.message);
  } else {
    console.error("[ai] call failed", e);
  }
  return "ai_unavailable";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "bad_request" });

  // 1. Who.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return fail("unauthorized");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (authError || !user || user.is_anonymous) return fail("unauthorized");

  // 2. What. Size first, before reading a body of any length.
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (declared > LIMITS.bodyBytes) return fail("bad_request");
  const raw = await req.text();
  if (raw.length > LIMITS.bodyBytes) return fail("bad_request");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("bad_request");
  }
  const parsed = parseRequest(body);
  if (!parsed.ok) {
    console.warn("[ai] refused request", user.id, parsed.error);
    return fail("bad_request");
  }
  const { req: ask } = parsed;
  const setup = MODELS[ask.feature];

  // 3. May they.
  const { data: callId, error: limitError } = await admin.rpc("ai_begin", { p_user: user.id, p_feature: ask.feature });
  if (limitError) {
    const code = limitCode(limitError.message);
    if (code) return fail(code);
    console.error("[ai] ai_begin failed", limitError.message);
    return fail("ai_unavailable");
  }

  // 5, for every way a call ends.
  const finish = (served: string, usage: Usage) =>
    admin.rpc("ai_finish", {
      p_id: callId,
      p_ok: true,
      p_model: served,
      p_input_tokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      p_output_tokens: usage.output_tokens,
      p_cost_micros: costMicros(setup.model, served, usage),
    });
  const takeBack = () => admin.rpc("ai_finish", { p_id: callId, p_ok: false });

  // 4. The model.
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: setup.model,
    max_tokens: setup.maxTokens,
    system: SYSTEMS[ask.feature],
    // The training data rides on the first message, so everything before the
    // newest question stays the same from one turn to the next (the cache).
    messages: ask.messages.map((m, i) => ({
      role: m.role,
      content: i === 0 ? `${trainingBlock(ask.context)}\n\n${m.text}` : m.text,
    })),
    // A program comes back as JSON of exactly PROGRAM_SCHEMA's shape.
    output_config: ask.feature === "program"
      ? { effort: setup.effort, format: { type: "json_schema", schema: PROGRAM_SCHEMA as unknown as Record<string, unknown> } }
      : { effort: setup.effort },
    cache_control: { type: "ephemeral" },
    // A request the model declines for safety is retried on Anthropic's
    // recommended fallback model, server-side.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Lets Anthropic tell abuse by one account from abuse by the app.
    metadata: { user_id: user.id },
  };

  if (!ask.stream) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await anthropic.beta.messages.create(params);
    } catch (e) {
      await takeBack();
      return fail(codeFor(e));
    }
    await finish(response.model, response.usage);
    if (response.stop_reason === "refusal") return json(200, { text: DECLINED });
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) return fail("ai_unavailable");
    return json(200, { text, truncated: response.stop_reason === "max_tokens" });
  }

  // Streamed: each piece of the reply goes to the app as it's written.
  const encoder = new TextEncoder();
  let stream: ReturnType<typeof anthropic.beta.messages.stream> | null = null;
  let closedByApp = false;
  const body2 = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (!closedByApp) controller.enqueue(encoder.encode(sseLine(event)));
      };
      // Keeps the connection from timing out while the model thinks.
      const ping = setInterval(() => {
        if (!closedByApp) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 10_000);
      // What the call has used so far, for when it ends early.
      let served = setup.model;
      let usage: Usage | null = null;
      try {
        stream = anthropic.beta.messages.stream(params);
        for await (const event of stream) {
          if (event.type === "message_start") {
            served = event.message.model;
            usage = { ...event.message.usage };
          } else if (event.type === "message_delta" && usage) {
            usage = {
              input_tokens: event.usage.input_tokens ?? usage.input_tokens,
              output_tokens: event.usage.output_tokens,
              cache_creation_input_tokens: event.usage.cache_creation_input_tokens ?? usage.cache_creation_input_tokens,
              cache_read_input_tokens: event.usage.cache_read_input_tokens ?? usage.cache_read_input_tokens,
            };
          } else if (event.type === "content_block_start") {
            if (event.content_block.type === "thinking") send({ type: "status", status: "thinking" });
            // The model declined part way; its fallback starts the reply again.
            if (event.content_block.type === "fallback") send({ type: "reset" });
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "text", text: event.delta.text });
          }
        }
        const final = await stream.finalMessage();
        await finish(final.model, final.usage);
        if (final.stop_reason === "refusal") {
          send({ type: "reset" });
          send({ type: "text", text: DECLINED });
        }
        send({ type: "done", truncated: final.stop_reason === "max_tokens" });
      } catch (e) {
        if (closedByApp) {
          // The person left mid-answer: what was written is still paid for.
          if (usage) await finish(served, usage);
          else await takeBack();
        } else {
          await takeBack();
          send({ type: "error", error: codeFor(e) });
        }
      } finally {
        clearInterval(ping);
        if (!closedByApp) controller.close();
      }
    },
    cancel() {
      // The app went away (Insights closed): stop the model, and the spending.
      closedByApp = true;
      stream?.abort();
    },
  });
  return new Response(body2, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
});
