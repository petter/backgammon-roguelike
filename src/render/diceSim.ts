import { Matrix4, Quaternion, Vector3 } from "three";
import { CHECKER_R, FIELD_HALF_D, FIELD_HALF_W } from "./layout.ts";

/** Half the edge of a die. */
export const DIE_HALF = 0.26;
export const SIM_DT = 1 / 120;

const GRAVITY = -30;
const FLOOR_BOUNCE = 0.42;
const WALL_BOUNCE = 0.55;
/** Dice collide with each other and with checkers as spheres of this radius. */
const BODY_R = 0.33;
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
/** How high the centre of a cube sits above the surface it stands on, given its tilt. */
function support(q: Quaternion): number {
  const e = matrix.makeRotationFromQuaternion(q).elements;
  return DIE_HALF * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
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
  const minX = -FIELD_HALF_W + DIE_HALF;
  const maxX = FIELD_HALF_W - DIE_HALF;
  const minZ = -FIELD_HALF_D + DIE_HALF;
  const maxZ = FIELD_HALF_D - DIE_HALF;
  const spread = (amount: number) => (random() - 0.5) * amount;

  const bodies: Body[] = values.map((_, i) => ({
    // From the thrower's edge, to their right of the bar, a hand's height above the rim.
    p: new Vector3(side * (1.6 + i * 0.85 + spread(0.3)), 1.5 + random() * 0.6, side * 5),
    v: new Vector3(spread(3.5), 1.5 + random() * 2, -side * (5.5 + random() * 3)),
    q: new Quaternion().setFromAxisAngle(
      new Vector3(spread(2), spread(2), spread(2)).normalize(),
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

  for (; steps < maxSteps; steps++) {
    const time = steps * SIM_DT;
    for (const b of bodies) {
      if (b.state === "rest") continue;
      const ground = under(obstacles, b.p.x, b.p.z);
      const floor = ground ? ground.top : 0;

      if (b.state === "settling") {
        b.settleT = Math.min(1, b.settleT + SIM_DT / SETTLE_TIME);
        b.q.slerpQuaternions(b.settleFrom, b.settleTo, b.settleT);
        b.v.multiplyScalar(0.9);
        b.p.x += b.v.x * SIM_DT;
        b.p.z += b.v.z * SIM_DT;
        b.p.y = floor + support(b.q);
        if (b.settleT >= 1) {
          b.state = "rest";
          b.v.set(0, 0, 0);
        }
        continue;
      }

      b.v.y += GRAVITY * SIM_DT;
      b.p.addScaledVector(b.v, SIM_DT);
      const speed = b.w.length();
      if (speed > 1e-6) {
        spin.setFromAxisAngle(axis.copy(b.w).divideScalar(speed), speed * SIM_DT);
        b.q.premultiply(spin).normalize();
      }

      // Rims.
      if (b.p.x < minX || b.p.x > maxX) {
        b.p.x = Math.min(maxX, Math.max(minX, b.p.x));
        b.v.x *= -WALL_BOUNCE;
        b.w.multiplyScalar(0.7);
      }
      if (b.p.z < minZ || b.p.z > maxZ) {
        b.p.z = Math.min(maxZ, Math.max(minZ, b.p.z));
        b.v.z *= -WALL_BOUNCE;
        b.w.multiplyScalar(0.7);
      }

      // The sides of checkers.
      const bottom = b.p.y - DIE_HALF;
      for (const o of obstacles) {
        if (bottom > o.top - 0.03) continue;
        normal.set(b.p.x - o.x, 0, b.p.z - o.z);
        const distance = normal.length();
        const reach = CHECKER_R + BODY_R * 0.8;
        if (distance >= reach || distance < 1e-6) continue;
        normal.divideScalar(distance);
        b.p.addScaledVector(normal, reach - distance);
        const into = b.v.dot(normal);
        if (into < 0) b.v.addScaledVector(normal, -1.4 * into);
      }

      // The felt, or the top of a checker.
      const rest = floor + support(b.q);
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

    // Dice against each other.
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        normal.subVectors(b.p, a.p);
        const distance = normal.length();
        const reach = BODY_R * 1.8;
        if (distance >= reach || distance < 1e-6) continue;
        normal.divideScalar(distance);
        const overlap = reach - distance;
        const aMoves = a.state === "moving";
        const bMoves = b.state === "moving";
        if (!aMoves && !bMoves) continue;
        // A die at rest stays put; the moving one takes the whole correction.
        const share = aMoves && bMoves ? 0.5 : 1;
        if (aMoves) a.p.addScaledVector(normal, -overlap * share);
        if (bMoves) b.p.addScaledVector(normal, overlap * share);
        const closing = (bMoves ? b.v.dot(normal) : 0) - (aMoves ? a.v.dot(normal) : 0);
        if (closing >= 0) continue;
        const impulse = (-1.5 * closing) / (aMoves && bMoves ? 2 : 1);
        if (aMoves) a.v.addScaledVector(normal, -impulse);
        if (bMoves) b.v.addScaledVector(normal, impulse);
      }
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
