import { describe, expect, it } from "vitest";

import { emptyBoard, initialBoard, place } from "../src/core/board.ts";
import { CARDS, type CardId, starterDeck } from "../src/core/cards.ts";
import {
  applyCommand,
  cardBlock,
  type GameEvent,
  GameError,
  type GameState,
  legalMoves,
} from "../src/core/game.ts";
import { createRng, rollDie } from "../src/core/rng.ts";
import { redactEvent, viewFor } from "../src/core/view.ts";
import { cards, game, hand } from "./helpers.ts";

const byValue = (a: number, b: number) => a - b;

const play = (state: GameState, index = 0) =>
  applyCommand(state, state.current, { type: "playCard", index });

const roll = (state: GameState) => applyCommand(state, state.current, { type: "roll" });

/** The two dice a plain roll from this RNG state shows. */
function pairFrom(seed: number): [number, number] {
  const rng = createRng(seed);
  return [rollDie(rng), rollDie(rng)];
}

/** The first RNG state whose roll satisfies `wanted`. */
function seedWhere(wanted: (pair: [number, number]) => boolean): number {
  for (let seed = 0; seed < 10_000; seed++) if (wanted(pairFrom(seed))) return seed;
  throw new Error("no such seed");
}

const doublesSeed = seedWhere(([a, b]) => a === b && a > 1);
const plainSeed = seedWhere(([a, b]) => a !== b && a > 1 && b > 1);

/** Black about to roll with the given hexes on them. */
function blackRolls(partial: Partial<GameState>): GameState {
  return game({ current: "black", phase: "roll", board: initialBoard(), ...partial });
}

const hexed = (black: GameState["hexes"]["black"]): GameState["hexes"] => ({
  white: [],
  black,
});

describe("the new cards", () => {
  it("are fifteen: one legendary, two epic, four rare and eight common", () => {
    const added: CardId[] = [
      "leadWeight",
      "horseshoe",
      "sageSmoke",
      "chisel",
      "quietStep",
      "looseBoard",
      "keenEye",
      "coinToss",
      "backstep",
      "flipBones",
      "mirror",
      "counterpunch",
      "crackedDice",
      "curseEater",
      "shackles",
    ];
    const count = (rarity: string) => added.filter((id) => CARDS[id].rarity === rarity).length;
    expect([count("legendary"), count("epic"), count("rare"), count("common")]).toEqual([
      1, 2, 4, 8,
    ]);
    expect(starterDeck().filter((id) => added.includes(id))).toHaveLength(8 * 4 + 4 * 2 + 2 + 1);
  });
});

describe("hexes", () => {
  it("are cast on the opponent and bite at their next roll: Lead Weight", () => {
    const cast = play(game({ cards: hand("white", "leadWeight") }));
    expect(cast.state.hexes.black).toEqual(["leadWeight"]);
    expect(cast.events).toContainEqual({ type: "hexCast", player: "black", card: "leadWeight" });

    const [a, b] = pairFrom(plainSeed);
    const rolled = roll(blackRolls({ hexes: hexed(["leadWeight"]), rng: plainSeed }));
    const high = Math.max(a, b);
    expect(rolled.state.dice.toSorted(byValue)).toEqual(
      [Math.min(a, b), high - 1].toSorted(byValue),
    );
    expect(rolled.state.hexes.black).toEqual([]);
    expect(rolled.events).toContainEqual({
      type: "hexStruck",
      player: "black",
      card: "leadWeight",
    });
  });

  it("Lead Weight on doubles lowers one of the four", () => {
    const [a] = pairFrom(doublesSeed);
    const rolled = roll(blackRolls({ hexes: hexed(["leadWeight"]), rng: doublesSeed }));
    expect(rolled.state.dice.toSorted(byValue)).toEqual([a - 1, a, a, a]);
  });

  it("cannot be cast twice on the same player", () => {
    const state = game({ cards: hand("white", "leadWeight"), hexes: hexed(["leadWeight"]) });
    expect(cardBlock(state, "leadWeight", [])).toBe("They are already under Lead Weight");
    expect(() => play(state)).toThrow(GameError);
  });

  it("Cracked Dice rolls three, drops the highest and never makes doubles", () => {
    for (let seed = 0; seed < 200; seed++) {
      const { state, events } = roll(blackRolls({ hexes: hexed(["crackedDice"]), rng: seed }));
      const shown = events.find((e) => e.type === "diceRolled");
      if (shown?.type !== "diceRolled") throw new Error("no roll");
      expect(shown.dice).toHaveLength(3);
      expect(state.dice).toEqual(shown.dice.toSorted((x, y) => x - y).slice(0, 2));
      expect(state.hexes.black).toEqual([]);
    }
  });

  describe("Shackles of Greed", () => {
    it("lowers the highest die on every roll and stays", () => {
      const [a, b] = pairFrom(plainSeed);
      const { state } = roll(blackRolls({ hexes: hexed(["shackles"]), rng: plainSeed }));
      expect(Math.max(...state.dice)).toBe(Math.max(a, b) - 1);
      expect(state.hexes.black).toEqual(["shackles"]);
    });

    it("breaks on natural doubles, which are kept whole", () => {
      const [a] = pairFrom(doublesSeed);
      const { state, events } = roll(blackRolls({ hexes: hexed(["shackles"]), rng: doublesSeed }));
      expect(state.dice).toEqual([a, a, a, a]);
      expect(state.hexes.black).toEqual([]);
      expect(events).toContainEqual({ type: "hexLifted", player: "black", cards: ["shackles"] });
    });

    it("breaks when the shackled player hits the caster", () => {
      const board = emptyBoard();
      place(board, "black", 0, 1);
      place(board, "white", 3, 1);
      const state = game({ current: "black", board, dice: [3], hexes: hexed(["shackles"]) });
      const after = applyCommand(state, "black", { type: "move", from: 0, to: 3, die: 3 });
      expect(after.state.hexes.black).toEqual([]);
      expect(after.state.board.bar.white).toBe(1);
    });

    it("breaks when the shackled player hits with Quake", () => {
      const board = emptyBoard();
      place(board, "white", 20, 1);
      const state = game({
        current: "black",
        board,
        hexes: hexed(["shackles"]),
        cards: hand("black", "quake"),
      });
      expect(play(state).state.hexes.black).toEqual([]);
    });
  });

  describe("Backstep", () => {
    // Black moves towards 23, so backwards is towards 0.
    const board = () => {
      const b = emptyBoard();
      place(b, "black", 10, 2);
      place(b, "white", 20, 2);
      return b;
    };

    it("turns the first checker move backwards, and only the first", () => {
      const { state } = roll(blackRolls({ board: board(), hexes: hexed(["backstep"]) }));
      expect(state.reversing).toBe(true);
      const moves = legalMoves(state);
      expect(moves.length).toBeGreaterThan(0);
      for (const move of moves) expect(move.to).toBe(10 - move.die);
      const [first] = moves;
      if (!first) throw new Error("no move");
      const after = applyCommand(state, "black", { type: "move", ...first }).state;
      expect(after.reversing).toBe(false);
      for (const move of legalMoves(after))
        expect(move.to as number).toBeGreaterThan(move.from as number);
    });

    it("can hit going backwards", () => {
      const b = board();
      place(b, "white", 7, 1);
      const state = game({ current: "black", board: b, dice: [3, 5], reversing: true });
      expect(legalMoves(state)).toContainEqual({ player: "black", from: 10, to: 7, die: 3 });
    });

    it("waits until checkers on the bar have entered", () => {
      const b = board();
      b.bar.black = 1;
      const state = game({ current: "black", board: b, dice: [3, 5], reversing: true });
      const entry = legalMoves(state).find((move) => move.from === "bar");
      if (!entry) throw new Error("no entry");
      const after = applyCommand(state, "black", { type: "move", ...entry }).state;
      expect(after.reversing).toBe(true);
      for (const move of legalMoves(after))
        expect(move.to as number).toBeLessThan(move.from as number);
    });

    it("lapses when no checker can step back", () => {
      const b = emptyBoard();
      place(b, "black", 0, 2);
      const state = game({ current: "black", board: b, dice: [3, 5], reversing: true });
      expect(
        legalMoves(state)
          .map((m) => Number(m.to))
          .toSorted(byValue),
      ).toEqual([3, 5]);
    });

    it("is gone by the next turn even if unused", () => {
      const state = game({ current: "black", dice: [], reversing: true });
      expect(applyCommand(state, "black", { type: "endTurn" }).state.reversing).toBe(false);
    });
  });
});

describe("wards", () => {
  it("Iron Horseshoe blocks the next hex, then is gone", () => {
    let state = play(game({ cards: hand("white", "horseshoe") })).state;
    expect(state.wards.white).toEqual(["horseshoe"]);
    state = { ...state, current: "black", cards: hand("black", "leadWeight", "leadWeight") };
    const first = play(state);
    expect(first.state.hexes.white).toEqual([]);
    expect(first.state.wards.white).toEqual([]);
    expect(first.events).toContainEqual({
      type: "hexWarded",
      player: "white",
      card: "leadWeight",
      ward: "horseshoe",
    });
    expect(play(first.state).state.hexes.white).toEqual(["leadWeight"]);
  });

  it("Glass Mirror sends the hex back onto the caster", () => {
    const state = game({
      current: "black",
      cards: hand("black", "crackedDice"),
      wards: { white: ["mirror"], black: [] },
    });
    const { state: after, events } = play(state);
    expect(after.hexes).toEqual({ white: [], black: ["crackedDice"] });
    expect(after.wards.white).toEqual([]);
    expect(events).toContainEqual({ type: "hexCast", player: "black", card: "crackedDice" });
  });

  it("a rebounding hex is stopped by the caster's horseshoe, but never by their mirror", () => {
    const blocked = play(
      game({
        current: "black",
        cards: hand("black", "backstep"),
        wards: { white: ["mirror", "horseshoe"], black: ["horseshoe"] },
      }),
    ).state;
    expect(blocked.hexes).toEqual({ white: [], black: [] });
    expect(blocked.wards).toEqual({ white: ["horseshoe"], black: [] });

    const landed = play(
      game({
        current: "black",
        cards: hand("black", "backstep"),
        wards: { white: ["mirror"], black: ["mirror"] },
      }),
    ).state;
    expect(landed.hexes.black).toEqual(["backstep"]);
    expect(landed.wards.black).toEqual(["mirror"]);
  });

  it("cannot stand twice", () => {
    const state = game({ wards: { white: ["mirror"], black: [] } });
    expect(cardBlock(state, "mirror", [])).toBe("Your Glass Mirror is already standing");
    expect(cardBlock(state, "horseshoe", [])).toBeNull();
  });

  describe("Sage Smoke", () => {
    it("lifts the oldest hex before rolling", () => {
      const state = blackRolls({
        hexes: hexed(["crackedDice", "leadWeight"]),
        cards: hand("black", "sageSmoke"),
      });
      const after = play(state).state;
      expect(after.hexes.black).toEqual(["leadWeight"]);
      expect(after.phase).toBe("roll");
    });

    it("lifts a Backstep that is biting now", () => {
      const state = game({
        current: "black",
        dice: [2, 3],
        reversing: true,
        cards: hand("black", "sageSmoke"),
      });
      expect(play(state).state.reversing).toBe(false);
    });

    it("rerolls the lowest die when there is nothing to lift; a pair it leaves is doubles", () => {
      const doubled = new Set<boolean>();
      for (let seed = 0; seed < 60; seed++) {
        const after = play(
          game({ dice: [2, 5], rng: seed, cards: hand("white", "sageSmoke") }),
        ).state;
        doubled.add(after.dice.length === 4);
        if (after.dice.length === 4) expect(after.dice).toEqual([5, 5, 5, 5]);
        else expect(after.dice[1]).toBe(5);
      }
      expect(doubled).toEqual(new Set([true, false]));
    });

    it("lifts a biting Backstep without touching one that rebounded this turn", () => {
      const state = game({
        reversing: true,
        hexes: { white: ["backstep"], black: [] },
        cards: hand("white", "sageSmoke"),
      });
      const after = play(state).state;
      expect(after.reversing).toBe(false);
      expect(after.hexes.white).toEqual(["backstep"]);
    });

    it("has nothing to do before rolling when no hex is on you", () => {
      expect(cardBlock(game({ phase: "roll" }), "sageSmoke", [])).toBe(
        "No hex to lift. After rolling, Sage Smoke rerolls a die",
      );
    });
  });

  describe("Curse Eater", () => {
    it("before rolling, lifts every hex and promises a die for each", () => {
      const state = blackRolls({
        hexes: hexed(["leadWeight", "shackles"]),
        cards: hand("black", "curseEater"),
        rng: plainSeed,
      });
      const eaten = play(state).state;
      expect(eaten.hexes.black).toEqual([]);
      expect(eaten.bonusDice.black).toBe(2);
      const rolled = roll(eaten).state;
      expect(rolled.dice).toHaveLength(4);
      expect(rolled.dice.slice(0, 2)).toEqual(pairFrom(plainSeed));
      expect(rolled.bonusDice.black).toBe(0);
    });

    it("after rolling, adds the dice at once", () => {
      const state = game({
        dice: [4, 2],
        hexes: { white: ["shackles"], black: [] },
        cards: hand("white", "curseEater"),
      });
      const after = play(state).state;
      expect(after.hexes.white).toEqual([]);
      expect(after.dice.length).toBeGreaterThanOrEqual(3);
    });

    it("needs a hex to eat", () => {
      expect(cardBlock(game(), "curseEater", [])).toBe("Curse Eater needs a hex on you to lift");
    });
  });
});

describe("traps", () => {
  it("are set face down: announced without a name to the opponent, kept out of the discard", () => {
    const { state, events } = play(game({ cards: hand("white", "looseBoard") }));
    expect(state.traps.white).toEqual(["looseBoard"]);
    expect(state.cards.white.discard).toEqual([]);
    expect(events).toEqual([{ type: "trapSet", player: "white", card: "looseBoard" }]);
    const seen = events.map((event) => redactEvent(event, "black"));
    expect(seen).toEqual([{ type: "trapSet", player: "white", card: null }]);
    expect(JSON.stringify(viewFor(state, "black"))).not.toContain("looseBoard");
    expect(viewFor(state, "black").counts.white.traps).toBe(1);
    expect(viewFor(state, "white").traps).toEqual(["looseBoard"]);
  });

  it("are limited to two, of different kinds", () => {
    expect(cardBlock(game(), "counterpunch", ["counterpunch"])).toBe(
      "You already have Counterpunch set",
    );
    expect(cardBlock(game(), "counterpunch", ["looseBoard"])).toBeNull();
  });

  it("Loose Board takes one die from rolled doubles and goes to the discard", () => {
    const [a] = pairFrom(doublesSeed);
    const state = blackRolls({ rng: doublesSeed, traps: { white: ["looseBoard"], black: [] } });
    const { state: after, events } = roll(state);
    expect(after.dice).toEqual([a, a, a]);
    expect(after.traps.white).toEqual([]);
    expect(after.cards.white.discard).toEqual(["looseBoard"]);
    expect(events).toContainEqual({ type: "trapSprung", player: "white", card: "looseBoard" });
  });

  it("Loose Board also springs on doubles made by a card", () => {
    const state = game({
      current: "black",
      dice: [6, 2],
      cards: hand("black", "loaded"),
      traps: { white: ["looseBoard"], black: [] },
    });
    expect(play(state).state.dice).toEqual([6, 6, 6]);
  });

  it("Loose Board takes one die from doubles Lucky Charm pairs up", () => {
    let sprung = 0;
    for (let rng = 0; rng < 100; rng++) {
      const state = game({
        rng,
        current: "black",
        dice: [2, 5],
        cards: hand("black", "charm"),
        traps: { white: ["looseBoard"], black: [] },
      });
      const { state: after } = play(state);
      if (after.traps.white.length > 0) continue;
      expect(after.dice).toHaveLength(4);
      expect(new Set(after.dice.slice(1)).size).toBe(1);
      sprung++;
    }
    expect(sprung).toBeGreaterThan(0);
  });

  it("Loose Board waits through rolls that are not doubles", () => {
    const state = blackRolls({ rng: plainSeed, traps: { white: ["looseBoard"], black: [] } });
    expect(roll(state).state.traps.white).toEqual(["looseBoard"]);
  });

  describe("Counterpunch", () => {
    const board = () => {
      const b = emptyBoard();
      place(b, "black", 0, 2);
      place(b, "white", 3, 1);
      return b;
    };

    it("sends the hitter to the bar too", () => {
      const state = game({
        current: "black",
        board: board(),
        dice: [3],
        traps: { white: ["counterpunch"], black: [] },
      });
      const { state: after, events } = applyCommand(state, "black", {
        type: "move",
        from: 0,
        to: 3,
        die: 3,
      });
      expect(after.board.bar).toEqual({ white: 1, black: 1 });
      expect(after.board.points[3]).toEqual({ owner: null, count: 0 });
      expect(after.traps.white).toEqual([]);
      expect(
        events.filter((e): e is Extract<GameEvent, { type: "hit" }> => e.type === "hit"),
      ).toEqual([
        { type: "hit", player: "white", point: 3 },
        { type: "hit", player: "black", point: 3 },
      ]);
    });

    it("holds off against a hitter shielded by Bulwark", () => {
      const state = game({
        current: "black",
        board: board(),
        dice: [3],
        shielded: { white: false, black: true },
        traps: { white: ["counterpunch"], black: [] },
      });
      const after = applyCommand(state, "black", { type: "move", from: 0, to: 3, die: 3 }).state;
      expect(after.board.bar).toEqual({ white: 1, black: 0 });
      expect(after.traps.white).toEqual(["counterpunch"]);
    });
  });
});

describe("dice, tactic, tempo and wild cards", () => {
  it("Chisel splits the highest die, never into doubles", () => {
    expect(play(game({ dice: [5, 2], cards: hand("white", "chisel") })).state.dice).toEqual([
      3, 2, 2,
    ]);
    expect(play(game({ dice: [6], cards: hand("white", "chisel") })).state.dice).toEqual([3, 3]);
    expect(cardBlock(game({ dice: [1, 1] }), "chisel", [])).toBe("Chisel cannot split a 1");
  });

  it("Flip the Bones turns each die over and keeps the count", () => {
    expect(play(game({ dice: [1, 2], cards: hand("white", "flipBones") })).state.dice).toEqual([
      6, 5,
    ]);
    expect(play(game({ dice: [1, 1], cards: hand("white", "flipBones") })).state.dice).toEqual([
      6, 6,
    ]);
    expect(cardBlock(game({ dice: [1, 6] }), "flipBones", [])).toBe(
      "Flipping these dice would change nothing",
    );
  });

  it("Quiet Step moves the rearmost checker one point without a die", () => {
    const board = emptyBoard();
    place(board, "white", 20, 1);
    place(board, "white", 5, 2);
    const after = play(game({ board, dice: [4], cards: hand("white", "quietStep") })).state;
    expect(after.board.points[19]).toEqual({ owner: "white", count: 1 });
    expect(after.dice).toEqual([4]);
  });

  it("Quiet Step works from black's side and will not step onto an enemy", () => {
    const board = emptyBoard();
    place(board, "black", 2, 1);
    expect(
      play(game({ current: "black", board, cards: hand("black", "quietStep") })).state.board
        .points[3],
    ).toEqual({ owner: "black", count: 1 });
    place(board, "white", 3, 1);
    expect(cardBlock(game({ current: "black", board }), "quietStep", [])).toBe(
      "Quiet Step has no room: your rearmost checker cannot step forward",
    );
  });

  it("Keen Eye adds a fourth card to the next pick, and waits out a full hand", () => {
    const deck: CardId[] = Array.from({ length: 10 }, () => "reroll");
    let state = play(
      game({
        dice: [],
        cards: { white: cards({ hand: ["keenEye"], deck }), black: cards({ deck }) },
      }),
    ).state;
    expect(state.extraOffer.white).toBe(true);
    state = applyCommand(state, "white", { type: "endTurn" }).state;
    state = { ...state, phase: "move", dice: [] };
    const full = { ...state.cards.white, hand: Array.from({ length: 5 }, (): CardId => "charm") };
    const skipped = applyCommand({ ...state, cards: { ...state.cards, white: full } }, "black", {
      type: "endTurn",
    }).state;
    expect(skipped.cards.white.offer).toEqual([]);
    expect(skipped.extraOffer.white).toBe(true);
    const offered = applyCommand(state, "black", { type: "endTurn" }).state;
    expect(offered.cards.white.offer).toHaveLength(4);
    expect(offered.extraOffer.white).toBe(false);
  });

  it("Coin Toss adds a die on heads and takes the lowest on tails", () => {
    const outcomes = new Set<boolean>();
    for (let seed = 0; seed < 40; seed++) {
      const { state, events } = play(
        game({ dice: [2, 5], rng: seed, cards: hand("white", "coinToss") }),
      );
      const flip = events.find((e) => e.type === "coinFlipped");
      if (flip?.type !== "coinFlipped") throw new Error("no flip");
      outcomes.add(flip.heads);
      if (flip.heads) expect(state.dice.length).toBeGreaterThanOrEqual(3);
      else expect(state.dice).toEqual([5]);
    }
    expect(outcomes).toEqual(new Set([true, false]));
  });
});
