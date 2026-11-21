import {
  applyMove,
  type BoardEvent,
  type BoardState,
  CHECKERS_PER_PLAYER,
  initialBoard,
  legalMovesForDie,
  loneEnemiesAtHome,
  type Move,
  opponent,
  type Player,
  sweepHome,
} from "./board.ts";
import { type CardId, starterDeck } from "./cards.ts";
import { createRng, type Rng, rollDie, shuffle } from "./rng.ts";

export const OFFER_SIZE = 3;
export const HAND_LIMIT = 5;

/** `pick`: choose one offered card. `roll`: roll the dice. `move`: play checkers and cards. */
export type Phase = "pick" | "roll" | "move" | "over";

export interface PlayerCards {
  /** Draw pile; the last element is the top. */
  deck: CardId[];
  hand: CardId[];
  discard: CardId[];
  /** Cards on offer during this player's pick phase. */
  offer: CardId[];
}

/** Plain data throughout, so it survives JSON and can live in any store. */
export interface GameState {
  board: BoardState;
  current: Player;
  /** Dice still to be played this turn. Doubles appear four times. */
  dice: number[];
  phase: Phase;
  winner: Player | null;
  cards: Record<Player, PlayerCards>;
  /** A shielded player's lone checkers cannot be hit. Lasts until their next turn. */
  shielded: Record<Player, boolean>;
  /** Games won in this match so far. Carried over by a rematch. */
  wins: Record<Player, number>;
  /** Who has asked to play again. Only ever set once the game is over. */
  rematch: Record<Player, boolean>;
  /**
   * RNG state. Secret: whoever knows it can predict every roll and draw. It is only 32 bits,
   * so a server must also replace it with fresh entropy before each command; otherwise a
   * player could recover it from the dice they see.
   */
  rng: number;
}

export type Command =
  | { type: "pickCard"; index: number }
  | { type: "roll" }
  | { type: "move"; from: number | "bar"; to: number | "off"; die: number }
  | { type: "playCard"; index: number }
  | { type: "endTurn" }
  /** Asks to play again. Only once the game is over; the new game starts when both have. */
  | { type: "rematch" };

/** `cards` and `card` are `null` once redacted for the opponent. */
export type GameEvent =
  | BoardEvent
  | { type: "cardsOffered"; player: Player; cards: CardId[] | null }
  | { type: "cardPicked"; player: Player; card: CardId | null }
  | { type: "cardPlayed"; player: Player; card: CardId }
  | { type: "diceRolled"; player: Player; dice: number[] }
  /** A card changed the dice. `doubled`: it left an exact pair, which became four dice. */
  | { type: "diceChanged"; player: Player; dice: number[]; doubled: boolean }
  | { type: "shieldRaised"; player: Player }
  | { type: "turnEnded"; player: Player; next: Player }
  | { type: "gameWon"; winner: Player }
  | { type: "rematchOffered"; player: Player }
  /** A rematch began: the board is set up afresh. The first turn's events follow. */
  | { type: "gameStarted"; first: Player };

export interface Result {
  state: GameState;
  events: GameEvent[];
}

/** A command the rules reject. Safe to show to the player who sent it. */
export class GameError extends Error {}

/** The public facts that decide which checker moves are legal. */
export type TurnInfo = Pick<GameState, "board" | "current" | "dice" | "phase" | "shielded">;

/**
 * Every single-checker move one of the remaining dice allows, with no regard for what it
 * leaves playable afterwards. `legalMoves` is the one the rules go by.
 */
export function possibleMoves(turn: TurnInfo): Move[] {
  if (turn.phase !== "move") return [];
  const shielded = turn.shielded[opponent(turn.current)];
  return [...new Set(turn.dice)].flatMap((die) =>
    legalMovesForDie(turn.board, turn.current, die, shielded),
  );
}

/** How much of a roll can be played: how many dice, and how many pips they add up to. */
interface Play {
  count: number;
  pips: number;
}

const better = (a: Play, b: Play) => a.count > b.count || (a.count === b.count && a.pips > b.pips);

/** Positions examined before the search gives up and leaves the roll unrestricted. */
const SEARCH_LIMIT = 50_000;

class SearchTooLarge extends Error {}

/**
 * The most that can be played from a position with the given dice: as many dice as
 * possible, and among equally long plays the one worth the most pips.
 */
function bestPlay(
  board: BoardState,
  player: Player,
  dice: number[],
  shielded: boolean,
  seen: Map<string, Play>,
  budget: { left: number },
): Play {
  if (dice.length === 0) return { count: 0, pips: 0 };
  const key = `${JSON.stringify(board)}|${[...dice].sort().join("")}`;
  const known = seen.get(key);
  if (known) return known;
  if (--budget.left < 0) throw new SearchTooLarge();

  const everything: Play = { count: dice.length, pips: dice.reduce((sum, die) => sum + die, 0) };
  let best: Play = { count: 0, pips: 0 };
  search: for (const die of new Set(dice)) {
    const rest = [...dice];
    rest.splice(rest.indexOf(die), 1);
    for (const move of legalMovesForDie(board, player, die, shielded)) {
      const after = bestPlay(applyMove(board, move).board, player, rest, shielded, seen, budget);
      const play = { count: 1 + after.count, pips: die + after.pips };
      if (better(play, best)) best = play;
      // Nothing can beat using every die.
      if (best.count === everything.count && best.pips === everything.pips) break search;
    }
  }
  seen.set(key, best);
  return best;
}

/**
 * The moves the rules allow now. A roll must be played so as to use as many dice as
 * possible, and when they cannot all be used, the highest of them: so a move is legal only
 * if it can begin such a play. This is the backgammon rule for two dice, carried over
 * unchanged to turns where cards have left more.
 */
export function legalMoves(turn: TurnInfo): Move[] {
  const moves = possibleMoves(turn);
  if (moves.length === 0) return moves;
  const player = turn.current;
  const shielded = turn.shielded[opponent(player)];
  const seen = new Map<string, Play>();
  const budget = { left: SEARCH_LIMIT };
  try {
    const most = bestPlay(turn.board, player, turn.dice, shielded, seen, budget);
    return moves.filter((move) => {
      const rest = [...turn.dice];
      rest.splice(rest.indexOf(move.die), 1);
      const after = bestPlay(
        applyMove(turn.board, move).board,
        player,
        rest,
        shielded,
        seen,
        budget,
      );
      return 1 + after.count === most.count && move.die + after.pips === most.pips;
    });
  } catch (error) {
    // A position too tangled to search fully (many dice, many choices): leave it open
    // rather than stall. Client and server reach the same verdict, since both run this.
    if (error instanceof SearchTooLarge) return moves;
    throw error;
  }
}

/**
 * Why a card cannot be played right now, in words for the player, or `null` if it can.
 * A card that would change nothing is not playable: it would be thrown away for no effect.
 * Everything this looks at is public, so a client can ask the same question as the server.
 */
export function cardBlock(turn: TurnInfo, card: CardId): string | null {
  if (turn.phase !== "move") return "Roll before playing a card";
  const them = opponent(turn.current);
  switch (card) {
    case "reroll":
      return turn.dice.length > 0 ? null : "Second Wind needs dice left to reroll";
    case "loaded":
      if (turn.dice.length === 0) return "Loaded Die needs a die left to change";
      return turn.dice.some((die) => die < 6) ? null : "Every die you have left is already a 6";
    case "charm":
      return null;
    case "shield":
      return turn.shielded[turn.current] ? "Bulwark is already protecting your checkers" : null;
    case "quake":
      if (turn.shielded[them]) return "Their Bulwark protects their checkers from Quake";
      return loneEnemiesAtHome(turn.board, turn.current).length > 0
        ? null
        : "Quake would do nothing: no lone enemy checker is in your home board";
  }
}

export function canPlayCard(turn: TurnInfo, card: CardId): boolean {
  return cardBlock(turn, card) === null;
}

function withCards(state: GameState, player: Player, cards: PlayerCards): GameState["cards"] {
  return player === "white"
    ? { white: cards, black: state.cards.black }
    : { white: state.cards.white, black: cards };
}

function cloneCards(cards: PlayerCards): PlayerCards {
  return {
    deck: [...cards.deck],
    hand: [...cards.hand],
    discard: [...cards.discard],
    offer: [...cards.offer],
  };
}

function freshCards(rng: Rng): PlayerCards {
  return { deck: shuffle(starterDeck(), rng), hand: [], discard: [], offer: [] };
}

/** Hands the turn to `player`: drops their shield and deals their card offer. */
function beginTurn(state: GameState, player: Player): Result {
  const rng = createRng(state.rng);
  const mine = cloneCards(state.cards[player]);
  const events: GameEvent[] = [];

  if (mine.hand.length < HAND_LIMIT) {
    while (mine.offer.length < OFFER_SIZE) {
      if (mine.deck.length === 0) {
        mine.deck = shuffle(mine.discard, rng);
        mine.discard = [];
      }
      const card = mine.deck.pop();
      if (card === undefined) break;
      mine.offer.push(card);
    }
  }
  const picking = mine.offer.length > 0;
  if (picking) events.push({ type: "cardsOffered", player, cards: [...mine.offer] });

  return {
    state: {
      ...state,
      current: player,
      dice: [],
      phase: picking ? "pick" : "roll",
      cards: withCards(state, player, mine),
      shielded: { ...state.shielded, [player]: false },
      rng: rng.state,
    },
    events,
  };
}

/**
 * Independent sources for what each player may not learn about the other. With one shared
 * seed, a player could work back from their own deck to the opponent's.
 */
export interface GameSeeds {
  white: number;
  black: number;
  /** Decides who starts, then every roll and reshuffle, unless the state is reseeded. */
  play: number;
}

function expandSeed(seed: number): GameSeeds {
  const rng = createRng(seed);
  const part = () => rng.int(0x1_0000_0000);
  return { white: part(), black: part(), play: part() };
}

/**
 * A new match. A single number gives a fully reproducible game, for local play and tests.
 * A server should pass three unrelated secrets instead.
 */
export function newGame(
  seed: number | GameSeeds,
  wins: Record<Player, number> = { white: 0, black: 0 },
): Result {
  const seeds = typeof seed === "number" ? expandSeed(seed) : seed;
  const cards = {
    white: freshCards(createRng(seeds.white)),
    black: freshCards(createRng(seeds.black)),
  };
  const rng = createRng(seeds.play);
  const first: Player = rng.int(2) === 0 ? "white" : "black";
  return beginTurn(
    {
      board: initialBoard(),
      current: first,
      dice: [],
      phase: "roll",
      winner: null,
      cards,
      shielded: { white: false, black: false },
      wins,
      rematch: { white: false, black: false },
      rng: rng.state,
    },
    first,
  );
}

/**
 * Two matching dice are doubles and play four times, whether rolled or made by a card.
 * Only an exact pair counts: three dice with two alike stay as they are.
 */
function asDoubles(dice: number[]): number[] {
  const [a, b] = dice;
  return dice.length === 2 && a === b ? [a, a, a, a] : dice;
}

function pickCard(state: GameState, index: number): Result {
  if (state.phase !== "pick") throw new GameError("There is no card to pick right now");
  const player = state.current;
  const mine = cloneCards(state.cards[player]);
  const card = mine.offer[index];
  if (card === undefined) throw new GameError("No such card on offer");
  mine.hand.push(card);
  mine.discard.push(...mine.offer.filter((_, i) => i !== index));
  mine.offer = [];
  return {
    state: { ...state, phase: "roll", cards: withCards(state, player, mine) },
    events: [{ type: "cardPicked", player, card }],
  };
}

function roll(state: GameState): Result {
  if (state.phase !== "roll") throw new GameError("You cannot roll right now");
  const rng = createRng(state.rng);
  const a = rollDie(rng);
  const b = rollDie(rng);
  const dice = asDoubles([a, b]);
  return {
    state: { ...state, dice, phase: "move", rng: rng.state },
    events: [{ type: "diceRolled", player: state.current, dice }],
  };
}

function move(state: GameState, wanted: Omit<Move, "player">): Result {
  const player = state.current;
  const legal = legalMoves(state).find(
    (m) => m.from === wanted.from && m.to === wanted.to && m.die === wanted.die,
  );
  if (!legal) throw new GameError("That move is not legal");

  const applied = applyMove(state.board, legal);
  const dice = [...state.dice];
  dice.splice(dice.indexOf(legal.die), 1);
  const events: GameEvent[] = [...applied.events];
  const moved: GameState = { ...state, board: applied.board, dice };

  if (applied.board.off[player] < CHECKERS_PER_PLAYER) return { state: moved, events };
  events.push({ type: "gameWon", winner: player });
  const wins = { ...moved.wins, [player]: moved.wins[player] + 1 };
  return { state: { ...moved, dice: [], phase: "over", winner: player, wins }, events };
}

function playCard(state: GameState, index: number): Result {
  const player = state.current;
  const mine = cloneCards(state.cards[player]);
  const card = mine.hand[index];
  if (card === undefined) throw new GameError("No such card in hand");
  const blocked = cardBlock(state, card);
  if (blocked) throw new GameError(blocked);
  mine.hand.splice(index, 1);
  mine.discard.push(card);

  const rng = createRng(state.rng);
  const events: GameEvent[] = [{ type: "cardPlayed", player, card }];
  const next: GameState = { ...state, cards: withCards(state, player, mine) };

  if (card === "reroll") {
    next.dice = state.dice.map(() => rollDie(rng));
  } else if (card === "loaded") {
    next.dice = [...state.dice];
    next.dice[next.dice.indexOf(Math.min(...next.dice))] = 6;
  } else if (card === "charm") {
    next.dice = [...state.dice, rollDie(rng)];
  } else if (card === "shield") {
    next.shielded = { ...state.shielded, [player]: true };
    events.push({ type: "shieldRaised", player });
  } else {
    const swept = sweepHome(state.board, player);
    next.board = swept.board;
    events.push(...swept.events);
  }
  if (next.dice !== state.dice) {
    const changed = next.dice;
    next.dice = asDoubles(changed);
    events.push({ type: "diceChanged", player, dice: next.dice, doubled: next.dice !== changed });
  }

  next.rng = rng.state;
  return { state: next, events };
}

function endTurn(state: GameState): Result {
  if (state.phase !== "move") throw new GameError("Roll before ending your turn");
  if (legalMoves(state).length > 0) throw new GameError("You still have moves to play");
  const player = state.current;
  const next = opponent(player);
  const begun = beginTurn(state, next);
  return { state: begun.state, events: [{ type: "turnEnded", player, next }, ...begun.events] };
}

/**
 * Records that `player` wants to play again. Once both do, a new game starts with the same
 * seats and the running score. It is dealt from `seeds`; without them, from the game's own
 * RNG, which is fine for local play but lets a player work out the opponent's deck.
 */
function rematch(state: GameState, player: Player, seeds?: GameSeeds): Result {
  if (state.phase !== "over") throw new GameError("The game is not over yet");
  if (state.rematch[player]) throw new GameError("You have already asked for a rematch");
  if (!state.rematch[opponent(player)]) {
    return {
      state: { ...state, rematch: { ...state.rematch, [player]: true } },
      events: [{ type: "rematchOffered", player }],
    };
  }
  const started = newGame(seeds ?? state.rng, state.wins);
  return {
    state: started.state,
    events: [{ type: "gameStarted", first: started.state.current }, ...started.events],
  };
}

/**
 * The single entry point for changing a game. Throws `GameError` when the rules say no.
 * `seeds` deal the new game if this command starts a rematch; a server must pass them.
 */
export function applyCommand(
  state: GameState,
  player: Player,
  command: Command,
  seeds?: GameSeeds,
): Result {
  if (command.type === "rematch") return rematch(state, player, seeds);
  if (state.phase === "over") throw new GameError("The game is over");
  if (player !== state.current) throw new GameError("It is not your turn");
  switch (command.type) {
    case "pickCard":
      return pickCard(state, command.index);
    case "roll":
      return roll(state);
    case "move":
      return move(state, command);
    case "playCard":
      return playCard(state, command.index);
    case "endTurn":
      return endTurn(state);
  }
}
