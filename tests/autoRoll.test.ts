import { describe, expect, it } from "vitest";

import { rollsByItself } from "../src/app/autoRoll.ts";
import { viewFor } from "../src/core/view.ts";
import { game, hand } from "./helpers.ts";

describe("rollsByItself", () => {
  it("throws the dice when nothing in hand can be played before the roll", () => {
    const state = game({ phase: "roll", cards: hand("white", "leadWeight", "sageSmoke") });
    expect(rollsByItself(viewFor(state, "white"))).toBe(true);
  });

  it("waits for the player when a cleansing ward could lift a hex first", () => {
    const state = game({
      phase: "roll",
      hexes: { white: ["leadWeight"], black: [] },
      cards: hand("white", "sageSmoke"),
    });
    expect(rollsByItself(viewFor(state, "white"))).toBe(false);
  });

  it("never rolls for the other player, or outside the roll", () => {
    expect(rollsByItself(viewFor(game({ phase: "roll" }), "black"))).toBe(false);
    expect(rollsByItself(viewFor(game({ phase: "pick" }), "white"))).toBe(false);
  });
});
