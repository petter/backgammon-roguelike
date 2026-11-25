/**
 * How thrown dice turn into the dice that are played, when something changes them as they
 * land: a hex lowering one, Cracked Dice dropping one, Curse Eater adding some.
 */
export interface DiceShift {
  /**
   * For each thrown die, in order: the faces it rolls through, one pip at a time, from the
   * value thrown to the value played, and the index among the played dice it ends as. Null
   * when the die is dropped.
   */
  thrown: Array<{ faces: number[]; end: number } | null>;
  /** Indices among the played dice of dice that are not thrown but appear. */
  added: number[];
}

/** One pip at a time from `from` to `to`, both included. */
function pipsBetween(from: number, to: number): number[] {
  const step = to < from ? -1 : 1;
  const faces = [from];
  for (let value = from; value !== to; value += step) faces.push(value + step);
  return faces;
}

/**
 * Pairs the thrown dice with the played ones, which start with the dice kept from the throw
 * and end with any dice added. The `dropped` highest thrown dice are dropped, and the rest
 * kept lowest first, as Cracked Dice keeps them. Otherwise each die keeps its place, so a
 * lowered die rolls down where it lies.
 */
export function planShift(thrown: number[], played: number[], dropped = 0): DiceShift {
  const lowestFirst = (a: number, b: number) => (thrown[a] ?? 0) - (thrown[b] ?? 0);
  let kept = thrown.map((_, i) => i);
  if (dropped > 0) kept = kept.toSorted(lowestFirst).slice(0, -dropped);
  const ends = new Map(kept.map((i, end) => [i, end]));
  return {
    thrown: thrown.map((value, i) => {
      const end = ends.get(i);
      const to = end === undefined ? undefined : played[end];
      return end === undefined || to === undefined ? null : { faces: pipsBetween(value, to), end };
    }),
    added: played.map((_, end) => end).slice(kept.length),
  };
}
