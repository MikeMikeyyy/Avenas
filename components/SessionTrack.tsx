// The progress rail under a workout card: one dot per scheduled session of that
// day, joined by short lines, with the session you're looking at marked.
//
// Four dot states, and the difference between two of them is the point of this
// component:
//   done     filled accent
//   current  filled accent, larger, brighter glow
//   MISSED   filled grey — the day came round and nothing was logged
//   future   hollow, a thin ring in the track colour — it hasn't come round yet
//
// A missed dot is FILLED grey rather than hollow because it is not the same thing
// as a session still to come: it already happened and went untrained. The lines
// either side of it fade between the two colours instead of switching at the
// joint, so the gap reads as a dip in the run rather than as a gap in the rail.
//
// Shared: this was duplicated verbatim in app/(tabs)/home.tsx and app/journal.tsx,
// which render the same card.

import { Fragment } from "react";
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

/** Past `total`, dots would be thinner than the gaps between them, so the rail
 *  becomes a bar. */
const MAX_DOTS = 12;

interface Props {
  /** Which session this card is, 1-based. */
  current: number;
  /** How many the program schedules for this day in total. */
  total: number;
  /** Session numbers that came round with nothing logged (utils/sessionTrack). */
  missed?: number[];
  accent: string;
  /** The rail's own colour: future dots' ring, and the unfilled bar. */
  track: string;
  /** Missed dots and the fade towards them. Defaults to `track`; pass the
   *  theme's secondary text colour for a grey that reads on both themes. */
  missedColor?: string;
}

type DotState = "done" | "current" | "missed" | "future";

export default function SessionTrack({ current, total, missed, accent, track, missedColor }: Props) {
  const grey = missedColor ?? track;
  const missedSet = new Set(missed ?? []);

  const stateAt = (i: number): DotState => {
    if (missedSet.has(i + 1)) return "missed";
    if (i === current - 1) return "current";
    return i < current - 1 ? "done" : "future";
  };
  // What the rail is drawn in AT that dot — the colour a connector fades to.
  const colorAt = (i: number): string => {
    const s = stateAt(i);
    return s === "missed" ? grey : s === "future" ? track : accent;
  };

  // Never fewer dots than the session being shown: a program can end up with one
  // more occurrence than it scheduled (a pushed day extends it), and a rail whose
  // current dot fell off the end would light every dot with none of them current.
  const dots = Math.max(total, current);

  if (dots <= MAX_DOTS) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {Array.from({ length: dots }).map((_, i) => {
          const state = stateAt(i);
          const isCurrent = state === "current";
          const isFuture  = state === "future";
          const isMissed  = state === "missed";
          const from = i > 0 ? colorAt(i - 1) : null;
          const to = colorAt(i);
          return (
            <Fragment key={i}>
              {from !== null && (
                from === to ? (
                  <View style={{
                    flex: 1, height: 2,
                    backgroundColor: to,
                    shadowColor: to === accent ? accent : "transparent",
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: to === accent ? 0.7 : 0,
                    shadowRadius: 2,
                  }} />
                ) : (
                  // Between two states: fade rather than switch, so a missed dot
                  // sits in a dip in the rail instead of behind a hard joint.
                  // The fade is held off until the last stretch (`locations`), so
                  // it reads as the line going out AT the circle rather than the
                  // whole segment washing halfway between two colours.
                  <LinearGradient
                    colors={[from, to]}
                    locations={to === accent ? [0.45, 1] : [0, 0.55]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={{ flex: 1, height: 2 }}
                  />
                )
              )}
              <View style={{
                width: isCurrent ? 9 : 7, height: isCurrent ? 9 : 7, borderRadius: 999,
                backgroundColor: isFuture ? "transparent" : isMissed ? grey : accent,
                borderWidth: isFuture ? 1.5 : 0, borderColor: track,
                // No glow on a missed dot: the glow is what makes a dot read as
                // lit, and this one deliberately isn't.
                shadowColor: isFuture || isMissed ? "transparent" : accent,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: isCurrent ? 0.95 : state === "done" ? 0.55 : 0,
                shadowRadius: isCurrent ? 3 : 2,
              }} />
            </Fragment>
          );
        })}
      </View>
    );
  }

  const pct = Math.min(1, current / total);
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: track, overflow: "hidden" }}>
      <View style={{
        width: `${Math.round(pct * 100)}%`, height: "100%", backgroundColor: accent, borderRadius: 2,
        shadowColor: accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6,
      }} />
    </View>
  );
}
