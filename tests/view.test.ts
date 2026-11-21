import { describe, expect, it } from "vitest";

import { applyCommand, type GameEvent, newGame } from "../src/core/game.ts";
import { redactEvent, viewFor } from "../src/core/view.ts";
import { cards, game } from "./helpers.ts";

describe("viewFor", () => {
  const state = game({
    rng: 123456789,
    cards: {
      white: cards({ deck: ["charm", "quake"], hand: ["shield"], offer: ["reroll"] }),
      black: cards({ deck: ["loaded"], hand: ["quake", "charm"], discard: ["shield"] }),
    },
  });

  it("shows your own hand and offer", () => {
    const view = viewFor(state, "white");
    expect(view.you).toBe("white");
    expect(view.hand).toEqual(["shield"]);
    expect(view.offer).toEqual(["reroll"]);
  });

  it("shows only pile sizes for both players", () => {
    expect(viewFor(state, "white").counts).toEqual({
      white: { hand: 1, deck: 2, discard: 0, traps: 0 },
      black: { hand: 2, deck: 1, discard: 1, traps: 0 },
    });
  });

  it("exposes exactly the documented fields, so new state stays secret by default", () => {
    expect(Object.keys(viewFor(state, "black")).toSorted()).toEqual(
      [
        "board",
        "bonusDice",
        "counts",
        "current",
        "dice",
        "extraOffer",
        "hand",
        "hexes",
        "offer",
        "phase",
        "rematch",
        "reversing",
        "shielded",
        "traps",
        "wards",
        "winReason",
        "winner",
        "wins",
        "you",
      ].toSorted(),
    );
  });

  it("leaks neither the opponent's cards nor the RNG state", () => {
    const wire = JSON.stringify(viewFor(state, "white"));
    expect(wire).not.toContain("123456789");
    // Black holds the only "loaded"; white must not see it anywhere.
    expect(wire).not.toContain("loaded");
    expect(wire).not.toContain('deck":[');
  });
});

describe("redactEvent", () => {
  it("hides the opponent's offer and pick, and nothing else", () => {
    const offered: GameEvent = { type: "cardsOffered", player: "white", cards: ["quake"] };
    const picked: GameEvent = { type: "cardPicked", player: "white", card: "quake" };
    const played: GameEvent = { type: "cardPlayed", player: "white", card: "quake" };
    expect(redactEvent(offered, "white")).toEqual(offered);
    expect(redactEvent(picked, "white")).toEqual(picked);
    expect(redactEvent(offered, "black")).toEqual({ ...offered, cards: null });
    expect(redactEvent(picked, "black")).toEqual({ ...picked, card: null });
    expect(redactEvent(played, "black")).toEqual(played);
  });

  it("keeps a whole turn's worth of events free of the opponent's card names", () => {
    let { state, events } = newGame(21);
    const player = state.current;
    const other = player === "white" ? "black" : "white";
    const picked = applyCommand(state, player, { type: "pickCard", index: 0 });
    state = picked.state;
    events = [...events, ...picked.events];
    const seen = JSON.stringify(events.map((e) => redactEvent(e, other)));
    for (const id of ["reroll", "loaded", "charm", "shield", "quake"]) {
      expect(seen).not.toContain(id);
    }
  });
});
