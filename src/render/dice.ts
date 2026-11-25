import { gsap } from "gsap";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { must } from "../core/must.ts";
import {
  DIE_HALF,
  type DiceThrow,
  FACE_NORMALS,
  type Obstacle,
  SIM_DT,
  simulateThrow,
} from "./diceSim.ts";
import type { Lens } from "./stage.ts";

/** Pip positions on a 3 by 3 grid, per face value. */
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

/** Values in the order a box lists its faces: +x, -x, +y, -y, +z, -z. See `FACE_NORMALS`. */
const FACE_ORDER = [3, 4, 1, 6, 2, 5];

function faceTexture(value: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#f6efdc";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#1a1512";
    for (const [column, row] of must(PIPS[value], `pips for ${value}`)) {
      context.beginPath();
      context.arc(size * (0.26 + column * 0.24), size * (0.26 + row * 0.24), size * 0.085, 0, 7);
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let shared: { geometry: THREE.BufferGeometry; materials: THREE.Material[] } | null = null;
/** Built on first use: drawing the faces needs a canvas, which only a browser has. */
function parts() {
  shared ??= {
    geometry: new RoundedBoxGeometry(DIE_HALF * 2, DIE_HALF * 2, DIE_HALF * 2, 3, 0.07),
    materials: FACE_ORDER.map(
      (value) => new THREE.MeshStandardMaterial({ map: faceTexture(value), roughness: 0.35 }),
    ),
  };
  return shared;
}

/** Where a die goes once it has been shown off: a spot in client pixels, and its size there. */
export interface DieSlot {
  x: number;
  y: number;
  size: number;
}

/** World units in front of the camera at which the dice are held up to be read. */
const NEAR = 12;
/** Seconds the dice rise from the board to the camera. */
const RISE = 0.55;
/** Seconds they stay there, readable. */
const HOLD = 0.85;
/** Seconds they take to fly into the dice shown at the top of the screen. */
const LEAVE = 0.42;
/** Size of a held die, as a share of the canvas height. */
const HELD_SIZE = 0.22;

const FACING_VIEWER = new THREE.Vector3(0, 0, 1);
const VERTICAL = new THREE.Vector3(0, 1, 0);

interface Die {
  /** Moves and tumbles as simulated. */
  body: THREE.Group;
  /** The painted cube, turned inside the body so the right value ends on top. */
  cube: THREE.Mesh;
  value: number;
}

/** One die's way from the board to the camera, and on to its slot at the top of the screen. */
interface Leg {
  from: THREE.Vector3;
  fromTurn: THREE.Quaternion;
  near: THREE.Vector3;
  nearTurn: THREE.Quaternion;
  nearScale: number;
  slot: THREE.Vector3;
  slotTurn: THREE.Quaternion;
  slotScale: number;
}

/**
 * The dice of a throw. They tumble across the board, are held up to the camera for a moment
 * so the roll can be read, and then fly off into the dice shown at the top of the screen,
 * leaving the board clear for the checkers.
 */
export class DiceView {
  readonly group = new THREE.Group();
  private dice: Die[] = [];
  private playback: gsap.core.Timeline | null = null;
  private shown: number[] = [];
  private readonly lens: Lens;
  private readonly slots: (count: number) => DieSlot[];
  /** Called as a thrown die strikes something, with how fast it was going, to be heard. */
  onKnock: ((speed: number) => void) | null = null;

  /** `slots` says where each of that many dice should end up, in client pixels. */
  constructor(lens: Lens, slots: (count: number) => DieSlot[]) {
    this.lens = lens;
    this.slots = slots;
  }

  /** The values of the latest throw, in order. Empty when there is none. */
  get values(): number[] {
    return this.shown;
  }

  /**
   * Throws dice that come to rest showing `values`, in that order. `onLanded` is called
   * once they have been shown off and are gone from the board; not at all if the dice are
   * cleared, shown or thrown again first.
   */
  throw(
    values: number[],
    side: 1 | -1,
    obstacles: Obstacle[],
    random: () => number,
    onLanded: () => void,
  ): void {
    this.clear();
    const thrown = simulateThrow(values, side, obstacles, random);
    this.dice = thrown.dice.map((path, i) => this.spawn(path.faces, must(values[i], `value ${i}`)));
    this.shown = [...values];
    const clock = { step: 0 };
    const place = () => this.pose(thrown, Math.round(clock.step));
    place();
    this.playback = gsap.timeline({
      onComplete: () => {
        this.playback = null;
        this.group.clear();
        this.dice = [];
        onLanded();
      },
    });
    this.playback.to(clock, {
      step: thrown.steps - 1,
      duration: thrown.steps * SIM_DT,
      ease: "none",
      onUpdate: place,
    });
    for (const { step, speed } of thrown.knocks) {
      this.playback.call(() => this.onKnock?.(speed), [], step * SIM_DT);
    }
    this.showOff(this.playback);
  }

  /** Takes note of dice already thrown, without a throw: for a game joined mid-turn. */
  show(values: number[]): void {
    this.clear();
    this.shown = [...values];
  }

  /** Takes the dice away at once, wherever they are. */
  clear(): void {
    this.playback?.kill();
    this.playback = null;
    this.group.clear();
    this.dice = [];
    this.shown = [];
  }

  private spawn(faces: THREE.Quaternion, value: number): Die {
    const { geometry, materials } = parts();
    const cube = new THREE.Mesh(geometry, materials);
    cube.castShadow = true;
    cube.quaternion.copy(faces);
    const body = new THREE.Group();
    body.add(cube);
    this.group.add(body);
    return { body, cube, value };
  }

  private pose(thrown: DiceThrow, step: number): void {
    this.dice.forEach(({ body }, i) => {
      const f = must(thrown.dice[i], `die ${i}`).frames;
      const o = step * 7;
      body.position.fromArray(f, o);
      body.quaternion.fromArray(f, o + 3);
    });
  }

  /**
   * Adds the rise to the camera, the pause there and the flight to the top of the screen.
   * Where everything goes is worked out only once the dice have landed, so a window resized
   * in the meantime is taken into account.
   */
  private showOff(timeline: gsap.core.Timeline): void {
    const legs: Leg[] = [];
    const turn = new THREE.Quaternion();
    const t = { rise: 0, sway: 0, leave: 0 };

    const plan = () => {
      const rect = this.lens.bounds();
      const pixel = this.lens.pixel(NEAR);
      const count = this.dice.length;
      const held = Math.min(rect.height * HELD_SIZE, (rect.width * 0.7) / (count * 1.5));
      const slots = this.slots(count);
      this.group.updateWorldMatrix(true, false);
      // Turns from the world into the group the dice live in, which shakes with the board.
      const intoGroup = this.group.getWorldQuaternion(new THREE.Quaternion()).invert();
      const at = (x: number, y: number) =>
        this.group.worldToLocal(this.lens.point(x, y, NEAR, new THREE.Vector3()));
      legs.length = 0;
      this.dice.forEach((die, i) => {
        // The cube turned so the rolled value faces the viewer square on, then tilted by
        // `lean` so that it still reads as a cube.
        const square = (lean: THREE.Euler) =>
          intoGroup
            .clone()
            .multiply(this.lens.facing)
            .multiply(new THREE.Quaternion().setFromEuler(lean))
            .multiply(
              new THREE.Quaternion().setFromUnitVectors(
                FACE_NORMALS[die.value] ?? VERTICAL,
                FACING_VIEWER,
              ),
            )
            .multiply(die.cube.quaternion.clone().invert());
        const slot = slots[i] ?? { x: rect.left + 40 * (i + 1), y: rect.top, size: 30 };
        legs.push({
          from: die.body.position.clone(),
          fromTurn: die.body.quaternion.clone(),
          near: at(
            rect.left + rect.width / 2 + (i - (count - 1) / 2) * held * 1.5,
            rect.top + rect.height * 0.45,
          ),
          nearTurn: square(new THREE.Euler(-0.32, i % 2 === 0 ? 0.38 : -0.38, 0)),
          nearScale: (held * pixel) / (DIE_HALF * 2),
          slot: at(slot.x, slot.y),
          slotTurn: square(new THREE.Euler()),
          slotScale: (slot.size * pixel * 0.8) / (DIE_HALF * 2),
        });
      });
    };

    const draw = () => {
      this.dice.forEach(({ body }, i) => {
        const leg = legs[i];
        if (!leg) return;
        if (t.leave > 0) {
          body.position.lerpVectors(leg.near, leg.slot, t.leave);
          body.quaternion.slerpQuaternions(leg.nearTurn, leg.slotTurn, t.leave);
          body.scale.setScalar(THREE.MathUtils.lerp(leg.nearScale, leg.slotScale, t.leave));
          return;
        }
        body.position.lerpVectors(leg.from, leg.near, t.rise);
        body.quaternion.slerpQuaternions(leg.fromTurn, leg.nearTurn, t.rise);
        body.scale.setScalar(THREE.MathUtils.lerp(1, leg.nearScale, t.rise));
        // A half turn that unwinds on the way up, then a gentle sway while held.
        const direction = i % 2 === 0 ? 1 : -1;
        const angle = (1 - t.rise) * Math.PI * direction + Math.sin(t.sway * Math.PI * 2) * 0.1;
        body.quaternion.premultiply(turn.setFromAxisAngle(VERTICAL, angle));
      });
    };

    timeline
      .to(t, { rise: 1, duration: RISE, ease: "power3.out", onStart: plan, onUpdate: draw })
      .to(t, { sway: 1, duration: HOLD, ease: "sine.inOut", onUpdate: draw })
      .to(t, { leave: 1, duration: LEAVE, ease: "power2.in", onUpdate: draw });
  }
}
