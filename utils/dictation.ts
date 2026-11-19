// utils/dictation.ts
//
// Voice typing's text (hooks/useDictation.ts; user ask, 2026-11-14): how what
// the phone hears joins what was already typed. Pure, so
// scripts/verify-dictation.ts runs it.
//
// The speech recognizer sends results as it hears: partial ones (the words so
// far, revised as it goes) and final ones. On iPhone a final result only comes
// once listening stops, and a partial one carries everything heard so far; on
// other phones a final result can close one stretch of speech and the next
// partials start afresh. `absorb` takes either: what's final is kept, the
// latest partial shown after it, and a partial that repeats what's already
// final has that part taken off, so nothing is typed twice.

/** What's been heard this time: what's final, and the latest partial. */
export type Heard = { final: string; partial: string };

export const NOTHING_HEARD: Heard = { final: "", partial: "" };

/** The pieces with single spaces between, empty ones left out. */
export function joinText(...parts: string[]): string {
  return parts.map(p => p.trim()).filter(Boolean).join(" ");
}

/** `heard` after one more result from the recognizer. */
export function absorb(heard: Heard, transcript: string, isFinal: boolean): Heard {
  let words = transcript.trim();
  const done = heard.final;
  if (done && words.toLowerCase().startsWith(done.toLowerCase())) words = words.slice(done.length).trim();
  return isFinal ? { final: joinText(done, words), partial: "" } : { final: done, partial: words };
}

/** The text box: what was typed before listening began, then what's been
 *  heard, kept to `max` characters (the box's own limit). */
export function dictatedText(before: string, heard: Heard, max = Infinity): string {
  return joinText(before, heard.final, heard.partial).slice(0, max);
}

/** How loud they're speaking, 0 to 1, from the recognizer's -2 to 10
 *  (anything below 0 can't be heard). */
export function loudness(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value / 10, 0), 1) : 0;
}

/** The phone's language for the recognizer ("en-AU"), or US English. */
export function phoneLanguage(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : "en-US";
  } catch {
    return "en-US";
  }
}
