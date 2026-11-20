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

function isOpen(board: BoardState, player: Player, point: number): boolean {
  const target = board.points[point];
  return target.owner !== opponent(player) || target.count <= 1;
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

/** Every legal single-checker move for one die. Ignores how the rest of the roll is used. */
export function legalMovesForDie(board: BoardState, player: Player, die: number): Move[] {
  const step = player === "white" ? -1 : 1;

  if (board.bar[player] > 0) {
    const entry = player === "white" ? POINT_COUNT - die : die - 1;
    return isOpen(board, player, entry) ? [{ player, from: "bar", to: entry, die }] : [];
  }

  const farthest = farthestDistance(board, player);
  const canBearOff = farthest <= 6;
  const moves: Move[] = [];

  board.points.forEach((p, from) => {
    if (p.owner !== player || p.count === 0) return;
    const distance = distanceToOff(player, from);
    if (die < distance) {
      const to = from + step * die;
      if (isOpen(board, player, to)) moves.push({ player, from, to, die });
    } else if (canBearOff && (die === distance || distance === farthest)) {
      // Exact roll, or an overshoot from the rearmost checker.
      moves.push({ player, from, to: "off", die });
    }
  });
  return moves;
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
    const source = next.points[from];
    source.count -= 1;
    if (source.count === 0) source.owner = null;
  }

  if (to === "off") {
    next.off[player] += 1;
  } else {
    const target = next.points[to];
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
