import type { BoardState, Player } from "./board.ts";
import type { CardId, HexId, TrapId, WardId } from "./cards.ts";
import type { GameEvent, GameState, Phase, WinReason } from "./game.ts";

/**
 * Everything one player is allowed to know. Built field by field, so anything added to
 * `GameState` stays secret until it is listed here.
 */
export interface PlayerView {
  you: Player;
  board: BoardState;
  current: Player;
  dice: number[];
  phase: Phase;
  winner: Player | null;
  winReason: WinReason | null;
  shielded: Record<Player, boolean>;
  /** Hexes waiting on each player, oldest first. */
  hexes: Record<Player, HexId[]>;
  /** Wards standing in front of each player. */
  wards: Record<Player, WardId[]>;
  /** Your own traps. The opponent's are only counted, in `counts`. */
  traps: TrapId[];
  extraOffer: Record<Player, boolean>;
  bonusDice: Record<Player, number>;
  /** The player on turn is under Backstep: their next checker move goes backwards. */
  reversing: boolean;
  /** Games won in this match so far. */
  wins: Record<Player, number>;
  /** Who has asked to play again, once the game is over. */
  rematch: Record<Player, boolean>;
  hand: CardId[];
  /** Cards you may pick from. Empty unless it is your pick phase. */
  offer: CardId[];
  /** Pile sizes and set traps for both players. Contents stay hidden. */
  counts: Record<Player, { hand: number; deck: number; discard: number; traps: number }>;
}

export function viewFor(state: GameState, viewer: Player): PlayerView {
  const count = (player: Player) => ({
    hand: state.cards[player].hand.length,
    deck: state.cards[player].deck.length,
    discard: state.cards[player].discard.length,
    traps: state.traps[player].length,
  });
  return {
    you: viewer,
    board: state.board,
    current: state.current,
    dice: state.dice,
    phase: state.phase,
    winner: state.winner,
    winReason: state.winReason,
    shielded: state.shielded,
    hexes: state.hexes,
    wards: state.wards,
    traps: state.traps[viewer],
    extraOffer: state.extraOffer,
    bonusDice: state.bonusDice,
    reversing: state.reversing,
    wins: state.wins,
    rematch: state.rematch,
    hand: state.cards[viewer].hand,
    offer: state.cards[viewer].offer,
    counts: { white: count("white"), black: count("black") },
  };
}

/**
 * Hides what the viewer may not see: which cards the opponent was offered and picked, and
 * which trap they set.
 */
export function redactEvent(event: GameEvent, viewer: Player): GameEvent {
  if (event.type === "trapSet" && event.player !== viewer) return { ...event, card: null };
  if (event.type === "cardsOffered" && event.player !== viewer) return { ...event, cards: null };
  if (event.type === "cardPicked" && event.player !== viewer) return { ...event, card: null };
  return event;
}
