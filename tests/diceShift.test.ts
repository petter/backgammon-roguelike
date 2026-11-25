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
    expect(planShift([6, 3, 2], [2, 3])).toEqual({
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

  it("changes nothing when the dice stay as thrown", () => {
    expect(planShift([3, 5], [3, 5]).thrown.every((die) => die?.faces.length === 1)).toBe(true);
  });
});
