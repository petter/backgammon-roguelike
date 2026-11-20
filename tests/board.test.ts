import { describe, expect, it } from "vitest";
import {
  applyMove,
  type BoardState,
  emptyBoard,
  initialBoard,
  legalMovesForDie,
  type Player,
  place,
} from "../src/core/board";

function countFor(board: BoardState, player: Player): number {
  const onPoints = board.points
    .filter((p) => p.owner === player)
    .reduce((sum, p) => sum + p.count, 0);
  return onPoints + board.bar[player] + board.off[player];
}

describe("initialBoard", () => {
  it("gives each player 15 checkers in the standard setup", () => {
    const board = initialBoard();
    expect(countFor(board, "white")).toBe(15);
    expect(countFor(board, "black")).toBe(15);
    expect(board.points[23]).toEqual({ owner: "white", count: 2 });
    expect(board.points[0]).toEqual({ owner: "black", count: 2 });
    expect(board.points[5]).toEqual({ owner: "white", count: 5 });
    expect(board.points[18]).toEqual({ owner: "black", count: 5 });
  });
});

describe("legalMovesForDie", () => {
  it("moves white down and black up", () => {
    const board = initialBoard();
    expect(legalMovesForDie(board, "white", 1).map((m) => [m.from, m.to])).toEqual([
      [5, 4],
      [7, 6],
      [23, 22],
    ]);
    expect(legalMovesForDie(board, "black", 1).map((m) => [m.from, m.to])).toEqual([
      [0, 1],
      [16, 17],
      [18, 19],
    ]);
  });

  it("blocks points held by two or more opposing checkers", () => {
    const board = initialBoard();
    // White's back checkers on 23 cannot land on black's 5 at 18.
    expect(legalMovesForDie(board, "white", 5).some((m) => m.from === 23)).toBe(false);
  });

  it("forces entry from the bar, and blocks it on a held point", () => {
    const board = initialBoard();
    board.bar.white = 1;
    expect(legalMovesForDie(board, "white", 3)).toEqual([
      { player: "white", from: "bar", to: 21, die: 3 },
    ]);
    // A 6 enters on index 18, held by five black checkers.
    expect(legalMovesForDie(board, "white", 6)).toEqual([]);
  });

  it("does not bear off while a checker is outside home", () => {
    const board = emptyBoard();
    place(board, "white", 2, 1);
    place(board, "white", 10, 1);
    expect(legalMovesForDie(board, "white", 3).some((m) => m.to === "off")).toBe(false);
  });

  it("bears off exactly, and overshoots only from the rearmost point", () => {
    const board = emptyBoard();
    place(board, "white", 1, 1);
    place(board, "white", 3, 1);
    expect(legalMovesForDie(board, "white", 2).map((m) => [m.from, m.to])).toEqual([
      [1, "off"],
      [3, 1],
    ]);
    expect(legalMovesForDie(board, "white", 6).map((m) => [m.from, m.to])).toEqual([[3, "off"]]);
  });

  it("bears black off the high end", () => {
    const board = emptyBoard();
    place(board, "black", 22, 2);
    expect(legalMovesForDie(board, "black", 2).map((m) => [m.from, m.to])).toEqual([[22, "off"]]);
  });
});

describe("applyMove", () => {
  it("sends a lone opposing checker to the bar", () => {
    const board = emptyBoard();
    place(board, "white", 10, 1);
    place(board, "black", 7, 1);
    const result = applyMove(board, { player: "white", from: 10, to: 7, die: 3 });
    expect(result.board.points[7]).toEqual({ owner: "white", count: 1 });
    expect(result.board.points[10]).toEqual({ owner: null, count: 0 });
    expect(result.board.bar.black).toBe(1);
    expect(result.events).toEqual([
      { type: "hit", player: "black", point: 7 },
      { type: "pieceMoved", player: "white", from: 10, to: 7 },
    ]);
  });

  it("leaves the input board untouched", () => {
    const board = initialBoard();
    applyMove(board, { player: "white", from: 23, to: 22, die: 1 });
    expect(board).toEqual(initialBoard());
  });
});
