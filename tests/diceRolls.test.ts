import { describe, expect, it } from "vitest";

import { bitesRoll, rollBitten, throwFor } from "../src/app/diceRolls.ts";
import { initialBoard } from "../src/core/board.ts";
import type { HexId } from "../src/core/cards.ts";
import { applyCommand, type GameEvent } from "../src/core/game.ts";
import { game } from "./helpers.ts";

/** Rolls for white under `hexes`, trying seeds until `wanted` holds for the roll. */
function rollUnder(hexes: HexId[], wanted: (dice: number[]) => boolean) {
  for (let rng = 1; rng < 500; rng++) {
    const state = game({
      board: initialBoard(),
      phase: "roll",
      rng,
      hexes: { white: hexes, black: [] },
    });
    const { events } = applyCommand(state, "white", { type: "roll" });
    const rolled = events.find((event) => event.type === "diceRolled");
    if (rolled?.type === "diceRolled" && wanted(rolled.dice)) return { events, rolled };
  }
  throw new Error("no such roll");
}

describe("rollBitten", () => {
  it("finds the lowered dice Shackles of Greed leave on a throw that was not doubles", () => {
    const { events, rolled } = rollUnder(["shackles"], ([a, b]) => a !== b);
    const bitten = rollBitten(events, rolled);
    expect(bitten?.type).toBe("diceChanged");
    expect(Math.max(...(bitten?.dice ?? []))).toBe(Math.max(...rolled.dice) - 1);
    expect(bitten && bitesRoll(events, bitten)).toBe(true);
  });

  it("finds nothing when no hex changes the roll", () => {
    const { events, rolled } = rollUnder([], () => true);
    expect(rollBitten(events, rolled)).toBeNull();
  });

  it("leaves a card's later change to be thrown again", () => {
    const rolled: GameEvent = { type: "diceRolled", player: "white", dice: [6, 5] };
    const events: GameEvent[] = [
      rolled,
      { type: "cardPlayed", player: "white", card: "leadWeight" },
      { type: "diceChanged", player: "white", dice: [5, 5], doubled: false },
    ];
    expect(rollBitten(events, rolled)).toBeNull();
    expect(bitesRoll(events, events[2]!)).toBe(false);
  });

  it("throws a bitten roll once, landing as thrown and then changing", () => {
    const { events, rolled } = rollUnder(["shackles"], ([a, b]) => a !== b);
    const bitten = rollBitten(events, rolled);
    expect(throwFor(events, rolled)).toEqual({
      thrown: rolled.dice,
      played: bitten?.dice,
      dropped: 0,
    });
    expect(bitten && throwFor(events, bitten)).toBeNull();
  });

  it("drops the highest die Cracked Dice throws, when the roll changes", () => {
    const { events, rolled } = rollUnder(["crackedDice"], (dice) => new Set(dice).size === 3);
    expect(throwFor(events, rolled)).toMatchObject({ thrown: rolled.dice, dropped: 1 });
  });
});
