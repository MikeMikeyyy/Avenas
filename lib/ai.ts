// The app's side of the AI (supabase/functions/ai; migration 0060). RN-only
// (imports the Supabase client).
//
// The phone never talks to Anthropic and never holds a key: it sends the
// question and a summary of the person's training to our Edge Function, which
// checks their limits, asks the model and answers. Every failure throws an
// AiError whose `code` says why, and aiErrorMessage() turns it into words for
// the screen (server actions fail honestly, never swallowed).

import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
// Expo's fetch reads a response as it arrives (React Native's waits for all of it).
import { fetch as streamingFetch } from "expo/fetch";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase";
import { LIMITS, parseSse, type AskFeature, type Feature, type Turn } from "../supabase/functions/ai/request";

export type { AskFeature, Feature, Turn };
export { LIMITS as AI_LIMITS };

export type AiErrorCode =
  | "ai_daily_limit"   // this feature's calls, or this account's spend, for the day
  | "ai_monthly_limit" // this account's spend over 30 days
  | "ai_rate_limit"    // too many calls in the last minute
  | "ai_budget"        // everyone's budget for the day is spent, or ours with Anthropic
  | "ai_disabled"      // switched off (kill switch)
  | "ai_blocked"       // this account is kept from the AI
  | "ai_consent"       // the server has no agreement to the AI from this account
  | "unauthorized"     // not signed in, or the sign-in has ended
  | "bad_request"      // the question was too long, or malformed
  | "ai_unavailable"   // the model or the function failed
  | "offline";         // the request never reached the server

const KNOWN: ReadonlySet<string> = new Set<AiErrorCode>([
  "ai_daily_limit", "ai_monthly_limit", "ai_rate_limit", "ai_budget", "ai_disabled", "ai_blocked",
  "ai_consent", "unauthorized", "bad_request", "ai_unavailable", "offline",
]);

/** Whether trying again soon could work (a "Try again" is worth offering). */
export function aiRetryable(code: AiErrorCode): boolean {
  return code === "ai_unavailable" || code === "offline" || code === "ai_rate_limit";
}

export class AiError extends Error {
  constructor(public readonly code: AiErrorCode) {
    super(code);
    this.name = "AiError";
  }
}

/** What to tell the person, for each way a call can fail. No em dashes. */
export function aiErrorMessage(code: AiErrorCode): string {
  switch (code) {
    case "ai_daily_limit": return "You've reached today's AI limit. It frees up over the next 24 hours.";
    case "ai_monthly_limit": return "You've used this month's AI allowance. It frees up again over the coming days.";
    case "ai_rate_limit": return "That's a lot of questions at once. Give it a minute and try again.";
    case "ai_budget":
    case "ai_disabled": return "The AI is taking a break right now. Try again later.";
    case "ai_blocked": return "The AI isn't available on this account.";
    case "ai_consent": return "Agree to sharing your training with the AI to use Insights.";
    case "unauthorized": return "Sign in again to use the AI.";
    case "bad_request": return "That message is too long. Try a shorter one.";
    case "offline": return "You're offline. Connect to ask the AI.";
    case "ai_unavailable":
    default: return "The AI couldn't answer just now. Try again in a moment.";
  }
}

/** The error code an Edge Function failure carries. */
async function codeOf(error: unknown): Promise<AiErrorCode> {
  if (error instanceof FunctionsFetchError) return "offline";
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await (error.context as Response).json();
      if (typeof body?.error === "string" && KNOWN.has(body.error)) return body.error as AiErrorCode;
    } catch {
      // Not our JSON (a gateway error page): fall through.
    }
    if ((error.context as Response | undefined)?.status === 401) return "unauthorized";
  }
  return "ai_unavailable";
}

export type AiReply = {
  text: string;
  /** The reply hit its length limit and stops short. */
  truncated: boolean;
};

/**
 * Asks the training assistant. `messages` is the conversation oldest first,
 * ending with the person's new message; only the last LIMITS.turns are sent.
 * `context` is the person's training, summarised (never more than
 * LIMITS.contextChars). Throws AiError.
 */
export async function askAi(messages: Turn[], context: string): Promise<AiReply> {
  const recent = messages.slice(-LIMITS.turns);
  const { data, error } = await supabase.functions.invoke<{ text?: unknown; truncated?: unknown }>("ai", {
    body: { feature: "chat", messages: recent, context: context.slice(0, LIMITS.contextChars) },
  });
  if (error) throw new AiError(await codeOf(error));
  if (typeof data?.text !== "string" || !data.text) throw new AiError("ai_unavailable");
  return { text: data.text, truncated: data.truncated === true };
}

export type StreamHandlers = {
  /** The model has started thinking before it writes. */
  onThinking?: () => void;
  /** More of the reply. */
  onText: (text: string) => void;
  /** Throw away what's been written so far: the reply starts again. */
  onReset?: () => void;
};

/**
 * Asks the training assistant and hands over the reply as it's written
 * (supabase/functions/ai, StreamEvent). Same conversation and context rules as
 * askAi. Resolves when the reply is complete; throws AiError when it can't be
 * had, and the abort error itself when `signal` is aborted (Insights closed).
 */
export async function streamAi(
  messages: Turn[],
  context: string,
  on: StreamHandlers,
  signal?: AbortSignal,
  /** chat (Insights), interview or program (the program builder). */
  feature: AskFeature = "chat",
): Promise<{ truncated: boolean }> {
  // The sign-in from storage, renewed if it's run out (never useAuth()).
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AiError("unauthorized");

  let response: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    response = await streamingFetch(`${SUPABASE_URL}/functions/v1/ai`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        feature,
        stream: true,
        messages: messages.slice(-LIMITS.turns),
        context: context.slice(0, LIMITS.contextChars),
      }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiError("offline");
  }

  // Refused before the model was asked (a limit, the sign-in, the agreement).
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    let code: AiErrorCode = response.status === 401 ? "unauthorized" : "ai_unavailable";
    try {
      const body = await response.json();
      if (typeof body?.error === "string" && KNOWN.has(body.error)) code = body.error as AiErrorCode;
    } catch {
      // Not our JSON (a gateway error page).
    }
    throw new AiError(code);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new AiError("ai_unavailable");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new AiError("ai_unavailable");
    }
    if (chunk.done) break;
    const { events, rest } = parseSse(buffer + decoder.decode(chunk.value, { stream: true }));
    buffer = rest;
    for (const event of events) {
      switch (event.type) {
        case "status": on.onThinking?.(); break;
        case "text": on.onText(event.text); break;
        case "reset": on.onReset?.(); break;
        case "done": return { truncated: event.truncated };
        case "error": throw new AiError(KNOWN.has(event.error) ? (event.error as AiErrorCode) : "ai_unavailable");
      }
    }
  }
  // The connection ended before the reply did.
  throw new AiError("ai_unavailable");
}

export type AiAllowance = {
  perDay: number;
  used: number;
  /** Calls left in the last 24 hours; 0 whenever `status` says why not. */
  remaining: number;
  /** Why this feature can't be used now, or null when it can. */
  status: AiErrorCode | null;
};

/** What's left of each feature for the signed-in account over the last 24
 *  hours, and why not (ai_remaining, 0061). Throws when it can't be read. */
export async function aiAllowance(): Promise<Partial<Record<Feature, AiAllowance>>> {
  const { data, error } = await supabase.rpc("ai_remaining");
  if (error) throw new Error(error.message);
  const out: Partial<Record<Feature, AiAllowance>> = {};
  for (const row of (data ?? []) as { feature: Feature; per_day: number; used: number; remaining: number; status: string | null }[]) {
    const status = row.status && KNOWN.has(row.status) ? (row.status as AiErrorCode) : null;
    out[row.feature] = { perDay: row.per_day, used: row.used, remaining: row.remaining, status };
  }
  return out;
}
