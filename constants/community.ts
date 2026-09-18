// constants/community.ts
//
// Community engagement agreement for the Trainer hub (messaging, groups and
// shared programs). Required by Apple App Store Review Guideline 1.2 (Safety,
// User-Generated Content): users must agree to terms with a zero-tolerance
// policy for objectionable content and abusive behaviour before using any
// feature that surfaces content from other people.
//
// The acceptance is VERSIONED: bump COMMUNITY_TERMS_VERSION whenever the
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
 *  standalone Community Guidelines page (in full).
 *
 *  Report and block names the real gestures and menus, so it has to change when
 *  those do. Section 6 of the Terms of Service restates the zero-tolerance rule
 *  and the 24-hour promise, and must stay in step. No em dashes in the copy. */
export const COMMUNITY_GUIDELINES: GuidelineSection[] = [
  {
    heading: "Be respectful",
    body:
      "Treat everyone on Avenas with respect, whether they're a trainer, a client or a member of your group. Harassment, bullying, hate speech, threats or discrimination of any kind are not allowed.",
  },
  {
    heading: "No objectionable content",
    body:
      "Don't send, post or share anything illegal, sexually explicit, violent, abusive or otherwise objectionable. That includes messages, group chats, shared programs, names and profile photos. There is zero tolerance for this content and the people who share it.",
  },
  {
    heading: "Keep it genuine",
    body:
      "Be yourself. Don't pretend to be someone else, send spam or unwanted connection requests, or share another person's private details without their permission.",
  },
  {
    heading: "Report and block",
    body:
      "If something breaks these rules, report it or block the person. In a chat, press and hold a message to report it, or tap the menu (⋯) at the top to report, block or remove the connection. In a group, press and hold a message to report it, or report a member from the member list in the group's menu (⋯). You can unblock people any time in Settings under Blocked Accounts.",
  },
  {
    heading: "We act within 24 hours",
    body:
      "We review every report and act within 24 hours, removing content that breaks these rules and the people who post it. Repeat or serious violations can result in a permanent ban.",
  },
  {
    heading: "Need help?",
    body:
      "For answers, see Help & FAQ in Settings. To reach us, use Report a Bug in Settings or email support@avenas.com. By continuing, you also agree to our Terms of Service and Privacy Policy.",
  },
];
