import type { BoardEvent, BoardState, Player } from "./board.ts";
import type { CardId, HexId, TrapId, WardId } from "./cards.ts";

/** `pick`: choose one offered card. `roll`: roll the dice. `move`: play checkers and cards. */
export type Phase = "pick" | "roll" | "move" | "over";

/** How a finished game ended: normal bear-off, or victory claimed after the opponent left. */
export type WinReason = "bearOff" | "abandoned";

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
  /** How the game was won, once `phase === "over"`. */
  winReason: WinReason | null;
  cards: Record<Player, PlayerCards>;
  /** A shielded player's lone checkers cannot be hit. Lasts until their next turn. */
  shielded: Record<Player, boolean>;
  /**
   * Hexes cast on each player, oldest first. They bite when that player next rolls, and are
   * spent then, except Shackles of Greed, which stays until broken or lifted. Public.
   */
  hexes: Record<Player, HexId[]>;
  /** Wards standing in front of each player, waiting for the next hex. Public. */
  wards: Record<Player, WardId[]>;
  /** Traps each player has set face down. Secret: the opponent learns only how many. */
  traps: Record<Player, TrapId[]>;
  /** Whoever played Keen Eye is offered one more card at their next pick. */
  extraOffer: Record<Player, boolean>;
  /** Dice Curse Eater has promised before the roll, added when the player rolls. */
  bonusDice: Record<Player, number>;
  /** A Backstep hex has bitten: the player's next checker move must go backwards if it can. */
  reversing: boolean;
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
  /** Claims victory once the opponent has been disconnected past the grace period. */
  | { type: "claimVictory" }
  /** Asks to play again. Only once the game is over; the new game starts when both have. */
  | { type: "rematch" };

/** `cards` and `card` are `null` once redacted for the opponent. */
export type GameEvent =
  | BoardEvent
  | { type: "cardsOffered"; player: Player; cards: CardId[] | null }
  /** `player` starts a turn holding a full hand, so there is no card to pick. */
  | { type: "handFull"; player: Player }
  | { type: "cardPicked"; player: Player; card: CardId | null }
  /** Played face up. A trap is never announced this way: see `trapSet`. */
  | { type: "cardPlayed"; player: Player; card: CardId }
  | { type: "diceRolled"; player: Player; dice: number[] }
  /** A card changed the dice. `doubled`: it made a pair, which became four dice. */
  | { type: "diceChanged"; player: Player; dice: number[]; doubled: boolean }
  | { type: "shieldRaised"; player: Player }
  /** A hex landed on `player`, to bite at their next roll. */
  | { type: "hexCast"; player: Player; card: HexId }
  /** `player`'s ward met a hex: a horseshoe blocks it, a mirror sends it back. */
  | { type: "hexWarded"; player: Player; card: HexId; ward: WardId }
  /** A hex bit `player` as they rolled. */
  | { type: "hexStruck"; player: Player; card: HexId }
  /** Hexes left `player`: lifted by a ward card, or Shackles broken by a hit or doubles. */
  | { type: "hexLifted"; player: Player; cards: HexId[] }
  /** `player` set a trap face down. `card` is `null` once redacted for the opponent. */
  | { type: "trapSet"; player: Player; card: TrapId | null }
  /** `player`'s trap sprang and is revealed. */
  | { type: "trapSprung"; player: Player; card: TrapId }
  | { type: "coinFlipped"; player: Player; heads: boolean }
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
export type TurnInfo = Pick<
  GameState,
  "board" | "current" | "dice" | "phase" | "shielded" | "reversing"
>;

/** The public facts that decide whether a card can be played, beside the player's own traps. */
export type CardTurn = TurnInfo & Pick<GameState, "hexes" | "wards" | "extraOffer">;

/** Replaces one player's entry in a two-player record. */
export function withPlayer<T>(
  record: Record<Player, T>,
  player: Player,
  value: T,
): Record<Player, T> {
  return player === "white"
    ? { white: value, black: record.black }
    : { white: record.white, black: value };
}

export function cloneCards(cards: PlayerCards): PlayerCards {
  return {
    deck: [...cards.deck],
    hand: [...cards.hand],
    discard: [...cards.discard],
    offer: [...cards.offer],
  };
}

/**
 * Two matching dice are doubles and play four times, whether rolled or made by a card.
 * Only an exact pair counts: three dice with two alike stay as they are.
 */
export function asDoubles(dice: number[]): number[] {
  const [a, b] = dice;
  return dice.length === 2 && a !== undefined && a === b ? [a, a, a, a] : dice;
}

/**
 * The dice after one extra die is rolled into them: when it matches a die already there, that
 * pair is doubles and plays four times, after the dice left over.
 */
export function withPairedDie(dice: number[], rolled: number): number[] {
  const at = dice.indexOf(rolled);
  if (at === -1) return [...dice, rolled];
  return [...dice.toSpliced(at, 1), rolled, rolled, rolled, rolled];
}

/** The dice with one of the highest lowered by 1, unless the highest is already a 1. */
export function lowerHighest(dice: number[]): number[] {
  const high = Math.max(...dice);
  if (dice.length === 0 || high <= 1) return dice;
  const next = [...dice];
  next[next.indexOf(high)] = high - 1;
  return next;
}
