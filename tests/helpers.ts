import { type BoardState, emptyBoard, type Player } from "../src/core/board.ts";
import type { CardId } from "../src/core/cards.ts";
import type { GameState, PlayerCards } from "../src/core/game.ts";

export function cards(partial: Partial<PlayerCards> = {}): PlayerCards {
  return { deck: [], hand: [], discard: [], offer: [], ...partial };
}

/** A game in white's move phase on an empty board, to be shaped per test. */
export function game(partial: Partial<GameState> = {}): GameState {
  return {
    board: emptyBoard(),
    current: "white",
    dice: [],
    phase: "move",
    winner: null,
    cards: { white: cards(), black: cards() },
    shielded: { white: false, black: false },
    hexes: { white: [], black: [] },
    wards: { white: [], black: [] },
    traps: { white: [], black: [] },
    extraOffer: { white: false, black: false },
    bonusDice: { white: 0, black: 0 },
    reversing: false,
    wins: { white: 0, black: 0 },
    rematch: { white: false, black: false },
    rng: 1,
    ...partial,
  };
}

export function hand(player: Player, ...ids: CardId[]): GameState["cards"] {
  return { white: cards(), black: cards(), [player]: cards({ hand: ids }) };
}

export function checkersOf(board: BoardState, player: Player): number {
  const onPoints = board.points
    .filter((p) => p.owner === player)
    .reduce((sum, p) => sum + p.count, 0);
  return onPoints + board.bar[player] + board.off[player];
}
