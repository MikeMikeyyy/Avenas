// utils/notificationRoute.ts
//
// Where a tapped notification takes you (app/_layout.tsx). Each one carries the
// screen it's about in its data.url, set by the database triggers (migrations
// 0012 onwards), and most go straight there.
//
// A message to a gym user from one of their trainers goes a step further (user
// decision, 2026-10-21): that trainer is put on the Trainer tab if they weren't
// already, the tab opens, and their chat opens over it, so leaving the chat
// lands on their page. A gym user's tab has no Messages button, so a message
// from a trainer who isn't on it would otherwise leave you in a chat with no
// way back to them.

import type { Href } from "expo-router";
import type { AccountType } from "../contexts/AccountTypeContext";
import { resolveMyTrainers } from "./roster";
import { featureTrainer, hydrateTrainerHub, peekGymHub } from "./trainerHub";

const CHAT_URL = /^\/trainer\/chat\/([^/?#]+)$/;

/** Who a message notification is from (its url is `/trainer/chat/<sender>`),
 *  or null for any other notification. */
export function chatSenderOf(url: string): string | null {
  const m = CHAT_URL.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The screens a tapped notification opens, in order.
 *
 * Decided from what's on this phone (the Trainer tab's saved copy lists every
 * trainer), so the tap never waits on the network. A trainer the copy doesn't
 * know yet (connected since it was saved) gets their chat straight away, as
 * every message did before, and is put on the tab once the server has said who
 * they are, so the tab is on them when you get back to it.
 */
export async function notificationSteps(url: string, accountType: AccountType, owner: string): Promise<Href[]> {
  const sender = chatSenderOf(url);
  if (!sender || accountType !== "gym_user") return [url as Href];

  await hydrateTrainerHub("gym", owner);
  const held = peekGymHub(owner);
  const trainer = held?.trainers?.find(t => t.id === sender) ?? (held?.pt?.id === sender ? held.pt : undefined);
  if (!trainer) {
    void resolveMyTrainers()
      .then(({ all, primary }) => {
        const found = all.find(t => t.id === sender);
        if (found && primary?.id !== found.id) return featureTrainer(owner, found);
      })
      .catch(err => { if (__DEV__) console.warn("[avenas] notification trainer", err); });
    return [url as Href];
  }

  if (held?.pt?.id !== trainer.id) await featureTrainer(owner, trainer);
  return [
    "/trainer-hub",
    {
      pathname: "/trainer/chat/[id]",
      params: { id: trainer.id, name: trainer.name, initials: trainer.initials, photo: trainer.photoUri ?? "" },
    },
  ];
}
