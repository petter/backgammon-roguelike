import { describe, expect, it } from "vitest";

import { lessonText, nextLesson, startProgress } from "../src/app/guidance.ts";
import { applyMove, emptyBoard, initialBoard, place } from "../src/core/board.ts";
import { viewFor } from "../src/core/view.ts";
import { game } from "./helpers.ts";

/** One straggler short of home for both players. */
function nearlyHome() {
  const board = emptyBoard();
  place(board, "white", 0, 14);
  place(board, "white", 6, 1);
  place(board, "black", 23, 14);
  place(board, "black", 17, 1);
  return board;
}

describe("nextLesson", () => {
  it("introduces the viewer once, at the start of a game", () => {
    const view = viewFor(game({ board: initialBoard(), phase: "pick", current: "black" }), "white");
    const first = nextLesson(startProgress(view.board), view, false);
    expect(first.lesson).toEqual({ kind: "home", player: "white" });
    expect(nextLesson(first.progress, view, false).lesson).toBeNull();
  });

  it("does not introduce a game already under way, such as after a reload", () => {
    const { board } = applyMove(initialBoard(), { player: "white", from: 12, to: 9, die: 3 });
    const view = viewFor(game({ board }), "white");
    expect(nextLesson(startProgress(board), view, false).lesson).toBeNull();
  });

  it("in hot-seat play introduces each player on their first turn", () => {
    const board = initialBoard();
    const white = viewFor(game({ board, current: "white" }), "white");
    const one = nextLesson(startProgress(board), white, true);
    expect(one.lesson).toEqual({ kind: "home", player: "white" });
    const black = viewFor(game({ board, current: "black" }), "black");
    const two = nextLesson(one.progress, black, true);
    expect(two.lesson).toEqual({ kind: "home", player: "black" });
    expect(nextLesson(two.progress, white, true).lesson).toBeNull();
  });

  it("says to bear off when the last checker comes home, once", () => {
    const before = nearlyHome();
    let { progress } = nextLesson(
      startProgress(before),
      viewFor(game({ board: before }), "white"),
      false,
    );
    const { board } = applyMove(before, { player: "white", from: 6, to: 2, die: 4 });
    const home = nextLesson(progress, viewFor(game({ board }), "white"), false);
    expect(home.lesson).toEqual({ kind: "bearOff", player: "white" });
    progress = home.progress;
    expect(nextLesson(progress, viewFor(game({ board }), "white"), false).lesson).toBeNull();
  });

  it("does not tell the viewer when the opponent gets home", () => {
    const before = nearlyHome();
    const { progress } = nextLesson(
      startProgress(before),
      viewFor(game({ board: before }), "white"),
      false,
    );
    const { board } = applyMove(before, { player: "black", from: 17, to: 20, die: 3 });
    const view = viewFor(game({ board, current: "black" }), "white");
    expect(nextLesson(progress, view, false).lesson).toBeNull();
  });

  it("does not say it again for a board that was already home when first seen", () => {
    const board = nearlyHome();
    board.points[6] = { owner: null, count: 0 };
    board.off.white = 1;
    const view = viewFor(game({ board }), "white");
    expect(nextLesson(startProgress(board), view, false).lesson).toBeNull();
  });

  it("teaches nothing once the game is over", () => {
    const view = viewFor(game({ board: initialBoard(), phase: "over", winner: "black" }), "white");
    expect(nextLesson(startProgress(view.board), view, false).lesson).toBeNull();
  });
});

describe("lessonText", () => {
  it("names the dice that can bear off, and only points at a ring that is there", () => {
    const lesson = { kind: "bearOff", player: "white" } as const;
    expect(lessonText(lesson, false, false, [1], 1).body).toMatch(
      /Your ⚀ takes the gold-ringed checker on your 1-point/,
    );
    expect(lessonText(lesson, false, false, [1], 1).body).not.toMatch(/farthest/);
    expect(lessonText(lesson, false, false, [6], 4).body).toMatch(
      /higher than your farthest checker/,
    );
    expect(lessonText(lesson, false, true, [2]).body).toMatch(/tap it/);
    expect(lessonText(lesson, false, false, []).body).toMatch(/^When a checker is ringed in gold/);
  });

  it("names the player in hot-seat play and says you online", () => {
    expect(lessonText({ kind: "home", player: "black" }, true).kicker).toMatch(/Black/);
    expect(lessonText({ kind: "home", player: "black" }, false).kicker).not.toMatch(/Black/);
  });
});
