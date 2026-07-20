// lib/reports.ts
//
// Server-side report submission (migration 0014). RN-only (imports the
// Supabase client). utils/moderation.ts owns the flow: it always keeps the
// on-device log (offline fallback + mock contacts), and calls this to deliver
// reports against REAL accounts to the operator; failures are queued locally
// and retried on the next report.

import { supabase } from "./supabase";
import type { Report } from "../constants/chat";

/** Current session's user id, or null when signed out. Local read — no network. */
async function myUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** Deliver one report row. Throws when it can't (offline / signed out) so the
 *  caller can queue it for retry. */
export async function insertReportRow(report: Report): Promise<void> {
  const uid = await myUid();
  if (!uid) throw new Error("not signed in");
  const { error } = await supabase.from("reports").insert({
    reporter_id: uid,
    reported_id: report.contactId,
    kind: report.kind,
    reason: report.reason,
    message_id: report.messageId ?? null,
    message_text: report.messageText ?? null,
    contact_name: report.contactName ?? null,
  });
  if (error) throw new Error(`submit report: ${error.message}`);
}
