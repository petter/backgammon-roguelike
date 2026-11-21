import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { initialBoard } from "../src/core/board.ts";
import { createRng } from "../src/core/rng.ts";
import {
  DIE_HALF,
  facesFor,
  type Obstacle,
  SIM_DT,
  shownValue,
  simulateThrow,
} from "../src/render/diceSim.ts";
import { FIELD_HALF_D, FIELD_HALF_W, obstaclesOf } from "../src/render/layout.ts";

function lastFrame(frames: Float32Array) {
  const f = frames.subarray(frames.length - 7);
  return { x: f[0], y: f[1], z: f[2], q: new Quaternion(f[3], f[4], f[5], f[6]) };
}

describe("simulateThrow", () => {
  const board = obstaclesOf(initialBoard());

  it("always lands every die on the value it was asked to show", () => {
    let throws = 0;
    for (let seed = 0; seed < 300; seed++) {
      const rng = createRng(seed);
      const count = 1 + (seed % 6);
      const values = Array.from({ length: count }, () => 1 + rng.int(6));
      const side = seed % 2 === 0 ? 1 : -1;
      const result = simulateThrow(values, side, seed % 3 === 0 ? [] : board, rng.next);
      expect(result.dice).toHaveLength(count);
      result.dice.forEach((die, i) => {
        const end = lastFrame(die.frames);
        expect(shownValue(end.q, die.faces), `seed ${seed} die ${i}`).toBe(values[i]);
      });
      throws++;
    }
    expect(throws).toBe(300);
  });

  it("ends with every die lying flat on the felt, inside the rims, within a few seconds", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRng(seed + 1000);
      const result = simulateThrow([3, 5], seed % 2 === 0 ? 1 : -1, board, rng.next);
      expect(result.steps * SIM_DT).toBeLessThan(4);
      expect(result.steps * SIM_DT).toBeGreaterThan(0.4);
      for (const die of result.dice) {
        expect(die.frames).toHaveLength(result.steps * 7);
        expect(die.frames.every(Number.isFinite)).toBe(true);
        const end = lastFrame(die.frames);
        expect(Math.abs(end.x)).toBeLessThanOrEqual(FIELD_HALF_W - DIE_HALF + 1e-4);
        expect(Math.abs(end.z)).toBeLessThanOrEqual(FIELD_HALF_D - DIE_HALF + 1e-4);
        // Flat: the centre is exactly half an edge above whatever it rests on.
        const lift = end.y - DIE_HALF;
        expect(lift, `seed ${seed}`).toBeGreaterThanOrEqual(-1e-4);
      }
    }
  });

  it("almost never leaves a die on top of a checker", () => {
    let perched = 0;
    let total = 0;
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRng(seed + 5000);
      const result = simulateThrow([1, 6], seed % 2 === 0 ? 1 : -1, board, rng.next);
      for (const die of result.dice) {
        total++;
        if (lastFrame(die.frames).y > DIE_HALF + 0.05) perched++;
      }
    }
    expect(perched / total).toBeLessThan(0.03);
  });

  it("never sinks a die into the felt on the way", () => {
    const rng = createRng(77);
    const { dice } = simulateThrow([2, 4, 6], 1, board, rng.next);
    for (const die of dice) {
      for (let i = 1; i < die.frames.length; i += 7) {
        expect(die.frames[i]).toBeGreaterThanOrEqual(DIE_HALF - 1e-4);
      }
    }
  });

  it("keeps resting dice from overlapping each other", () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = createRng(seed + 9000);
      const { dice } = simulateThrow([1, 2, 3, 4, 5, 6], 1, [], rng.next);
      const ends = dice.map((die) => lastFrame(die.frames));
      for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          const gap = Math.hypot(ends[i].x - ends[j].x, ends[i].z - ends[j].z);
          expect(gap, `seed ${seed}`).toBeGreaterThan(DIE_HALF * 1.6);
        }
      }
    }
  });

  it("is the same throw for the same random sequence", () => {
    const a = simulateThrow([4, 4], -1, board, createRng(5).next);
    const b = simulateThrow([4, 4], -1, board, createRng(5).next);
    expect(a.steps).toBe(b.steps);
    expect([...a.dice[0].frames]).toEqual([...b.dice[0].frames]);
  });
});

describe("simulateThrow contacts", () => {
  const board = obstaclesOf(initialBoard());

  /** Every frame of every die, as position and orientation. */
  function* poses(frames: Float32Array) {
    for (let o = 0; o < frames.length; o += 7) {
      yield {
        x: frames[o],
        y: frames[o + 1],
        z: frames[o + 2],
        q: new Quaternion(frames[o + 3], frames[o + 4], frames[o + 5], frames[o + 6]),
      };
    }
  }

  const cases: [string, number[], 1 | -1, () => () => number][] = [
    ["five dice, constant 0", [5, 6, 1, 2, 3], -1, () => () => 0],
    ["six dice, constant just under 1", [6, 1, 2, 3, 4, 5], 1, () => () => 0.999999],
    ["six dice, constant one half", [1, 2, 3, 4, 5, 6], 1, () => () => 0.5],
    ["six dice, seed 65", [6, 1, 2, 3, 4, 5], 1, () => createRng(65).next],
  ];
  for (let seed = 0; seed < 150; seed++) {
    const count = 1 + (seed % 6);
    cases.push([
      `seed ${seed}`,
      Array.from({ length: count }, (_, i) => 1 + ((seed + i) % 6)),
      seed % 2 === 0 ? 1 : -1,
      () => createRng(seed + 300).next,
    ]);
  }

  it("keeps every corner of every die inside the rims and above the felt, in every frame", () => {
    const corner = new Vector3();
    for (const [name, values, side, random] of cases) {
      for (const obstacles of [[], board]) {
        const { dice } = simulateThrow(values, side, obstacles, random());
        // The worst corner over the whole throw, checked once per throw.
        let farX = 0;
        let farZ = 0;
        let low = Infinity;
        for (const die of dice) {
          for (const pose of poses(die.frames)) {
            for (let c = 0; c < 8; c++) {
              corner
                .set(c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1)
                .multiplyScalar(DIE_HALF)
                .applyQuaternion(pose.q);
              farX = Math.max(farX, Math.abs(corner.x + pose.x));
              farZ = Math.max(farZ, Math.abs(corner.z + pose.z));
              low = Math.min(low, corner.y + pose.y);
            }
          }
        }
        expect(farX, name).toBeLessThanOrEqual(FIELD_HALF_W + 1e-4);
        expect(farZ, name).toBeLessThanOrEqual(FIELD_HALF_D + 1e-4);
        expect(low, name).toBeGreaterThanOrEqual(-1e-4);
      }
    }
  });

  /** How far a cube reaches from its centre along a unit direction. */
  function reach(q: Quaternion, direction: Vector3): number {
    return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
      .map((axis) => Math.abs(axis.applyQuaternion(q).dot(direction)))
      .reduce((sum, part) => sum + part * DIE_HALF, 0);
  }

  it("leaves a gap between any two dice resting on the same level", () => {
    for (const [name, values, side, random] of cases) {
      for (const obstacles of [[], board]) {
        const { dice } = simulateThrow(values, side, obstacles, random());
        const ends = dice.map((die) => lastFrame(die.frames));
        for (let i = 0; i < ends.length; i++) {
          for (let j = i + 1; j < ends.length; j++) {
            if (Math.abs(ends[i].y - ends[j].y) > DIE_HALF) continue;
            const line = new Vector3(ends[j].x - ends[i].x, 0, ends[j].z - ends[i].z);
            const distance = line.length();
            line.normalize();
            // Projected onto the line between them, the two footprints do not overlap.
            const air = distance - reach(ends[i].q, line) - reach(ends[j].q, line);
            expect(air, name).toBeGreaterThanOrEqual(-1e-3);
          }
        }
      }
    }
  });

  it("never lets two dice act on each other before they touch", () => {
    // Free flight, clear of the felt and the rims: the dice must not change course while
    // there is still air between them.
    const { dice } = simulateThrow([1, 2], 1, [], createRng(1821).next);
    const a = [...poses(dice[0].frames)];
    const b = [...poses(dice[1].frames)];
    const air = (f: number) => {
      const line = new Vector3(b[f].x - a[f].x, b[f].y - a[f].y, b[f].z - a[f].z);
      const distance = line.length();
      line.normalize();
      return distance - reach(a[f].q, line) - reach(b[f].q, line);
    };
    let checked = 0;
    for (let f = 1; f < 14; f++) {
      // Only steps that begin and end with air between the dice, well above the felt.
      const airborne = [a, b].every((die) => die[f + 1].y > 0.7);
      if (!airborne || air(f) < 0.02 || air(f + 1) < 0.02) continue;
      checked++;
      // Then each die moves sideways as if the other were not there.
      for (const die of [a, b]) {
        const stepBefore = die[f].x - die[f - 1].x;
        const stepAfter = die[f + 1].x - die[f].x;
        expect(Math.abs(stepAfter - stepBefore), `frame ${f}`).toBeLessThan(1e-3);
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it("still lands on the requested values in all of those cases", () => {
    for (const [name, values, side, random] of cases) {
      const { dice } = simulateThrow(values, side, board, random());
      dice.forEach((die, i) => {
        expect(shownValue(lastFrame(die.frames).q, die.faces), name).toBe(values[i]);
      });
    }
  });
});

describe("facesFor", () => {
  it("shows each value on top for a die lying still", () => {
    for (let value = 1; value <= 6; value++) {
      expect(shownValue(new Quaternion(), facesFor(value))).toBe(value);
    }
  });
});

describe("obstaclesOf", () => {
  it("has one obstacle per checker on the board and the bar", () => {
    const board = initialBoard();
    board.bar.white = 2;
    const obstacles: Obstacle[] = obstaclesOf(board);
    expect(obstacles).toHaveLength(32);
    expect(obstacles.every((o) => o.top > 0)).toBe(true);
  });
});
