// What an alert says about a failure.
//
// Screens used to show `e.message` as it came, so a failed group action could
// read "rename group: new row violates row-level security policy for table
// groups". lib/ throws two kinds of message: ones written for people ("Your
// current password is incorrect.", "Sign in to send programs to your
// trainer."), which end like a sentence, and the server's own wording, which
// doesn't and usually carries lib's "operation: " prefix. Only the first kind
// reaches the alert; otherwise the screen's own fallback line does.
//
// Sign-in, sign-up, password and email screens don't use this: Supabase Auth's
// messages ("Invalid login credentials") are written for people but don't end
// in a full stop, and they're the useful part of those alerts.

const CONNECTION = "Check your connection and try again.";

/** The fetch layer's wording when the request never reached the server. */
const NETWORK = /network request failed|failed to fetch|network error|timed? ?out|aborted/i;

/** Server refusals worth saying in plain words rather than the fallback. */
const KNOWN: [RegExp, string][] = [
  [/rate limit/i, "Too many requests. Try again in a minute."],
  [/not (signed in|authenticated)/i, "You've been signed out. Sign in and try again."],
];

export function alertMessage(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message.trim() : "";
  if (!msg) return fallback;
  if (NETWORK.test(msg)) return CONNECTION;
  const known = KNOWN.find(([re]) => re.test(msg));
  if (known) return known[1];
  if (/[.!?]$/.test(msg) && !/^[\w ]+: /.test(msg)) return msg;
  return fallback;
}
