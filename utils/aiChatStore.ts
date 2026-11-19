// utils/aiChatStore.ts
//
// Each account's Insights chats on this phone (AI_CHATS_BY_ACCOUNT_KEY): read
// and kept here, the list's rules in utils/aiChat.ts. Never synced or backed
// up: deleting a chat deletes it everywhere it ever was (the server never had
// the words, only that a question was asked; migration 0060).

import { AI_CHAT_BY_ACCOUNT_KEY, AI_CHATS_BY_ACCOUNT_KEY } from "../constants/ai";
import { chatFromOldThread, chatsFrom, type AiChat } from "./aiChat";
import { getJSON, removeKey, setJSON } from "./storage";

type ByAccount = Record<string, unknown>;

const asMap = (v: unknown): ByAccount => (v && typeof v === "object" && !Array.isArray(v) ? (v as ByAccount) : {});

// Reads and writes of the map run one at a time, each reading it fresh, so two
// quick saves can't write over each other or over another account's chats.
let chain: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

/** This account's chats under `key` (Insights' by default), newest first.
 *  Insights' one conversation kept before chats were a list becomes the
 *  first of them, once. */
export function loadChats(owner: string, key: string = AI_CHATS_BY_ACCOUNT_KEY): Promise<AiChat[]> {
  return oneAtATime(async () => {
    const all = asMap(await getJSON<unknown>(key, {}));
    if (owner in all || key !== AI_CHATS_BY_ACCOUNT_KEY) return chatsFrom(all[owner]);

    const old = asMap(await getJSON<unknown>(AI_CHAT_BY_ACCOUNT_KEY, {}));
    const carried = chatFromOldThread(old[owner]);
    if (!carried) return [];
    const chats = [carried];
    await setJSON(AI_CHATS_BY_ACCOUNT_KEY, { ...all, [owner]: chats });
    const { [owner]: _gone, ...rest } = old;
    if (Object.keys(rest).length) await setJSON(AI_CHAT_BY_ACCOUNT_KEY, rest);
    else await removeKey(AI_CHAT_BY_ACCOUNT_KEY);
    return chats;
  });
}

/** Keeps this account's chats under `key` as they now are. Never rejects. */
export function saveChats(owner: string, chats: AiChat[], key: string = AI_CHATS_BY_ACCOUNT_KEY): void {
  void oneAtATime(async () => {
    const all = asMap(await getJSON<unknown>(key, {}));
    await setJSON(key, { ...all, [owner]: chats });
  }).catch(err => { if (__DEV__) console.warn("[avenas]", "setJSON", key, err); });
}
