import {
  applyMove,
  type BoardState,
  legalMovesForDie,
  type Move,
  opponent,
  type Player,
  reverseMovesForDie,
} from "./board.ts";
import type { TurnInfo } from "./state.ts";

/**
 * The single-checker moves open with these dice, highest die first. While a Backstep hex
 * holds and no checker waits on the bar, they are the backward moves, unless there are none.
 */
function nextMoves(
  board: BoardState,
  player: Player,
  dice: number[],
  shielded: boolean,
  reversing: boolean,
): Move[] {
  const faces = [...new Set(dice)].toSorted((a, b) => b - a);
  if (reversing && board.bar[player] === 0) {
    const back = faces.flatMap((die) => reverseMovesForDie(board, player, die, shielded));
    if (back.length > 0) return back;
  }
  return faces.flatMap((die) => legalMovesForDie(board, player, die, shielded));
}

/** Whether a Backstep hex still holds after this move: only entering from the bar leaves it. */
export function stillReversing(reversing: boolean, move: Pick<Move, "from">): boolean {
  return reversing && move.from === "bar";
}

/**
 * Every single-checker move one of the remaining dice allows, with no regard for what it
 * leaves playable afterwards. `legalMoves` is the one the rules go by.
 */
export function possibleMoves(turn: TurnInfo): Move[] {
  if (turn.phase !== "move") return [];
  const shielded = turn.shielded[opponent(turn.current)];
  return nextMoves(turn.board, turn.current, turn.dice, shielded, turn.reversing);
}

/**
 * How much of a roll can be played: how many dice, and the highest die that can begin such
 * a play. The die only matters when a single one can be played.
 */
interface Play {
  count: number;
  high: number;
}

/** Positions examined before the search gives up and leaves the roll unrestricted. */
const SEARCH_LIMIT = 50_000;

class SearchTooLarge extends Error {}

/**
 * Shared by every step of one search: whose roll it is, whether the opponent is shielded,
 * the positions already solved, and how many more may be.
 */
interface Search {
  player: Player;
  shielded: boolean;
  seen: Map<string, Play>;
  left: number;
}

function without(dice: number[], die: number): number[] {
  const rest = [...dice];
  rest.splice(rest.indexOf(die), 1);
  return rest;
}

/** The most that can be played from a position with the given dice. */
function bestPlay(board: BoardState, dice: number[], reversing: boolean, search: Search): Play {
  if (dice.length === 0) return { count: 0, high: 0 };
  const key = `${JSON.stringify(board)}|${dice.toSorted((a, b) => a - b).join("")}|${reversing}`;
  const known = search.seen.get(key);
  if (known) return known;
  if (--search.left < 0) throw new SearchTooLarge();

  let best: Play = { count: 0, high: 0 };
  // Highest die first, so the first play found of any length begins with the highest die.
  for (const move of nextMoves(board, search.player, dice, search.shielded, reversing)) {
    const after = bestPlay(
      applyMove(board, move).board,
      without(dice, move.die),
      stillReversing(reversing, move),
      search,
    );
    if (1 + after.count > best.count) best = { count: 1 + after.count, high: move.die };
    // Nothing can beat using every die.
    if (best.count === dice.length) break;
  }
  search.seen.set(key, best);
  return best;
}

/**
 * The moves the rules allow now. A roll must be played so as to use as many dice as
 * possible, and when only one can be played, the highest that can: so a move is legal only
 * if it can begin such a play. This is the backgammon rule for two dice, carried over
 * unchanged to turns where cards have left more.
 */
export function legalMoves(turn: TurnInfo): Move[] {
  const moves = possibleMoves(turn);
  if (moves.length === 0) return moves;
  const search: Search = {
    player: turn.current,
    shielded: turn.shielded[opponent(turn.current)],
    seen: new Map(),
    left: SEARCH_LIMIT,
  };
  try {
    const most = bestPlay(turn.board, turn.dice, turn.reversing, search);
    return moves.filter((move) => {
      const after = bestPlay(
        applyMove(turn.board, move).board,
        without(turn.dice, move.die),
        stillReversing(turn.reversing, move),
        search,
      );
      // One die only: it must be the highest that can be played at all.
      return 1 + after.count === most.count && (most.count > 1 || move.die === most.high);
    });
  } catch (error) {
    // A position too tangled to search fully (many dice, many choices): leave it open
    // rather than stall. Client and server reach the same verdict, since both run this.
    if (error instanceof SearchTooLarge) return moves;
    throw error;
  }
}

/** How many of the dice the rules require to be played from here. For explaining a refusal. */
export function diceToPlay(turn: TurnInfo): number {
  const [move] = legalMoves(turn);
  if (!move) return 0;
  return (
    1 +
    diceToPlay({
      ...turn,
      board: applyMove(turn.board, move).board,
      dice: without(turn.dice, move.die),
      reversing: stillReversing(turn.reversing, move),
    })
  );
}
