import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import Avatar from "../Avatar";
import FavouriteStar from "../FavouriteStar";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { Client } from "../../utils/trainerStore";
import { isActiveNow, presenceLabel } from "../../utils/presence";

export default function ClientCard({ client, activeProgramName, badge, badgeColor = ACCT, showAccountType = true, isFavourite = false, onToggleFavourite, onPress }: {
  client: Client;
  activeProgramName?: string;
  /** Extra tag beside the name, e.g. a group role. */
  badge?: string;
  /** Tint for `badge`. Defaults to the brand accent. */
  badgeColor?: string;
  /**
   * Whether to show the automatic TRAINER tag for a trainer ACCOUNT.
   *
   * False inside a group, where the card already states the person's standing
   * IN that group and a second TRAINER chip says something else entirely — in
   * the accent, which is the colour a group's OWNER badge uses. A trainer
   * demoted to member read as "TRAINER" (green) next to "MEMBER" (blue) and
   * looked like the demotion hadn't taken, when the stored role was right all
   * along.
   */
  showAccountType?: boolean;
  /**
   * Starred state. Three cases, in order of how the card reads:
   *
   *   isFavourite + onToggleFavourite → a tappable star, hollow when unstarred
   *   isFavourite alone              → a static gold star, no control
   *   neither                        → nothing at all
   *
   * The middle one is what a roster wants: an empty outline on every row puts a
   * control on a card whose job is to be tapped once, and a star you can only
   * see when it means something is the point of a star.
   */
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  /** Omit for a card with nothing behind it — your own row in a group roster,
   *  or a fellow member a gym user has no coaching relationship with. It then
   *  renders as a plain card: no bounce, no haptic, no button role, so it never
   *  promises a destination it doesn't have. Passing a no-op here instead would
   *  still bounce and buzz, because BounceButton fires the haptic itself. */
  onPress?: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const card = (
    <NeuCard dark={isDark} radius={18}>
      <View style={styles.row}>
        <Avatar
          uri={client.photoUri}
          initials={client.initials}
          size={48}
          backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
          textColor={ACCT}
          textStyle={[styles.avatarText, { color: ACCT }]}
        />
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{client.name}</Text>
            {client.isTrainer && showAccountType && (
              <View style={[styles.trainerTag, { backgroundColor: `${ACCT}22` }]}>
                <Text style={[styles.trainerTagText, { color: ACCT }]}>TRAINER</Text>
              </View>
            )}
            {badge ? (
              <View style={[styles.trainerTag, { backgroundColor: `${badgeColor}22` }]}>
                <Text style={[styles.trainerTagText, { color: badgeColor }]}>{badge}</Text>
              </View>
            ) : null}
          </View>
          {activeProgramName ? (
            <View style={styles.programRow}>
              <Text style={[styles.programLabel, { color: t.ts }]}>ACTIVE PROGRAM</Text>
              <Text style={[styles.programName, { color: t.tp }]} numberOfLines={1}>{activeProgramName}</Text>
            </View>
          ) : (
            <Text style={[styles.sub, { color: t.ts }]} numberOfLines={1}>No active program</Text>
          )}
          {/* No timestamp → no row: covers both "never active" and "sharing
              turned off" (migration 0009) without distinguishing them. */}
          {!!client.lastActiveISO && (
            <View style={styles.metaRow}>
              <View style={[styles.dot, { backgroundColor: isActiveNow(client.lastActiveISO) ? ACCT : t.ts }]} />
              <Text style={[styles.meta, { color: t.ts }]}>
                {presenceLabel(client.lastActiveISO)}
              </Text>
            </View>
          )}
        </View>
        {/* Right edge, vertically centred: its own tap target inside the card,
            so starring someone never opens them. A nested touchable wins the
            responder, which is what keeps the two apart. */}
        {onToggleFavourite ? (
          <TouchableOpacity
            onPress={onToggleFavourite}
            activeOpacity={0.7}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: isFavourite }}
            accessibilityLabel={isFavourite ? `Unfavourite ${client.name}` : `Favourite ${client.name}`}
          >
            <FavouriteStar size={18} filled={isFavourite} inactiveColor={t.ts} />
          </TouchableOpacity>
        ) : isFavourite ? (
          <FavouriteStar size={18} />
        ) : null}
      </View>
    </NeuCard>
  );

  if (!onPress) return <View style={{ marginBottom: 12 }}>{card}</View>;

  return (
    <BounceButton style={{ marginBottom: 12 }} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${client.name}`}>
      {card}
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  avatar:     { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 16 },
  nameRow:    { flexDirection: "row", alignItems: "center", gap: 6 },
  name:       { fontFamily: FontFamily.bold, fontSize: 16, flexShrink: 1 },
  trainerTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  trainerTagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
  sub:        { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },
  programRow: { marginTop: 4 },
  programLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.9 },
  programName:  { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 1 },
  metaRow:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  dot:        { width: 6, height: 6, borderRadius: 3 },
  meta:       { fontFamily: FontFamily.regular, fontSize: 12 },
});
