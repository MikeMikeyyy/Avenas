// utils/groupConnect.ts
//
// Adding someone from a group (user decisions, 2026-11-20; migration 0063).
//
// Connecting takes a connect code, and people in a group don't have each
// other's, so a member's sheet (components/trainer/GroupMemberSheet.tsx, on
// the group's page and its member list) asks them from the group. Who may ask
// whom goes by ACCOUNT TYPE, never the group role:
//
//   me \ them        trainer account      gym user
//   trainer          Connect              Add as client
//   gym user         Add as trainer       nothing
//
// Two gym users connected could only chat (utils/roster.ts: Other
// Connections, no coaching either way), so it's never offered. Two trainers
// "Connect": once they are, each is asked whether the other is their trainer,
// client or both (utils/connectionRolePrompt.ts). Both must have joined the
// group.
//
// Once asked, the sheet says "Request sent", greyed, and goes on saying it if
// they decline: a declined request isn't sent again from a group. It's theirs
// to ask now, and when they do my sheet says "Accept request", which connects
// us there and then (and if I decline theirs, the turn is mine again).
//
// The only trainer of a group is a trainer account, too: the owner's "Make a
// trainer" on a gym user says so instead (NOT_TRAINER_ACCOUNT_TITLE).
//
// request_group_connection is what the database enforces; this mirrors it, so
// the sheet only offers what will go through. Pure: the request itself is
// utils/connectFromGroup.ts.

import type { AccountType } from "../contexts/AccountTypeContext";
import type { GroupMember, MemberConnection } from "../constants/groups";
import type { GroupConnectResult } from "../lib/groups";

/** Whether I may ask them from a group: a trainer anyone, a gym user only a
 *  trainer. */
export const canAddFromGroup = (mine: AccountType, theirs: AccountType): boolean =>
  mine === "pt" || theirs === "pt";

/** What a member's sheet offers for connecting with them. */
export type GroupAddAction =
  /** Ask them. The label says what they'll be to me. */
  | { kind: "add"; label: string }
  /** They've asked me: connect now. */
  | { kind: "accept"; label: string }
  /** Asked already, waiting or declined: nothing to do but wait. */
  | { kind: "sent"; label: string };

/**
 * What their sheet offers me, or null for nothing: it's me, I've blocked
 * them, they haven't joined yet, either account type isn't known (a copy saved
 * before 0063), we're connected, or we're two gym users.
 */
export function groupAddAction(
  mine: AccountType | undefined,
  them: Pick<GroupMember, "accountType" | "connection" | "accepted">,
  { isMe, blocked }: { isMe: boolean; blocked: boolean },
): GroupAddAction | null {
  if (isMe || blocked || !them.accepted || !mine || !them.accountType) return null;
  if (them.connection === "connected" || !canAddFromGroup(mine, them.accountType)) return null;
  if (them.connection === "incoming") return { kind: "accept", label: "Accept request" };
  if (them.connection === "requested") return { kind: "sent", label: "Request sent" };
  const label = mine === "gym_user" ? "Add as trainer" : them.accountType === "gym_user" ? "Add as client" : "Connect";
  return { kind: "add", label };
}

/** Where I stand with them once the server has answered, for the roster on
 *  screen; null when it should be read again (they've left, or an account
 *  type changed since it was). */
export function connectionAfter(result: GroupConnectResult): MemberConnection | null {
  if (result === "requested") return "requested";
  if (result === "connected" || result === "already") return "connected";
  return null;
}

/**
 * What the alert after asking says, or null when there's nothing to say:
 * two trainers just connected, and the question of how to file each other
 * takes its place, as accepting on the Connect screen does.
 */
export function groupConnectOutcome(
  result: GroupConnectResult,
  mine: AccountType,
  theirs: AccountType | undefined,
  name: string,
): { title: string; body: string } | null {
  // A roster's names are never blank (fetchGroupMembers), so this is a guard.
  const who = name.trim() || "User";
  const twoTrainers = mine === "pt" && theirs === "pt";
  // What they'll be to me (two trainers choose for themselves).
  const role = mine === "gym_user" ? "trainers" : theirs === "gym_user" ? "clients" : null;
  switch (result) {
    case "requested":
      return {
        title: "Request sent",
        body: twoTrainers
          ? `Once ${who} accepts, you'll choose whether they're your trainer, your client or both.`
          : role ? `Once ${who} accepts, they'll be one of your ${role}.` : `${who} will see your request and can accept it.`,
      };
    case "connected":
      if (twoTrainers) return null;
      return { title: "Connected", body: role ? `${who} is one of your ${role} now.` : `You're now connected with ${who}.` };
    case "already":
      return { title: "Already connected", body: `You're already connected with ${who}.` };
    case "not_member":
      return { title: "Not in this group", body: `${who} isn't in this group any more.` };
    case "not_allowed":
      return { title: NOT_TRAINER_ACCOUNT_TITLE, body: `${who} has a gym user account. Gym users can only add trainers.` };
    default:
      return { title: "Couldn't send the request", body: "Please try again." };
  }
}

/** The owner's "Make a trainer" on a gym user (and the database's refusal of
 *  it): only a trainer account can be a trainer in a group. */
export const NOT_TRAINER_ACCOUNT_TITLE = "Not a trainer account";

export const notTrainerAccountMessage = (name: string): string =>
  `${name.trim() || "User"} has a gym user account. Only trainer accounts can be trainers in a group.`;
