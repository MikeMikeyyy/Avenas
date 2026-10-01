// What the solo flows run in. IMPORT THIS FIRST (it imports ../app.ts, which
// has to load before any of the app's modules).
//
//   time      Sydney, so a run crosses the daylight-saving change on Sunday
//             4 October 2026 (the app's day maths has broken across one before:
//             CLAUDE.md, "Day arithmetic rounds, never floors").
//   the clock set by the flow, so "tomorrow" and "1am" are steps rather than
//             waits: `new Date()` and Date.now() read it, every other form of
//             Date is the real one.
//   prompts   react-native's Alert presses whichever button the step chose
//             (answerPrompts), so Make Rest Day, Move to Tomorrow and Resume run
//             through the app's own prompts, options and all.
//   the rest  the backup scheduler and the reminders do nothing: neither
//             decides anything the flows check.

import { stubModule } from "../app";

declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Australia/Sydney";

// ─── The clock ───────────────────────────────────────────────────────────────

const RealDate = Date;
let nowMs = RealDate.now();

function FakeDate(this: unknown, ...args: unknown[]): unknown {
  // Called without `new`, Date() is a string, as the real one is.
  if (!new.target) return new RealDate(nowMs).toString();
  if (args.length === 0) return new RealDate(nowMs);
  return new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
}
FakeDate.prototype = RealDate.prototype;
FakeDate.now = () => nowMs;
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
(globalThis as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;

/** Set the clock to a local date and time. */
export function setClock(year: number, month: number, day: number, hour = 10, minute = 0): void {
  nowMs = new RealDate(year, month - 1, day, hour, minute).getTime();
}

/** `days` local calendar days on, at `hour`:`minute`. */
export function advanceDays(days: number, hour = 10, minute = 0): void {
  const d = new RealDate(nowMs);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  nowMs = d.getTime();
}

/** A minute on: each step happens a moment after the last. */
export function tick(): void {
  nowMs += 60_000;
}

/** Whether the clock's zone has the daylight-saving change the flows expect,
 *  i.e. setting TZ took. Without it a run is still valid, it just doesn't
 *  cross one. */
export function crossesDst(): boolean {
  return new RealDate(2026, 9, 3, 12).getTimezoneOffset() !== new RealDate(2026, 9, 5, 12).getTimezoneOffset();
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

type Button = { text?: string; style?: string; onPress?: () => void };
/** Which button to press, by its text; null (or a text not offered) cancels. */
export type Chooser = (title: string, buttons: string[]) => string | null;

let chooser: Chooser = () => null;
/** Every prompt shown since the last call, for a step to read what it was offered. */
const shown: { title: string; buttons: string[] }[] = [];

export function answerPrompts(next: Chooser): void {
  chooser = next;
}

export function takePrompts(): { title: string; buttons: string[] }[] {
  return shown.splice(0, shown.length);
}

stubModule({ request: "react-native" }, {
  Alert: {
    alert(title: string, _message?: string, buttons?: Button[], options?: { onDismiss?: () => void }) {
      const list = buttons && buttons.length > 0 ? buttons : [{ text: "OK" }];
      const texts = list.map(b => b.text ?? "");
      shown.push({ title, buttons: texts });
      const pick = chooser(title, texts);
      const button = pick === null ? list.find(b => b.style === "cancel") : list.find(b => b.text === pick);
      if (button) button.onPress?.();
      else (list.find(b => b.style === "cancel")?.onPress ?? options?.onDismiss)?.();
    },
  },
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
});

// ─── Inert ───────────────────────────────────────────────────────────────────

stubModule({ file: "lib/syncManager.ts" }, {
  scheduleCloudPush: () => {},
  flushCloudPush: () => {},
  retryFailedCloudPush: () => {},
});
stubModule({ file: "utils/notificationScheduler.ts" }, {
  resyncScheduledNotifications: () => {},
});
