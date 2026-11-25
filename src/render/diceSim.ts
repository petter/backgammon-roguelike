import { Quaternion, Vector3 } from "three";

import { must } from "../core/must.ts";
import {
  type Contact,
  contact,
  corners,
  DIE_HALF,
  extents,
  reachAlong,
  type Rigid,
  solve,
  type Surface,
} from "./cube.ts";
import { CHECKER_R, FIELD_HALF_D, FIELD_HALF_W } from "./layout.ts";

export { DIE_HALF } from "./cube.ts";
export const SIM_DT = 1 / 120;

const GRAVITY = -32;
/** The felt, and the tops of checkers. */
const FLOOR: Surface = { bounce: 0.3, friction: 0.45 };
const WALL_BOUNCE = 0.5;
const RIM: Surface = { bounce: WALL_BOUNCE, friction: 0.25 };
/** A corner this close to a surface already leans on it. */
const SLOP = 0.01;
/** A checker counts as ground for a corner no further than this below its top. */
const STEP_UP = 0.1;
/** The sliver of air left between two dice that touch. */
const PAIR_GAP = 0.004;
/** Closest a die's centre may come to a checker's axis while beside it. */
const CHECKER_REACH = CHECKER_R + DIE_HALF * Math.SQRT2;
/** Times per step the corner impulses are re-solved, so they settle on a shared answer. */
const VELOCITY_PASSES = 8;
/** Times per step the contact constraints are re-solved, so one fix cannot undo another. */
const SOLVER_PASSES = 4;
/** A die on the felt slower than this, and turning slower than `REST_SPIN`, is done rolling. */
const REST_SPEED = 0.3;
const REST_SPIN = 2;
const SETTLE_TIME = 0.22;
/** A die still moving this long after the throw is put to rest where it is. */
const MAX_TIME = 3.2;
/** Slowest a corner may strike something and still be heard, in units per second. */
const KNOCK_SPEED = 1.2;
/** Steps a die stays quiet after a knock, so one landing is not heard as a buzz. */
const KNOCK_GAP = 6;

const UP = new Vector3(0, 1, 0);

/** Outward normal of the face showing each value. Opposite faces add up to seven. */
export const FACE_NORMALS: Record<number, Vector3> = {
  1: new Vector3(0, 1, 0),
  6: new Vector3(0, -1, 0),
  2: new Vector3(0, 0, 1),
  5: new Vector3(0, 0, -1),
  3: new Vector3(1, 0, 0),
  4: new Vector3(-1, 0, 0),
};

/** A checker the dice can bounce off or land on: a cylinder standing on the board. */
export interface Obstacle {
  x: number;
  z: number;
  /** Height of its top face above the playfield. */
  top: number;
}

export interface DiePath {
  /** Seven numbers per step: position x, y, z, then quaternion x, y, z, w. */
  frames: Float32Array;
  /**
   * How the pips are turned inside the tumbling body. Chosen after the simulation, so that
   * whichever face ended up on top is the one showing the wanted value.
   */
  faces: Quaternion;
}

/** A die striking the felt, a rim, a checker or another die: something to be heard. */
export interface DiceKnock {
  step: number;
  /** How fast the die met what it struck, in units per second. */
  speed: number;
}

export interface DiceThrow {
  steps: number;
  dice: DiePath[];
  /** Every audible knock of every die, in step order. */
  knocks: DiceKnock[];
}

interface Body extends Rigid {
  state: "moving" | "settling" | "rest";
  /** A corner rested on the felt during this step. */
  onFelt: boolean;
  /** The checker a corner rested on during this step, if any. */
  perch: Obstacle | null;
  settleFrom: Quaternion;
  settleTo: Quaternion;
  settleT: number;
  /** The local axis that ended up pointing up. */
  top: Vector3;
  /** The value the die must show once it has landed. */
  value: number;
  /** Position and orientation at every step, seven numbers each. */
  frames: Float32Array;
  /** The hardest strike during this step, in units per second. */
  struck: number;
  /** The step of the latest knock that was heard. */
  knocked: number;
}

/** The orientation nearest to `q` that lies flat, and the local axis it puts on top. */
function flatten(q: Quaternion): { flat: Quaternion; top: Vector3 } {
  let best = UP;
  let bestY = -Infinity;
  for (const normal of Object.values(FACE_NORMALS)) {
    const y = normal.clone().applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      best = normal;
    }
  }
  const tilt = new Quaternion().setFromUnitVectors(best.clone().applyQuaternion(q), UP);
  return { flat: tilt.multiply(q).normalize(), top: best.clone() };
}

/** The value a die shows on top, for a body orientation and its pip rotation. */
export function shownValue(body: Quaternion, faces: Quaternion): number {
  let shown = 0;
  let bestY = -Infinity;
  for (const [value, normal] of Object.entries(FACE_NORMALS)) {
    const y = normal.clone().applyQuaternion(faces).applyQuaternion(body).y;
    if (y > bestY) {
      bestY = y;
      shown = Number(value);
    }
  }
  return shown;
}

/** Pip rotation that makes `value` show on the given local axis. */
export function facesFor(value: number, top: Vector3 = UP): Quaternion {
  return new Quaternion().setFromUnitVectors(must(FACE_NORMALS[value], `face ${value}`), top);
}

/** The checker the point is standing over, if any: the highest one. */
function under(obstacles: Obstacle[], x: number, z: number): Obstacle | null {
  let found: Obstacle | null = null;
  for (const o of obstacles) {
    if (Math.hypot(x - o.x, z - o.z) < CHECKER_R && (!found || o.top > found.top)) found = o;
  }
  return found;
}

/**
 * The checker a corner at this height would stand on, if any: the highest one under it
 * whose top the corner has not already sunk well below. A corner further down is beside
 * the stack, not on it.
 */
function footing(obstacles: Obstacle[], x: number, y: number, z: number): Obstacle | null {
  let found: Obstacle | null = null;
  for (const o of obstacles) {
    if (o.top > y + STEP_UP || (found && o.top <= found.top)) continue;
    if (Math.hypot(x - o.x, z - o.z) < CHECKER_R) found = o;
  }
  return found;
}

/**
 * Throws dice across the board and records where each one is at every step.
 *
 * Each die is a rigid cube: gravity pulls it, and its corners strike the felt, the rims and
 * the tops of checkers with an impulse and friction each, so a die tumbles over its edges
 * and skids to a stop the way a real one does. Checker sides and other dice push it away.
 * The outcome is not decided by any of this. Each die is painted afterwards so that the
 * face it happened to land on shows the value asked for, which is how the result can come
 * from the server while the throw still looks free.
 *
 * `side` is +1 when thrown from the near edge (white) and -1 from the far edge (black).
 */
export function simulateThrow(
  values: number[],
  side: 1 | -1,
  obstacles: Obstacle[],
  random: () => number,
): DiceThrow {
  const spread = (amount: number) => (random() - 0.5) * amount;

  const maxSteps = Math.ceil((MAX_TIME + SETTLE_TIME) / SIM_DT) + 2;
  const bodies: Body[] = values.map((value, i) => {
    // From the thrower's edge, to their right of the bar, a hand's height above the rim.
    const v = new Vector3(spread(3.5), 1.5 + random() * 2, -side * (5.5 + random() * 3));
    // Thrown dice turn mostly end over end, the way they leave the fingers.
    const roll = new Vector3(v.z, 0, -v.x).normalize().multiplyScalar(8 + random() * 10);
    return {
      p: new Vector3(side * (1.6 + i * 0.85 + spread(0.3)), 1.5 + random() * 0.6, side * 5),
      v,
      q: new Quaternion().setFromAxisAngle(
        new Vector3(spread(2) || 1, spread(2), spread(2)).normalize(),
        random() * Math.PI * 2,
      ),
      w: roll.add(new Vector3(spread(12), spread(12), spread(12))),
      state: "moving",
      onFelt: false,
      perch: null,
      settleFrom: new Quaternion(),
      settleTo: new Quaternion(),
      settleT: 0,
      top: new Vector3(0, 1, 0),
      value,
      frames: new Float32Array(maxSteps * 7),
      struck: 0,
      // Quiet at first: the dice leave the hand touching, which is no knock.
      knocked: 0,
    };
  });
  const pairs = bodies.flatMap((a, i) => bodies.slice(i + 1).map((b) => [a, b] as const));
  const spin = new Quaternion();
  const axis = new Vector3();
  const normal = new Vector3();
  const offsets: Vector3[] = [];
  const contacts: Contact[] = [];
  const knocks: DiceKnock[] = [];
  let steps = 0;
  const strike = (b: Body, speed: number) => {
    b.struck = Math.max(b.struck, speed);
  };
  /** Contact with a surface, noting how hard the corner came in. */
  const meet = (b: Body, r: Vector3, n: Vector3, surface: Surface) => {
    const c = contact(b, r, n, surface);
    strike(b, c.target / surface.bounce);
    contacts.push(c);
  };

  const settle = (b: Body) => {
    const { flat, top } = flatten(b.q);
    b.state = "settling";
    b.settleFrom.copy(b.q);
    b.settleTo.copy(flat);
    b.settleT = 0;
    b.top.copy(top);
    b.w.set(0, 0, 0);
  };

  /** Finds every corner of a die that leans on the felt, a checker top or a rim. */
  const touch = (b: Body) => {
    b.onFelt = false;
    b.perch = null;
    for (const r of corners(b.q, offsets)) {
      const x = b.p.x + r.x;
      const y = b.p.y + r.y;
      const z = b.p.z + r.z;
      const stand = footing(obstacles, x, y, z);
      if (y - (stand ? stand.top : 0) < SLOP) {
        meet(b, r, UP, FLOOR);
        if (stand) b.perch = stand;
        else b.onFelt = true;
      }
      if (Math.abs(x) > FIELD_HALF_W - SLOP) {
        normal.set(-Math.sign(x), 0, 0);
        meet(b, r, normal, RIM);
      }
      if (Math.abs(z) > FIELD_HALF_D - SLOP) {
        normal.set(0, 0, -Math.sign(z));
        meet(b, r, normal, RIM);
      }
    }
  };

  /** Keeps a die inside the rims, whatever its tilt, and stops it if it was heading out. */
  const holdInside = (b: Body) => {
    const e = extents(b.q);
    const limitX = FIELD_HALF_W - e.x;
    const limitZ = FIELD_HALF_D - e.z;
    if (Math.abs(b.p.x) > limitX) {
      const sign = Math.sign(b.p.x);
      b.p.x = sign * limitX;
      if (b.v.x * sign > 0) b.v.x *= -WALL_BOUNCE;
    }
    if (Math.abs(b.p.z) > limitZ) {
      const sign = Math.sign(b.p.z);
      b.p.z = sign * limitZ;
      if (b.v.z * sign > 0) b.v.z *= -WALL_BOUNCE;
    }
  };

  /** Pushes a die out of the side of any checker it is level with. */
  const holdOffCheckers = (b: Body) => {
    const bottom = b.p.y - extents(b.q).y;
    for (const o of obstacles) {
      if (bottom > o.top - 0.03) continue;
      normal.set(b.p.x - o.x, 0, b.p.z - o.z);
      let distance = normal.length();
      if (distance >= CHECKER_REACH) continue;
      if (distance < 1e-6) {
        normal.set(1, 0, 0);
        distance = 0;
      } else normal.divideScalar(distance);
      b.p.addScaledVector(normal, CHECKER_REACH - distance);
      const into = b.v.dot(normal);
      if (into < 0) {
        strike(b, -into);
        b.v.addScaledVector(normal, -1.4 * into);
      }
    }
  };

  /** Pushes two dice apart. A die at rest stays put and the other takes the whole push. */
  const holdApart = (a: Body, b: Body) => {
    const aFree = a.state !== "rest";
    const bFree = b.state !== "rest";
    if (!aFree && !bFree) return;
    normal.subVectors(b.p, a.p);
    let distance = normal.length();
    // Nothing closer than a die's own diagonal can be decided without looking at the tilt.
    if (distance >= DIE_HALF * 2 * Math.sqrt(3)) return;
    if (distance < 1e-6) {
      normal.set(1, 0, 0);
      distance = 0;
    } else normal.divideScalar(distance);
    const touching = reachAlong(a.q, normal) + reachAlong(b.q, normal) + PAIR_GAP;
    if (distance >= touching) return;
    const overlap = touching - distance;
    const share = aFree && bFree ? 0.5 : 1;
    if (aFree) a.p.addScaledVector(normal, -overlap * share);
    if (bFree) b.p.addScaledVector(normal, overlap * share);
    const closing = (bFree ? b.v.dot(normal) : 0) - (aFree ? a.v.dot(normal) : 0);
    if (closing >= 0) return;
    strike(a, -closing);
    strike(b, -closing);
    const impulse = (-1.5 * closing) / (aFree && bFree ? 2 : 1);
    if (aFree) a.v.addScaledVector(normal, -impulse);
    if (bFree) b.v.addScaledVector(normal, impulse);
  };

  /** Lifts a tumbling die so that no corner ends the step inside the felt or a checker. */
  const standOn = (b: Body) => {
    let lift = -Infinity;
    for (const r of corners(b.q, offsets)) {
      const stand = footing(obstacles, b.p.x + r.x, b.p.y + r.y, b.p.z + r.z);
      lift = Math.max(lift, (stand ? stand.top : 0) - r.y);
    }
    if (b.p.y < lift) b.p.y = lift;
  };

  for (; steps < maxSteps; steps++) {
    const time = steps * SIM_DT;

    // Forces, then the corner impulses that answer them.
    contacts.length = 0;
    for (const b of bodies) {
      if (b.state !== "moving") continue;
      b.v.y += GRAVITY * SIM_DT;
      touch(b);
    }
    for (let pass = 0; pass < VELOCITY_PASSES; pass++) {
      for (const c of contacts) solve(c);
    }
    for (const b of bodies) {
      // Never come to rest on a checker: slide off it.
      if (b.state !== "moving" || !b.perch) continue;
      normal.set(b.p.x - b.perch.x, 0, b.p.z - b.perch.z);
      if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0);
      b.v.addScaledVector(normal.normalize(), 9 * SIM_DT);
    }

    // Motion.
    for (const b of bodies) {
      if (b.state === "moving") {
        b.p.addScaledVector(b.v, SIM_DT);
        const speed = b.w.length();
        if (speed > 1e-6) {
          spin.setFromAxisAngle(axis.copy(b.w).divideScalar(speed), speed * SIM_DT);
          b.q.premultiply(spin).normalize();
        }
      } else if (b.state === "settling") {
        b.settleT = Math.min(1, b.settleT + SIM_DT / SETTLE_TIME);
        b.q.slerpQuaternions(b.settleFrom, b.settleTo, b.settleT);
        b.v.multiplyScalar(0.9);
        b.v.y = 0;
        b.p.x += b.v.x * SIM_DT;
        b.p.z += b.v.z * SIM_DT;
      }
    }

    // Contacts. Solved several times over, because fixing one can break another; the rims
    // go last so that they always win.
    for (let pass = 0; pass < SOLVER_PASSES; pass++) {
      for (const [a, b] of pairs) holdApart(a, b);
      for (const b of bodies) {
        if (b.state === "rest") continue;
        holdOffCheckers(b);
        holdInside(b);
      }
    }

    // The felt, or the top of a checker. Last of all, so nothing ends a step below it.
    for (const b of bodies) {
      if (b.state === "settling") {
        const ground = under(obstacles, b.p.x, b.p.z);
        b.p.y = (ground ? ground.top : 0) + extents(b.q).y;
        if (b.settleT >= 1) {
          b.state = "rest";
          b.v.set(0, 0, 0);
        }
      } else if (b.state === "moving") {
        standOn(b);
        const still = b.v.length() < REST_SPEED && b.w.length() < REST_SPIN;
        if ((b.onFelt && !b.perch && still) || time > MAX_TIME) settle(b);
      }
    }

    for (const b of bodies) {
      b.frames.set([b.p.x, b.p.y, b.p.z, b.q.x, b.q.y, b.q.z, b.q.w], steps * 7);
      if (b.struck >= KNOCK_SPEED && steps - b.knocked >= KNOCK_GAP) {
        knocks.push({ step: steps, speed: b.struck });
        b.knocked = steps;
      }
      b.struck = 0;
    }
    if (bodies.every((b) => b.state === "rest")) {
      steps++;
      break;
    }
  }

  return {
    steps,
    dice: bodies.map((b) => ({
      frames: b.frames.subarray(0, steps * 7),
      faces: facesFor(b.value, b.top),
    })),
    knocks,
  };
}
