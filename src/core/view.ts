import type { BoardState, Player } from "./board.ts";
import type { CardId } from "./cards.ts";
import type { GameEvent, GameState, Phase } from "./game.ts";

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
  shielded: Record<Player, boolean>;
  /** Games won in this match so far. */
  wins: Record<Player, number>;
  /** Who has asked to play again, once the game is over. */
  rematch: Record<Player, boolean>;
  hand: CardId[];
  /** Cards you may pick from. Empty unless it is your pick phase. */
  offer: CardId[];
  /** Pile sizes for both players. Contents stay hidden. */
  counts: Record<Player, { hand: number; deck: number; discard: number }>;
}

export function viewFor(state: GameState, viewer: Player): PlayerView {
  const count = (player: Player) => ({
    hand: state.cards[player].hand.length,
    deck: state.cards[player].deck.length,
    discard: state.cards[player].discard.length,
  });
  return {
    you: viewer,
    board: state.board,
    current: state.current,
    dice: state.dice,
    phase: state.phase,
    winner: state.winner,
    shielded: state.shielded,
    wins: state.wins,
    rematch: state.rematch,
    hand: state.cards[viewer].hand,
    offer: state.cards[viewer].offer,
    counts: { white: count("white"), black: count("black") },
  };
}

/** Hides what the viewer may not see: which cards the opponent was offered and picked. */
export function redactEvent(event: GameEvent, viewer: Player): GameEvent {
  if (event.type === "cardsOffered" && event.player !== viewer) return { ...event, cards: null };
  if (event.type === "cardPicked" && event.player !== viewer) return { ...event, card: null };
  return event;
}
