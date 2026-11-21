import type { GameState } from "../core/game.ts";

/** State added after games were first saved; a game saved before it has none. */
type Added =
  | "wins"
  | "rematch"
  | "winReason"
  | "hexes"
  | "wards"
  | "traps"
  | "extraOffer"
  | "bonusDice"
  | "reversing";

/**
 * Brings a saved game up to date. One saved before matches kept a score has none; if it
 * is already won, the win is the one thing known about the match, so it is counted, and
 * treated as a normal bear-off. One saved before curses, wards and traps has none of them.
 */
export function upToDate(
  game: Omit<GameState, Added> & Partial<Pick<GameState, Added>>,
): GameState {
  const none = { white: 0, black: 0, ...(game.winner ? { [game.winner]: 1 } : {}) };
  const no = { white: false, black: false };
  return {
    ...game,
    wins: game.wins ?? none,
    rematch: game.rematch ?? no,
    winReason: game.winReason ?? (game.winner ? "bearOff" : null),
    hexes: game.hexes ?? { white: [], black: [] },
    wards: game.wards ?? { white: [], black: [] },
    traps: game.traps ?? { white: [], black: [] },
    extraOffer: game.extraOffer ?? no,
    bonusDice: game.bonusDice ?? { white: 0, black: 0 },
    reversing: game.reversing ?? false,
  };
}
