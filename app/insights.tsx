// Insights: the AI training assistant, from Home's Insights card. The chat
// itself is components/ai/AiChatScreen.tsx (docs/ARCHITECTURE.md "AI"), shared
// with the Program Builder (app/program-builder.tsx); this is what Insights
// says, its mark (logo A) and where its chats are kept.

import AiChatScreen, { type AiChatConfig } from "../components/ai/AiChatScreen";
import InsightsMark from "../components/icons/InsightsMark";
import { AI_CHATS_BY_ACCOUNT_KEY } from "../constants/ai";

const INSIGHTS: AiChatConfig = {
  kind: "insights",
  name: "Insights",
  Mark: InsightsMark,
  intro: "Hey, I'm your training assistant. Ask me anything about training, or about your own: I can see your program and the workouts you've logged.",
  // The workout review and program check-in are asked for here, never made
  // anywhere else unasked (user pick, 2026-11-14).
  suggestions: ["Review my last workout", "How's my program going?", "What should I focus on?", "How balanced is my split?"],
  placeholder: "Ask about your training…",
  waitingLines: ["Thinking…", "Looking at your training…", "Working out an answer…"],
  chatsKey: AI_CHATS_BY_ACCOUNT_KEY,
};

export default function InsightsScreen() {
  return <AiChatScreen config={INSIGHTS} />;
}
