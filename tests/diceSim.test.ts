import { Quaternion } from "three";
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
