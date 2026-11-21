import { describe, expect, it } from "vitest";

import { revealFor } from "../src/app/reveals.ts";
import { emptyBoard, place, type Player } from "../src/core/board.ts";
import { applyCommand } from "../src/core/game.ts";
import { game } from "./helpers.ts";

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
