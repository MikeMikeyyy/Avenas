// constants/cards.ts
//
// The geometry a card shares with its one-line summary row.
//
// Several sections in the app render the same list two ways: full cards, or a
// compact list when the section is collapsed. That means the SAME title is
// rendered by two different trees, and unless those trees agree on padding,
// font size and line height, the title jumps as you toggle between them. The
// toggle then reads as if it re-laid-out the page rather than as a change in
// how much of the page you're being shown.
//
// The contract both trees satisfy:
//
//   A title's box sits exactly CARD_PAD below the card's inner top edge and
//   CARD_PAD in from its left edge, at CARD_TITLE's size and line height.
//
// which is why SUMMARY_ROW's vertical padding is CARD_PAD rather than something
// tuned to look compact on its own.
//
// CARD_TITLE_LINE and CARD_PILL_H are deliberately equal. A summary row is
// `alignItems: "center"`, so its tallest child decides the row height and
// everything shorter gets pushed down by half the difference — a status pill
// even a point taller than the title would centre the title downward in list
// mode and nowhere else. Equal heights make that impossible rather than
// merely unlikely.

import type { TextStyle, ViewStyle } from "react-native";
import { FontFamily } from "./theme";

/** Inner padding of a card, and of one summary row. */
export const CARD_PAD = 14;
export const CARD_TITLE_LINE = 22;
export const CARD_PILL_H = 22;

/** A card's title, and the same title in a summary row. */
export const CARD_TITLE: TextStyle = {
  fontFamily: FontFamily.semibold,
  fontSize: 15,
  lineHeight: CARD_TITLE_LINE,
};

/** The line under a card title. Only the expanded card has room for one, so
 *  this has no summary-row counterpart — it sits below the shared title and
 *  can't move it. */
export const CARD_META: TextStyle = {
  fontFamily: FontFamily.regular,
  fontSize: 12,
  lineHeight: 16,
  marginTop: 2,
};

/** The padded body of an expanded card. Pair with `gap` for the rows below. */
export const CARD_INNER: ViewStyle = { padding: CARD_PAD };

/** The header row inside a card: title block on the left, status on the right. */
export const CARD_TOP: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
};

/** One row of the compact list a collapsed section shows. */
export const SUMMARY_ROW: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  paddingHorizontal: CARD_PAD,
  paddingVertical: CARD_PAD,
};

/** The status pill on the right of either. Fixed height, per the note above. */
export const CARD_PILL: ViewStyle = {
  height: CARD_PILL_H,
  justifyContent: "center",
  borderRadius: 8,
  paddingHorizontal: 9,
};

export const CARD_PILL_TEXT: TextStyle = {
  fontFamily: FontFamily.semibold,
  fontSize: 11,
  letterSpacing: 0.3,
};
