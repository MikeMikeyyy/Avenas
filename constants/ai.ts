// The AI assistant on the phone (docs/ARCHITECTURE.md "AI").

/** Record<accountId, AgreementRecord>: each account's agreement to sharing its
 *  training with the AI (utils/agreements.ts), recorded on the server too as
 *  document 'ai' (record_agreement, 0060). */
export const AI_TERMS_BY_ACCOUNT_KEY = "@avenas/ai_terms_by_account";

/** The agreement's version. Bump it after a material change to what the AI is
 *  sent or who it goes to, and raise the server's ai_settings.consent_version
 *  to match in the same release (0061): the server refuses an account whose
 *  agreement is older, and the app asks again. Never raise the server's
 *  first: phones with the old app would keep agreeing to the old version. */
export const AI_TERMS_VERSION = 1;

/** Record<accountId, AiChat[]>: each account's Insights chats, newest first,
 *  on this phone only (never synced or backed up), so deleting one deletes
 *  it everywhere it ever was (utils/aiChat.ts, utils/aiChatStore.ts). */
export const AI_CHATS_BY_ACCOUNT_KEY = "@avenas/ai_chats_by_account";

/** Record<accountId, AiChat[]>: each account's Program Builder chats (My
 *  Programs), kept as Insights' are but apart from them (user ask, 2026-11-13). */
export const AI_BUILDER_CHATS_BY_ACCOUNT_KEY = "@avenas/ai_builder_chats_by_account";

/** Record<accountId, ChatMessage[]>: the one Insights conversation each account
 *  had before chats were kept as a list (2026-11-13). Read once to become that
 *  account's first chat, then removed; never written. */
export const AI_CHAT_BY_ACCOUNT_KEY = "@avenas/ai_chat_by_account";

/** Messages of a conversation kept on the phone. The model is sent the last
 *  AI_LIMITS.turns of them (lib/ai.ts). */
export const AI_CHAT_KEEP = 40;

/** Chats kept per account; past this the oldest go (user pick, 2026-11-13). */
export const AI_CHATS_KEEP = 50;
