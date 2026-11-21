import type { Player } from "../core/board.ts";
import { backArea, FIELD_HALF_W, ROUTE_LANE as LANE, TRAY_X, trayWell } from "./layout.ts";

/**
 * The shape of the guide's route on the playfield, in world units: where a player's
 * checkers travel, or where a checker goes to be borne off. Pure geometry.
 */

/** What a route is drawn for. See `Guide` in guide.ts. */
export interface RouteOf {
  kind: "home" | "bearOff";
  player: Player;
  from?: { x: number; out: number; cross: number };
}

/** How far each corner of the route is rounded off, so chevrons do not pile up there. */
const CORNER = 0.6;
/** The bend into the tray is wider: it starts on the rail, where no chevron is drawn. */
const TRAY_CORNER = 1;
/** The shortest first leg worth drawing out from a stack before the turn for the tray. */
const MIN_LEG = 0.4;
/** How far down the tray an arrowhead goes: past the pile of borne-off checkers. */
const PILE_CLEAR = 4.4;
/** The least run down the tray at the end of a bear-off route. */
const TRAY_RUN = 1.4;
/** Where in home the route ends: between two points, pointing at the HOME tag. */
export const ROUTE_END = { x: 3.5, z: 2.1 };

export interface Waypoint {
  x: number;
  z: number;
}

/**
 * The way a player's checkers travel, as a line through the middle of the board: along the
 * far side, round the end, and back along their own side into home. For bearing off, from
 * the middle of home out over the rail into the tray.
 */
export function routeOf(guide: RouteOf): Waypoint[] {
  const s = guide.player === "white" ? 1 : -1;
  if (guide.kind === "bearOff") {
    // With no checker able to leave yet there is no route to show: the tray alone is lit.
    if (!guide.from) return [];
    const well = trayWell(guide.player);
    // `out` is just past the innermost checker of the stack that can leave, `cross` how
    // far in the route crosses to the tray, clear of the stacks on the way. With no room
    // between them for a first leg, it runs straight across.
    const { x, out, cross: turn } = guide.from;
    const start: Waypoint[] =
      out - turn < MIN_LEG
        ? [{ x, z: s * turn }]
        : [
            { x, z: s * out },
            { x, z: s * turn },
          ];
    // Down the tray past where borne-off checkers pile up, so they never cover the
    // arrowhead, and far enough that the last stretch is long enough to aim it.
    const far = Math.max(Math.abs(well.z0), Math.abs(well.z1)) - 0.3;
    const end = Math.min(far, Math.max(PILE_CLEAR, turn + TRAY_RUN));
    return rounded([...start, { x: TRAY_X, z: s * turn }, { x: TRAY_X, z: s * end }], TRAY_CORNER);
  }
  // Far enough in that the turn clears the rail, which would hide its outer edge.
  const end = FIELD_HALF_W - 1.25;
  // A half circle round the far end of the board, from the far lane to the near one.
  const turn: Waypoint[] = Array.from({ length: 9 }, (_, i) => {
    const phi = (i / 8) * Math.PI;
    return { x: -end - Math.sin(phi) * LANE, z: -s * Math.cos(phi) * LANE };
  });
  // From under the back checkers out to the far lane; along it, round the end, back along
  // the near lane, then turning down into home.
  // The route sets out from the near end of the framed back checkers.
  const back = backArea(guide.player);
  const backX = (back.x0 + back.x1) / 2;
  const backZ = s > 0 ? back.z1 : back.z0;
  return rounded(
    [
      { x: backX, z: backZ },
      { x: backX, z: -s * LANE },
      { x: end, z: -s * LANE },
      ...turn,
      { x: ROUTE_END.x, z: s * LANE },
      { x: ROUTE_END.x, z: s * ROUTE_END.z },
    ],
    CORNER,
  );
}

/**
 * Rounds off every corner of a polyline with a curve that leaves each side `radius` before
 * the corner, or half the side if that is shorter. Gentle bends, such as the samples of a
 * half circle, are left nearly as they are.
 */
function rounded(points: Waypoint[], radius: number): Waypoint[] {
  const out: Waypoint[] = points.slice(0, 1);
  for (let i = 1; i < points.length - 1; i++) {
    const [a, v, b] = [points[i - 1], points[i], points[i + 1]] as [Waypoint, Waypoint, Waypoint];
    const r = Math.min(
      radius,
      Math.hypot(v.x - a.x, v.z - a.z) / 2,
      Math.hypot(b.x - v.x, b.z - v.z) / 2,
    );
    const from = (p: Waypoint) => {
      const length = Math.hypot(p.x - v.x, p.z - v.z) || 1;
      return { x: v.x + ((p.x - v.x) / length) * r, z: v.z + ((p.z - v.z) / length) * r };
    };
    const [enter, leave] = [from(a), from(b)];
    // A quadratic curve with the corner as its control point.
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      out.push({
        x: u * u * enter.x + 2 * u * t * v.x + t * t * leave.x,
        z: u * u * enter.z + 2 * u * t * v.z + t * t * leave.z,
      });
    }
  }
  const last = points.at(-1);
  if (last && points.length > 1) out.push(last);
  return out;
}

/** Spots every `step` along a polyline, each with the direction it is heading. */
export function along(points: Waypoint[], step: number): Array<Waypoint & { angle: number }> {
  const out: Array<Waypoint & { angle: number }> = [];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length === 0) continue;
    const angle = Math.atan2(-(b.z - a.z), b.x - a.x);
    // Short of the segment's end, which is the next one's start: no spot is placed twice.
    for (let d = carry; d < length; d += step) {
      const t = d / length;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, angle });
    }
    carry = (carry - length) % step;
    if (carry < 0) carry += step;
  }
  // The route ends exactly at its last point, where the arrowhead goes, facing along the
  // way the route comes in: from far enough back that a short last stub cannot tilt it.
  const end = points.at(-1);
  const before = points.findLast((p) => end && Math.hypot(end.x - p.x, end.z - p.z) >= step);
  if (end && before) {
    // Room for the arrowhead, which is larger than the chevrons behind it.
    while (out.length > 0) {
      const last = out.at(-1);
      if (!last || Math.hypot(end.x - last.x, end.z - last.z) >= step * 1.2) break;
      out.pop();
    }
    out.push({ ...end, angle: Math.atan2(-(end.z - before.z), end.x - before.x) });
  }
  // Each spot faces along the line from its neighbour behind to its neighbour ahead, so
  // marks on a curve turn with it smoothly.
  const angles = out.map((spot, i) => {
    const prior = out[i - 1];
    const after = out[i + 1];
    return prior && after ? Math.atan2(-(after.z - prior.z), after.x - prior.x) : spot.angle;
  });
  out.forEach((spot, i) => {
    spot.angle = angles[i] ?? spot.angle;
  });
  return out;
}
