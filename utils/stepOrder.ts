// utils/stepOrder.ts
//
// Moving one row of a list by dragging it, when the rows differ in height (a
// custom exercise's steps, components/StepsEditor.tsx): which place the held
// row has reached, which rows slide to make room, and the list in its new
// order. Pure, so scripts/verify-steps-order.ts can run it.

/** The place a held row has reached, dragged `dy` from where it stood: how
 *  many of the other rows' middles its own middle is past, each where it stood
 *  when the row was picked up (`heights`, top to bottom). */
export function placeReached(heights: readonly number[], from: number, dy: number): number {
  let top = 0;
  const middles = heights.map(h => {
    const middle = top + h / 2;
    top += h;
    return middle;
  });
  const held = middles[from] + dy;
  return middles.reduce((n, m, i) => (i !== from && m < held ? n + 1 : n), 0);
}

/** Which way row `i` slides to make room for the row held from `from` and
 *  over place `over`: up a place (-1), down (1), or not at all. */
export function slideFor(i: number, from: number, over: number): -1 | 0 | 1 {
  if (i === from) return 0;
  if (over > from && i > from && i <= over) return -1;
  if (over < from && i < from && i >= over) return 1;
  return 0;
}

/** `items` with the one at `from` taken out and put in at `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
