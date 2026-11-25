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

/** Orders indices into `values` by the value there, highest first. */
const byValue = (values: number[]) => (a: number, b: number) => (values[b] ?? 0) - (values[a] ?? 0);

/**
 * Pairs the thrown dice with the played ones. A die keeps its value where it can; the dice
 * left over are paired highest with highest, so a lowered die rolls down a pip. Thrown dice
 * left after that are dropped, and played dice left after that appear.
 */
export function planShift(thrown: number[], played: number[]): DiceShift {
  const ends: Array<number | null> = thrown.map(() => null);
  const taken = new Set<number>();
  const keep = (i: number, j: number) => {
    ends[i] = j;
    taken.add(j);
  };
  // A die that keeps its value keeps its place where it can, so no two dice cross.
  thrown.forEach((value, i) => {
    if (played[i] === value) keep(i, i);
  });
  thrown.forEach((value, i) => {
    if (ends[i] !== null) return;
    const j = played.findIndex((other, k) => other === value && !taken.has(k));
    if (j !== -1) keep(i, j);
  });
  const looseThrown = thrown
    .map((_, i) => i)
    .filter((i) => ends[i] === null)
    .toSorted(byValue(thrown));
  const loosePlayed = played
    .map((_, j) => j)
    .filter((j) => !taken.has(j))
    .toSorted(byValue(played));
  looseThrown.forEach((i, n) => {
    const j = loosePlayed[n];
    if (j !== undefined) ends[i] = j;
  });
  return {
    thrown: thrown.map((value, i) => {
      const end = ends[i];
      if (end === null || end === undefined) return null;
      return { faces: pipsBetween(value, played[end] ?? value), end };
    }),
    added: loosePlayed.slice(looseThrown.length).toSorted((a, b) => a - b),
  };
}
