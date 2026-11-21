import { Matrix4, Quaternion, Vector3 } from "three";
import { CHECKER_R, FIELD_HALF_D, FIELD_HALF_W } from "./layout.ts";

/** Half the edge of a die. */
export const DIE_HALF = 0.26;
export const SIM_DT = 1 / 120;

const GRAVITY = -30;
const FLOOR_BOUNCE = 0.42;
const WALL_BOUNCE = 0.55;
/** The sliver of air left between two dice that touch. */
const PAIR_GAP = 0.004;
/** Closest a die's centre may come to a checker's axis while beside it. */
const CHECKER_REACH = CHECKER_R + DIE_HALF * Math.SQRT2;
/** Times per step the contact constraints are re-solved, so one fix cannot undo another. */
const SOLVER_PASSES = 4;
const SETTLE_TIME = 0.22;
/** A die still moving this long after the throw is put to rest where it is. */
const MAX_TIME = 3.2;

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

export interface DiceThrow {
  steps: number;
  dice: DiePath[];
}

interface Body {
  p: Vector3;
  v: Vector3;
  q: Quaternion;
  w: Vector3;
  state: "moving" | "settling" | "rest";
  settleFrom: Quaternion;
  settleTo: Quaternion;
  settleT: number;
  /** The local axis that ended up pointing up. */
  top: Vector3;
}

const matrix = new Matrix4();
const reach = { x: 0, y: 0, z: 0 };
/**
 * How far a cube turned by `q` extends from its centre along each world axis. The y value
 * is how high the centre sits above the surface it stands on.
 */
function extents(q: Quaternion): { x: number; y: number; z: number } {
  const e = matrix.makeRotationFromQuaternion(q).elements;
  reach.x = DIE_HALF * (Math.abs(e[0]) + Math.abs(e[4]) + Math.abs(e[8]));
  reach.y = DIE_HALF * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
  reach.z = DIE_HALF * (Math.abs(e[2]) + Math.abs(e[6]) + Math.abs(e[10]));
  return reach;
}

const along = new Matrix4();
/**
 * How far a cube turned by `q` reaches from its centre in the direction `n` (a unit vector).
 * Two dice touch along the line between their centres exactly when the distance between
 * the centres equals the sum of their reaches along it, so they neither pass through each
 * other nor bounce off thin air.
 */
function reachAlong(q: Quaternion, n: Vector3): number {
  const e = along.makeRotationFromQuaternion(q).elements;
  return (
    DIE_HALF *
    (Math.abs(n.x * e[0] + n.y * e[1] + n.z * e[2]) +
      Math.abs(n.x * e[4] + n.y * e[5] + n.z * e[6]) +
      Math.abs(n.x * e[8] + n.y * e[9] + n.z * e[10]))
  );
}

/** The orientation nearest to `q` that lies flat, and the local axis it puts on top. */
function flatten(q: Quaternion): { flat: Quaternion; top: Vector3 } {
  let best = FACE_NORMALS[1];
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
  return new Quaternion().setFromUnitVectors(FACE_NORMALS[value], top);
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
 * Throws dice across the board and records where each one is at every step.
 *
 * The motion is a small rigid-body approximation: gravity, bounces off the felt, the rims,
 * the checkers and the other dice, and spin that follows the roll. The outcome is not
 * decided by it. Each die is painted afterwards so that the face it happened to land on
 * shows the value asked for, which is how the result can come from the server while the
 * throw still looks free.
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

  const bodies: Body[] = values.map((_, i) => ({
    // From the thrower's edge, to their right of the bar, a hand's height above the rim.
    p: new Vector3(side * (1.6 + i * 0.85 + spread(0.3)), 1.5 + random() * 0.6, side * 5),
    v: new Vector3(spread(3.5), 1.5 + random() * 2, -side * (5.5 + random() * 3)),
    q: new Quaternion().setFromAxisAngle(
      new Vector3(spread(2) || 1, spread(2), spread(2)).normalize(),
      random() * Math.PI * 2,
    ),
    w: new Vector3(spread(24), spread(24), spread(24)),
    state: "moving",
    settleFrom: new Quaternion(),
    settleTo: new Quaternion(),
    settleT: 0,
    top: new Vector3(0, 1, 0),
  }));

  const maxSteps = Math.ceil((MAX_TIME + SETTLE_TIME) / SIM_DT) + 2;
  const frames = bodies.map(() => new Float32Array(maxSteps * 7));
  const spin = new Quaternion();
  const axis = new Vector3();
  const normal = new Vector3();
  let steps = 0;

  const settle = (b: Body) => {
    const { flat, top } = flatten(b.q);
    b.state = "settling";
    b.settleFrom.copy(b.q);
    b.settleTo.copy(flat);
    b.settleT = 0;
    b.top.copy(top);
    b.w.set(0, 0, 0);
  };

  /** Keeps a die inside the rims, whatever its tilt, and bounces it if it was heading out. */
  const holdInside = (b: Body) => {
    const e = extents(b.q);
    const limitX = FIELD_HALF_W - e.x;
    const limitZ = FIELD_HALF_D - e.z;
    if (Math.abs(b.p.x) > limitX) {
      const sign = Math.sign(b.p.x);
      b.p.x = sign * limitX;
      if (b.v.x * sign > 0) {
        b.v.x *= -WALL_BOUNCE;
        b.w.multiplyScalar(0.7);
      }
    }
    if (Math.abs(b.p.z) > limitZ) {
      const sign = Math.sign(b.p.z);
      b.p.z = sign * limitZ;
      if (b.v.z * sign > 0) {
        b.v.z *= -WALL_BOUNCE;
        b.w.multiplyScalar(0.7);
      }
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
      if (into < 0) b.v.addScaledVector(normal, -1.4 * into);
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
    const impulse = (-1.5 * closing) / (aFree && bFree ? 2 : 1);
    if (aFree) a.v.addScaledVector(normal, -impulse);
    if (bFree) b.v.addScaledVector(normal, impulse);
  };

  for (; steps < maxSteps; steps++) {
    const time = steps * SIM_DT;

    // Motion.
    for (const b of bodies) {
      if (b.state === "moving") {
        b.v.y += GRAVITY * SIM_DT;
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
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) holdApart(bodies[i], bodies[j]);
      }
      for (const b of bodies) {
        if (b.state === "rest") continue;
        holdOffCheckers(b);
        holdInside(b);
      }
    }

    // The felt, or the top of a checker. Last of all, so nothing ends a step below it.
    for (const b of bodies) {
      if (b.state === "rest") continue;
      const ground = under(obstacles, b.p.x, b.p.z);
      const rest = (ground ? ground.top : 0) + extents(b.q).y;
      if (b.state === "settling") {
        b.p.y = rest;
        if (b.settleT >= 1) {
          b.state = "rest";
          b.v.set(0, 0, 0);
        }
        continue;
      }
      if (b.p.y <= rest) {
        b.p.y = rest;
        if (b.v.y < 0) {
          const hard = b.v.y < -1.2;
          b.v.y = hard ? -b.v.y * FLOOR_BOUNCE : 0;
          if (hard) {
            b.v.x *= 0.82;
            b.v.z *= 0.82;
          }
        }
        const drag = Math.max(0, 1 - 2.6 * SIM_DT);
        b.v.x *= drag;
        b.v.z *= drag;
        // On the ground the spin follows the roll.
        const grip = Math.min(1, 14 * SIM_DT);
        b.w.x += (b.v.z / DIE_HALF - b.w.x) * grip;
        b.w.z += (-b.v.x / DIE_HALF - b.w.z) * grip;
        b.w.y *= 1 - 3 * SIM_DT;
        if (ground) {
          // Never come to rest on a checker: slide off it.
          normal.set(b.p.x - ground.x, 0, b.p.z - ground.z);
          if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0);
          b.v.addScaledVector(normal.normalize(), 9 * SIM_DT);
        } else if (Math.hypot(b.v.x, b.v.z) < 0.7 && Math.abs(b.v.y) < 0.2) {
          settle(b);
        }
      }
      if (time > MAX_TIME && b.state === "moving") settle(b);
    }

    bodies.forEach((b, i) => {
      frames[i].set([b.p.x, b.p.y, b.p.z, b.q.x, b.q.y, b.q.z, b.q.w], steps * 7);
    });
    if (bodies.every((b) => b.state === "rest")) {
      steps++;
      break;
    }
  }

  return {
    steps,
    dice: bodies.map((b, i) => ({
      frames: frames[i].subarray(0, steps * 7),
      faces: facesFor(values[i], b.top),
    })),
  };
}
