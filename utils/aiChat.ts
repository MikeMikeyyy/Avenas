// utils/aiChat.ts
//
// The Insights conversation's pure parts (app/insights.tsx): what the model is
// sent from it, what's kept, and how a reply is tidied for the screen. RN-free,
// so scripts/verify-ai.ts runs it.

import type { ChatMessage } from "../constants/chat";
import { AI_CHAT_KEEP, AI_CHATS_KEEP } from "../constants/ai";
import { LIMITS, type Turn } from "../supabase/functions/ai/request";

/** One conversation in an account's list of chats. */
export type AiChat = {
  id: string;
  /** Its first question, on one line ("" until there is one). */
  title: string;
  createdAtISO: string;
  /** When it last had a message: the list's order. */
  updatedAtISO: string;
  messages: ChatMessage[];
  /** Program Builder: the interview knows enough to build (its last reply
   *  said so), so Build my program is offered. */
  ready?: boolean;
  /** Program Builder: the program it built, by name, and when. */
  built?: { name: string; atISO: string };
};

/** Longest a chat's title is kept (the list shows one line of it). */
const TITLE_MAX = 120;

/** A chat's title from its first question: one line, at most TITLE_MAX. */
export function chatTitle(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

export function newChatId(now: number = Date.now()): string {
  return `chat_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** A chat not yet in the list (it joins with its first message). */
export function blankChat(id: string, now: Date = new Date()): AiChat {
  const iso = now.toISOString();
  return { id, title: "", createdAtISO: iso, updatedAtISO: iso, messages: [] };
}

/** `chat` holding `messages` now: titled by its first question if it isn't
 *  yet, its last AI_CHAT_KEEP messages kept, and moved to the top. */
export function withMessages(chat: AiChat, messages: readonly ChatMessage[], now: Date = new Date()): AiChat {
  const firstQuestion = messages.find(m => m.mine)?.text ?? "";
  return {
    ...chat,
    title: chat.title || chatTitle(firstQuestion),
    updatedAtISO: now.toISOString(),
    messages: keptThread(messages),
  };
}

/** The list with `chat` in it (in place of the one with its id): newest
 *  first, empty chats left out, no more than AI_CHATS_KEEP. */
export function putChat(chats: readonly AiChat[], chat: AiChat): AiChat[] {
  return [chat, ...chats.filter(c => c.id !== chat.id)]
    .filter(c => c.messages.length > 0)
    .sort((a, b) => b.updatedAtISO.localeCompare(a.updatedAtISO))
    .slice(0, AI_CHATS_KEEP);
}

/** The list without the chat `id`. */
export function dropChat(chats: readonly AiChat[], id: string): AiChat[] {
  return chats.filter(c => c.id !== id);
}

const isMessage = (m: unknown): m is ChatMessage =>
  !!m && typeof m === "object" && typeof (m as ChatMessage).text === "string" && typeof (m as ChatMessage).mine === "boolean";

/** What's stored for an account as a list of chats, keeping only what reads
 *  as one, newest first. */
export function chatsFrom(stored: unknown): AiChat[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((c): c is AiChat =>
      !!c && typeof c === "object" &&
      typeof (c as AiChat).id === "string" && typeof (c as AiChat).updatedAtISO === "string" &&
      Array.isArray((c as AiChat).messages))
    .map(c => ({
      ...c,
      title: typeof c.title === "string" ? c.title : "",
      createdAtISO: typeof c.createdAtISO === "string" ? c.createdAtISO : c.updatedAtISO,
      messages: c.messages.filter(isMessage),
    }))
    .filter(c => c.messages.length > 0)
    .sort((a, b) => b.updatedAtISO.localeCompare(a.updatedAtISO))
    .slice(0, AI_CHATS_KEEP);
}

/** The one conversation kept before chats were a list, as a chat, dated by
 *  its own messages (null when there's nothing in it). */
export function chatFromOldThread(stored: unknown, now: Date = new Date()): AiChat | null {
  const messages = Array.isArray(stored) ? stored.filter(isMessage) : [];
  if (!messages.length) return null;
  // A message's own time, or now when it has none that reads as one.
  const at = (iso: string | undefined) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d : now;
  };
  const first = at(messages[0].sentAtISO);
  const last = at(messages[messages.length - 1].sentAtISO);
  return withMessages({ ...blankChat(newChatId(now.getTime()), first) }, messages, last);
}

/** The conversation as the model is sent it: the last LIMITS.turns messages,
 *  the person's as `user`. (The greeting the screen opens with is the app's,
 *  not the model's; the server drops anything before the first question.) */
export function turnsFor(messages: readonly ChatMessage[]): Turn[] {
  return messages
    .slice(-LIMITS.turns)
    .map(m => ({ role: m.mine ? "user" as const : "assistant" as const, text: m.text }));
}

/** What's kept of a conversation on the phone: its last AI_CHAT_KEEP messages. */
export function keptThread(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.slice(-AI_CHAT_KEEP);
}

/**
 * A reply made fit for plain text. The model is asked for plain text, but in
 * case markdown slips through: bold and heading marks go, "- " and "* " list
 * items become "• ", and an em dash becomes a comma (the app's copy never
 * has one). An en dash, as in "6–8 reps", stays.
 */
export function cleanReply(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
