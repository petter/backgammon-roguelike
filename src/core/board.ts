import { must } from "./must.ts";

export type Player = "white" | "black";

export const POINT_COUNT = 24;
export const CHECKERS_PER_PLAYER = 15;

export interface PointState {
  owner: Player | null;
  count: number;
}

export interface BoardState {
  /** Index 0 is white's 1-point. White moves towards 0, black towards 23. */
  points: PointState[];
  bar: Record<Player, number>;
  off: Record<Player, number>;
}

/** `from` is a point index or the bar; `to` is a point index or borne off. */
export interface Move {
  player: Player;
  from: number | "bar";
  to: number | "off";
  die: number;
}

export type BoardEvent =
  | { type: "hit"; player: Player; point: number }
  | { type: "pieceMoved"; player: Player; from: number | "bar"; to: number | "off" };

/** The point at an index, which must be on the board. */
export function pointAt(board: BoardState, index: number): PointState {
  return must(board.points[index], `point ${index}`);
}

export function opponent(player: Player): Player {
  return player === "white" ? "black" : "white";
}

export function emptyBoard(): BoardState {
  return {
    points: Array.from({ length: POINT_COUNT }, () => ({ owner: null, count: 0 })),
    bar: { white: 0, black: 0 },
    off: { white: 0, black: 0 },
  };
}

export function place(board: BoardState, player: Player, point: number, count: number): void {
  board.points[point] = { owner: player, count };
}

export function initialBoard(): BoardState {
  const board = emptyBoard();
  for (const [point, count] of [
    [23, 2],
    [12, 5],
    [7, 3],
    [5, 5],
  ] as const) {
    place(board, "white", point, count);
    place(board, "black", POINT_COUNT - 1 - point, count);
  }
  return board;
}

export function cloneBoard(board: BoardState): BoardState {
  return {
    points: board.points.map((p) => ({ ...p })),
    bar: { ...board.bar },
    off: { ...board.off },
  };
}

/** Pips a checker on `point` still has to travel to bear off. */
function distanceToOff(player: Player, point: number): number {
  return player === "white" ? point + 1 : POINT_COUNT - point;
}

/** Whether `point` is in the player's home board, the last six points of their journey. */
export function isHome(player: Player, point: number): boolean {
  return distanceToOff(player, point) <= 6;
}

/** A point is open unless the opponent holds it, or their lone checker there is shielded. */
function isOpen(board: BoardState, player: Player, point: number, shielded: boolean): boolean {
  const target = pointAt(board, point);
  if (target.owner !== opponent(player) || target.count === 0) return true;
  return target.count === 1 && !shielded;
}

/** Farthest distance from bearing off among the player's checkers on the board. */
function farthestDistance(board: BoardState, player: Player): number {
  let farthest = 0;
  board.points.forEach((p, i) => {
    if (p.owner === player && p.count > 0) {
      farthest = Math.max(farthest, distanceToOff(player, i));
    }
  });
  return farthest;
}

/**
 * Every legal single-checker move for one die. Ignores how the rest of the roll is used.
 * `opponentShielded` makes the opponent's lone checkers unhittable.
 */
export function legalMovesForDie(
  board: BoardState,
  player: Player,
  die: number,
  opponentShielded = false,
): Move[] {
  const step = player === "white" ? -1 : 1;

  if (board.bar[player] > 0) {
    const entry = player === "white" ? POINT_COUNT - die : die - 1;
    return isOpen(board, player, entry, opponentShielded)
      ? [{ player, from: "bar", to: entry, die }]
      : [];
  }

  const farthest = farthestDistance(board, player);
  const canBearOff = farthest <= 6;
  const moves: Move[] = [];

  board.points.forEach((p, from) => {
    if (p.owner !== player || p.count === 0) return;
    const distance = distanceToOff(player, from);
    if (die < distance) {
      const to = from + step * die;
      if (isOpen(board, player, to, opponentShielded)) moves.push({ player, from, to, die });
    } else if (canBearOff && (die === distance || distance === farthest)) {
      // Exact roll, or an overshoot from the rearmost checker.
      moves.push({ player, from, to: "off", die });
    }
  });
  return moves;
}

/**
 * Every move that takes one of the player's checkers `die` points backwards, away from home,
 * as a Backstep hex demands. A checker on the bar has nowhere back to go, and none may leave
 * the board; it may hit an open blot like any forward move.
 */
export function reverseMovesForDie(
  board: BoardState,
  player: Player,
  die: number,
  opponentShielded = false,
): Move[] {
  const step = player === "white" ? 1 : -1;
  const moves: Move[] = [];
  board.points.forEach((p, from) => {
    if (p.owner !== player || p.count === 0) return;
    const to = from + step * die;
    if (to < 0 || to >= POINT_COUNT) return;
    if (isOpen(board, player, to, opponentShielded)) moves.push({ player, from, to, die });
  });
  return moves;
}

/**
 * The step Quiet Step takes: the player's rearmost checker one point forward, onto an empty
 * point or one of their own. `null` if it cannot: a checker on the bar, the rearmost already
 * on the 1-point, or an opposing checker in the way.
 */
export function quietStep(board: BoardState, player: Player): { from: number; to: number } | null {
  if (board.bar[player] > 0) return null;
  const far = farthestDistance(board, player);
  if (far <= 1) return null;
  const from = player === "white" ? far - 1 : POINT_COUNT - far;
  const to = player === "white" ? from - 1 : from + 1;
  const target = pointAt(board, to);
  return target.owner === opponent(player) && target.count > 0 ? null : { from, to };
}

/** Applies a move without checking legality. Returns a new board and what happened. */
export function applyMove(
  board: BoardState,
  move: Move,
): { board: BoardState; events: BoardEvent[] } {
  const next = cloneBoard(board);
  const events: BoardEvent[] = [];
  const { player, from, to } = move;

  if (from === "bar") {
    next.bar[player] -= 1;
  } else {
    const source = pointAt(next, from);
    source.count -= 1;
    if (source.count === 0) source.owner = null;
  }

  if (to === "off") {
    next.off[player] += 1;
  } else {
    const target = pointAt(next, to);
    if (target.owner === opponent(player) && target.count === 1) {
      next.bar[opponent(player)] += 1;
      target.count = 0;
      events.push({ type: "hit", player: opponent(player), point: to });
    }
    target.owner = player;
    target.count += 1;
  }

  events.push({ type: "pieceMoved", player, from, to });
  return { board: next, events };
}

/** The points in the player's home board that hold a single opposing checker. */
export function loneEnemiesAtHome(board: BoardState, player: Player): number[] {
  const victim = opponent(player);
  return board.points.flatMap((point, index) =>
    point.owner === victim && point.count === 1 && isHome(player, index) ? [index] : [],
  );
}

/** Sends every lone opposing checker in the player's home board to the bar. */
export function sweepHome(
  board: BoardState,
  player: Player,
): { board: BoardState; events: BoardEvent[] } {
  const next = cloneBoard(board);
  const victim = opponent(player);
  const events: BoardEvent[] = loneEnemiesAtHome(board, player).map((index) => {
    next.points[index] = { owner: null, count: 0 };
    next.bar[victim] += 1;
    return { type: "hit", player: victim, point: index };
  });
  return { board: next, events };
}

/** How many of the player's checkers stand on a point. */
function mineAt(board: BoardState, player: Player, index: number): number {
  const point = pointAt(board, index);
  return point.owner === player ? point.count : 0;
}

/** Whether every one of the player's checkers still in play is in their home board. */
export function allHome(board: BoardState, player: Player): boolean {
  return (
    board.bar[player] === 0 &&
    board.points.every((_, index) => mineAt(board, player, index) === 0 || isHome(player, index))
  );
}

/** Whether the player's checkers all stand where the game set them up. */
export function untouched(board: BoardState, player: Player): boolean {
  const start = initialBoard();
  return (
    board.bar[player] === 0 &&
    board.off[player] === 0 &&
    board.points.every((_, index) => mineAt(board, player, index) === mineAt(start, player, index))
  );
}
