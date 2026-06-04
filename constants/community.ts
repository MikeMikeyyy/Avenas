// constants/community.ts
//
// Community engagement agreement for the Trainer hub (messaging + shared
// programs). Required by Apple App Store Review Guideline 1.2 (Safety —
// User-Generated Content): users must agree to terms with a zero-tolerance
// policy for objectionable content and abusive behaviour before using any
// feature that surfaces content from other people.
//
// The acceptance is VERSIONED — bump COMMUNITY_TERMS_VERSION whenever the
// guidelines materially change and every user is re-prompted on next entry.

export const COMMUNITY_TERMS_KEY = "@avenas/community_terms";

/** Bump when the guidelines change → everyone must re-accept. */
export const COMMUNITY_TERMS_VERSION = 1;

/** Stored shape: the version the user accepted + when. */
export type CommunityTermsAcceptance = {
  version: number;
  acceptedAtISO: string;
};

/** One-line promise shown on the agreement prompt. */
export const COMMUNITY_PLEDGE =
  "There is zero tolerance for objectionable content or abusive behaviour.";

export type GuidelineSection = { heading: string; body: string };

/** Full guidelines, rendered on the agreement prompt (summary) and the
 *  standalone Community Guidelines page (in full). */
export const COMMUNITY_GUIDELINES: GuidelineSection[] = [
  {
    heading: "Be respectful",
    body:
      "Treat trainers, coaches, and clients with respect. Harassment, bullying, hate speech, threats, or discrimination of any kind are not allowed.",
  },
  {
    heading: "No objectionable content",
    body:
      "Do not send or post content that is illegal, sexually explicit, violent, abusive, or otherwise objectionable. There is zero tolerance for this content and the people who share it.",
  },
  {
    heading: "Report and block",
    body:
      "If you see something that breaks these rules, report the message or the person, or block them. Open a conversation and tap the menu (⋯) to report, block, or remove a connection.",
  },
  {
    heading: "We act within 24 hours",
    body:
      "We review every report and act within 24 hours — removing offending content and ejecting abusive users. Repeat or serious violations can result in a permanent ban.",
  },
  {
    heading: "Need help?",
    body:
      "You can reach us any time from Settings → Help & FAQ or Report a Bug. By continuing you also agree to our Terms of Service and Privacy Policy.",
  },
];
