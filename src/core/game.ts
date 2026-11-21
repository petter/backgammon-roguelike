import {
  applyMove,
  CHECKERS_PER_PLAYER,
  initialBoard,
  type Move,
  opponent,
  type Player,
} from "./board.ts";
import { breakShackles, cardBlock, counterpunch, playCard, rollDice } from "./cardPlay.ts";
import { type CardId, starterDeck } from "./cards.ts";
import { legalMoves, stillReversing } from "./moves.ts";
import { createRng, type Rng, shuffle } from "./rng.ts";
import {
  type CardTurn,
  cloneCards,
  type Command,
  type GameEvent,
  GameError,
  type GameState,
  type PlayerCards,
  type Result,
  withPlayer,
} from "./state.ts";

export { cardBlock } from "./cardPlay.ts";
export { diceToPlay, legalMoves, possibleMoves } from "./moves.ts";
export {
  type CardTurn,
  type Command,
  type GameEvent,
  GameError,
  type GameState,
  type Phase,
  type PlayerCards,
  type Result,
  type TurnInfo,
} from "./state.ts";

export const OFFER_SIZE = 3;
export const HAND_LIMIT = 5;

export function canPlayCard(
  turn: CardTurn,
  card: CardId,
  traps: Parameters<typeof cardBlock>[2],
): boolean {
  return cardBlock(turn, card, traps) === null;
}

function freshCards(rng: Rng): PlayerCards {
  return { deck: shuffle(starterDeck(), rng), hand: [], discard: [], offer: [] };
}

const neither = { white: false, black: false } as const;

/** Hands the turn to `player`: drops their shield and deals their card offer. */
function beginTurn(state: GameState, player: Player): Result {
  const rng = createRng(state.rng);
  const mine = cloneCards(state.cards[player]);
  const events: GameEvent[] = [];
  let extraOffer = state.extraOffer;

  if (mine.hand.length < HAND_LIMIT) {
    // Keen Eye's extra card waits for a turn with a pick.
    const size = OFFER_SIZE + (state.extraOffer[player] ? 1 : 0);
    extraOffer = withPlayer(state.extraOffer, player, false);
    while (mine.offer.length < size) {
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
      cards: withPlayer(state.cards, player, mine),
      shielded: withPlayer(state.shielded, player, false),
      extraOffer,
      reversing: false,
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
      shielded: { ...neither },
      hexes: { white: [], black: [] },
      wards: { white: [], black: [] },
      traps: { white: [], black: [] },
      extraOffer: { ...neither },
      bonusDice: { white: 0, black: 0 },
      reversing: false,
      wins,
      rematch: { ...neither },
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
    state: { ...state, phase: "roll", cards: withPlayer(state.cards, player, mine) },
    events: [{ type: "cardPicked", player, card }],
  };
}

function roll(state: GameState): Result {
  if (state.phase !== "roll") throw new GameError("You cannot roll right now");
  return rollDice(state);
}

function moveChecker(state: GameState, wanted: Omit<Move, "player">): Result {
  const player = state.current;
  const legal = legalMoves(state).find(
    (m) => m.from === wanted.from && m.to === wanted.to && m.die === wanted.die,
  );
  if (!legal) throw new GameError("That move is not legal");

  const applied = applyMove(state.board, legal);
  const dice = [...state.dice];
  dice.splice(dice.indexOf(legal.die), 1);
  const events: GameEvent[] = [...applied.events];
  const moved: GameState = {
    ...state,
    board: applied.board,
    dice,
    reversing: stillReversing(state.reversing, legal),
  };
  if (legal.to !== "off" && applied.events.some((event) => event.type === "hit")) {
    breakShackles(moved, applied.events, events);
    counterpunch(moved, legal.to, events);
  }

  if (moved.board.off[player] < CHECKERS_PER_PLAYER) return { state: moved, events };
  events.push({ type: "gameWon", winner: player });
  const wins = { ...moved.wins, [player]: moved.wins[player] + 1 };
  return { state: { ...moved, dice: [], phase: "over", winner: player, wins }, events };
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
      return moveChecker(state, command);
    case "playCard":
      return playCard(state, command.index);
    case "endTurn":
      return endTurn(state);
  }
}
