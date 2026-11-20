import { describe, expect, it } from "vitest";
import { emptyBoard, place } from "../src/core/board";
import { type GameState, legalMoves, newGame, playMove, roll } from "../src/core/game";
import { createRng, type Rng } from "../src/core/rng";

/** Rng whose dice come up as scripted. */
function fixedDice(...dice: number[]): Rng {
  let i = 0;
  return { next: () => 0, int: () => dice[i++] - 1 };
}

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const draw = (rng: Rng) => Array.from({ length: 20 }, () => rng.int(6));
    expect(draw(a)).toEqual(draw(b));
  });

  it("stays in range", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
    }
  });
});

describe("roll", () => {
  it("gives four dice on doubles", () => {
    const { state, events } = roll(newGame(), fixedDice(3, 3));
    expect(state.dice).toEqual([3, 3, 3, 3]);
    expect(state.phase).toBe("move");
    expect(events).toEqual([{ type: "diceRolled", player: "white", dice: [3, 3, 3, 3] }]);
  });

  it("passes the turn when nothing can move", () => {
    const start = newGame();
    start.board.bar.white = 1;
    // 6-6 enters on index 18, held by black.
    const { state, events } = roll(start, fixedDice(6, 6));
    expect(state.current).toBe("black");
    expect(state.phase).toBe("roll");
    expect(events.at(-1)).toEqual({
      type: "turnEnded",
      player: "white",
      next: "black",
      reason: "blocked",
    });
  });
});

describe("playMove", () => {
  it("spends dice and hands over after the last one", () => {
    let { state } = roll(newGame(), fixedDice(1, 2));
    state = playMove(state, { player: "white", from: 23, to: 22, die: 1 }).state;
    expect(state.dice).toEqual([2]);
    expect(state.current).toBe("white");
    const result = playMove(state, { player: "white", from: 22, to: 20, die: 2 });
    expect(result.state.current).toBe("black");
    expect(result.state.phase).toBe("roll");
    expect(result.events.at(-1)).toMatchObject({ type: "turnEnded", reason: "done" });
  });

  it("rejects moves that are not legal", () => {
    const { state } = roll(newGame(), fixedDice(1, 2));
    expect(() => playMove(state, { player: "white", from: 23, to: 18, die: 5 })).toThrow();
    expect(() => playMove(state, { player: "black", from: 0, to: 1, die: 1 })).toThrow();
  });

  it("ends the game when the last checker is borne off", () => {
    const board = emptyBoard();
    place(board, "white", 0, 1);
    place(board, "black", 23, 1);
    board.off.white = 14;
    board.off.black = 14;
    const state: GameState = { board, current: "white", dice: [1, 4], phase: "move", winner: null };
    expect(legalMoves(state).some((m) => m.to === "off")).toBe(true);
    const result = playMove(state, { player: "white", from: 0, to: "off", die: 1 });
    expect(result.state.phase).toBe("over");
    expect(result.state.winner).toBe("white");
    expect(result.events.at(-1)).toEqual({ type: "gameWon", winner: "white" });
  });
});
