import { gsap } from "gsap";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { must } from "../core/must.ts";
import { planShift } from "./diceShift.ts";
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

/** A throw: the values the dice land on, and the values played once something changed them. */
export interface DiceRoll {
  thrown: number[];
  /** The thrown values when nothing changed them. */
  played?: number[] | undefined;
}

/** World units in front of the camera at which the dice are held up to be read. */
const NEAR = 12;
/** Seconds the dice rise from the board to the camera. */
const RISE = 0.55;
/** Seconds they stay there, readable. */
const HOLD = 0.85;
/** Seconds held dice show the throw before something changes them. */
const SHIFT_AFTER = 0.45;
/** Seconds a changed die takes to roll one pip. */
const SHIFT_STEP = 0.32;
/** Seconds the changed dice stay held, readable, once they have all changed. */
const SHIFT_HOLD = 0.7;
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
  /** The faces it shows while held: the value thrown, then each pip it rolls to. */
  faces: number[];
  /** Its index among the dice played, or null when it is dropped while held. */
  end: number | null;
  /** Whether it was not thrown but appears while held. */
  added: boolean;
}

/** One die's way from the board to the camera, and on to its slot at the top of the screen. */
interface Leg {
  from: THREE.Vector3;
  fromTurn: THREE.Quaternion;
  near: THREE.Vector3;
  /** Held, showing each of the die's faces in turn. */
  nearTurns: THREE.Quaternion[];
  nearScale: number;
  slot: THREE.Vector3;
  slotTurn: THREE.Quaternion;
  slotScale: number;
}

/**
 * The dice of a throw. They tumble across the board, are held up to the camera for a moment
 * so the roll can be read, and then fly off into the dice shown at the top of the screen,
 * leaving the board clear for the checkers. When something changes the roll as it lands,
 * the held dice change in front of the viewer before they go.
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

  /** The values of the latest throw as played, in order. Empty when there is none. */
  get values(): number[] {
    return this.shown;
  }

  /**
   * Throws dice that come to rest showing `thrown`, in that order. When `played` differs,
   * the held dice then change into it, in that order: a die rolls down or up a pip at a
   * time, a die dropped shrinks away, a die added pops in. `onLanded` is called once they
   * have been shown off and are gone from the board; not at all if the dice are cleared,
   * shown or thrown again first.
   */
  throw(
    { thrown: values, played = values }: DiceRoll,
    side: 1 | -1,
    obstacles: Obstacle[],
    random: () => number,
    onLanded: () => void,
  ): void {
    this.clear();
    const thrown = simulateThrow(values, side, obstacles, random);
    const shift = planShift(values, played);
    this.dice = thrown.dice.map((path, i) => {
      const value = must(values[i], `value ${i}`);
      const plan = shift.thrown[i];
      return this.spawn(path.faces, plan?.faces ?? [value], plan ? plan.end : null, false);
    });
    for (const end of shift.added) {
      const value = must(played[end], `played ${end}`);
      const die = this.spawn(new THREE.Quaternion(), [value], end, true);
      die.body.visible = false;
      this.dice.push(die);
    }
    this.shown = [...played];
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

  private spawn(cubeTurn: THREE.Quaternion, faces: number[], end: number | null, added: boolean) {
    const { geometry, materials } = parts();
    const cube = new THREE.Mesh(geometry, materials);
    cube.castShadow = true;
    cube.quaternion.copy(cubeTurn);
    const body = new THREE.Group();
    body.add(cube);
    this.group.add(body);
    return { body, cube, faces, end, added } satisfies Die;
  }

  /** Places the thrown dice at one step of the simulation. Added dice are not on the board. */
  private pose(thrown: DiceThrow, step: number): void {
    thrown.dice.forEach((path, i) => {
      const body = this.dice[i]?.body;
      if (!body) return;
      const o = step * 7;
      body.position.fromArray(path.frames, o);
      body.quaternion.fromArray(path.frames, o + 3);
    });
  }

  /**
   * Adds the rise to the camera, the pause there, any change to the dice and the flight to
   * the top of the screen. Where everything goes is worked out only once the dice have
   * landed, so a window resized in the meantime is taken into account.
   */
  private showOff(timeline: gsap.core.Timeline): void {
    const legs: Leg[] = [];
    const turn = new THREE.Quaternion();
    const t = { rise: 0, sway: 0, shift: 0, leave: 0 };
    const steps = Math.max(0, ...this.dice.map((die) => die.faces.length - 1));
    const changes = steps > 0 || this.dice.some((die) => die.added || die.end === null);
    // Dice only dropped or added still take one step to go or come.
    const shiftSteps = changes ? Math.max(steps, 1) : 0;

    const plan = () => {
      const rect = this.lens.bounds();
      const pixel = this.lens.pixel(NEAR);
      const count = this.dice.length;
      const held = Math.min(rect.height * HELD_SIZE, (rect.width * 0.7) / (count * 1.5));
      const playedCount = this.dice.filter((die) => die.end !== null).length;
      const slots = this.slots(playedCount);
      this.group.updateWorldMatrix(true, false);
      // Turns from the world into the group the dice live in, which shakes with the board.
      const intoGroup = this.group.getWorldQuaternion(new THREE.Quaternion()).invert();
      const at = (x: number, y: number) =>
        this.group.worldToLocal(this.lens.point(x, y, NEAR, new THREE.Vector3()));
      legs.length = 0;
      this.dice.forEach((die, i) => {
        // The cube turned so `value` faces the viewer square on, then tilted by `lean` so
        // that it still reads as a cube.
        const square = (value: number, lean: THREE.Euler) =>
          intoGroup
            .clone()
            .multiply(this.lens.facing)
            .multiply(new THREE.Quaternion().setFromEuler(lean))
            .multiply(
              new THREE.Quaternion().setFromUnitVectors(
                FACE_NORMALS[value] ?? VERTICAL,
                FACING_VIEWER,
              ),
            )
            .multiply(die.cube.quaternion.clone().invert());
        const lean = new THREE.Euler(-0.32, i % 2 === 0 ? 0.38 : -0.38, 0);
        const last = must(die.faces.at(-1), "a face");
        const slot = slots[die.end ?? 0] ?? {
          x: rect.left + 40 * ((die.end ?? 0) + 1),
          y: rect.top,
          size: 30,
        };
        const near = at(
          rect.left + rect.width / 2 + (i - (count - 1) / 2) * held * 1.5,
          rect.top + rect.height * 0.45,
        );
        const nearTurns = die.faces.map((value) => square(value, lean));
        if (die.added) {
          // Not thrown: it waits, held, to pop in.
          die.body.position.copy(near);
          die.body.quaternion.copy(must(nearTurns[0], "a turn"));
        }
        legs.push({
          from: die.body.position.clone(),
          fromTurn: die.body.quaternion.clone(),
          near,
          nearTurns,
          nearScale: (held * pixel) / (DIE_HALF * 2),
          slot: at(slot.x, slot.y),
          slotTurn: square(last, new THREE.Euler()),
          slotScale: (slot.size * pixel * 0.8) / (DIE_HALF * 2),
        });
      });
    };

    /** The held turn of a die partway through rolling over its faces. */
    const heldTurn = (leg: Leg, out: THREE.Quaternion) => {
      const top = leg.nearTurns.length - 1;
      const k = Math.min(t.shift, top);
      const from = Math.floor(k);
      const a = must(leg.nearTurns[from], "a turn");
      const b = leg.nearTurns[Math.min(from + 1, top)] ?? a;
      return out.slerpQuaternions(a, b, gsap.parseEase("back.out(1.6)")(k - from));
    };

    const draw = () => {
      this.dice.forEach((die, i) => {
        const { body } = die;
        const leg = legs[i];
        if (!leg) return;
        if (t.leave > 0) {
          if (die.end === null) return;
          body.position.lerpVectors(leg.near, leg.slot, t.leave);
          body.quaternion.slerpQuaternions(heldTurn(leg, turn), leg.slotTurn, t.leave);
          body.scale.setScalar(THREE.MathUtils.lerp(leg.nearScale, leg.slotScale, t.leave));
          return;
        }
        if (die.added) {
          const grow = Math.min(t.shift, 1);
          body.visible = grow > 0;
          body.quaternion.copy(heldTurn(leg, turn));
          body.scale.setScalar(leg.nearScale * gsap.parseEase("back.out(2)")(grow));
          return;
        }
        body.position.lerpVectors(leg.from, leg.near, t.rise);
        body.quaternion.slerpQuaternions(leg.fromTurn, heldTurn(leg, turn), t.rise);
        let scale = THREE.MathUtils.lerp(1, leg.nearScale, t.rise);
        if (die.end === null) {
          // Dropped: it shrinks away.
          const gone = Math.min(t.shift, 1);
          scale *= 1 - gsap.parseEase("back.in(1.6)")(gone);
          body.visible = gone < 1;
        } else if (die.faces.length > 1 && t.shift < die.faces.length - 1) {
          // A small hop as it rolls over to the next face.
          scale *= 1 + 0.12 * Math.sin((t.shift % 1) * Math.PI);
        }
        body.scale.setScalar(Math.max(scale, 0));
        // A half turn that unwinds on the way up, then a gentle sway while held.
        const direction = i % 2 === 0 ? 1 : -1;
        const angle = (1 - t.rise) * Math.PI * direction + Math.sin(t.sway * Math.PI * 2) * 0.1;
        body.quaternion.premultiply(turn.setFromAxisAngle(VERTICAL, angle));
      });
    };

    const hold = changes ? SHIFT_AFTER + shiftSteps * SHIFT_STEP + SHIFT_HOLD : HOLD;
    timeline
      .to(t, { rise: 1, duration: RISE, ease: "power3.out", onStart: plan, onUpdate: draw })
      .addLabel("held")
      .to(t, { sway: 1, duration: hold, ease: "sine.inOut", onUpdate: draw });
    if (changes) {
      timeline.to(
        t,
        { shift: shiftSteps, duration: shiftSteps * SHIFT_STEP, ease: "none", onUpdate: draw },
        `held+=${SHIFT_AFTER}`,
      );
      // Each pip a die rolls over clicks down on the table's felt.
      for (let n = 0; n < shiftSteps; n++) {
        timeline.call(() => this.onKnock?.(6), [], `held+=${SHIFT_AFTER + (n + 0.5) * SHIFT_STEP}`);
      }
    }
    timeline.to(
      t,
      { leave: 1, duration: LEAVE, ease: "power2.in", onUpdate: draw },
      `held+=${hold}`,
    );
  }
}
