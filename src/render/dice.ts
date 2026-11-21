import gsap from "gsap";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  DIE_HALF,
  type DiceThrow,
  facesFor,
  type Obstacle,
  SIM_DT,
  simulateThrow,
} from "./diceSim.ts";

/** Pip positions on a 3 by 3 grid, per face value. */
const PIPS: Record<number, [number, number][]> = {
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
    for (const [column, row] of PIPS[value]) {
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

interface Die {
  /** Moves and tumbles as simulated. */
  body: THREE.Group;
  /** The painted cube, turned inside the body so the right value ends on top. */
  cube: THREE.Mesh;
}

/** The dice on the board: thrown with an animation, or simply set down. */
export class DiceView {
  readonly group = new THREE.Group();
  private dice: Die[] = [];
  private playback: gsap.core.Tween | null = null;
  private shown: number[] = [];

  /** The values the dice on the board show, in order. Empty when there are none. */
  get values(): number[] {
    return this.shown;
  }

  /**
   * Throws dice that come to rest showing `values`, in that order. `onLanded` is called
   * once the animation has actually finished; not at all if the dice are cleared, shown or
   * thrown again first.
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
    this.dice = thrown.dice.map((path) => this.spawn(path.faces));
    this.shown = [...values];
    const clock = { step: 0 };
    const place = () => this.pose(thrown, Math.round(clock.step));
    place();
    this.playback = gsap.to(clock, {
      step: thrown.steps - 1,
      duration: thrown.steps * SIM_DT,
      ease: "none",
      onUpdate: place,
      onComplete: () => {
        this.playback = null;
        onLanded();
      },
    });
  }

  /** Sets dice down at rest showing `values`, without a throw: for a game joined mid-turn. */
  show(values: number[], side: 1 | -1): void {
    this.clear();
    this.shown = [...values];
    this.dice = values.map((value, i) => {
      const die = this.spawn(facesFor(value));
      die.body.position.set(side * (1.7 + i * 0.75), DIE_HALF, 0);
      die.body.rotation.y = i * 0.6 + 0.3;
      return die;
    });
  }

  /** Takes the dice off the board. */
  clear(): void {
    this.playback?.kill();
    this.playback = null;
    for (const { body } of this.dice) {
      gsap.to(body.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: 0.18,
        ease: "power2.in",
        onComplete: () => this.group.remove(body),
      });
    }
    this.dice = [];
    this.shown = [];
  }

  private spawn(faces: THREE.Quaternion): Die {
    const { geometry, materials } = parts();
    const cube = new THREE.Mesh(geometry, materials);
    cube.castShadow = true;
    cube.quaternion.copy(faces);
    const body = new THREE.Group();
    body.add(cube);
    this.group.add(body);
    return { body, cube };
  }

  private pose(thrown: DiceThrow, step: number): void {
    this.dice.forEach(({ body }, i) => {
      const f = thrown.dice[i].frames;
      const o = step * 7;
      body.position.set(f[o], f[o + 1], f[o + 2]);
      body.quaternion.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]);
    });
  }
}
