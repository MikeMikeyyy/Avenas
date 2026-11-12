// Client wrapper for record_agreement (migration 0059): the server's record of
// an account agreeing to the Terms of Service or the community guidelines.
// RN-only (imports the Supabase client). utils/agreements.ts decides when.

import { supabase } from "./supabase";

/** What can be agreed to: the Terms of Service, the community guidelines. */
export type AgreementDocument = "terms" | "community";

/** Record that the signed-in account agreed to `version` of `document` at
 *  `agreedAtISO` (the phone's clock; the server keeps its own time beside it).
 *  Agreeing to one again changes nothing. Throws when it can't be recorded. */
export async function recordAgreement(document: AgreementDocument, version: number, agreedAtISO: string): Promise<void> {
  const { error } = await supabase.rpc("record_agreement", {
    p_document: document,
    p_version: version,
    p_agreed_at: agreedAtISO,
  });
  if (error) throw new Error(error.message);
}
