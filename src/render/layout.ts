import type { Player } from "../core/board.ts";

/** World units. X runs left to right, Z towards the camera, Y up. Playfield top is y = 0. */
export const FIELD_HALF_W = 6.5;
export const FIELD_HALF_D = 5.5;
export const BAR_W = 1;
export const TRIANGLE_LEN = 4.6;
export const CHECKER_R = 0.43;
export const CHECKER_H = 0.2;
export const TRAY_X = 7.8;
export const TRAY_W = 1.4;

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

export type PickTarget = { kind: "point"; index: number } | { kind: "bar" } | { kind: "off" };

/** Maps a spot on the playfield plane to what the player clicked. */
export function pickAt(x: number, z: number): PickTarget | null {
  if (Math.abs(z) > FIELD_HALF_D + 0.5) return null;
  if (Math.abs(x - TRAY_X) <= TRAY_W / 2) return { kind: "off" };
  if (Math.abs(x) > FIELD_HALF_W || Math.abs(z) > FIELD_HALF_D) return null;
  if (Math.abs(x) < BAR_W / 2) return { kind: "bar" };
  const c = x < 0 ? Math.floor(x + FIELD_HALF_W) : 6 + Math.floor(x - BAR_W / 2);
  return { kind: "point", index: z > 0 ? 11 - c : 12 + c };
}
