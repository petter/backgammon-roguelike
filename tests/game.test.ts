import { describe, expect, it } from "vitest";
import { applyMove, emptyBoard, initialBoard, type Move, place } from "../src/core/board.ts";
import {
  CARD_IDS,
  CARDS,
  type CardId,
  RARITIES,
  type Rarity,
  starterDeck,
} from "../src/core/cards.ts";
import {
  applyCommand,
  canPlayCard,
  cardBlock,
  diceToPlay,
  GameError,
  type GameState,
  HAND_LIMIT,
  legalMoves,
  newGame,
  OFFER_SIZE,
  possibleMoves,
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

describe("starterDeck", () => {
  it("holds fewer copies the rarer a card is, and a single copy of the rarest", () => {
    const deck = starterDeck();
    const count = (id: CardId) => deck.filter((card) => card === id).length;
    const order = Object.keys(RARITIES) as Rarity[];
    for (const id of CARD_IDS) expect(count(id)).toBe(RARITIES[CARDS[id].rarity].copies);
    const copies = order.map((rarity) => RARITIES[rarity].copies);
    expect(copies).toEqual([...copies].sort((a, b) => b - a));
    expect(copies[0]).toBeGreaterThan(copies.at(-1) ?? 0);
    expect(RARITIES.legendary.copies).toBe(1);
    // The two cards that swing a game hardest are the two rarest.
    expect(CARDS.loaded.rarity).toBe("legendary");
    expect(CARDS.quake.rarity).toBe("epic");
    expect(deck).toHaveLength(11);
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
    // Only one die can be used, so it must be the higher one.
    expect(() =>
      applyCommand(state, "white", { type: "move", from: 0, to: "off", die: 1 }),
    ).toThrow(GameError);
    const result = applyCommand(state, "white", { type: "move", from: 0, to: "off", die: 4 });
    expect(result.state.phase).toBe("over");
    expect(result.state.winner).toBe("white");
    expect(result.events.at(-1)).toEqual({ type: "gameWon", winner: "white" });
    expect(() => applyCommand(result.state, "black", { type: "roll" })).toThrow(GameError);
  });
});

describe("rematch", () => {
  const won = () => {
    const board = emptyBoard();
    place(board, "white", 0, 1);
    place(board, "black", 23, 1);
    board.off.white = 14;
    board.off.black = 14;
    const state = game({ board, dice: [4], wins: { white: 1, black: 2 } });
    return applyCommand(state, "white", { type: "move", from: 0, to: "off", die: 4 }).state;
  };

  it("counts the win", () => {
    expect(won().wins).toEqual({ white: 2, black: 2 });
  });

  it("is refused while the game is still being played", () => {
    expect(() => applyCommand(game(), "white", { type: "rematch" })).toThrow(GameError);
    expect(() => applyCommand(game(), "black", { type: "rematch" })).toThrow(GameError);
  });

  it("waits for the other player, whoever asks first", () => {
    for (const asker of ["white", "black"] as const) {
      const asked = applyCommand(won(), asker, { type: "rematch" });
      expect(asked.events).toEqual([{ type: "rematchOffered", player: asker }]);
      expect(asked.state.phase).toBe("over");
      expect(asked.state.rematch[asker]).toBe(true);
      expect(asked.state.board).toEqual(won().board);
      expect(() => applyCommand(asked.state, asker, { type: "rematch" })).toThrow(GameError);
    }
  });

  it("starts a fresh game with the score kept once both have asked", () => {
    const asked = applyCommand(won(), "black", { type: "rematch" }).state;
    const { state, events } = applyCommand(asked, "white", { type: "rematch" });
    expect(state.board).toEqual(initialBoard());
    expect(state.winner).toBeNull();
    expect(state.phase).not.toBe("over");
    expect(state.wins).toEqual({ white: 2, black: 2 });
    expect(state.rematch).toEqual({ white: false, black: false });
    expect(state.shielded).toEqual({ white: false, black: false });
    expect(events[0]).toEqual({ type: "gameStarted", first: state.current });
    for (const player of ["white", "black"] as const) {
      const mine = state.cards[player];
      const held = mine.deck.length + mine.hand.length + mine.discard.length + mine.offer.length;
      expect(held).toBe(starterDeck().length);
    }
  });

  it("deals the new game from the seeds it is given, not from the old game", () => {
    const asked = applyCommand(won(), "black", { type: "rematch" }).state;
    const seeds = { white: 11, black: 22, play: 33 };
    const a = applyCommand({ ...asked, rng: 1 }, "white", { type: "rematch" }, seeds).state;
    const b = applyCommand({ ...asked, rng: 2 }, "white", { type: "rematch" }, seeds).state;
    expect(a).toEqual(b);
    expect(a.cards).toEqual(newGame(seeds).state.cards);
    const other = { ...seeds, white: 12 };
    const c = applyCommand(asked, "white", { type: "rematch" }, other).state;
    expect(c.cards.black).toEqual(a.cards.black);
    expect(c.cards.white).not.toEqual(a.cards.white);
  });
});

describe("using as many dice as possible", () => {
  const pairs = (moves: { from: number | "bar"; to: number | "off"; die: number }[]) =>
    moves.map((m) => `${m.from}>${m.to} (${m.die})`).sort();

  it("leaves a roll unrestricted when every die can be played whatever comes first", () => {
    const state = game({ board: initialBoard(), dice: [3, 1] });
    expect(pairs(legalMoves(state))).toEqual(pairs(possibleMoves(state)));
  });

  it("allows a single die when no order can use the other", () => {
    // White's one checker is on 10. The 6 is blocked at once (10>4). The 3 can be played
    // (10>7), after which the 6 is blocked too (7>1). One die is all there is.
    const board = emptyBoard();
    place(board, "white", 10, 1);
    place(board, "black", 4, 2);
    place(board, "black", 1, 2);
    const state = game({ board, dice: [6, 3] });
    expect(pairs(legalMoves(state))).toEqual(["10>7 (3)"]);
    const after = applyCommand(state, "white", { type: "move", from: 10, to: 7, die: 3 }).state;
    expect(legalMoves(after)).toEqual([]);
    expect(applyCommand(after, "white", { type: "endTurn" }).state.current).toBe("black");
  });

  it("requires the order that lets both dice be played", () => {
    const board = emptyBoard();
    place(board, "white", 12, 1);
    place(board, "white", 3, 1);
    // Black blocks 12>10 (the 2 first), 3>1 (the 2 for the other checker) and nothing else.
    place(board, "black", 10, 2);
    place(board, "black", 1, 2);
    const state = game({ board, dice: [5, 2] });
    // 12>7 with the 5, then 7>5 with the 2: both dice. Starting with the 2 is impossible
    // from 12, and 3>1 is blocked. The 5 from 3 would bear off: not allowed, 12 is outside.
    expect(pairs(possibleMoves(state))).toEqual(["12>7 (5)"]);
    expect(pairs(legalMoves(state))).toEqual(["12>7 (5)"]);
    const after = applyCommand(state, "white", { type: "move", from: 12, to: 7, die: 5 }).state;
    expect(pairs(legalMoves(after))).toEqual(["7>5 (2)"]);
  });

  it("forbids the move that strands a die when another order uses both", () => {
    const board = emptyBoard();
    place(board, "white", 8, 1);
    place(board, "white", 20, 1);
    // From 8: the 4 goes to 4 (open), the 2 goes to 6 (open). From 20: 16 blocked, 18 open.
    // After 20>18 (2), the 4 can be played 8>4 or 18>14. After 8>6 (2): 6>2 blocked, 20>16
    // blocked: the 4 is stranded. So 8>6 with the 2 is forbidden.
    place(board, "black", 16, 2);
    place(board, "black", 2, 2);
    const state = game({ board, dice: [4, 2] });
    expect(pairs(possibleMoves(state))).toContain("8>6 (2)");
    expect(pairs(legalMoves(state))).not.toContain("8>6 (2)");
    expect(pairs(legalMoves(state))).toContain("20>18 (2)");
    expect(pairs(legalMoves(state))).toContain("8>4 (4)");
    expect(() => applyCommand(state, "white", { type: "move", from: 8, to: 6, die: 2 })).toThrow(
      GameError,
    );
  });

  it("allows any die to start when every start uses the same number of dice", () => {
    // Two checkers left and three dice: any die bears off the first, another the second.
    const board = emptyBoard();
    place(board, "white", 0, 2);
    place(board, "black", 23, 15);
    board.off.white = 13;
    const state = game({ board, dice: [1, 2, 3] });
    expect(
      legalMoves(state)
        .map((m) => m.die)
        .sort(),
    ).toEqual([1, 2, 3]);
    expect(diceToPlay(state)).toBe(2);
  });

  it("counts the dice to play, so a refusal can be explained correctly", () => {
    // The 1 must go first (3 to 2), which keeps the 2 playable: two dice, not "the higher".
    const board = emptyBoard();
    place(board, "white", 0, 1);
    place(board, "white", 3, 1);
    place(board, "black", 1, 2);
    place(board, "black", 23, 13);
    board.off.white = 13;
    const state = game({ board, dice: [1, 2] });
    expect(pairs(legalMoves(state))).toEqual(["3>2 (1)"]);
    expect(diceToPlay(state)).toBe(2);
  });

  it("requires the higher die when either can be played but not both", () => {
    const board = emptyBoard();
    place(board, "white", 9, 1);
    // 9>4 (5) and 9>6 (3) are both open, but after either the other die is blocked.
    place(board, "black", 1, 2);
    place(board, "black", 3, 2);
    place(board, "black", 0, 2);
    const state = game({ board, dice: [5, 3] });
    expect(pairs(possibleMoves(state))).toEqual(["9>4 (5)", "9>6 (3)"]);
    // After 9>4: the 3 would go to 1, blocked. After 9>6: the 5 would go to 1, blocked.
    expect(pairs(legalMoves(state))).toEqual(["9>4 (5)"]);
  });

  it("allows the lower die when it is the only one that can be played", () => {
    const board = emptyBoard();
    place(board, "white", 9, 1);
    place(board, "black", 4, 2);
    place(board, "black", 1, 2);
    const state = game({ board, dice: [5, 3] });
    expect(pairs(legalMoves(state))).toEqual(["9>6 (3)"]);
  });

  it("makes doubles play as many of the four as can be played", () => {
    const board = emptyBoard();
    place(board, "white", 12, 1);
    place(board, "white", 6, 1);
    // Twos: from 12 the road is open (10, 8, 6, 4...). From 6: 4, then 2 is blocked.
    place(board, "black", 2, 2);
    const state = game({ board, dice: [2, 2, 2, 2] });
    // Every first move here still allows four dice in total, so nothing is forbidden yet.
    expect(pairs(legalMoves(state))).toEqual(pairs(possibleMoves(state)));
    // Play 6>4, then 12>10, 10>8, 8>6: four dice.
    let after = state;
    for (const [from, to] of [
      [6, 4],
      [12, 10],
      [10, 8],
      [8, 6],
    ]) {
      after = applyCommand(after, "white", { type: "move", from, to, die: 2 }).state;
    }
    expect(after.dice).toEqual([]);
  });

  it("takes an opponent's Bulwark into account", () => {
    const board = emptyBoard();
    place(board, "white", 9, 1);
    place(board, "black", 4, 1);
    place(board, "black", 6, 2);
    place(board, "black", 1, 2);
    // Unshielded, the 5 hits on 4 and is the only move (the 3 is blocked on 6).
    expect(pairs(legalMoves(game({ board, dice: [5, 3] })))).toEqual(["9>4 (5)"]);
    // Shielded, that blot cannot be hit: nothing can be played and the turn may end.
    const shielded = game({ board, dice: [5, 3], shielded: { white: false, black: true } });
    expect(legalMoves(shielded)).toEqual([]);
    expect(applyCommand(shielded, "white", { type: "endTurn" }).state.current).toBe("black");
  });

  it("follows the dice as cards change them", () => {
    const board = emptyBoard();
    place(board, "white", 9, 1);
    place(board, "black", 1, 2);
    place(board, "black", 3, 2);
    place(board, "black", 0, 2);
    // With 5 and 3 only the 5 may be played (see above). A Loaded Die turns the 3 into a 6.
    const state = game({ board, dice: [5, 3], cards: hand("white", "loaded") });
    const loaded = applyCommand(state, "white", { type: "playCard", index: 0 }).state;
    expect(loaded.dice).toEqual([5, 6]);
    // 9>3 (6) is blocked; 9>4 (5) then 4>... the 6 would bear off, but 4 is home and alone,
    // so it may: both dice can now be played, in that order only.
    expect(pairs(legalMoves(loaded))).toEqual(["9>4 (5)"]);
  });

  it("always lets a legal play run to the full count it promised", () => {
    // Follow legal moves at random from many positions: the dice used always equal the
    // most that could be used from the start, and never is a legal move absent while a
    // possible one exists.
    for (let seed = 0; seed < 400; seed++) {
      const rng = createRng(seed);
      const board = emptyBoard();
      for (let i = 0; i < 10; i++) {
        const point = rng.int(24);
        if (board.points[point].count === 0) {
          place(board, rng.int(2) ? "white" : "black", point, 1 + rng.int(3));
        }
      }
      const count = 1 + rng.int(4);
      const doubles = rng.int(4) === 0;
      const first = 1 + rng.int(6);
      const dice = Array.from({ length: doubles ? 4 : count }, () =>
        doubles ? first : 1 + rng.int(6),
      );
      let state = game({ board, dice });

      // The best any order of possible moves can do, by brute force.
      const most = (turn: GameState): number => {
        let best = 0;
        for (const move of possibleMoves(turn)) {
          const next = { ...turn, board: applyMove(turn.board, move).board, dice: [...turn.dice] };
          next.dice.splice(next.dice.indexOf(move.die), 1);
          best = Math.max(best, 1 + most(next));
        }
        return best;
      };
      const promised = most(state);
      expect(diceToPlay(state), `seed ${seed}`).toBe(promised);
      // Exactly the moves that can begin a longest play; with one die only, the highest.
      const after = (move: Move) => {
        const next = { ...state, board: applyMove(state.board, move).board, dice: [...state.dice] };
        next.dice.splice(next.dice.indexOf(move.die), 1);
        return next;
      };
      const longest = possibleMoves(state).filter((move) => 1 + most(after(move)) === promised);
      const high = Math.max(...longest.map((move) => move.die));
      const expected = promised === 1 ? longest.filter((move) => move.die === high) : longest;
      expect(pairs(legalMoves(state)), `seed ${seed}`).toEqual(pairs(expected));

      let used = 0;
      for (let moves = legalMoves(state); moves.length > 0; moves = legalMoves(state)) {
        const move = moves[rng.int(moves.length)];
        expect(possibleMoves(state)).toContainEqual(move);
        state = applyCommand(state, "white", { type: "move", ...move }).state;
        used++;
      }
      expect(used, `seed ${seed}`).toBe(promised);
    }
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
        const turn = state;
        const index = turn.cards[player].hand.findIndex((c) => canPlayCard(turn, c));
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
    const { state, events } = play(game({ cards: hand("white", "charm", "shield") }), 1);
    expect(state.cards.white.hand).toEqual(["charm"]);
    expect(state.cards.white.discard).toEqual(["shield"]);
    expect(events[0]).toEqual({ type: "cardPlayed", player: "white", card: "shield" });
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

  describe("a card that would change nothing cannot be played", () => {
    /** Tries the card, and checks it is refused with that reason and nothing changes. */
    const refused = (state: GameState, reason: string, index = 0) => {
      const before = structuredClone(state);
      const card = state.cards[state.current].hand[index];
      expect(cardBlock(state, card)).toBe(reason);
      expect(canPlayCard(state, card)).toBe(false);
      expect(() => applyCommand(state, state.current, { type: "playCard", index })).toThrowError(
        new GameError(reason),
      );
      // The card stays in hand and nothing else moved.
      expect(state).toEqual(before);
    };

    it("Bulwark cannot be played twice in one turn", () => {
      const first = play(game({ cards: hand("white", "shield", "shield") }));
      expect(first.state.shielded.white).toBe(true);
      expect(first.state.cards.white.hand).toEqual(["shield"]);
      refused(first.state, "Bulwark is already protecting your checkers");
    });

    it("Bulwark can be played again on a later turn, once the first has worn off", () => {
      let state = play(game({ cards: hand("white", "shield", "shield") })).state;
      state = applyCommand(state, "white", { type: "endTurn" }).state;
      // White's shield lasts through black's turn.
      expect(state.shielded.white).toBe(true);
      state = applyCommand(state, "black", { type: "roll" }).state;
      state = { ...state, dice: [] };
      state = applyCommand(state, "black", { type: "endTurn" }).state;
      expect(state.shielded.white).toBe(false);
      state = { ...state, phase: "move" };
      expect(cardBlock(state, "shield")).toBeNull();
      expect(play(state).state.shielded.white).toBe(true);
    });

    it("Bulwark is allowed even with no lone checker yet, since one may be left later", () => {
      expect(cardBlock(game(), "shield")).toBeNull();
    });

    it("Quake needs a lone enemy checker in your home board", () => {
      const board = emptyBoard();
      place(board, "black", 4, 2);
      place(board, "black", 6, 1);
      place(board, "white", 2, 1);
      refused(
        game({ board, cards: hand("white", "quake") }),
        "Quake would do nothing: no lone enemy checker is in your home board",
      );
    });

    it("Quake is refused against a shielded opponent", () => {
      const board = emptyBoard();
      place(board, "black", 2, 1);
      refused(
        game({ board, cards: hand("white", "quake"), shielded: { white: false, black: true } }),
        "Their Bulwark protects their checkers from Quake",
      );
    });

    it("Quake counts targets from the side of whoever plays it", () => {
      const board = emptyBoard();
      place(board, "white", 20, 1);
      expect(cardBlock(game({ board, current: "black" }), "quake")).toBeNull();
      expect(cardBlock(game({ board, current: "white" }), "quake")).not.toBeNull();
    });

    it("dice cards explain what they are missing", () => {
      refused(
        game({ dice: [], cards: hand("white", "reroll") }),
        "Second Wind needs dice left to reroll",
      );
      refused(
        game({ dice: [], cards: hand("white", "loaded") }),
        "Loaded Die needs a die left to change",
      );
      refused(
        game({ dice: [6, 6], cards: hand("white", "loaded") }),
        "Every die you have left is already a 6",
      );
      expect(cardBlock(game({ dice: [] }), "charm")).toBeNull();
    });

    it("nothing can be played before rolling", () => {
      for (const card of CARD_IDS) {
        expect(cardBlock(game({ phase: "roll" }), card)).toBe("Roll before playing a card");
      }
    });

    it("every card the rules allow does change something", () => {
      // For every card the rules allow, playing it changes more than the hand and discard.
      for (let seed = 0; seed < 300; seed++) {
        const rng = createRng(seed);
        const board = emptyBoard();
        for (let i = 0; i < 8; i++) {
          const point = rng.int(24);
          if (board.points[point].count === 0) {
            place(board, rng.int(2) ? "white" : "black", point, 1 + rng.int(2));
          }
        }
        const dice = Array.from({ length: rng.int(4) }, () => 1 + rng.int(6));
        const shielded = { white: rng.int(3) === 0, black: rng.int(3) === 0 };
        for (const card of CARD_IDS) {
          const state = game({ board, dice, shielded, rng: seed, cards: hand("white", card) });
          if (!canPlayCard(state, card)) continue;
          const after = play(state).state;
          const changed =
            JSON.stringify([after.board, after.shielded]) !==
              JSON.stringify([state.board, state.shielded]) || after.dice.length !== dice.length;
          // Second Wind and Loaded Die keep the count but must have had dice to change.
          expect(
            changed || ((card === "reroll" || card === "loaded") && dice.length > 0),
            card,
          ).toBe(true);
        }
      }
    });
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
