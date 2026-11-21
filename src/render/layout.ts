import type { BoardState, Player } from "../core/board.ts";

/** World units. X runs left to right, Z towards the camera, Y up. Playfield top is y = 0. */
export const FIELD_HALF_W = 6.5;
export const FIELD_HALF_D = 5.5;
export const BAR_W = 1;
export const TRIANGLE_LEN = 4.6;
export const CHECKER_R = 0.43;
export const CHECKER_H = 0.2;
export const TRAY_X = 7.8;
export const TRAY_W = 1.4;
/** Width of the wooden rails round the playfield, and of the tray's walls. */
export const RIM = 0.5;
export const TRAY_WALL = 0.16;
/** The board's outer depth, rails included; the tray is as deep. */
export const OUTER_D = (FIELD_HALF_D + RIM) * 2;
/** Depth of each of the tray's two felt wells, either side of its divider. */
export const TRAY_WELL_D = (OUTER_D - TRAY_WALL * 2 - 0.2) / 2;

const SLOT = 0.88;
const PER_LAYER = 5;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where a checker stands: a point index, or a player's bar or borne-off stack. */
export type Place =
  | { kind: "point"; index: number }
  | { kind: "bar"; player: Player }
  | { kind: "off"; player: Player };

/** Points 0-11 run right to left along the near edge, 12-23 left to right along the far edge. */
function column(point: number): number {
  return point < 12 ? 11 - point : point - 12;
}

/** +1 for the near (white home) edge, -1 for the far edge. */
export function pointSide(point: number): 1 | -1 {
  return point < 12 ? 1 : -1;
}

export function pointX(point: number): number {
  const c = column(point);
  return c - 5.5 + (c < 6 ? -BAR_W / 2 : BAR_W / 2);
}

function side(player: Player): 1 | -1 {
  return player === "white" ? 1 : -1;
}

/** Rest position of the `i`-th checker (0 = first placed) at a place. */
export function slotPosition(place: Place, i: number): Vec3 {
  if (place.kind === "off") {
    return { x: TRAY_X, y: CHECKER_H / 2 + i * CHECKER_H, z: side(place.player) * 3 };
  }
  const layer = Math.floor(i / PER_LAYER);
  const slot = i % PER_LAYER;
  const y = CHECKER_H / 2 + layer * CHECKER_H;
  if (place.kind === "bar") {
    return { x: 0, y, z: side(place.player) * (0.9 + slot * SLOT) };
  }
  const edge = FIELD_HALF_D - 0.5 - slot * SLOT - layer * (SLOT / 2);
  return { x: pointX(place.index), y, z: pointSide(place.index) * edge };
}

/**
 * How far from the middle line the guide's route runs, on each side: just inside the tips
 * of the points, so the outward and return lanes stand well apart.
 */
export const ROUTE_LANE = 0.68;

/** A rectangle on the playfield plane, in world units. */
export interface Area {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A player's home board: the six points between the bar and the tray on their edge. */
export function homeArea(player: Player): Area {
  const far = side(player) * FIELD_HALF_D;
  return { x0: BAR_W / 2, x1: FIELD_HALF_W, z0: Math.min(0, far), z1: Math.max(0, far) };
}

/**
 * A player's outer board: the six points on their own edge across the bar from home,
 * stopping short of the middle strip between the two rows of point tips.
 */
export function outerArea(player: Player): Area {
  const s = side(player);
  const near = s * (FIELD_HALF_D - TRIANGLE_LEN);
  const far = s * FIELD_HALF_D;
  return {
    x0: -FIELD_HALF_W,
    x1: -BAR_W / 2,
    z0: Math.min(near, far),
    z1: Math.max(near, far),
  };
}

/**
 * Where a player's two back checkers stand at the start, on the far side of the board:
 * their 24-point, from the edge to just past the nearer checker.
 */
export function backArea(player: Player): Area {
  const s = side(player);
  const x = pointX(player === "white" ? 23 : 0);
  // The nearer checker's centre, then its radius and a little more.
  const reach = FIELD_HALF_D - 0.5 - SLOT - 0.55;
  const ends = [-s * FIELD_HALF_D, -s * reach];
  return { x0: x - 0.5, x1: x + 0.5, z0: Math.min(...ends), z1: Math.max(...ends) };
}

/** The tray well a player bears off into. */
export function trayWell(player: Player): Area {
  const half = (TRAY_W - TRAY_WALL * 2) / 2;
  const z = (side(player) * (TRAY_WELL_D + 0.2)) / 2;
  return { x0: TRAY_X - half, x1: TRAY_X + half, z0: z - TRAY_WELL_D / 2, z1: z + TRAY_WELL_D / 2 };
}

export type PickTarget = { kind: "point"; index: number } | { kind: "bar" } | { kind: "off" };

/** Maps a spot on the playfield plane to what the player clicked. */
export function pickAt(x: number, z: number): PickTarget | null {
  if (Math.abs(z) > FIELD_HALF_D + 0.5) return null;
  // The tray is narrow, a thin target on a small screen: the outer half of the rail beside
  // it, clear of the checkers on the last point, and a sliver past it count as the tray too.
  if (x > FIELD_HALF_W + RIM / 2 && x <= TRAY_X + TRAY_W / 2 + 0.3) return { kind: "off" };
  if (Math.abs(x) > FIELD_HALF_W || Math.abs(z) > FIELD_HALF_D) return null;
  if (Math.abs(x) < BAR_W / 2) return { kind: "bar" };
  const c = x < 0 ? Math.floor(x + FIELD_HALF_W) : 6 + Math.floor(x - BAR_W / 2);
  return { kind: "point", index: z > 0 ? 11 - c : 12 + c };
}

/** Every checker standing on the board or the bar, as something dice can run into. */
export function obstaclesOf(board: BoardState): Array<{ x: number; z: number; top: number }> {
  const out: Array<{ x: number; z: number; top: number }> = [];
  const add = (place: Place, count: number) => {
    for (let i = 0; i < count; i++) {
      const at = slotPosition(place, i);
      out.push({ x: at.x, z: at.z, top: at.y + CHECKER_H / 2 });
    }
  };
  board.points.forEach((point, index) => {
    add({ kind: "point", index }, point.count);
  });
  add({ kind: "bar", player: "white" }, board.bar.white);
  add({ kind: "bar", player: "black" }, board.bar.black);
  return out;
}
