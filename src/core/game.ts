import {
  applyMove,
  type BoardEvent,
  type BoardState,
  CHECKERS_PER_PLAYER,
  initialBoard,
  legalMovesForDie,
  type Move,
  opponent,
  type Player,
  sweepHome,
} from "./board.ts";
import { CARDS, type CardId, starterDeck } from "./cards.ts";
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
  | { type: "endTurn" };

/** `cards` and `card` are `null` once redacted for the opponent. */
export type GameEvent =
  | BoardEvent
  | { type: "cardsOffered"; player: Player; cards: CardId[] | null }
  | { type: "cardPicked"; player: Player; card: CardId | null }
  | { type: "cardPlayed"; player: Player; card: CardId }
  | { type: "diceRolled"; player: Player; dice: number[] }
  | { type: "diceChanged"; player: Player; dice: number[] }
  | { type: "shieldRaised"; player: Player }
  | { type: "turnEnded"; player: Player; next: Player }
  | { type: "gameWon"; winner: Player };

export interface Result {
  state: GameState;
  events: GameEvent[];
}

/** A command the rules reject. Safe to show to the player who sent it. */
export class GameError extends Error {}

/** The public facts that decide which checker moves are legal. */
export type TurnInfo = Pick<GameState, "board" | "current" | "dice" | "phase" | "shielded">;

/**
 * Legal moves for the remaining dice, one die at a time.
 * Not yet enforced: the rule that a roll must be played so as to use as many dice as possible.
 */
export function legalMoves(turn: TurnInfo): Move[] {
  if (turn.phase !== "move") return [];
  const shielded = turn.shielded[opponent(turn.current)];
  return [...new Set(turn.dice)].flatMap((die) =>
    legalMovesForDie(turn.board, turn.current, die, shielded),
  );
}

export function canPlayCard(turn: Pick<GameState, "phase" | "dice">, card: CardId): boolean {
  if (turn.phase !== "move") return false;
  if (card === "reroll") return turn.dice.length > 0;
  if (card === "loaded") return turn.dice.some((die) => die < 6);
  return true;
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
export function newGame(seed: number | GameSeeds): Result {
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
      rng: rng.state,
    },
    first,
  );
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
  const dice = a === b ? [a, a, a, a] : [a, b];
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
  return { state: { ...moved, dice: [], phase: "over", winner: player }, events };
}

function playCard(state: GameState, index: number): Result {
  if (state.phase !== "move") throw new GameError("Roll before playing a card");
  const player = state.current;
  const mine = cloneCards(state.cards[player]);
  const card = mine.hand[index];
  if (card === undefined) throw new GameError("No such card in hand");
  if (!canPlayCard(state, card)) {
    throw new GameError(`${CARDS[card].name} cannot be played right now`);
  }
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
  } else if (!state.shielded[opponent(player)]) {
    const swept = sweepHome(state.board, player);
    next.board = swept.board;
    events.push(...swept.events);
  }
  if (next.dice !== state.dice) events.push({ type: "diceChanged", player, dice: next.dice });

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

/** The single entry point for changing a game. Throws `GameError` when the rules say no. */
export function applyCommand(state: GameState, player: Player, command: Command): Result {
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
