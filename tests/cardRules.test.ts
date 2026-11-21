import { describe, expect, it } from "vitest";

import {
  applyMove,
  emptyBoard,
  legalMovesForDie,
  type Move,
  opponent,
  place,
  type Player,
  reverseMovesForDie,
} from "../src/core/board.ts";
import { type CardId, isTrap, starterDeck } from "../src/core/cards.ts";
import {
  applyCommand,
  cardBlock,
  type Command,
  diceToPlay,
  type GameEvent,
  GameError,
  type GameState,
  HAND_LIMIT,
  legalMoves,
  newGame,
  type TurnInfo,
} from "../src/core/game.ts";
import { createRng, rollDie } from "../src/core/rng.ts";
import { redactEvent, viewFor } from "../src/core/view.ts";
import { checkersOf, game, hand } from "./helpers.ts";

const players = ["white", "black"] as const;
const byValue = (a: number, b: number) => a - b;
const pack = starterDeck().toSorted();
const eventFields = new Set(
  "type player from to point die dice card cards ward heads doubled next first winner".split(" "),
);
const play = (state: GameState) =>
  applyCommand(state, state.current, { type: "playCard", index: 0 });
const move = (state: GameState, from: number, to: number, die: number) =>
  applyCommand(state, state.current, { type: "move", from, to, die });

function checkSecrets(state: GameState, viewer: Player, events: GameEvent[]) {
  const view = viewFor(state, viewer);
  const them = opponent(viewer);
  const piles = state.cards[them];
  // Changing every secret, keeping public pile sizes constant, must produce the same wire view.
  const mask = (ids: CardId[]): CardId[] => ids.map((id) => (id === "quake" ? "charm" : "quake"));
  const hidden: GameState = {
    ...state,
    rng: ~state.rng,
    traps: {
      ...state.traps,
      [them]: state.traps[them].map((id) =>
        id === "counterpunch" ? "looseBoard" : "counterpunch",
      ),
    },
    cards: {
      ...state.cards,
      [viewer]: { ...state.cards[viewer], deck: mask(state.cards[viewer].deck) },
      [them]: {
        hand: mask(piles.hand),
        deck: mask(piles.deck),
        discard: mask(piles.discard),
        offer: mask(piles.offer),
      },
    },
  };
  expect(viewFor(hidden, viewer)).toEqual(view);
  expect(view.hand).toEqual(state.cards[viewer].hand);
  expect(view.traps).toEqual(state.traps[viewer]);
  expect(view.offer).toEqual(state.cards[viewer].offer);
  for (const event of events) {
    expect(Object.keys(event).filter((key) => !eventFields.has(key))).toEqual([]);
    let visible = event;
    if (event.type === "cardsOffered" && event.player === them) visible = { ...event, cards: null };
    if ((event.type === "trapSet" || event.type === "cardPicked") && event.player === them)
      visible = { ...event, card: null };
    if (event.type === "cardPlayed") expect(isTrap(event.card)).toBe(false);
    expect(redactEvent(event, viewer)).toEqual(visible);
  }
}

function commandChoices(state: GameState): Command[] {
  const view = viewFor(state, state.current);
  const choices: Command[] = [];
  const moves = legalMoves(view);
  expect(moves).toEqual(legalMoves(state));
  for (const [index, card] of view.hand.entries()) {
    const command = { type: "playCard", index } as const;
    const reason = cardBlock(view, card, view.traps);
    if (reason) expect(() => applyCommand(state, view.you, command)).toThrow(reason);
    else {
      expect(() => applyCommand(state, view.you, command)).not.toThrow();
      choices.push(command);
    }
  }
  if (view.phase === "pick")
    view.offer.forEach((_, index) => choices.push({ type: "pickCard", index }));
  if (view.phase === "roll") choices.push({ type: "roll" });
  if (view.phase === "move") {
    for (const m of moves) choices.push({ type: "move", from: m.from, to: m.to, die: m.die });
    if (moves.length === 0) choices.push({ type: "endTurn" });
    else expect(() => applyCommand(state, view.you, { type: "endTurn" })).toThrow(GameError);
  }
  return choices;
}

describe("seeded games with both seats playing from their own views", () => {
  it.each(Array.from({ length: 24 }, (_, seed) => seed))(
    "finishes seed %i with all cards and checkers",
    (seed) => {
      const rng = createRng(0xabc000 + seed);
      let { state, events } = newGame(seed);
      for (let step = 0; step < 4000; step++) {
        for (const player of players) {
          checkSecrets(state, player, events);
          const { deck, hand: held, discard, offer } = state.cards[player];
          expect(
            [...deck, ...held, ...discard, ...offer, ...state.traps[player]].toSorted(),
          ).toEqual(pack);
          expect(checkersOf(state.board, player)).toBe(15);
          expect(held.length).toBeLessThanOrEqual(HAND_LIMIT);
          expect(state.traps[player].length).toBeLessThanOrEqual(2);
          expect(new Set(state.traps[player]).size).toBe(state.traps[player].length);
        }
        if (state.winner) {
          expect(state.phase).toBe("over");
          expect(state.board.off[state.winner]).toBe(15);
          return;
        }
        const choices = commandChoices(state);
        const command = choices[rng.int(choices.length)];
        if (!command) throw new Error(`Seed ${seed}, step ${step}: no command`);
        expect(() => applyCommand(state, opponent(state.current), command)).toThrow(GameError);
        ({ state, events } = applyCommand(state, state.current, command));
      }
      throw new Error(`Seed ${seed} exceeded 4000 commands`);
    },
  );
});

// Enumerate complete continuations without using the production move search or its cutoff.
function continuations(turn: TurnInfo): Array<{ move: Move; length: number }> {
  const { board, dice, current } = turn;
  const faces = [...new Set(dice)];
  const shield = turn.shielded[opponent(current)];
  const back =
    turn.reversing && board.bar[current] === 0
      ? faces.flatMap((die) => reverseMovesForDie(board, current, die, shield))
      : [];
  const choices = back.length
    ? back
    : faces.flatMap((die) => legalMovesForDie(board, current, die, shield));
  return choices.map((m) => {
    const rest = [...dice];
    rest.splice(rest.indexOf(m.die), 1);
    const after = continuations({
      ...turn,
      dice: rest,
      board: applyMove(board, m).board,
      reversing: turn.reversing && m.from === "bar",
    });
    return { move: m, length: 1 + Math.max(0, ...after.map((path) => path.length)) };
  });
}

describe("Backstep", () => {
  it("requires a longest continuation, then the higher die when only one can be used", () => {
    for (let seed = 0; seed < 240; seed++) {
      const rng = createRng(seed);
      const current = players[seed % 2]!;
      const board = emptyBoard();
      for (let i = 0; i < 8; i++) {
        const at = rng.int(24);
        if (!board.points[at]!.count) place(board, players[rng.int(2)]!, at, 1 + rng.int(2));
      }
      board.bar[current] = rng.int(3) === 0 ? 1 : 0;
      const dice = Array.from({ length: 1 + rng.int(4) }, () => rollDie(rng));
      const state = game({
        current,
        board,
        dice,
        reversing: true,
        shielded: { white: seed % 3 === 0, black: seed % 3 === 0 },
      });
      const paths = continuations(state);
      const most = Math.max(0, ...paths.map((p) => p.length));
      const high = Math.max(0, ...paths.map((p) => p.move.die));
      const expected = paths
        .filter((p) => p.length === most && (most > 1 || p.move.die === high))
        .map((p) => p.move);
      const key = (m: Move) => `${m.from}>${m.to}/${m.die}`;
      expect(legalMoves(state).map(key).toSorted(), `seed ${seed}`).toEqual(
        expected.map(key).toSorted(),
      );
      expect(diceToPlay(state), `seed ${seed}`).toBe(most);
      for (const { move: m } of paths) {
        const submit = () => applyCommand(state, current, { ...m, type: "move" });
        if (expected.includes(m)) expect(submit).not.toThrow();
        else expect(submit).toThrow(GameError);
      }
    }
  });

  it.each(players)("lets %s bear off when the only backwards landing is shielded", (current) => {
    const board = emptyBoard();
    const index = (white: number) => (current === "white" ? white : 23 - white);
    place(board, current, index(0), 1);
    place(board, opponent(current), index(1), 1);
    board.off[current] = 14;
    const turn = game({
      board,
      current,
      dice: [1],
      reversing: true,
      shielded: { black: true, white: true },
    });
    expect(legalMoves(turn)).toEqual([{ player: current, from: index(0), to: "off", die: 1 }]);
    expect(
      applyCommand(turn, current, { type: "move", from: index(0), to: "off", die: 1 }).state.winner,
    ).toBe(current);
  });
});

describe("card combinations", () => {
  it.each(players)("checks both trap slots and duplicate wards and hexes for %s", (current) => {
    const state = game({
      current,
      cards: hand(current, "looseBoard", "counterpunch", "looseBoard", "counterpunch"),
    });
    const set = play(play(state).state).state;
    for (const [index, card] of set.cards[current].hand.entries()) {
      expect(cardBlock(viewFor(set, current), card, set.traps[current])).toBeTruthy();
      expect(() => applyCommand(set, current, { type: "playCard", index })).toThrow(GameError);
    }
    for (const card of [
      "horseshoe",
      "mirror",
      "leadWeight",
      "backstep",
      "crackedDice",
      "shackles",
    ] as const) {
      const first = play(game({ current, cards: hand(current, card, card) })).state;
      expect(() => play(first)).toThrow(GameError);
    }
  });

  it("allows only Lucky Charm among dice changers when there are no dice or hexes", () => {
    const diceCards: CardId[] = [
      "reroll",
      "charm",
      "loaded",
      "sageSmoke",
      "chisel",
      "coinToss",
      "flipBones",
      "curseEater",
    ];
    const allowed = diceCards.filter((card) => !cardBlock(game(), card, []));
    expect(allowed).toEqual(["charm"]);
    expect(play(game({ cards: hand("white", "charm") })).state.dice).toHaveLength(1);
  });

  it("splits and flips one or many dice, and tails removes exactly one lowest die", () => {
    for (const dice of [[1], [2], [6], [1, 2, 4], [2, 2, 6, 6]]) {
      const use = (card: CardId, rng = 1) => play(game({ dice, rng, cards: hand("white", card) }));
      const high = Math.max(...dice);
      if (high === 1) expect(() => use("chisel")).toThrow(GameError);
      else {
        const cut = [...dice];
        cut.splice(dice.indexOf(high), 1, Math.ceil(high / 2), Math.floor(high / 2));
        expect(use("chisel").state.dice.toSorted(byValue)).toEqual(cut.toSorted(byValue));
      }
      expect(use("flipBones").state.dice).toEqual(dice.map((die) => 7 - die));
      const tails = use("coinToss");
      expect(tails.events).toContainEqual({ type: "coinFlipped", player: "white", heads: false });
      const lost = [...dice];
      lost.splice(dice.indexOf(Math.min(...dice)), 1);
      expect(tails.state.dice).toEqual(lost);
    }
  });

  it("Cracked Dice prevents matching kept dice from springing Loose Board or breaking Shackles", () => {
    const state = game({
      phase: "roll",
      hexes: { white: ["crackedDice", "shackles"], black: [] },
      traps: { white: [], black: ["looseBoard"] },
    });
    const rng = createRng(0);
    const seeds = Array.from({ length: 80 }, () => rng.int(1_000_000));
    let matching = 0;
    for (const seed of seeds) {
      const draw = createRng(seed);
      const kept = [rollDie(draw), rollDie(draw), rollDie(draw)].toSorted(byValue);
      if (kept[0] !== kept[1]) continue;
      matching++;
      const after = applyCommand({ ...state, rng: seed }, "white", { type: "roll" }).state;
      expect(after.dice.toSorted(byValue)).toEqual([Math.max(1, kept[0]! - 1), kept[1]]);
      expect(after.hexes.white).toEqual(["shackles"]);
      expect(after.traps.black).toEqual(["looseBoard"]);
    }
    expect(matching).toBeGreaterThan(0);
  });
});

describe("rule conflicts, resolved", () => {
  it("Sage Smoke follows the doubles rule, so a pair it leaves springs Loose Board", () => {
    const state = game({
      dice: [1, 4],
      rng: 1,
      cards: hand("white", "sageSmoke"),
      traps: { white: [], black: ["looseBoard"] },
    });
    expect(play(state).state.dice).toEqual([4, 4, 4]);
  });

  it.each([
    ["flipBones", [3, 3], [4, 4]],
    ["coinToss", [1, 4, 4], [4, 4]],
  ] as const)("%s never makes doubles, as its card says", (card, dice, expected) => {
    const state = game({
      dice: [...dice],
      rng: 1,
      cards: hand("white", card),
      traps: { white: [], black: ["looseBoard"] },
    });
    const after = play(state).state;
    if (card === "coinToss" && after.dice.length > 2) return;
    expect(after.dice).toEqual(expected);
    expect(after.traps.black).toEqual(["looseBoard"]);
  });

  it("Counterpunch cannot leave both players permanently barred from entering", () => {
    const board = emptyBoard();
    for (let i = 0; i < 6; i++) {
      place(board, "white", i, 2);
      place(board, "black", 23 - i, 2);
    }
    place(board, "white", 12, 3);
    place(board, "black", 14, 2);
    place(board, "black", 10, 1);
    const state = move(
      game({ board, dice: [2], traps: { white: [], black: ["counterpunch"] } }),
      12,
      10,
      2,
    ).state;
    const canEscape = players.some((current) => {
      const turn = { ...state, current, dice: [1, 2, 3, 4, 5, 6] };
      return (
        legalMoves(turn).length > 0 ||
        ["quietStep", "quake"].some((card) => !cardBlock(turn, card as CardId, []))
      );
    });
    expect(state.phase === "over" || canEscape).toBe(true);
  });

  it("Sage Smoke lifts just one of an active and a newly reflected Backstep", () => {
    const state = game({
      reversing: true,
      wards: { white: [], black: ["mirror"] },
      cards: hand("white", "backstep", "sageSmoke"),
    });
    const reflected = play(state).state;
    const lifted = play(reflected).state;
    const count = (s: GameState) => s.hexes.white.length + Number(s.reversing);
    expect(count(lifted)).toBe(count(reflected) - 1);
  });

  it("a shackled defender's Counterpunch breaks their Shackles when it hits the caster", () => {
    const board = emptyBoard();
    place(board, "white", 10, 1);
    place(board, "black", 8, 1);
    const state = game({
      board,
      dice: [2],
      hexes: { white: [], black: ["shackles"] },
      traps: { white: [], black: ["counterpunch"] },
    });
    expect(move(state, 10, 8, 2).state.hexes.black).toEqual([]);
  });

  it("Quiet Step cannot make the first checker move forward while Backstep can be obeyed", () => {
    const board = emptyBoard();
    place(board, "white", 10, 1);
    const state = game({ board, dice: [1], reversing: true, cards: hand("white", "quietStep") });
    if (cardBlock(state, "quietStep", [])) return;
    const after = play(state).state;
    expect(after.board.points[9]?.count).toBe(0);
  });

  it("recomputes playable dice after a secret Counterpunch interrupts a Backstep", () => {
    const board = emptyBoard();
    place(board, "white", 10, 1);
    place(board, "black", 12, 1);
    place(board, "black", 21, 2);
    const state = game({
      board,
      dice: [2, 3],
      reversing: true,
      traps: { white: [], black: ["counterpunch"] },
    });
    const hit = move(state, 10, 12, 2).state;
    const avoid = move(state, 10, 13, 3).state;
    expect(diceToPlay(viewFor(state, "white"))).toBe(2);
    expect(diceToPlay(hit)).toBe(0);
    expect(diceToPlay(avoid)).toBe(1);
  });
});
