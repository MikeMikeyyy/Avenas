import React from "react";
import { StyleSheet } from "react-native";
import AiEntryCard from "./AiEntryCard";
import InsightsMark from "./icons/InsightsMark";

// ─── Insights card ────────────────────────────────────────────────────────────
// Home's way in to Insights (app/insights.tsx), between the activity calendar
// and the weekly schedule: the AI training assistant (logo A). The card itself
// is AiEntryCard, shared with My Programs' Build with AI.

export default function InsightsCard({ isDark }: { isDark: boolean }) {
  return (
    <AiEntryCard
      isDark={isDark}
      Mark={InsightsMark}
      title="Insights"
      subtitle="Ask about your training"
      route="/insights"
      accessibilityLabel="Open training insights"
      style={styles.wrap}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 28 },
});
