// The Program Builder: the AI asks about your goal, schedule and gym, then
// builds a program and opens it in the builder to check and save (user ask,
// 2026-11-13). From the Build with AI card on My Programs. The chat is
// components/ai/AiChatScreen.tsx (docs/ARCHITECTURE.md "AI"), shared with
// Insights; its chats are its own (AI_BUILDER_CHATS_BY_ACCOUNT_KEY).

import AiChatScreen, { type AiChatConfig } from "../components/ai/AiChatScreen";
import BuilderMark from "../components/icons/BuilderMark";
import { AI_BUILDER_CHATS_BY_ACCOUNT_KEY } from "../constants/ai";

const BUILDER: AiChatConfig = {
  kind: "builder",
  name: "Program Builder",
  Mark: BuilderMark,
  intro: "Let's build you a program. I'll ask a few quick questions about your goal, your schedule and your gym, then build it for you to check and save. First up: what are you training for?",
  suggestions: ["Build muscle", "Get stronger", "Lose fat", "General fitness"],
  suggestOnlyAtStart: true,
  placeholder: "Type your answer…",
  waitingLines: ["Thinking…", "Looking at your training…", "Planning the next question…"],
  chatsKey: AI_BUILDER_CHATS_BY_ACCOUNT_KEY,
};

export default function ProgramBuilderScreen() {
  return <AiChatScreen config={BUILDER} />;
}
