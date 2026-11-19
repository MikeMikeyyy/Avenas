// utils/agreements.ts
//
// What each account has agreed to on this phone: the community guidelines
// (Apple 1.2; every screen with other people in it waits for them,
// components/CommunityGate.tsx), the Terms of Service (sign-up's last step,
// app/accept-terms.tsx) and sharing training with the AI (Apple 5.1.2(i);
// Insights asks before the first question, app/insights.tsx, and the server
// checks it before every AI call, 0061). Each is kept per ACCOUNT, and recorded on the server
// too (record_agreement, migration 0059), so there's a showing that the
// account agreed, which a flag on the phone never was (user request,
// 2026-11-12).
//
// The phone's copy is what lets someone in, so nothing waits on the server: an
// agreement is held at once, written to the phone, then sent. One the server
// didn't get (no signal) stays marked as not sent and goes with
// syncAgreements at the next launch or when the signal comes back
// (app/_layout.tsx), as a block made offline does (utils/moderation.ts
// syncBlocks). That's the phone's record catching the server up, not an
// action waiting in a queue: the agreement itself was given and holds.
//
// The community guidelines' agreement was one for the whole phone until
// 2026-11-12, kept on purpose when another account signed in, so that account
// had every community screen without ever being shown them. That one no
// longer counts: everyone agrees once more, which also gives every account
// using them a record on the server (user pick, 2026-11-12). The Terms of
// Service are recorded from sign-up on; accounts made before have no record
// (the same pick).
//
// Whether the community guidelines are agreed is kept for this launch once
// read, so a screen that knows opens at once, and every screen waiting hears
// the moment they're agreed to (hooks/useCommunityTerms.ts).

import { AI_TERMS_BY_ACCOUNT_KEY, AI_TERMS_VERSION } from "../constants/ai";
import { COMMUNITY_TERMS_BY_ACCOUNT_KEY, COMMUNITY_TERMS_KEY, COMMUNITY_TERMS_VERSION } from "../constants/community";
import { TERMS_BY_ACCOUNT_KEY, TERMS_VERSION } from "../constants/onboarding";
import { recordAgreement, type AgreementDocument } from "../lib/agreements";
import { getJSON, removeKey, setJSON } from "./storage";

/** One account's agreement to one document, as the phone keeps it. */
export type AgreementRecord = {
  version: number;
  acceptedAtISO: string;
  /** The server has it (record_agreement, 0059). */
  onServer?: boolean;
};

const KEYS: Record<AgreementDocument, string> = {
  community: COMMUNITY_TERMS_BY_ACCOUNT_KEY,
  terms: TERMS_BY_ACCOUNT_KEY,
  ai: AI_TERMS_BY_ACCOUNT_KEY,
};

const CURRENT: Record<AgreementDocument, number> = {
  community: COMMUNITY_TERMS_VERSION,
  terms: TERMS_VERSION,
  ai: AI_TERMS_VERSION,
};

// Reading, agreeing and marking what the server has each read a map and write
// it back, so they run one at a time.
let chain: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function loadAll(document: AgreementDocument): Promise<Record<string, AgreementRecord>> {
  const map = await getJSON<Record<string, AgreementRecord> | null>(KEYS[document], {});
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

// ─── The community guidelines, as the screens wait on them ───────────────────

let termsHeld: { owner: string; accepted: boolean } | null = null;
const termsListeners = new Set<() => void>();
/** Moves on with every agreement given, so a read that started before one
 *  can't put the guidelines back up when it lands. */
let termsEpoch = 0;

function holdTerms(owner: string, accepted: boolean): void {
  if (termsHeld?.owner === owner && termsHeld.accepted === accepted) return;
  termsHeld = { owner, accepted };
  termsListeners.forEach(listener => listener());
}

/** Whether `owner` has agreed, as far as this launch has read: null until then. */
export function peekCommunityTermsAccepted(owner: string): boolean | null {
  return termsHeld?.owner === owner ? termsHeld.accepted : null;
}

/** Be told when what's held changes (an agreement given, a read landing). */
export function subscribeCommunityTerms(listener: () => void): () => void {
  termsListeners.add(listener);
  return () => { termsListeners.delete(listener); };
}

/** True only when this account agreed to the CURRENT guidelines on this phone. */
export function hasAcceptedCommunityTerms(owner: string): Promise<boolean> {
  // Taken now, not when its turn comes: an "I agree" in between moves it on.
  const epoch = termsEpoch;
  return oneAtATime(async () => {
    const mine = (await loadAll("community"))[owner];
    const accepted = !!mine && mine.version === COMMUNITY_TERMS_VERSION;
    // Agreed while this was reading: that stands.
    if (epoch !== termsEpoch) return peekCommunityTermsAccepted(owner) ?? accepted;
    holdTerms(owner, accepted);
    return accepted;
  });
}

/** This account agrees to the current guidelines: held at once, so the screen
 *  waiting opens without waiting on the phone's storage, then kept and sent. */
export async function acceptCommunityTerms(owner: string): Promise<void> {
  termsEpoch += 1;
  holdTerms(owner, true);
  await agree("community", owner);
  // The phone-wide agreement from before, which nothing reads now.
  await removeKey(COMMUNITY_TERMS_KEY);
}

// ─── The Terms of Service ─────────────────────────────────────────────────────

/** The account signing up accepts the current Terms (app/accept-terms.tsx). */
export async function acceptTerms(owner: string): Promise<void> {
  await agree("terms", owner);
}

// ─── Sharing training with the AI ─────────────────────────────────────────────
// Asked before the first question in Insights (app/insights.tsx; Apple
// 5.1.2(i)). Unlike the others, the server checks this one before every AI
// call (ai_begin, 0061), so the AI waits until the server has it.

/** True only when this account agreed to the CURRENT AI agreement on this phone. */
export function hasAcceptedAiTerms(owner: string): Promise<boolean> {
  return oneAtATime(async () => {
    const mine = (await loadAll("ai"))[owner];
    return !!mine && mine.version === AI_TERMS_VERSION;
  });
}

/** This account agrees to the AI: kept, then sent. True once the server has
 *  it; false when it couldn't go (no signal), and syncAgreements sends it. */
export function acceptAiTerms(owner: string): Promise<boolean> {
  return agree("ai", owner);
}

// ─── Keeping and sending ──────────────────────────────────────────────────────

/** Keeps the agreement on the phone, then sends it. True once the server has
 *  it. */
async function agree(document: AgreementDocument, owner: string): Promise<boolean> {
  const record: AgreementRecord = { version: CURRENT[document], acceptedAtISO: new Date().toISOString() };
  await oneAtATime(async () => {
    const map = await loadAll(document);
    await setJSON<Record<string, AgreementRecord>>(KEYS[document], { ...map, [owner]: record });
  });
  // Signed out there's no account to record it for: it holds on this phone.
  return owner ? send(document, owner, record) : false;
}

/** Send one record to the server, and mark it on the phone once it's there.
 *  False when it couldn't go (no signal): it stays unmarked, for syncAgreements. */
async function send(document: AgreementDocument, owner: string, record: AgreementRecord): Promise<boolean> {
  try {
    await recordAgreement(document, record.version, record.acceptedAtISO);
  } catch (err) {
    if (__DEV__) console.warn("[avenas]", "record agreement", document, err);
    return false;
  }
  await oneAtATime(async () => {
    const map = await loadAll(document);
    const kept = map[owner];
    // Only the one sent: agreed again meanwhile, that's its own to send.
    if (kept && !kept.onServer && kept.version === record.version && kept.acceptedAtISO === record.acceptedAtISO) {
      await setJSON<Record<string, AgreementRecord>>(KEYS[document], { ...map, [owner]: { ...kept, onServer: true } });
    }
  });
  return true;
}

/** Send what this account agreed to on this phone that the server doesn't have
 *  yet (agreed with no signal). At launch and when the signal comes back
 *  (app/_layout.tsx). Never rejects. */
export async function syncAgreements(owner: string): Promise<void> {
  if (!owner) return;
  for (const document of ["terms", "community", "ai"] as const) {
    const kept = (await oneAtATime(() => loadAll(document)))[owner];
    if (kept && !kept.onServer) await send(document, owner, kept);
  }
}
