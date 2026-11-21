import { Matrix4, type Quaternion, Vector3 } from "three";

/** Half the edge of a die. */
export const DIE_HALF = 0.26;
/**
 * Inverse moment of inertia of a solid cube of unit mass, about any axis through its centre:
 * a cube's inertia is the same in every direction, so a single number does.
 */
const INV_INERTIA = 1.5 / (DIE_HALF * DIE_HALF);

/** A die as a rigid body of unit mass. */
export interface Rigid {
  p: Vector3;
  v: Vector3;
  q: Quaternion;
  /** Angular velocity, in world axes. */
  w: Vector3;
}

/** The eight corners of a die relative to its centre, in its own axes. */
const CORNERS = Array.from(
  { length: 8 },
  (_, c) => new Vector3(c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1),
).map((corner) => corner.multiplyScalar(DIE_HALF));

/** Where each corner of a die turned by `q` lies relative to its centre, in world axes. */
export function corners(q: Quaternion, out: Vector3[]): Vector3[] {
  CORNERS.forEach((corner, i) => {
    (out[i] ??= new Vector3()).copy(corner).applyQuaternion(q);
  });
  return out;
}

const matrix = new Matrix4();
const reach = { x: 0, y: 0, z: 0 };
/**
 * How far a cube turned by `q` extends from its centre along each world axis. The y value
 * is how high the centre sits above the surface it stands on.
 */
export function extents(q: Quaternion): { x: number; y: number; z: number } {
  const e = matrix.makeRotationFromQuaternion(q).elements;
  reach.x = DIE_HALF * (Math.abs(e[0]) + Math.abs(e[4]) + Math.abs(e[8]));
  reach.y = DIE_HALF * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
  reach.z = DIE_HALF * (Math.abs(e[2]) + Math.abs(e[6]) + Math.abs(e[10]));
  return reach;
}

/**
 * How far a cube turned by `q` reaches from its centre in the direction `n` (a unit vector).
 * Two dice touch along the line between their centres exactly when the distance between
 * the centres equals the sum of their reaches along it, so they neither pass through each
 * other nor bounce off thin air.
 */
export function reachAlong(q: Quaternion, n: Vector3): number {
  const e = matrix.makeRotationFromQuaternion(q).elements;
  return (
    DIE_HALF *
    (Math.abs(n.x * e[0] + n.y * e[1] + n.z * e[2]) +
      Math.abs(n.x * e[4] + n.y * e[5] + n.z * e[6]) +
      Math.abs(n.x * e[8] + n.y * e[9] + n.z * e[10]))
  );
}

/**
 * One corner of a die pressing on a surface: the felt, a rim or the top of a checker.
 * Its impulses add up over several passes, so a die standing on several corners at once
 * is held up by all of them together instead of being kicked by each in turn.
 */
export interface Contact {
  body: Rigid;
  /** From the centre of the die to the corner, in world axes. */
  r: Vector3;
  /** Out of the surface. */
  n: Vector3;
  /** Normal speed the corner should leave with: a bounce after a hard hit, none after a soft one. */
  target: number;
  /** How much impulse it takes to change the corner's normal speed by one. */
  mass: number;
  friction: number;
  /** Impulse pushed along the normal so far. Never negative: a surface cannot pull. */
  pushed: number;
  /** Friction impulse applied so far, along the surface. */
  rubbed: Vector3;
}

const point = new Vector3();
const torque = new Vector3();
const slide = new Vector3();
const change = new Vector3();

/** How fast the point of the body at offset `r` is moving. */
function velocityAt(body: Rigid, r: Vector3, out: Vector3): Vector3 {
  return out.crossVectors(body.w, r).add(body.v);
}

/** Pushes the body at offset `r`: it speeds up, and spins about its centre. */
function push(body: Rigid, r: Vector3, impulse: Vector3): void {
  body.v.add(impulse);
  body.w.addScaledVector(torque.crossVectors(r, impulse), INV_INERTIA);
}

/** The effort it takes to move the point at `r` along `n`: one for the body, more for its spin. */
function stiffness(r: Vector3, n: Vector3): number {
  const along = r.dot(n);
  return 1 + INV_INERTIA * (r.lengthSq() - along * along);
}

/** What a die strikes. */
export interface Surface {
  /** Share of a hard hit's speed a corner gives back. */
  bounce: number;
  friction: number;
}

/** A corner arriving slower than this stops dead instead of bouncing, so dice do not buzz. */
const HARD_SPEED = 0.6;

/** A corner touching a surface, ready to be solved. */
export function contact(body: Rigid, r: Vector3, n: Vector3, surface: Surface): Contact {
  const approach = velocityAt(body, r, point).dot(n);
  return {
    body,
    r: r.clone(),
    n: n.clone(),
    target: approach < -HARD_SPEED ? -approach * surface.bounce : 0,
    mass: 1 / stiffness(r, n),
    friction: surface.friction,
    pushed: 0,
    rubbed: new Vector3(),
  };
}

/** One pass over a contact: stop the corner going into the surface, then rub against its sliding. */
export function solve(c: Contact): void {
  const { body, r, n } = c;
  const speed = velocityAt(body, r, point).dot(n);
  const pushed = Math.max(0, c.pushed + (c.target - speed) * c.mass);
  push(body, r, change.copy(n).multiplyScalar(pushed - c.pushed));
  c.pushed = pushed;

  velocityAt(body, r, point);
  slide.copy(point).addScaledVector(n, -point.dot(n));
  const sliding = slide.length();
  if (sliding < 1e-9) return;
  slide.divideScalar(sliding);
  // The friction that would stop the slide outright, held to what the push allows.
  change
    .copy(slide)
    .multiplyScalar(-sliding / stiffness(r, slide))
    .add(c.rubbed);
  const limit = c.friction * c.pushed;
  if (change.length() > limit) change.setLength(limit);
  slide.subVectors(change, c.rubbed);
  c.rubbed.copy(change);
  push(body, r, slide);
}
