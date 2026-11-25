import { describe, expect, it } from "vitest";

import { planShift } from "../src/render/diceShift.ts";

describe("planShift", () => {
  it("rolls a lowered die down a pip and leaves the other alone", () => {
    // Shackles of Greed on a 6-5: the 6 drops to a 5, which is not rolled doubles.
    expect(planShift([6, 5], [5, 5])).toEqual({
      thrown: [
        { faces: [6, 5], end: 0 },
        { faces: [5], end: 1 },
      ],
      added: [],
    });
  });

  it("rolls through every pip when a die drops by more than one", () => {
    // Shackles and Lead Weight together on a 6-2.
    expect(planShift([6, 2], [4, 2]).thrown).toEqual([
      { faces: [6, 5, 4], end: 0 },
      { faces: [2], end: 1 },
    ]);
  });

  it("drops the die Cracked Dice throws away", () => {
    expect(planShift([6, 3, 2], [2, 3], 1)).toEqual({
      thrown: [null, { faces: [3], end: 1 }, { faces: [2], end: 0 }],
      added: [],
    });
  });

  it("brings in the dice Curse Eater adds", () => {
    expect(planShift([4, 1], [4, 1, 6])).toEqual({
      thrown: [
        { faces: [4], end: 0 },
        { faces: [1], end: 1 },
      ],
      added: [2],
    });
  });

  it("still rolls a lowered die down when an added die shows what it was thrown as", () => {
    // Shackles on a 1-6, then Curse Eater adds a 6.
    expect(planShift([1, 6], [1, 5, 6])).toEqual({
      thrown: [
        { faces: [1], end: 0 },
        { faces: [6, 5], end: 1 },
      ],
      added: [2],
    });
  });

  it("drops the die Cracked Dice throws away even when an added die matches it", () => {
    expect(planShift([1, 2, 6], [1, 2, 6], 1)).toEqual({
      thrown: [{ faces: [1], end: 0 }, { faces: [2], end: 1 }, null],
      added: [2],
    });
  });

  it("rolls a die of lowered doubles down, the other moves of the doubles appearing", () => {
    // Lead Weight on a rolled 6-6, played as 5-6-6-6.
    expect(planShift([6, 6], [5, 6, 6, 6])).toEqual({
      thrown: [
        { faces: [6, 5], end: 0 },
        { faces: [6], end: 1 },
      ],
      added: [2, 3],
    });
  });
});
