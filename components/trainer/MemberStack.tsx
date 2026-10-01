// A group's members as a row of overlapping faces, with "+N" past `max`.
//
// One component for the two places a group shows who's in it: the banner on its
// own page, and its card on the Trainer tab (tighter there, smaller faces
// tucked further under each other, so the row sits under the group's name).
// The faces come in get_group_members' order, owner first, so both show the
// same people in the same order, invites still to be answered included.

import { StyleSheet, Text, View } from "react-native";

import Avatar from "../Avatar";
import { ACCT, FontFamily } from "../../constants/theme";
import type { MemberFace } from "../../constants/groups";

/** Faces shown before the rest collapse into "+N", wherever a group shows its
 *  stack, so the page and its card show the same people. */
const MEMBER_STACK_MAX = 4;

/** The ring around each face: the surface behind the stack, so the overlapping
 *  faces stay separated. */
const RING = 2;

export default function MemberStack({ members, size, overlap, isDark, ringColor, countColor }: {
  members: MemberFace[];
  /** Each face's diameter, inside its ring. */
  size: number;
  /** How far each face tucks under the one before it. */
  overlap: number;
  isDark: boolean;
  /** The surface the stack sits on. */
  ringColor: string;
  /** "+N"'s text: the page's secondary text colour. */
  countColor: string;
}) {
  const shown = members.slice(0, MEMBER_STACK_MAX);
  const overflow = Math.max(0, members.length - MEMBER_STACK_MAX);
  const ring = { borderRadius: size / 2 + RING, borderWidth: RING, borderColor: ringColor };
  // The banner's sizes (13 and 12 on a 38pt face), scaled, and never so small
  // that initials stop being letters.
  const initialsSize = Math.max(9, Math.round(size * 0.34));
  const countSize = Math.max(9, Math.round(size * 0.32));

  return (
    <View style={styles.stack}>
      {shown.map((m, i) => (
        <View key={m.id} style={[ring, { marginLeft: i === 0 ? 0 : -overlap }]}>
          <Avatar
            uri={m.photoUri}
            initials={m.initials}
            size={size}
            backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
            textColor={ACCT}
            textStyle={[styles.initials, { fontSize: initialsSize, color: ACCT }]}
          />
        </View>
      ))}
      {overflow > 0 && (
        <View
          style={[
            ring,
            styles.overflow,
            {
              // The face's own size, ring included: a touch smaller than the
              // faces, as the banner has always drawn it.
              width: size,
              height: size,
              marginLeft: -overlap,
              backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)",
            },
          ]}
        >
          <Text style={[styles.count, { fontSize: countSize, color: countColor }]}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack:    { flexDirection: "row", alignItems: "center" },
  initials: { fontFamily: FontFamily.bold },
  overflow: { alignItems: "center", justifyContent: "center" },
  count:    { fontFamily: FontFamily.bold },
});
