import { describe, expect, it } from "vitest";
import { emptyBoard, initialBoard, place } from "../src/core/board.ts";
import { starterDeck } from "../src/core/cards.ts";
import {
  applyCommand,
  GameError,
  type GameState,
  HAND_LIMIT,
  legalMoves,
  newGame,
  OFFER_SIZE,
} from "../src/core/game.ts";
import { createRng, type Rng, shuffle } from "../src/core/rng.ts";
import { cards, checkersOf, game, hand } from "./helpers.ts";

describe("createRng", () => {
  const draw = (rng: Rng) => Array.from({ length: 20 }, () => rng.int(6));

  it("repeats the same sequence for the same seed", () => {
    expect(draw(createRng(42))).toEqual(draw(createRng(42)));
  });

  it("continues the sequence from a saved state", () => {
    const whole = draw(createRng(42));
    const first = createRng(42);
    const head = Array.from({ length: 8 }, () => first.int(6));
    const tail = Array.from(
      { length: 12 },
      (
        (rng) => () =>
          rng.int(6)
      )(createRng(first.state)),
    );
    expect([...head, ...tail]).toEqual(whole);
  });

  it("stays in range", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
    }
  });

  it("shuffles without losing or inventing items", () => {
    const deck = starterDeck();
    expect(shuffle(deck, createRng(3)).sort()).toEqual([...deck].sort());
  });
});

describe("newGame", () => {
  it("is fully determined by the seed", () => {
    expect(newGame(99)).toEqual(newGame(99));
    expect(newGame(99).state.rng).not.toBe(newGame(100).state.rng);
  });

  it("shuffles each deck from its own seed, so one deck says nothing about the other", () => {
    const a = newGame({ white: 1, black: 2, play: 3 }).state;
    const b = newGame({ white: 1, black: 999, play: 3 }).state;
    const all = (s: typeof a, who: "white" | "black") => [
      ...s.cards[who].deck,
      ...s.cards[who].offer,
    ];
    expect(a.current).toBe(b.current);
    expect(all(a, "white").sort()).toEqual(all(b, "white").sort());
    const whiteOrder = (s: typeof a) =>
      s.current === "white"
        ? [...s.cards.white.deck, ...[...s.cards.white.offer].reverse()]
        : s.cards.white.deck;
    expect(whiteOrder(a)).toEqual(whiteOrder(b));
    expect(a.cards.black).not.toEqual(b.cards.black);
  });

  it("opens with the first player picking from three cards", () => {
    const { state, events } = newGame(5);
    const mine = state.cards[state.current];
    expect(state.phase).toBe("pick");
    expect(mine.offer).toHaveLength(OFFER_SIZE);
    expect(mine.deck).toHaveLength(starterDeck().length - OFFER_SIZE);
    expect(events).toEqual([{ type: "cardsOffered", player: state.current, cards: mine.offer }]);
  });

  it("lets either player start, depending on the seed", () => {
    const starters = new Set(Array.from({ length: 40 }, (_, seed) => newGame(seed).state.current));
    expect(starters).toEqual(new Set(["white", "black"]));
  });
});

describe("turn flow", () => {
  it("goes pick, roll, move, end turn", () => {
    let { state } = newGame(5);
    const player = state.current;
    const offered = state.cards[player].offer;

    let result = applyCommand(state, player, { type: "pickCard", index: 1 });
    state = result.state;
    expect(result.events).toEqual([{ type: "cardPicked", player, card: offered[1] }]);
    expect(state.cards[player].hand).toEqual([offered[1]]);
    expect(state.cards[player].discard).toEqual([offered[0], offered[2]]);
    expect(state.phase).toBe("roll");

    result = applyCommand(state, player, { type: "roll" });
    state = result.state;
    expect(state.phase).toBe("move");
    expect([2, 4]).toContain(state.dice.length);
    expect(result.events[0]).toMatchObject({ type: "diceRolled", player, dice: state.dice });
  });

  it("rolls four dice on doubles, somewhere in the first hundred seeds", () => {
    const lengths = new Set<number>();
    for (let seed = 0; seed < 100; seed++) {
      const started = game({ phase: "roll", rng: seed, board: initialBoard() });
      const { dice } = applyCommand(started, "white", { type: "roll" }).state;
      lengths.add(dice.length);
      if (dice.length === 4) expect(new Set(dice).size).toBe(1);
      else expect(dice[0]).not.toBe(dice[1]);
    }
    expect(lengths).toEqual(new Set([2, 4]));
  });

  it("rejects commands from the player who is not on turn", () => {
    const state = game({ phase: "roll" });
    expect(() => applyCommand(state, "black", { type: "roll" })).toThrow(GameError);
  });

  it("rejects commands in the wrong phase", () => {
    const rolling = game({ phase: "roll" });
    expect(() => applyCommand(rolling, "white", { type: "endTurn" })).toThrow(GameError);
    expect(() => applyCommand(rolling, "white", { type: "pickCard", index: 0 })).toThrow(GameError);
    expect(() => applyCommand(game(), "white", { type: "roll" })).toThrow(GameError);
  });

  it("spends a die per move and rejects illegal moves", () => {
    const state = game({ board: initialBoard(), dice: [1, 2] });
    const moved = applyCommand(state, "white", { type: "move", from: 23, to: 22, die: 1 }).state;
    expect(moved.dice).toEqual([2]);
    expect(moved.current).toBe("white");
    expect(() => applyCommand(state, "white", { type: "move", from: 23, to: 18, die: 5 })).toThrow(
      GameError,
    );
    // Right squares, wrong die.
    expect(() => applyCommand(state, "white", { type: "move", from: 23, to: 22, die: 2 })).toThrow(
      GameError,
    );
  });

  it("only ends the turn once no move is left", () => {
    const state = game({ board: initialBoard(), dice: [1] });
    expect(() => applyCommand(state, "white", { type: "endTurn" })).toThrow(GameError);
    const moved = applyCommand(state, "white", { type: "move", from: 23, to: 22, die: 1 }).state;
    const { state: next, events } = applyCommand(moved, "white", { type: "endTurn" });
    expect(next.current).toBe("black");
    expect(next.dice).toEqual([]);
    expect(events[0]).toEqual({ type: "turnEnded", player: "white", next: "black" });
  });

  it("lets a blocked player end the turn with dice left", () => {
    const board = initialBoard();
    board.bar.white = 1;
    // A 6 enters on index 18, held by five black checkers.
    const state = game({ board, dice: [6, 6, 6, 6] });
    expect(legalMoves(state)).toEqual([]);
    expect(applyCommand(state, "white", { type: "endTurn" }).state.current).toBe("black");
  });

  it("ends the game when the last checker is borne off", () => {
    const board = emptyBoard();
    place(board, "white", 0, 1);
    place(board, "black", 23, 1);
    board.off.white = 14;
    board.off.black = 14;
    const state = game({ board, dice: [1, 4] });
    const result = applyCommand(state, "white", { type: "move", from: 0, to: "off", die: 1 });
    expect(result.state.phase).toBe("over");
    expect(result.state.winner).toBe("white");
    expect(result.events.at(-1)).toEqual({ type: "gameWon", winner: "white" });
    expect(() => applyCommand(result.state, "black", { type: "roll" })).toThrow(GameError);
  });
});

describe("dealing", () => {
  const endWhiteTurn = (state: GameState) => applyCommand(state, "white", { type: "endTurn" });

  it("skips the pick when the hand is full", () => {
    const full = Array.from({ length: HAND_LIMIT }, () => "quake" as const);
    const state = game({
      cards: { white: cards(), black: cards({ hand: full, deck: ["charm", "charm", "charm"] }) },
    });
    const { state: next, events } = endWhiteTurn(state);
    expect(next.phase).toBe("roll");
    expect(next.cards.black.offer).toEqual([]);
    expect(events.some((e) => e.type === "cardsOffered")).toBe(false);
  });

  it("reshuffles the discard pile when the deck runs out", () => {
    const state = game({
      cards: {
        white: cards(),
        black: cards({ deck: ["charm"], discard: ["quake", "shield", "reroll"] }),
      },
    });
    const next = endWhiteTurn(state).state.cards.black;
    expect(next.offer).toHaveLength(3);
    expect(next.offer[0]).toBe("charm");
    expect([...next.offer.slice(1), ...next.deck].sort()).toEqual(["quake", "reroll", "shield"]);
    expect(next.discard).toEqual([]);
  });

  it("offers fewer cards, or none, when there are not enough left", () => {
    const one = endWhiteTurn(
      game({ cards: { white: cards(), black: cards({ deck: ["charm"] }) } }),
    );
    expect(one.state.cards.black.offer).toEqual(["charm"]);
    expect(one.state.phase).toBe("pick");
    expect(endWhiteTurn(game()).state.phase).toBe("roll");
  });

  it("never loses or duplicates a card over a long game", () => {
    let state = newGame(11).state;
    for (let turn = 0; turn < 60; turn++) {
      const player = state.current;
      if (state.phase === "pick") {
        state = applyCommand(state, player, { type: "pickCard", index: 0 }).state;
      }
      state = applyCommand(state, player, { type: "roll" }).state;
      while (state.cards[player].hand.length > 2) {
        const index = state.cards[player].hand.findIndex((c) => c !== "reroll" && c !== "loaded");
        if (index < 0) break;
        state = applyCommand(state, player, { type: "playCard", index }).state;
      }
      for (let moves = legalMoves(state); moves.length > 0; moves = legalMoves(state)) {
        state = applyCommand(state, player, { type: "move", ...moves[0] }).state;
        if (state.phase === "over") return;
      }
      state = applyCommand(state, player, { type: "endTurn" }).state;
      for (const who of ["white", "black"] as const) {
        const mine = state.cards[who];
        const all = [...mine.deck, ...mine.hand, ...mine.discard, ...mine.offer];
        expect(all.sort()).toEqual(starterDeck().sort());
        expect(checkersOf(state.board, who)).toBe(15);
      }
    }
  });
});

describe("cards", () => {
  const play = (state: GameState, index = 0) =>
    applyCommand(state, "white", { type: "playCard", index });

  it("moves a played card from hand to discard and announces it", () => {
    const { state, events } = play(game({ cards: hand("white", "charm", "quake") }), 1);
    expect(state.cards.white.hand).toEqual(["charm"]);
    expect(state.cards.white.discard).toEqual(["quake"]);
    expect(events[0]).toEqual({ type: "cardPlayed", player: "white", card: "quake" });
  });

  it("cannot be played before rolling, or from an empty slot", () => {
    const state = game({ phase: "roll", cards: hand("white", "charm") });
    expect(() => play(state)).toThrow(GameError);
    expect(() => play(game({ cards: hand("white", "charm") }), 3)).toThrow(GameError);
  });

  it("Second Wind rerolls each remaining die", () => {
    const { state, events } = play(game({ dice: [1, 2, 3], cards: hand("white", "reroll") }));
    expect(state.dice).toHaveLength(3);
    for (const die of state.dice) expect([1, 2, 3, 4, 5, 6]).toContain(die);
    expect(events.at(-1)).toEqual({
      type: "diceChanged",
      player: "white",
      dice: state.dice,
      doubled: false,
    });
    expect(state.rng).not.toBe(1);
    expect(() => play(game({ dice: [], cards: hand("white", "reroll") }))).toThrow(GameError);
  });

  it("Loaded Die turns the lowest die into a 6", () => {
    expect(play(game({ dice: [4, 2, 5], cards: hand("white", "loaded") })).state.dice).toEqual([
      4, 6, 5,
    ]);
    expect(() => play(game({ dice: [6, 6], cards: hand("white", "loaded") }))).toThrow(GameError);
    expect(() => play(game({ dice: [], cards: hand("white", "loaded") }))).toThrow(GameError);
  });

  it("treats a pair made by a card as doubles: four moves", () => {
    const loaded = play(game({ dice: [5, 6], cards: hand("white", "loaded") }));
    expect(loaded.state.dice).toEqual([6, 6, 6, 6]);
    expect(loaded.events.at(-1)).toEqual({
      type: "diceChanged",
      player: "white",
      dice: [6, 6, 6, 6],
      doubled: true,
    });

    // Second Wind and Lucky Charm depend on the roll: check both outcomes over many seeds.
    const seen = { rerollPair: 0, rerollOther: 0, charmPair: 0, charmOther: 0 };
    for (let rng = 0; rng < 200; rng++) {
      const rerolled = play(game({ rng, dice: [1, 2], cards: hand("white", "reroll") })).state.dice;
      if (rerolled.length === 4) {
        expect(new Set(rerolled).size).toBe(1);
        seen.rerollPair++;
      } else {
        expect(rerolled).toHaveLength(2);
        expect(rerolled[0]).not.toBe(rerolled[1]);
        seen.rerollOther++;
      }
      const charmed = play(game({ rng, dice: [4], cards: hand("white", "charm") })).state.dice;
      if (charmed.length === 4) {
        expect(charmed).toEqual([4, 4, 4, 4]);
        seen.charmPair++;
      } else {
        expect(charmed).toHaveLength(2);
        expect(charmed[0]).toBe(4);
        expect(charmed[1]).not.toBe(4);
        seen.charmOther++;
      }
    }
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(0);
  });

  it("makes doubles only from exactly two dice", () => {
    // Three dice with two alike stay three dice.
    expect(play(game({ dice: [6, 2, 6], cards: hand("white", "loaded") })).state.dice).toEqual([
      6, 6, 6,
    ]);
    for (let rng = 0; rng < 50; rng++) {
      expect(
        play(game({ rng, dice: [3, 3], cards: hand("white", "charm") })).state.dice,
      ).toHaveLength(3);
      expect(
        play(game({ rng, dice: [1, 2, 3], cards: hand("white", "reroll") })).state.dice,
      ).toHaveLength(3);
      expect(play(game({ rng, dice: [], cards: hand("white", "charm") })).state.dice).toHaveLength(
        1,
      );
    }
    // Cards that do not touch the dice leave a pair alone.
    expect(play(game({ dice: [3, 3], cards: hand("white", "shield") })).state.dice).toEqual([3, 3]);
  });

  it("flags doubles only when a card turned an exact pair into four dice", () => {
    const doubled = (state: GameState) =>
      play(state).events.flatMap((e) => (e.type === "diceChanged" ? [e.doubled] : []));
    // Four dice afterwards, but no pair was made.
    expect(doubled(game({ dice: [3, 3, 3, 3], cards: hand("white", "loaded") }))).toEqual([false]);
    expect(doubled(game({ dice: [5, 6], cards: hand("white", "loaded") }))).toEqual([true]);
    for (let rng = 0; rng < 300; rng++) {
      const four = play(game({ rng, dice: [1, 2, 3, 4], cards: hand("white", "reroll") }));
      expect(four.state.dice).toHaveLength(4);
      expect(four.events.at(-1)).toMatchObject({ doubled: false });
      const three = play(game({ rng, dice: [2, 2, 5], cards: hand("white", "charm") }));
      expect(three.state.dice).toHaveLength(4);
      expect(three.events.at(-1)).toMatchObject({ doubled: false });
      const two = play(game({ rng, dice: [1, 2], cards: hand("white", "reroll") }));
      expect(two.events.at(-1)).toMatchObject({ doubled: two.state.dice.length === 4 });
    }
    expect(doubled(game({ dice: [3, 3], cards: hand("white", "shield") }))).toEqual([]);
  });

  it("lets all four doubled dice be played", () => {
    const board = emptyBoard();
    place(board, "white", 23, 4);
    let state = play(game({ board, dice: [5, 6], cards: hand("white", "loaded") })).state;
    for (let i = 0; i < 4; i++) {
      state = applyCommand(state, "white", { type: "move", from: 23, to: 17, die: 6 }).state;
    }
    expect(state.dice).toEqual([]);
    expect(state.board.points[17]).toEqual({ owner: "white", count: 4 });
  });

  it("Lucky Charm adds a die, even when none are left", () => {
    const { state } = play(game({ dice: [], cards: hand("white", "charm") }));
    expect(state.dice).toHaveLength(1);
    expect([1, 2, 3, 4, 5, 6]).toContain(state.dice[0]);
  });

  it("Bulwark protects lone checkers until the owner's next turn", () => {
    const board = emptyBoard();
    place(board, "white", 10, 1);
    place(board, "black", 7, 1);
    const shielded = play(game({ board, cards: hand("white", "shield") }));
    expect(shielded.events).toContainEqual({ type: "shieldRaised", player: "white" });

    const blackTurn = { ...shielded.state, current: "black" as const, dice: [3] };
    expect(legalMoves(blackTurn)).toEqual([]);
    expect(legalMoves({ ...blackTurn, shielded: { white: false, black: false } })).toEqual([
      { player: "black", from: 7, to: 10, die: 3 },
    ]);

    const backToWhite = applyCommand(blackTurn, "black", { type: "endTurn" }).state;
    expect(backToWhite.shielded.white).toBe(false);
  });

  it("Bulwark also blocks entry from the bar onto a lone checker", () => {
    const board = emptyBoard();
    place(board, "white", 2, 1);
    board.bar.black = 1;
    const state = game({
      board,
      current: "black",
      dice: [3],
      shielded: { white: true, black: false },
    });
    expect(legalMoves(state)).toEqual([]);
  });

  it("Quake sends lone enemy checkers in your home board to the bar", () => {
    const board = emptyBoard();
    place(board, "black", 2, 1);
    place(board, "black", 4, 2);
    place(board, "black", 5, 1);
    place(board, "black", 6, 1);
    const { state, events } = play(game({ board, cards: hand("white", "quake") }));
    expect(state.board.bar.black).toBe(2);
    expect(state.board.points[2]).toEqual({ owner: null, count: 0 });
    expect(state.board.points[4].count).toBe(2);
    expect(state.board.points[6].count).toBe(1);
    expect(events.filter((e) => e.type === "hit")).toEqual([
      { type: "hit", player: "black", point: 2 },
      { type: "hit", player: "black", point: 5 },
    ]);
    expect(checkersOf(state.board, "black")).toBe(5);
  });

  it("Quake does nothing against a shielded opponent", () => {
    const board = emptyBoard();
    place(board, "black", 2, 1);
    const state = game({
      board,
      cards: hand("white", "quake"),
      shielded: { white: false, black: true },
    });
    expect(play(state).state.board).toEqual(board);
  });

  it("Quake works from black's side too", () => {
    const board = emptyBoard();
    place(board, "white", 20, 1);
    place(board, "white", 10, 1);
    const state = game({ board, current: "black", cards: hand("black", "quake") });
    const result = applyCommand(state, "black", { type: "playCard", index: 0 });
    expect(result.state.board.bar.white).toBe(1);
    expect(result.state.board.points[10].count).toBe(1);
  });
});
