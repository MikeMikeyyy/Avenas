import { View, Text, StyleSheet } from "react-native";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { Client } from "../../utils/trainerStore";

function timeAgo(iso: string | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  return `${wks}w ago`;
}

export default function ClientCard({ client, activeProgramName, onPress }: { client: Client; activeProgramName?: string; onPress: () => void }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  return (
    <BounceButton style={{ marginBottom: 12 }} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${client.name}`}>
      <NeuCard dark={isDark} radius={18}>
        <View style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
            <Text style={[styles.avatarText, { color: ACCT }]}>{client.initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{client.name}</Text>
            {activeProgramName ? (
              <View style={styles.programRow}>
                <Text style={[styles.programLabel, { color: t.ts }]}>ACTIVE PROGRAM</Text>
                <Text style={[styles.programName, { color: t.tp }]} numberOfLines={1}>{activeProgramName}</Text>
              </View>
            ) : (
              <Text style={[styles.sub, { color: t.ts }]} numberOfLines={1}>No active program</Text>
            )}
            <View style={styles.metaRow}>
              <View style={[styles.dot, { backgroundColor: ACCT }]} />
              <Text style={[styles.meta, { color: t.ts }]}>Last active {timeAgo(client.lastActiveISO)}</Text>
            </View>
          </View>
        </View>
      </NeuCard>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  avatar:     { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 16 },
  name:       { fontFamily: FontFamily.bold, fontSize: 16 },
  sub:        { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },
  programRow: { marginTop: 4 },
  programLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.9 },
  programName:  { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 1 },
  metaRow:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  dot:        { width: 6, height: 6, borderRadius: 3 },
  meta:       { fontFamily: FontFamily.regular, fontSize: 12 },
});
