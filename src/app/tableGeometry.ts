import type { Player } from "../core/board.ts";
import { FIELD_HALF_W, OUTER_D, RIM, TRAY_W, TRAY_X } from "../render/layout.ts";
import type { Stage } from "../render/stage.ts";
import type { TableGeometry } from "../ui/table.ts";

/** The board's outline on the felt, tray included, with a little more for the rails' height. */
const LEFT = -FIELD_HALF_W - RIM;
const RIGHT = TRAY_X + TRAY_W / 2;
const EDGE = OUTER_D / 2 + 0.4;

/**
 * Where the board is on screen now, and whose edge is nearest: what the cards on the table
 * are laid out against. `null` while the board has no room on screen.
 */
export function tableGeometry(stage: Stage): TableGeometry | null {
  const field = stage.lens.bounds();
  if (field.width === 0 || field.height === 0) return null;
  const corners = [
    stage.toScreen(LEFT, -EDGE),
    stage.toScreen(RIGHT, -EDGE),
    stage.toScreen(RIGHT, EDGE),
    stage.toScreen(LEFT, EDGE),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  // White's edge lies along +z; it is the near one when it is drawn lower down the screen.
  const near: Player = stage.toScreen(0, EDGE).y > stage.toScreen(0, -EDGE).y ? "white" : "black";
  return {
    board: {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    },
    field: { left: field.left, right: field.right, top: field.top, bottom: field.bottom },
    near,
  };
}
