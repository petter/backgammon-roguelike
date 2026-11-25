import { describe, expect, it } from "vitest";

import { coinReveal, playedReveal, revealFor } from "../src/app/reveals.ts";
import { emptyBoard, place, type Player } from "../src/core/board.ts";
import { applyCommand } from "../src/core/game.ts";
import { game, hand } from "./helpers.ts";

const whose = (player: Player) => (player === "white" ? "Your" : "Ada's");

describe("revealFor", () => {
  it("turns up a sprung Counterpunch before the hitter is sent to the bar, saying why", () => {
    const board = emptyBoard();
    place(board, "white", 10, 1);
    place(board, "black", 8, 1);
    const state = game({ board, dice: [2], traps: { white: [], black: ["counterpunch"] } });
    const { events } = applyCommand(state, "white", { type: "move", from: 10, to: 8, die: 2 });

    const sprung = events.findIndex((event) => event.type === "trapSprung");
    const hitterHit = events.findIndex((event) => event.type === "hit" && event.player === "white");
    expect(sprung).toBeGreaterThan(-1);
    expect(hitterHit).toBeGreaterThan(sprung);
    expect(revealFor(events[sprung]!, whose)).toEqual({
      card: "counterpunch",
      kind: "trap",
      title: "Ada's Counterpunch springs!",
      effect: "Your hitter goes to the bar too",
    });
  });

  it("shows a biting hex and what it does to the roll", () => {
    const reveal = revealFor({ type: "hexStruck", player: "white", card: "leadWeight" }, whose);
    expect(reveal).toMatchObject({ kind: "hex", effect: "Your highest die drops by 1" });
  });

  it("shows nothing for an ordinary event", () => {
    expect(revealFor({ type: "hit", player: "black", point: 8 }, whose)).toBeNull();
  });
});

describe("playedReveal", () => {
  const who = (player: Player) => (player === "white" ? "You" : "Ada");

  it("holds up a played card face up for both players", () => {
    const state = game({ dice: [3, 5], cards: hand("white", "leadWeight") });
    const { events } = applyCommand(state, "white", { type: "playCard", index: 0 });
    const played = events.find((event) => event.type === "cardPlayed");
    expect(played && playedReveal(played, who)).toEqual({
      card: "leadWeight",
      kind: "play",
      title: "You played Lead Weight",
    });
  });

  it("shows the opponent's trap only from the back, and the owner's by name", () => {
    expect(playedReveal({ type: "trapSet", player: "black", card: null }, who)).toMatchObject({
      card: null,
      kind: "set",
      title: "Ada set a trap",
    });
    expect(
      playedReveal({ type: "trapSet", player: "white", card: "counterpunch" }, who),
    ).toMatchObject({ card: "counterpunch", title: "You set Counterpunch" });
  });

  it("holds up nothing for an event that is not a card being played", () => {
    expect(playedReveal({ type: "hit", player: "black", point: 8 }, who)).toBeNull();
  });
});

describe("coinReveal", () => {
  it("tosses the coin a Coin Toss flipped, landing as it fell, and says what it does", () => {
    const outcomes = new Set<boolean>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = game({ dice: [2, 5], rng: seed, cards: hand("white", "coinToss") });
      const { events } = applyCommand(state, "white", { type: "playCard", index: 0 });
      const flip = events.find((event) => event.type === "coinFlipped");
      if (flip?.type !== "coinFlipped") throw new Error("no flip");
      outcomes.add(flip.heads);
      expect(coinReveal(flip, whose)).toEqual(
        flip.heads
          ? { heads: true, title: "Heads!", effect: "Your roll gains a die" }
          : { heads: false, title: "Tails", effect: "Your lowest die is lost" },
      );
    }
    expect(outcomes).toEqual(new Set([true, false]));
  });

  it("tosses nothing for any other event", () => {
    expect(coinReveal({ type: "hit", player: "black", point: 8 }, whose)).toBeNull();
  });
});
