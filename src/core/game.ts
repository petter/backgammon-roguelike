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
} from "./board";
import { type Rng, rollDie } from "./rng";

export type Phase = "roll" | "move" | "over";

export interface GameState {
  board: BoardState;
  current: Player;
  /** Dice still to be played this turn. Doubles appear four times. */
  dice: number[];
  phase: Phase;
  winner: Player | null;
}

export type GameEvent =
  | BoardEvent
  | { type: "diceRolled"; player: Player; dice: number[] }
  | { type: "turnEnded"; player: Player; next: Player; reason: "done" | "blocked" }
  | { type: "gameWon"; winner: Player };

export interface Result {
  state: GameState;
  events: GameEvent[];
}

export function newGame(first: Player = "white"): GameState {
  return { board: initialBoard(), current: first, dice: [], phase: "roll", winner: null };
}

/**
 * Legal moves for the remaining dice, one die at a time.
 * Not yet enforced: the rule that a roll must be played so as to use as many dice as possible.
 */
export function legalMoves(state: GameState): Move[] {
  if (state.phase !== "move") return [];
  return [...new Set(state.dice)].flatMap((die) =>
    legalMovesForDie(state.board, state.current, die),
  );
}

function endTurn(state: GameState, reason: "done" | "blocked"): Result {
  const next = opponent(state.current);
  return {
    state: { ...state, current: next, dice: [], phase: "roll" },
    events: [{ type: "turnEnded", player: state.current, next, reason }],
  };
}

export function roll(state: GameState, rng: Rng): Result {
  if (state.phase !== "roll") throw new Error(`Cannot roll during ${state.phase} phase`);
  const a = rollDie(rng);
  const b = rollDie(rng);
  const dice = a === b ? [a, a, a, a] : [a, b];
  const rolled: GameState = { ...state, dice, phase: "move" };
  const events: GameEvent[] = [{ type: "diceRolled", player: state.current, dice }];

  if (legalMoves(rolled).length > 0) return { state: rolled, events };
  const ended = endTurn(rolled, "blocked");
  return { state: ended.state, events: [...events, ...ended.events] };
}

export function playMove(state: GameState, move: Move): Result {
  const legal = legalMoves(state).some(
    (m) => m.from === move.from && m.to === move.to && m.die === move.die,
  );
  if (!legal || move.player !== state.current) {
    throw new Error(`Illegal move: ${JSON.stringify(move)}`);
  }

  const applied = applyMove(state.board, move);
  const dice = [...state.dice];
  dice.splice(dice.indexOf(move.die), 1);
  const moved: GameState = { ...state, board: applied.board, dice };
  const events: GameEvent[] = [...applied.events];

  if (moved.board.off[state.current] === CHECKERS_PER_PLAYER) {
    events.push({ type: "gameWon", winner: state.current });
    return { state: { ...moved, dice: [], phase: "over", winner: state.current }, events };
  }

  const blocked = dice.length > 0 && legalMoves(moved).length === 0;
  if (dice.length > 0 && !blocked) return { state: moved, events };
  const ended = endTurn(moved, blocked ? "blocked" : "done");
  return { state: ended.state, events: [...events, ...ended.events] };
}
